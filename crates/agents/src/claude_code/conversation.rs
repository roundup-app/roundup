//! A35: vendor storage stays here. A Mark freezes complete JSONL records, not a mutable file offset.

use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

use contracts::agent::{ConversationCard, ConversationOverview};
use regex::Regex;
use rpc::RpcError;
use serde_json::Value;
use std::sync::LazyLock;

use super::{Launcher, is_uuid};

#[derive(serde::Serialize, serde::Deserialize)]
struct RetainedCopy {
    path: PathBuf,
    owner: PathBuf,
    text: String,
}

impl RetainedCopy {
    fn read(ownership: &[u8]) -> Result<Self, RpcError> {
        serde_json::from_slice(ownership).map_err(RpcError::internal)
    }

    fn metadata(path: &Path) -> Result<Option<std::fs::Metadata>, RpcError> {
        match std::fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_file() => Ok(Some(metadata)),
            Ok(_) => Err(RpcError::conflict(
                "retained conversation ownership changed; preserving it",
            )),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(RpcError::internal(err)),
        }
    }

    fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
        a.dev() == b.dev() && a.ino() == b.ino()
    }

    fn sync(&self) -> Result<(), RpcError> {
        let mut dir = self.path.parent();
        // Persist the transcript entry and the newly made vendor project/config directories.
        for _ in 0..4 {
            let Some(path) = dir else {
                break;
            };
            std::fs::File::open(path)
                .and_then(|dir| dir.sync_all())
                .map_err(RpcError::internal)?;
            dir = path.parent();
        }
        Ok(())
    }
}

impl Launcher {
    fn conversation_path(&self, cwd: &Path, id: &str) -> Result<PathBuf, RpcError> {
        if !is_uuid(id) {
            return Err(RpcError::internal("invalid saved conversation id"));
        }
        let cwd = cwd.canonicalize().map_err(RpcError::internal)?;
        let project: String = cwd
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        Ok(self
            .conversation_dir
            .join("projects")
            .join(project)
            .join(format!("{id}.jsonl")))
    }

    #[cfg(test)]
    pub(crate) fn replace_retained_for_test(
        &self,
        cwd: &Path,
        id: &str,
        bytes: &[u8],
    ) -> Result<(), RpcError> {
        std::fs::write(self.conversation_path(cwd, id)?, bytes).map_err(RpcError::internal)
    }

    #[cfg(test)]
    pub(crate) fn assert_retained_for_test(&self, cwd: &Path, id: &str, expected: &[u8]) {
        assert_eq!(
            std::fs::read(self.conversation_path(cwd, id).unwrap()).unwrap(),
            expected
        );
    }

    #[cfg(test)]
    pub(crate) fn retained_copy_exists_for_test(&self, ownership: &[u8]) -> bool {
        RetainedCopy::read(ownership)
            .unwrap()
            .path
            .try_exists()
            .unwrap()
    }

    #[cfg(test)]
    pub(crate) fn interrupt_copy_for_test(&self, ownership: &[u8]) {
        let copy = RetainedCopy::read(ownership).unwrap();
        std::fs::remove_file(copy.path).unwrap();
        std::fs::write(copy.owner, b"{").unwrap();
    }

    #[cfg(test)]
    pub(crate) fn copy_owner_exists_for_test(&self, ownership: &[u8]) -> bool {
        RetainedCopy::read(ownership)
            .unwrap()
            .owner
            .try_exists()
            .unwrap()
    }

