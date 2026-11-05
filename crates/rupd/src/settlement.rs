//! DCL6: once a Door's children have changed and then come to rest, the Door hears one settled
//! note, so it reconciles its Todos and Pads and summarizes. The note, the Door's reply and the
//! note's own delivery are never a child change, so none of them arms another.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

use contracts::agent::{NodeKind, RailNode};
use contracts::message::{Message, MessageStatus};
use contracts::{Actor, Kind};
use rusqlite::{Connection, OptionalExtension};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::digest::{Reader, World};

/// Where the note names the child changes it answers, so a crash after sending finds it again.
const TOKEN: &str = "settlement:";

/// Where the stop note names the child changes it answers.
const STOP: &str = "settlement-stop:";

/// The markers `door_settlement` stores in `project.db`; in memory when none is given.
pub struct Settlements(Mutex<Connection>);

impl Default for Settlements {
    fn default() -> Self {
        let store = Self(Mutex::new(
            Connection::open_in_memory().expect("in-memory settlement store"),
        ));
        store.migrate().expect("settlement schema");
        store
    }
}

impl Settlements {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        Ok(Self(Mutex::new(Connection::open(path)?)))
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let db = self.0.lock().unwrap_or_else(|p| p.into_inner());
        db.execute_batch(include_str!(
            "../migrations/project/0049-door-settlement.sql"
        ))
    }

    fn row(&self, door: &str) -> rusqlite::Result<(Option<String>, Option<String>)> {
        let db = self.0.lock().unwrap_or_else(|p| p.into_inner());
        Ok(db
            .query_row(
                "SELECT settled, publishing FROM door_settlement WHERE door = ?1",
                [door],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .unwrap_or_default())
    }

    fn write(
        &self,
        door: &str,
        settled: Option<&str>,
        publishing: Option<&str>,
    ) -> rusqlite::Result<()> {
        let db = self.0.lock().unwrap_or_else(|p| p.into_inner());
        db.execute(
            "INSERT INTO door_settlement (door, settled, publishing) VALUES (?1, ?2, ?3)
             ON CONFLICT(door) DO UPDATE SET settled = ?2, publishing = ?3",
            rusqlite::params![door, settled, publishing],
        )
        .map(drop)
    }
}

/// Every Agent below `door`, nested Workstreams included.
fn descendants<'a>(nodes: &'a [RailNode], door: &str) -> Vec<&'a RailNode> {
    let mut found: Vec<&RailNode> = Vec::new();
    let mut parents = vec![door.to_owned()];
    while let Some(parent) = parents.pop() {
        for node in nodes
            .iter()
            .filter(|n| n.parent.as_deref() == Some(&parent))
        {
            if node.kind == NodeKind::Agent {
                found.push(node);
            }
            parents.push(node.id.clone());
        }
    }
    found
}

