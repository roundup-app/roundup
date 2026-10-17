//! B50, B51: Claude Code's own inbox, the mailbox it reads for a message from another session. A
//! `note` is written here instead of typed. The path and the entry shape are this adapter's,
//! recorded as the fixtures under `tests/fixtures/inbox/<version>/` for each supported version.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use contracts::agent::Inbox;
use serde_json::{Value, json};

use super::Launcher;

/// The versions of the installed Claude Code this adapter holds an inbox fixture for.
const SUPPORTED: [&str; 1] = ["2.1.296"];

/// How long `claude --version` may take before the version counts as unknown.
const VERSION_BOUND: Duration = Duration::from_secs(5);

/// The team every roundup Agent's inbox sits in.
const TEAM: &str = "roundup";

/// B50(d): the longest entry text one line of the TUI shows, `[cut]` included.
const LINE_BYTES: usize = 200;
const CUT: &str = "[cut]";

/// One note for an inbox: `id` is the Message's, `from` the sender's name. `one_line` asks for
/// the text to be cut to one line of the TUI (B50(d)).
pub struct Entry {
    pub id: u32,
    pub from: String,
    pub text: String,
    pub one_line: bool,
}

fn entry_id(id: u32) -> String {
    format!("rup-{id}")
}

/// B50(d): `text` as one line: cut at a character boundary so the whole, `[cut]` included, is at
/// most 200 bytes, when it is longer.
fn one_line(text: &str) -> String {
    if text.len() <= LINE_BYTES {
        return text.to_owned();
    }
    let mut end = LINE_BYTES - CUT.len();
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{CUT}", &text[..end])
}

impl Launcher {
    fn inbox_path(&self, agent: &str) -> PathBuf {
        self.conversation_dir
            .join("teams")
            .join(TEAM)
            .join("inboxes")
            .join(format!("{agent}.json"))
    }

    /// The installed Claude Code's version, from `claude --version`; `None` when it does not
    /// answer in time with a version. A version found once is kept.
    async fn version(&self) -> Option<String> {
        self.version
            .get_or_try_init(|| async { self.ask_version().await.ok_or(()) })
            .await
            .ok()
            .cloned()
    }

    async fn ask_version(&self) -> Option<String> {
        let run = tokio::process::Command::new(&self.bin)
            .arg("--version")
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .output();
        let out = tokio::time::timeout(VERSION_BOUND, run)
            .await
            .ok()?
            .ok()
            .filter(|out| out.status.success())?;
        let text = String::from_utf8(out.stdout).ok()?;
        let word = text.split_whitespace().next()?;
        word.split('.')
            .all(|part| part.parse::<u32>().is_ok())
            .then(|| word.to_owned())
    }

    /// B51: the state of Agent `agent`'s inbox: `missing` when it cannot be found, created or
    /// read; `mismatch` when its format, or the installed version, has no fixture here.
    pub async fn inbox_check(&self, agent: &str) -> Inbox {
        let path = self.inbox_path(agent);
        let read = path.parent().map_or(Err(()), |dir| {
            std::fs::create_dir_all(dir).map_err(drop)?;
            if !path.exists() {
                std::fs::write(&path, "[]").map_err(drop)?;
            }
            std::fs::read(&path).map_err(drop)
        });
        let Ok(bytes) = read else {
            return Inbox::Missing;
        };
        if entries(&bytes).is_none() {
            return Inbox::Mismatch;
        }
        match self.version().await {
            Some(version) if SUPPORTED.contains(&version.as_str()) => Inbox::Ok,
            _ => Inbox::Mismatch,
        }
    }

    /// B50(a), B50(c): appends one inbox entry per note, skipping an id already there so a note is
    /// in the inbox at most once. Nothing is written unless the file parses (B51(a)); the answer
    /// names the failed state.
    pub fn inbox_write(&self, agent: &str, notes: &[Entry]) -> Result<(), Inbox> {
        let path = self.inbox_path(agent);
        let bytes = std::fs::read(&path).map_err(|_| Inbox::Missing)?;
        let mut all = entries(&bytes).ok_or(Inbox::Mismatch)?;
        let now = timestamp();
        for note in notes {
            let id = entry_id(note.id);
            if all.iter().any(|entry| entry["id"] == id) {
                continue;
            }
            all.push(json!({
                "id": id, "from": note.from, "text": if note.one_line { one_line(&note.text) } else { note.text.clone() }, "timestamp": now, "read": false,
            }));
        }
        let dir = path.parent().ok_or(Inbox::Missing)?;
        let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|_| Inbox::Missing)?;
        let body = serde_json::to_vec(&all).map_err(|_| Inbox::Mismatch)?;
        file.write_all(&body).map_err(|_| Inbox::Missing)?;
        file.persist(&path).map_err(|_| Inbox::Missing)?;
        Ok(())
    }
}

/// The entries of an inbox file, or `None` when it is not the fixtures' format: an array of
/// objects, each with a `from`, a `text`, a `timestamp` (strings) and `read` (a boolean).
fn entries(bytes: &[u8]) -> Option<Vec<Value>> {
    let Value::Array(all) = serde_json::from_slice(bytes).ok()? else {
        return None;
    };
    let fits = |entry: &Value| {
        ["from", "text", "timestamp"]
            .iter()
            .all(|key| entry[key].is_string())
            && entry["read"].is_boolean()
    };
    all.iter().all(fits).then_some(all)
}

/// The Message ids the transcript at `path` records as another session's message, from byte
/// `from` on, and the offset to continue from: the end of the last complete line.
pub fn recorded(path: &Path, from: u64) -> (Vec<u32>, u64) {
    let Ok(bytes) = std::fs::read(path) else {
        return (Vec::new(), from);
    };
    let start = usize::try_from(from).unwrap_or(usize::MAX).min(bytes.len());
    let tail = &bytes[start..];
    let end = tail
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |end| end + 1);
    let ids = tail[..end]
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .filter(|record| record["type"] == "teammate_message")
        .filter_map(|record| record["id"].as_str()?.strip_prefix("rup-")?.parse().ok())
        .collect();
    (ids, (start + end) as u64)
}

/// The transcript file a hook payload names.
pub fn transcript_of(payload: &Value) -> Option<PathBuf> {
    payload["transcript_path"].as_str().map(PathBuf::from)
}

/// Now as an RFC 3339 timestamp, the way Claude Code writes its own entries.
fn timestamp() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