    /// A2681a: a missing or unreadable transcript has no display parts.
    pub fn read_overview(&self, cwd: &Path, id: &str) -> Option<ConversationOverview> {
        let path = self.conversation_path(cwd, id).ok()?;
        let text = std::fs::read_to_string(path).ok()?;
        let mut name = None;
        let mut custom_name = None;
        let mut used = None;
        let mut limit = None;
        let mut card = ConversationCard::default();
        for line in text.lines() {
            let Ok(record) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if record["type"] == "assistant" {
                let content = &record["message"]["content"];
                let text = if let Some(text) = content.as_str() {
                    text.to_owned()
                } else {
                    content
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|block| block["type"] == "text")
                        .filter_map(|block| block["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                };
                merge_cards(&mut card, &text);
                limit = record["message"]["model"].as_str().and_then(context_limit);
                let usage = &record["message"]["usage"];
                used = usage["input_tokens"].as_u64().and_then(|input| {
                    input
                        .checked_add(usage["cache_read_input_tokens"].as_u64().unwrap_or(0))?
                        .checked_add(usage["cache_creation_input_tokens"].as_u64().unwrap_or(0))
                });
            }
            if record["type"] == "custom-title"
                && let Some(title) = record["customTitle"]
                    .as_str()
                    .filter(|s| !s.trim().is_empty())
            {
                custom_name = Some(title.to_owned());
            }
            if record["type"] == "ai-title"
                && let Some(title) = record["aiTitle"].as_str().filter(|s| !s.trim().is_empty())
            {
                name = Some(title.to_owned());
            }
        }
        if card.facts.as_ref().is_some_and(Vec::is_empty) {
            card.facts = None;
        }
        Some(ConversationOverview {
            program: "Claude Code".into(),
            id: id.into(),
            name: custom_name.or(name),
            used,
            limit,
            card: (card != ConversationCard::default()).then_some(card),
        })
    }

    /// A saved id whose file is missing is an error, never an empty conversation.
    pub fn record_conversation(&self, cwd: &Path, id: &str) -> Result<Vec<u8>, RpcError> {
        let path = self.conversation_path(cwd, id)?;
        let mut bytes = std::fs::read(&path)
            .map_err(|err| RpcError::internal(format!("cannot read saved conversation: {err}")))?;
        // Claude appends records. A concurrent incomplete last record belongs to a later Mark.
        let end = bytes
            .iter()
            .rposition(|b| *b == b'\n')
            .map_or(0, |end| end + 1);
        if end == 0 {
            return Err(RpcError::internal(
                "saved conversation has no complete records",
            ));
        }
        bytes.truncate(end);
        for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            let record: Value = serde_json::from_slice(line).map_err(RpcError::internal)?;
            if !record.is_object() {
                return Err(RpcError::internal("conversation record is not an object"));
            }
        }
        Ok(bytes)
    }

    /// Create a new conversation from the frozen end, without opening the original for writing.
    /// Returns the id A22's launcher can resume; nothing starts or changes the Rail here.
    pub fn copy_conversation(&self, cwd: &Path, mark: &[u8]) -> Result<String, RpcError> {
        let (id, ownership) = self.prepare_conversation(cwd, mark)?;
        let copy = RetainedCopy::read(&ownership)?;
        let dir = copy
            .path
            .parent()
            .ok_or_else(|| RpcError::internal("missing conversation directory"))?;
        std::fs::create_dir_all(dir).map_err(RpcError::internal)?;
        let mut file = tempfile::NamedTempFile::new_in(dir).map_err(RpcError::internal)?;
        file.write_all(copy.text.as_bytes())
            .map_err(RpcError::internal)?;
        file.as_file().sync_all().map_err(RpcError::internal)?;
        file.persist_noclobber(&copy.path)
            .map_err(RpcError::internal)?;
        copy.sync()?;
        Ok(id)
    }

    /// Reserve an opaque ownership record before creating a retained vendor file. The Rail
    /// stores these bytes without interpreting vendor paths or records (P4).
    pub(crate) fn prepare_conversation(
        &self,
        cwd: &Path,
        mark: &[u8],
    ) -> Result<(String, Vec<u8>), RpcError> {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(RpcError::internal)?;
        random[6] = (random[6] & 0x0f) | 0x40;
        random[8] = (random[8] & 0x3f) | 0x80;
        let hex: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let id = format!(
            "{}-{}-{}-{}-{}",
            &hex[..8],
            &hex[8..12],
            &hex[12..16],
            &hex[16..20],
            &hex[20..]
        );
        let path = self.conversation_path(cwd, &id)?;
        if path.try_exists().map_err(RpcError::internal)? {
            return Err(RpcError::conflict(
                "retained conversation destination exists",
            ));
        }
        let end = mark
            .iter()
            .rposition(|b| *b == b'\n')
            .map_or(0, |at| at + 1);
        if end == 0 {
            return Err(RpcError::internal("conversation has no complete records"));
        }
        let mut bytes = Vec::new();
        for line in mark[..end]
            .split(|b| *b == b'\n')
            .filter(|line| !line.is_empty())
        {
            let mut record: Value = serde_json::from_slice(line).map_err(RpcError::internal)?;
            let fields = record
                .as_object_mut()
                .ok_or_else(|| RpcError::internal("conversation record is not an object"))?;
            if fields.contains_key("sessionId") {
                fields.insert("sessionId".into(), Value::String(id.clone()));
            }
            serde_json::to_writer(&mut bytes, &record).map_err(RpcError::internal)?;
            bytes.push(b'\n');
        }
        let owner = path.with_extension("roundup-owned");
        if owner.try_exists().map_err(RpcError::internal)? {
            return Err(RpcError::conflict(
                "retained conversation ownership destination exists",
            ));
        }
        let copy = RetainedCopy {
            path,
            owner,
            text: String::from_utf8(bytes).map_err(RpcError::internal)?,
        };
        let ownership = serde_json::to_vec(&copy).map_err(RpcError::internal)?;
        Ok((id, ownership))
    }

    pub(crate) fn write_conversation(&self, ownership: &[u8]) -> Result<(), RpcError> {
        let copy = RetainedCopy::read(ownership)?;
        let dir = copy
            .path
            .parent()
            .ok_or_else(|| RpcError::internal("missing conversation directory"))?;
        std::fs::create_dir_all(dir).map_err(RpcError::internal)?;
        // The recorded scratch identity owns any interrupted write. Only a complete, synced
        // file gets a transcript name; retain its hard link until the Rail publication commits.
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&copy.owner)
            .map_err(RpcError::internal)?;
        file.write_all(copy.text.as_bytes())
            .map_err(RpcError::internal)?;
        file.sync_all().map_err(RpcError::internal)?;
        std::fs::hard_link(&copy.owner, &copy.path).map_err(RpcError::internal)?;
        copy.sync()
    }

