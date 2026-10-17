//! The team mailbox of Claude Code 2.1.300, recorded under `tests/fixtures/inbox/2.1.300/`.
//!
//! Claude Code reads an inbox file only as a teammate: started with `--agent-id`, `--agent-name`
//! and `--team-name` and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, it takes the entries of
//! `<config>/teams/<team>/inboxes/<name>.json` as `<teammate-message>` turns. A teammate's
//! permission request is not a hook: it is an entry in the inbox of the team lead, and its answer
//! is an entry in the teammate's own. Roundup is the team lead, so a request reaches it as a
//! Decision (H21) and the answer goes back the same way.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::launch::ConfigLock;

/// The name Claude Code gives a team's lead.
const LEAD: &str = "team-lead";

/// The sender of a note entry.
pub const DAEMON: &str = "rupd";

/// One Agent's team: roundup is its lead and the Agent is its only teammate.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Team {
    dir: PathBuf,
    name: String,
    member: String,
}

impl Team {
    /// The team of Agent `id` under Claude Code's `config` folder. `data` (the Project's data
    /// folder) is in the name, since one config folder serves every Project.
    pub fn of(config: &Path, data: &Path, id: &str) -> Self {
        let digest = Sha256::digest(data.as_os_str().as_encoded_bytes());
        let name = format!(
            "roundup-{id}-{:02x}{:02x}{:02x}",
            digest[0], digest[1], digest[2]
        );
        Self {
            dir: config.join("teams").join(&name),
            member: format!("agent-{id}"),
            name,
        }
    }

    /// The arguments that make Claude Code a teammate of this team.
    pub fn argv(&self) -> [String; 6] {
        [
            "--agent-id".into(),
            format!("{}@{}", self.member, self.name),
            "--agent-name".into(),
            self.member.clone(),
            "--team-name".into(),
            self.name.clone(),
        ]
    }

    /// The variable that makes Claude Code read its inbox.
    pub const ENV: (&'static str, &'static str) = ("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1");

    pub fn lead_inbox(&self) -> PathBuf {
        self.inbox(LEAD)
    }

    pub fn inbox_of_agent(&self) -> PathBuf {
        self.inbox(&self.member)
    }

    fn inbox(&self, name: &str) -> PathBuf {
        self.dir.join("inboxes").join(format!("{name}.json"))
    }

    /// Write the team file Claude Code looks its lead up in, and leave both inboxes empty: an
    /// earlier Attempt's requests and answers are not this one's.
    pub fn prepare(&self, cwd: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(self.dir.join("inboxes"))?;
        let joined = OffsetDateTime::now_utc().unix_timestamp() * 1000;
        let config = json!({
            "name": self.name,
            "leadAgentId": format!("{LEAD}@{}", self.name),
            "members": [{
                "agentId": format!("{LEAD}@{}", self.name),
                "name": LEAD,
                "agentType": LEAD,
                "joinedAt": joined,
                "cwd": cwd,
            }],
        });
        std::fs::write(self.dir.join("config.json"), config.to_string())?;
        for inbox in [self.lead_inbox(), self.inbox_of_agent()] {
            write_entries(&inbox, &[])?;
        }
        Ok(())
    }

    /// Append `entry` to the Agent's inbox as sent by `from`; `text` is its whole body.
    pub fn deliver(&self, from: &str, text: &str, summary: Option<&str>) -> std::io::Result<()> {
        append(&self.inbox_of_agent(), entry(from, text, summary))
    }

    /// Answer `request` with the reply a `PermissionRequest` hook would have printed. `false`
    /// when that reply decides nothing, which leaves the request waiting.
    pub fn answer(&self, request: &Request, reply: &str) -> std::io::Result<bool> {
        let Some(response) = response(request, reply) else {
            return Ok(false);
        };
        self.deliver(LEAD, &response.to_string(), None)?;
        Ok(true)
    }
}

/// An entry of an inbox, in the shape Claude Code writes.
fn entry(from: &str, text: &str, summary: Option<&str>) -> Value {
    let stamp = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("a UTC time formats");
    let mut entry = json!({ "from": from, "text": text, "timestamp": stamp, "read": false });
    if let Some(summary) = summary {
        entry["summary"] = summary.into();
    }
    entry
}

/// The entries of the inbox at `path`; an inbox that does not exist yet holds none.
fn read_entries(path: &Path) -> std::io::Result<Vec<Value>> {
    match std::fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(Value::Array(entries)) => Ok(entries),
            _ => Err(std::io::Error::other(format!(
                "{} is not a list of entries",
                path.display()
            ))),
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(err) => Err(err),
    }
}

/// Replace the inbox at `path` whole, so a reader never sees half of it.
fn write_entries(path: &Path, entries: &[Value]) -> std::io::Result<()> {
    let folder = path.parent().expect("an inbox has a folder");
    let mut file = tempfile::NamedTempFile::new_in(folder)?;
    serde_json::to_writer_pretty(&mut file, entries)?;
    file.persist(path).map_err(|err| err.error)?;
    Ok(())
}

/// Add `entry` to the inbox at `path` under the lock Claude Code holds while it marks entries read.
fn append(path: &Path, entry: Value) -> std::io::Result<()> {
    let _lock = ConfigLock::take(path)?;
    let mut entries = read_entries(path)?;
    entries.push(entry);
    write_entries(path, &entries)
}

/// A permission request a teammate left in the lead's inbox.
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub id: String,
    pub tool_use_id: String,
    /// The `PermissionRequest` payload of the hook that would have carried it.
    pub payload: Value,
}

/// The permission requests in the inbox at `path`, in order; an entry of any other kind, and one
/// that is not readable, is skipped.
pub fn requests(path: &Path) -> std::io::Result<Vec<Request>> {
    Ok(read_entries(path)?
        .iter()
        .filter_map(|entry| {
            let body: Value = serde_json::from_str(entry["text"].as_str()?).ok()?;
            (body["type"] == "permission_request").then_some(())?;
            Some(Request {
                id: body["request_id"].as_str()?.to_owned(),
                tool_use_id: body["tool_use_id"].as_str().unwrap_or_default().to_owned(),
                payload: json!({
                    "hook_event_name": "PermissionRequest",
                    "tool_name": body["tool_name"],
                    "tool_input": body["input"],
                    "tool_use_id": body["tool_use_id"],
                }),
            })
        })
        .collect())
}

/// What the teammate is told for `reply`, the output of a `PermissionRequest` hook: `allow` lets
/// the tool run with its own input, `deny` fails it with the hook's message; anything else decides
/// nothing.
fn response(request: &Request, reply: &str) -> Option<Value> {
    let decision =
        serde_json::from_str::<Value>(reply).ok()?["hookSpecificOutput"]["decision"].clone();
    let mut response = json!({
        "type": "permission_response",
        "request_id": request.id,
        "tool_use_id": request.tool_use_id,
    });
    match decision["behavior"].as_str()? {
        "allow" => {
            response["subtype"] = "success".into();
            response["response"] = json!({ "updated_input": request.payload["tool_input"] });
        }
        "deny" => {
            response["subtype"] = "error".into();
            response["error"] = decision["message"].as_str().unwrap_or("Denied").into();
        }
        _ => return None,
    }
    Some(response)
}
