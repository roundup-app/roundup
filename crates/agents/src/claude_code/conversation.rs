//! A35: vendor storage stays here. A Mark freezes complete JSONL records, not a mutable file offset.

use std::io::Write;
use std::path::{Path, PathBuf};

use contracts::agent::{ConversationCard, ConversationOverview};
use regex::Regex;
use rpc::RpcError;
use serde_json::Value;
use std::sync::LazyLock;

use super::{Launcher, is_uuid};

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
        let dir = path
            .parent()
            .ok_or_else(|| RpcError::internal("missing conversation directory"))?;
        std::fs::create_dir_all(dir).map_err(RpcError::internal)?;
        let mut copy = tempfile::NamedTempFile::new_in(dir).map_err(RpcError::internal)?;
        for line in mark.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            let mut record: Value = serde_json::from_slice(line).map_err(RpcError::internal)?;
            if let Some(fields) = record.as_object_mut() {
                if fields.contains_key("sessionId") {
                    fields.insert("sessionId".into(), Value::String(id.clone()));
                }
            } else {
                return Err(RpcError::internal("conversation record is not an object"));
            }
            serde_json::to_writer(&mut copy, &record).map_err(RpcError::internal)?;
            copy.write_all(b"\n").map_err(RpcError::internal)?;
        }
        copy.as_file().sync_all().map_err(RpcError::internal)?;
        copy.persist_noclobber(path).map_err(RpcError::internal)?;
        Ok(id)
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