    /// Unpublished transcript removal requires both the original inode proof and exact
    /// complete bytes. User truncation, replacement and symlinks all refuse recovery.
    pub(crate) fn discard_conversation(&self, ownership: &[u8]) -> Result<(), RpcError> {
        let copy = RetainedCopy::read(ownership)?;
        let owner = RetainedCopy::metadata(&copy.owner)?;
        if let Some(actual) = RetainedCopy::metadata(&copy.path)? {
            if !owner
                .as_ref()
                .is_some_and(|owner| RetainedCopy::same_file(owner, &actual))
                || std::fs::read(&copy.path).map_err(RpcError::internal)? != copy.text.as_bytes()
            {
                return Err(RpcError::conflict(
                    "retained conversation ownership or contents changed; preserving it",
                ));
            }
            std::fs::remove_file(&copy.path).map_err(RpcError::internal)?;
            copy.sync()?;
        }
        if owner.is_some() {
            // No transcript existed during an interrupted scratch write. Only its exact
            // reserved prefix is ours; an unrelated scratch replacement stays untouched.
            let actual = std::fs::read(&copy.owner).map_err(RpcError::internal)?;
            if !copy.text.as_bytes().starts_with(&actual) {
                return Err(RpcError::conflict(
                    "retained conversation ownership changed; preserving it",
                ));
            }
            std::fs::remove_file(&copy.owner).map_err(RpcError::internal)?;
            copy.sync()?;
        }
        Ok(())
    }

