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

/// The markers `door_settlement` stores in `project.db`; in memory when none is given.
pub struct Settlements(Mutex<Connection>);

impl Default for Settlements {
    fn default() -> Self {
        let db = Connection::open_in_memory().expect("in-memory settlement store");
        db.execute_batch(include_str!(
            "../migrations/project/0049-door-settlement.sql"
        ))
        .expect("settlement schema");
        Self(Mutex::new(db))
    }
}

impl Settlements {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        Ok(Self(Mutex::new(Connection::open(path)?)))
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
            || children.iter().any(|c| busy(c) || open.contains(&c.id))
        {
            continue;
        }
        let marker = marker(&children);
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
        let Due { door, marker, sent } = due;
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
mod tests {
    use super::*;
    use contracts::Status;
    use serde_json::json;

    fn node(id: &str, kind: &str, parent: Option<&str>, status: Kind, finished: &str) -> RailNode {
        let mut node: RailNode = serde_json::from_value(json!({
            "id": id, "kind": kind, "name": id, "parent": parent, "order": 0,
            "status": null, "attempt": "1", "status_revision": null, "terminal_id": null,
            "worktree": null, "can_resume": false, "channel": null, "work": null, "stray": [],
            "model": null, "effort": null,
        }))
        .unwrap();
        node.status = Some(Status {
            kind: status,
            label: String::new(),
            since: 0,
            finished: finished.into(),
        });
        node
    }

    fn note(id: u32, to: &str, body: &str, status: MessageStatus) -> Message {
        serde_json::from_value(json!({
            "id": id, "from": {"kind": "user", "id": "", "parent": null}, "to": to,
            "kind": "note", "body": body, "replyTo": null,
            "status": serde_json::to_value(status).unwrap(), "reason": null, "at": 0,
        }))
        .unwrap()
    }

    fn rest(consult: Kind, finished: &str) -> Vec<RailNode> {
        vec![
            node("door", "workstream", None, Kind::Idle, "0"),
            node("job", "agent", Some("door"), Kind::Idle, finished),
            node("consult", "agent", Some("door"), consult, "0"),
        ]
    }

    #[test]
    fn dcl6_quiescence_with_idle_consult_costs_one_door_turn() {
        let store = Settlements::default();
        let none = HashSet::new();
        let nothing = HashMap::new();
        // A working child holds settlement; an idle Consult does not.
        assert!(due(&rest(Kind::Working, "1"), &[], &none, &nothing, &store).is_empty());
        let settled = due(&rest(Kind::Idle, "1"), &[], &none, &nothing, &store);
        assert_eq!(settled.len(), 1);
        assert_eq!(settled[0].door, "door");
        let marker = settled[0].marker.clone();
        store.write("door", Some(&marker), None).unwrap();
        // The note's delivery and the Door's reply change no child: no second note.
        let delivered = [note(
            1,
            "door",
            &format!("{TOKEN}{marker}"),
            MessageStatus::Delivered,
        )];
        assert!(due(&rest(Kind::Idle, "1"), &delivered, &none, &nothing, &store).is_empty());
        // A later child change followed by rest settles once more.
        let again = due(&rest(Kind::Idle, "2"), &delivered, &none, &nothing, &store);
        assert_eq!(again.len(), 1);
        assert_ne!(again[0].marker, marker);
    }

    #[test]
    fn dcl6_door_reply_and_restart_do_not_rearm_settlement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        let make = || {
            let db = Connection::open(&path).unwrap();
            db.execute_batch(include_str!(
                "../migrations/project/0049-door-settlement.sql"
            ))
            .unwrap();
            drop(db);
            Settlements::open(&path).unwrap()
        };
        let nodes = rest(Kind::Idle, "1");
        let (none, nothing) = (HashSet::new(), HashMap::new());
        let marker = due(&nodes, &[], &none, &nothing, &make())[0].marker.clone();
        // Crash after storing the intent and sending, before the settled mark: the note is found.
        make().write("door", None, Some(&marker)).unwrap();
        let body = format!("x {TOKEN}{marker}");
        let pending = [note(1, "door", &body, MessageStatus::Pending)];
        assert!(due(&nodes, &pending, &none, &nothing, &make()).is_empty());
        let sent = [note(1, "door", &body, MessageStatus::Delivered)];
        let found = due(&nodes, &sent, &none, &nothing, &make());
        assert!(found.len() == 1 && found[0].sent);
        // A crash before sending leaves the intent without a note: it is sent.
        assert!(!due(&nodes, &[], &none, &nothing, &make())[0].sent);
        // After the settled mark, a restart finds nothing due; a later change is due again once.
        make().write("door", Some(&marker), None).unwrap();
        assert!(due(&nodes, &[], &none, &nothing, &make()).is_empty());
        let other = rest(Kind::Idle, "2");
        assert_eq!(due(&other, &sent, &none, &nothing, &make()).len(), 1);
    }

    #[test]
    fn dcl6_open_job_blocks_settlement_until_door_decides() {
        let store = Settlements::default();
        let nodes = rest(Kind::Idle, "1");
        let nothing = HashMap::new();
        let open = HashSet::from(["job".to_owned()]);
        assert!(due(&nodes, &[], &open, &nothing, &store).is_empty());
        assert_eq!(due(&nodes, &[], &HashSet::new(), &nothing, &store).len(), 1);
    }
}
