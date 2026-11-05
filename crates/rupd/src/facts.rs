//! DCL5: the facts a Door learns once about a child, from the Rail, the Todos and the Messages:
//! the child ended with open Todos it owns and no report, or its turn stalled.

use std::collections::{HashMap, HashSet};

use contracts::agent::{NodeKind, RailNode};
use contracts::message::Message;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, Kind};
use serde_json::json;

use crate::digest::{Reader, World};

/// How long a working turn may show no activity before it is stalled.
pub const STALL_MS: i64 = 10 * 60 * 1000;

/// What was already published, so each fact reaches its Door once while it holds.
#[derive(Default)]
pub struct Facts {
    ended: HashSet<String>,
    /// The children whose current stall was published; leaving the stalled set re-arms it.
    stalled: HashSet<String>,
    /// How many finished compactions of each child were published.
    compacted: HashMap<String, u64>,
}

struct Fact {
    door: String,
    child: String,
    body: String,
    count: u64,
}

fn owned_by(todo: &Todo, child: &str) -> bool {
    !todo.done
        && todo
            .owner
            .as_ref()
            .is_some_and(|o| o.kind == ActorKind::Agent && o.id == child)
}

impl Facts {
    /// The ended facts not yet published. A Daemon note already in the Door's inbox with the same
    /// body counts as published, so a reopen does not repeat it.
    fn ended(&self, nodes: &[RailNode], todos: &[Todo], messages: &[Message]) -> Vec<Fact> {
        let doors: HashMap<&str, &RailNode> = nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Workstream)
            .map(|n| (n.id.as_str(), n))
            .collect();
        let mut facts = Vec::new();
        for child in nodes {
            let Some(door) = child.parent.as_deref().filter(|id| doors.contains_key(id)) else {
                continue;
            };
            if !child
                .status
                .as_ref()
                .is_some_and(|s| matches!(s.kind, Kind::Done | Kind::Error))
            {
                continue;
            }
            let open = todos.iter().filter(|t| owned_by(t, &child.id)).count();
            let reported = messages
                .iter()
                .any(|m| m.from.kind == ActorKind::Agent && m.from.id == child.id && m.to == door);
            if open == 0 || reported {
                continue;
            }
            let unassigned = todos
                .iter()
                .filter(|t| !t.done && t.owner.is_none() && t.home.as_deref() == Some(door))
                .count();
            let body = format!(
                "[ended] {} ended with {open} open Todos it owns and no report. Their owner is unchanged until you assign them; {unassigned} open Todos of this Workstream are unassigned. Reconcile them.",
                child.name
            );
            let key = format!(
                "{door}/{}/{}",
                child.id,
                child.attempt.as_deref().unwrap_or("")
            );
            if self.ended.contains(&key)
                || messages
                    .iter()
                    .any(|m| m.from == Actor::daemon() && m.to == door && m.body == body)
            {
                continue;
            }
            facts.push(Fact {
                door: door.to_owned(),
                child: key,
                body,
                count: 0,
            });
        }
        facts
    }

    fn stalls(&mut self, nodes: &[RailNode], stalled: &HashSet<String>) -> Vec<Fact> {
        self.stalled.retain(|id| stalled.contains(id));
        let doors: HashSet<&str> = nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Workstream)
            .map(|n| n.id.as_str())
            .collect();
        nodes
            .iter()
            .filter(|n| stalled.contains(&n.id) && !self.stalled.contains(&n.id))
            .filter_map(|child| {
                let door = child.parent.as_deref().filter(|id| doors.contains(id))?;
                Some(Fact {
                    door: door.to_owned(),
                    child: child.id.clone(),
                    body: format!(
                        "[stalled] {} is working but has shown no activity for ten minutes and runs no tool or background work. Decide whether to nudge, replace or accept it.",
                        child.name
                    ),
                    count: 0,
                })
            })
            .collect()
    }

    /// One fact for each child whose finished-compaction count rose past what was published; a
    /// count that fell is a new run and starts over.
    fn compactions(&mut self, nodes: &[RailNode], counts: &HashMap<String, u64>) -> Vec<Fact> {
        self.compacted
            .retain(|id, seen| counts.get(id).is_some_and(|count| count >= seen));
        let doors: HashSet<&str> = nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Workstream)
            .map(|n| n.id.as_str())
            .collect();
        nodes
            .iter()
            .filter_map(|child| {
                let count = *counts.get(&child.id)?;
                if count <= self.compacted.get(&child.id).copied().unwrap_or(0) {
                    return None;
                }
                let door = child.parent.as_deref().filter(|id| doors.contains(id))?;
                Some(Fact {
                    door: door.to_owned(),
                    child: child.id.clone(),
                    body: format!(
                        "[compacted] {} finished compacting its context (compaction {count}). Decide whether to hand off or continue.",
                        child.name
                    ),
                    count,
                })
            })
            .collect()
    }

    /// Sends each fact due as a `note` from the Daemon; one that fails stays due.
    pub async fn publish(&mut self, reader: &Reader, world: &World) {
        let mut due = self.ended(world.nodes(), &world.todos(), world.messages());
        let ended = due.len();
        due.extend(self.stalls(world.nodes(), world.stalled()));
        let stalls = due.len();
        due.extend(self.compactions(world.nodes(), world.compactions()));
        for (index, fact) in due.into_iter().enumerate() {
            let sent = reader
                .call::<Message>(
                    "message",
                    "message.send",
                    json!({"to": fact.door, "kind": "note", "body": fact.body}),
                    Actor::daemon(),
                )
                .await;
            match sent {
                Ok(_) if index < ended => {
                    self.ended.insert(fact.child);
                }
                Ok(_) if index >= stalls => {
                    self.compacted.insert(fact.child, fact.count);
                }
                Ok(_) => {
                    self.stalled.insert(fact.child);
                }
                Err(err) => eprintln!("rupd: fact for {} not sent: {err}", fact.door),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, kind: &str, parent: Option<&str>, status: &str) -> RailNode {
        serde_json::from_value(json!({
            "id":id,"kind":kind,"name":id,"parent":parent,"order":0,
            "status":{"kind":status,"label":"","since":0,"finished":"0"},"attempt":"1",
            "status_revision":"1","terminal_id":null,"worktree":null,"can_resume":false,
            "yolo":false,"channel":null,"stray":[],"model":null,"effort":null,"work":null,"auto":false
        }))
        .unwrap()
    }

    #[test]
    fn dcl5_a_stall_is_published_once_until_activity_clears_it() {
        let nodes = [
            node("door", "workstream", None, "working"),
            node("sub", "agent", Some("door"), "working"),
        ];
        let mut facts = Facts::default();
        let stalled: HashSet<String> = ["sub".to_owned(), "door".to_owned()].into();
        let due = facts.stalls(&nodes, &stalled);
        // The stalled Door has a row fact, not a Message to itself; only the child's reaches it.
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].door, "door");
        assert!(due[0].body.contains("sub"));
        facts.stalled.insert(due[0].child.clone());
        assert!(facts.stalls(&nodes, &stalled).is_empty());
        assert!(facts.stalls(&nodes, &HashSet::new()).is_empty());
        assert_eq!(
            facts.stalls(&nodes, &stalled).len(),
            1,
            "a new stall after activity is new"
        );
    }
}