    /// Publication owns the transcript now. Release only the proof link, accepting user
    /// edits to the published inode and safely repeating after a crash during release.
    pub(crate) fn finish_conversation(&self, ownership: &[u8]) -> Result<(), RpcError> {
        let copy = RetainedCopy::read(ownership)?;
        let Some(owner) = RetainedCopy::metadata(&copy.owner)? else {
            return Ok(());
        };
        if let Some(actual) = RetainedCopy::metadata(&copy.path)? {
            if !RetainedCopy::same_file(&owner, &actual) {
                return Err(RpcError::conflict(
                    "retained conversation ownership changed; preserving proof",
                ));
            }
        } else if std::fs::read(&copy.owner).map_err(RpcError::internal)? != copy.text.as_bytes() {
            return Err(RpcError::conflict(
                "retained conversation proof changed; preserving it",
            ));
        }
        std::fs::remove_file(&copy.owner).map_err(RpcError::internal)?;
        copy.sync()
    }
}

// Claude Code windows, rather than the API's maximum: 4.6 requires [1m].
// https://code.claude.com/docs/en/model-config#extended-context (2026-10-18).
// https://platform.claude.com/docs/en/models/overview (Haiku 4.5: 200k).
// Exact known ids only: a future model or gateway alias has no invented limit.
fn context_limit(model: &str) -> Option<u64> {
    match model {
        "claude-haiku-4-5"
        | "claude-haiku-4-5-20251001"
        | "claude-sonnet-4-5"
        | "claude-sonnet-4-5-20250929"
        | "claude-opus-4-5"
        | "claude-opus-4-5-20251101"
        | "claude-opus-4-6"
        | "claude-sonnet-4-6" => Some(200_000),
        "claude-opus-4-6[1m]"
        | "claude-sonnet-4-6[1m]"
        | "claude-opus-4-7"
        | "claude-opus-4-8"
        | "claude-opus-5"
        | "claude-opus-5-5"
        | "claude-sonnet-5"
        | "claude-sonnet-5-5"
        | "claude-haiku-5-5"
        | "claude-fable-5"
        | "claude-fable-5-1" => Some(1_000_000),
        _ => None,
    }
}

// Same pattern as moo.md hunch/hooks/tend.tsx CARD_RE, with multiline ^ instead of lookbehind.
static CARD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^```card[^\S\n]*\n([\s\S]*?)\n```[^\S\n]*\n?").expect("card fence pattern")
});

fn merge_cards(card: &mut ConversationCard, text: &str) {
    // Forward overwrite is equivalent to latestCard's reverse first-write: absent/invalid
    // keys do nothing, and a present [] replaces the old facts before omission on the wire.
    for block in CARD_RE.captures_iter(text) {
        let Ok(Value::Object(fields)) = serde_json::from_str::<Value>(&block[1]) else {
            continue;
        };
        for (key, target) in [
            ("intent", &mut card.intent),
            ("shape", &mut card.shape),
            ("outcome", &mut card.outcome),
        ] {
            if let Some(value) = fields
                .get(key)
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
            {
                *target = Some(value.to_owned());
            }
        }
        if let Some(facts) = fields.get("facts").and_then(Value::as_array) {
            card.facts = Some(
                facts
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|s| !s.trim().is_empty())
                    .map(str::to_owned)
                    .collect(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u2875c_copy_recovery_preserves_replaced_or_truncated_user_files() {
        for replace in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let launcher = Launcher::new(
                "unused",
                dir.path().join("config.json"),
                dir.path().join("rup"),
                None,
            );
            let (id, ownership) = launcher
                .prepare_conversation(dir.path(), b"{\"sessionId\":\"external\"}\n")
                .unwrap();
            launcher.write_conversation(&ownership).unwrap();
            let path = launcher.conversation_path(dir.path(), &id).unwrap();
            let bytes = std::fs::read(&path).unwrap();
            let changed = if replace {
                std::fs::remove_file(&path).unwrap();
                bytes
            } else {
                bytes[..1].to_vec()
            };
            std::fs::write(&path, &changed).unwrap();
            assert!(launcher.discard_conversation(&ownership).is_err());
            assert_eq!(std::fs::read(path).unwrap(), changed);
        }
    }
}