/// What the children are, as one string: it moves when a child finishes a turn, is replaced or
/// restarts, and by nothing the Door or the Daemon does.
fn marker(children: &[&RailNode]) -> String {
    let mut parts: Vec<String> = children
        .iter()
        .map(|c| {
            let finished = c.status.as_ref().map_or("0", |s| s.finished.as_str());
            format!("{}/{}/{finished}", c.id, c.attempt.as_deref().unwrap_or(""))
        })
        .collect();
    parts.sort();
    let sum = Sha256::digest(parts.join("\n"));
    sum[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// A child is at work, waiting on something or asking the user.
fn busy(child: &RailNode) -> bool {
    child
        .status
        .as_ref()
        .is_some_and(|s| matches!(s.kind, Kind::Working | Kind::Blocked | Kind::NeedsYou))
}

/// A Door whose children changed and now rest: the marker to answer, and whether a crashed pass
/// already sent its note.
struct Due {
    door: String,
    marker: String,
    sent: bool,
    /// The names of the open Jobs when this is their stop note, not the settled note.
    stop: Vec<String>,
}

/// DCL6: every Door to settle. `open` holds the Jobs with no report of their current Attempt and
/// `waiting` what each Door has not yet been sent.
fn due(
    nodes: &[RailNode],
    sent: &[Message],
    open: &HashSet<String>,
    waiting: &HashMap<String, u32>,
    store: &Settlements,
) -> Vec<Due> {
    let mut due = Vec::new();
    for door in nodes.iter().filter(|n| n.kind == NodeKind::Workstream) {
        let children = descendants(nodes, &door.id);
        let ids: HashSet<&str> = children
            .iter()
            .map(|c| c.id.as_str())
            .chain([door.id.as_str()])
            .collect();
        let pending = sent
            .iter()
            .any(|m| m.status == MessageStatus::Pending && ids.contains(m.to.as_str()));
        // A child that never finished a turn changed nothing worth settling.
        let finished = children
            .iter()
            .any(|c| c.status.as_ref().is_some_and(|s| s.finished != "0"));
        if !finished
            || pending
            || waiting.get(&door.id).is_some_and(|n| *n > 0)
            || busy(door)
            || children.iter().any(|c| busy(c))
        {
            continue;
        }
        let marker = marker(&children);
        // An unfinished Job is never counted complete: its stop note gives the Door the choice to
        // resume, replace or accept it first. Once that note is delivered the Door has chosen.
        let stops = |m: &&Message| m.to == door.id && m.body.contains(&format!("{STOP}{marker}"));
        let jobs: Vec<String> = children
            .iter()
            .filter(|c| open.contains(&c.id))
            .map(|c| c.name.clone())
            .collect();
        if !jobs.is_empty() {
            let (waiting_on_door, told) =
                sent.iter()
                    .filter(stops)
                    .fold((false, false), |(waiting, told), m| match m.status {
                        MessageStatus::Pending => (true, told),
                        _ => (waiting, true),
                    });
            if waiting_on_door {
                continue;
            }
            if !told {
                due.push(Due {
                    door: door.id.clone(),
                    marker,
                    sent: false,
                    stop: jobs,
                });
                continue;
            }
        }
        let (settled, publishing) = match store.row(&door.id) {
            Ok(row) => row,
            Err(err) => {
                eprintln!("settlement of {} not read: {err}", door.id);
                continue;
            }
        };
        if settled.as_deref() == Some(&marker) {
            continue;
        }
        let token = format!("{TOKEN}{marker}");
        due.push(Due {
            sent: publishing.as_deref() == Some(&marker)
                && sent
                    .iter()
                    .any(|m| m.to == door.id && m.body.contains(&token)),
            door: door.id.clone(),
            marker,
            stop: Vec::new(),
        });
    }
    due
}

/// One pass: each Door whose children changed since its last settled note and now rest gets one.
pub(crate) async fn settle(
    reader: &Reader,
    messages: &messages::Messages,
    store: &Settlements,
    world: &World,
    waiting: &HashMap<String, u32>,
) {
    let Some(agents) = reader.agents() else {
        return;
    };
    let open: HashSet<String> = match agents.open_jobs(|id| {
        Ok(messages
            .result_reports(id)?
            .into_iter()
            .map(|report| report.attempt)
            .collect())
    }) {
        Ok(jobs) => jobs.into_iter().map(|job| job.id).collect(),
        Err(err) => {
            eprintln!("settlement could not read open Jobs: {err}");
            return;
        }
    };
    for due in due(world.nodes(), world.messages(), &open, waiting, store) {
        let Due {
            door,
            marker,
            sent,
            stop,
        } = due;
        if !stop.is_empty() {
            let body = format!(
                "[stopped] Every Agent in this Workstream is at rest, but {} has no report of its \
                 current Attempt ({STOP}{marker}). For each, resume it, replace it, or accept \
                 its outcome as it stands; the Workstream settles after you have.",
                stop.join(", ")
            );
            let reply = reader
                .call::<Message>(
                    "message",
                    "message.send",
                    json!({"to": door, "kind": "note", "body": body}),
                    Actor::daemon(),
                )
                .await;
            if let Err(err) = reply {
                eprintln!("stop note for {door} not sent: {err}");
            }
            continue;
        }
        if !sent {
            // Written before the note, so a crash after sending finds the note by its token.
            let settled = store.row(&door).ok().and_then(|(settled, _)| settled);
            if let Err(err) = store.write(&door, settled.as_deref(), Some(&marker)) {
                eprintln!("settlement of {door} not stored: {err}");
                continue;
            }
            let body = format!(
                "[settled] Every Agent in this Workstream is at rest ({TOKEN}{marker}). Read the \
                 authoritative Todos and Pads, reconcile them with what the Agents reported, then \
                 summarize for the user what is done and what remains."
            );
            let reply = reader
                .call::<Message>(
                    "message",
                    "message.send",
                    json!({"to": door, "kind": "note", "body": body}),
                    Actor::daemon(),
                )
                .await;
            if let Err(err) = reply {
                eprintln!("settled note for {door} not sent: {err}");
                continue;
            }
        }
        if let Err(err) = store.write(&door, Some(&marker), None) {
            eprintln!("settlement of {door} not stored: {err}");
        }
    }
}

#[cfg(test)]
#[path = "settlement_tests.rs"]
mod tests;
