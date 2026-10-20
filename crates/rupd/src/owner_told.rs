//! T18: an Agent that owns a Todo hears, as one `note` from the Daemon when it is `idle`, that the
//! Todo was assigned to it, taken from it, re-nested or unblocked. Changes wait here in memory
//! while the Agent has any other Kind, and go out through `message.send` like any note.

use std::collections::HashMap;
use std::time::Duration;

use contracts::agent::{NodeKind, RailNode};
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, Event, EventData, Kind};
use serde_json::json;

use crate::digest::Reader;

const MAX_LINES: usize = 20;
const MAX_TITLE: usize = 80;
/// The events of one Daemon call arrive together; this long a gap ends the call's batch.
const SETTLE: Duration = Duration::from_millis(40);

#[derive(Clone, Debug, PartialEq, Eq)]
enum Change {
    Assigned,
    Taken,
    Blocked(Vec<u32>),
    Unblocked,
}

impl Change {
    fn words(&self) -> String {
        match self {
            Change::Assigned => "assigned to you".into(),
            Change::Taken => "taken from you".into(),
            Change::Blocked(ids) if ids.is_empty() => "now unblocked".into(),
            Change::Blocked(ids) => {
                let ids: Vec<String> = ids.iter().map(u32::to_string).collect();
                format!("now blocked by {}", ids.join(", "))
            }
            Change::Unblocked => "unblocked".into(),
        }
    }
}

/// The Todos as last seen, and the changes each owner Agent has not yet been told.
#[derive(Default)]
pub struct Told {
    todos: HashMap<u32, Todo>,
    pending: HashMap<String, Vec<(u32, Change)>>,
}

/// The Agent an owner names; Me and Unassigned name none.
fn agent(owner: &Option<Actor>) -> Option<&str> {
    owner
        .as_ref()
        .filter(|owner| owner.kind == ActorKind::Agent)
        .map(|owner| owner.id.as_str())
}

impl Told {
    pub fn new(todos: Vec<Todo>) -> Self {
        Self {
            todos: todos.into_iter().map(|todo| (todo.id, todo)).collect(),
            pending: HashMap::new(),
        }
    }

    fn tell(&mut self, to: &str, caller: &Actor, id: u32, change: Change) {
        if caller.kind == ActorKind::Agent && caller.id == to {
            return;
        }
        let list = self.pending.entry(to.to_owned()).or_default();
        // A list that became empty already says it is unblocked.
        if change == Change::Unblocked && list.last() == Some(&(id, Change::Blocked(Vec::new()))) {
            return;
        }
        list.push((id, change));
    }

    /// Reads one Event: what it changes for an owner Agent waits to be told.
    pub fn record(&mut self, event: &Event) {
        match &event.data {
            EventData::TodoCreated(todo) => {
                if let Some(to) = agent(&todo.owner) {
                    self.tell(to, &event.actor, todo.id, Change::Assigned);
                }
                self.todos.insert(todo.id, (**todo).clone());
            }
            EventData::TodoUpdated(todo) => {
                if let Some(before) = self.todos.get(&todo.id).cloned() {
                    if agent(&before.owner) != agent(&todo.owner) {
                        if let Some(from) = agent(&before.owner) {
                            self.tell(from, &event.actor, todo.id, Change::Taken);
                        }
                        if let Some(to) = agent(&todo.owner) {
                            self.tell(to, &event.actor, todo.id, Change::Assigned);
                        }
                    } else if before.blockers != todo.blockers
                        && let Some(owner) = agent(&todo.owner)
                    {
                        let change = Change::Blocked(todo.blockers.clone());
                        self.tell(owner, &event.actor, todo.id, change);
                    }
                }
                self.todos.insert(todo.id, (**todo).clone());
            }
            EventData::TodoUnblocked(id) => {
                let owner = self.todos.get(&id.id).and_then(|todo| agent(&todo.owner));
                if let Some(owner) = owner.map(str::to_owned) {
                    self.tell(&owner, &event.actor, id.id, Change::Unblocked);
                }
            }
            EventData::TodoDeleted(id) => {
                self.todos.remove(&id.id);
            }
            _ => {}
        }
    }

    pub fn waiting(&self) -> Vec<String> {
        self.pending.keys().cloned().collect()
    }

    /// Forgets what waits for `agent`, which can no longer be told.
    pub fn drop_agent(&mut self, agent: &str) {
        self.pending.remove(agent);
    }

    /// The one Message for `agent`: every change since its last, a line per Todo.
    pub fn take(&mut self, agent: &str) -> Option<String> {
        let changes = self.pending.remove(agent)?;
        let mut order: Vec<u32> = Vec::new();
        for (id, _) in &changes {
            if self.todos.contains_key(id) && !order.contains(id) {
                order.push(*id);
            }
        }
        let lines: Vec<String> = order
            .iter()
            .map(|id| {
                let words: Vec<String> = changes
                    .iter()
                    .filter(|(changed, _)| changed == id)
                    .map(|(_, change)| change.words())
                    .collect();
                let title: String = self.todos[id].title.chars().take(MAX_TITLE).collect();
                format!("- {title}: {} (rup todo get {id})", words.join(", "))
            })
            .collect();
        if lines.is_empty() {
            return None;
        }
        let mut body = String::from("[todos]");
        for line in lines.iter().take(MAX_LINES) {
            body.push('\n');
            body.push_str(line);
        }
        if lines.len() > MAX_LINES {
            body.push_str(&format!("\n[+{} more]", lines.len() - MAX_LINES));
        }
        Some(body)
    }
}

fn is_agent(node: &RailNode) -> bool {
    match node.kind {
        NodeKind::Agent => true,
        NodeKind::Workstream => node.attempt.is_some(),
    }
}

/// Sends each idle Agent its waiting changes; an Agent that is gone or has no Terminal program
/// is dropped, never retried.
async fn flush(told: &mut Told, reader: &Reader) {
    if told.waiting().is_empty() {
        return;
    }
    let Ok(world) = reader.world().await else {
        return;
    };
    for id in told.waiting() {
        let node = world.nodes().iter().find(|n| n.id == id && is_agent(n));
        let Some(node) = node else {
            told.drop_agent(&id);
            continue;
        };
        let idle = node
            .status
            .as_ref()
            .is_some_and(|status| status.kind == Kind::Idle);
        if !idle {
            continue;
        }
        if node.terminal_id.is_none() {
            told.drop_agent(&id);
            continue;
        }
        let Some(body) = told.take(&id) else { continue };
        let sent = reader
            .call::<contracts::message::Message>(
                "message",
                "message.send",
                json!({"to": id, "kind": "note", "body": body}),
                Actor::daemon(),
            )
            .await;
        if let Err(err) = sent {
            eprintln!("owner told: Todo changes for {id} not sent: {err}");
        }
    }
}

/// Runs until the Bus closes.
pub async fn tell_owners(reader: Reader, mut events: rpc::Subscription) {
    let todos = reader
        .world()
        .await
        .map(|world| world.todos())
        .unwrap_or_default();
    let mut told = Told::new(todos);
    while let Some(event) = events.next().await {
        told.record(&event);
        // The rest of one call's events join this batch.
        while let Ok(Some(more)) = tokio::time::timeout(SETTLE, events.next()).await {
            told.record(&more);
        }
        flush(&mut told, &reader).await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use contracts::todo::TodoId;
    use rpc::{Bus, Ctx, Module, RpcError};
    use serde_json::Value;

    use super::*;

    fn actor(kind: ActorKind, id: &str) -> Actor {
        Actor {
            kind,
            id: id.into(),
            parent: None,
        }
    }

    fn agent_actor(id: &str) -> Actor {
        actor(ActorKind::Agent, id)
    }

    fn todo(id: u32, title: &str, owner: Option<Actor>, blockers: Vec<u32>) -> Todo {
        Todo {
            id,
            title: title.into(),
            body: String::new(),
            done: false,
            blocked: !blockers.is_empty(),
            blockers,
            created_at: 0,
            creator: Actor::user(),
            home: None,
            owner,
        }
    }

    fn updated(by: Actor, todo: Todo) -> Event {
        Event {
            seq: None,
            actor: by,
            data: EventData::TodoUpdated(Box::new(todo)),
        }
    }

    fn told_with(todos: Vec<Todo>) -> Told {
        Told::new(todos)
    }

    #[test]
    fn t18_assign_take_renest_unblock_each_tell_the_owner_agent() {
        let a = Some(agent_actor("a"));
        let mut told = told_with(vec![
            todo(1, "Ship", None, vec![]),
            todo(2, "Dig", a.clone(), vec![3]),
        ]);
        told.record(&updated(Actor::user(), todo(1, "Ship", a.clone(), vec![])));
        told.record(&updated(Actor::user(), todo(2, "Dig", None, vec![3])));
        let body = told.take("a").unwrap();
        assert_eq!(
            body,
            "[todos]\n- Ship: assigned to you (rup todo get 1)\n- Dig: taken from you (rup todo get 2)"
        );
        told.record(&updated(
            Actor::user(),
            todo(1, "Ship", a.clone(), vec![5, 6]),
        ));
        assert_eq!(
            told.take("a").unwrap(),
            "[todos]\n- Ship: now blocked by 5, 6 (rup todo get 1)"
        );
        told.record(&Event {
            seq: None,
            actor: Actor::user(),
            data: EventData::TodoUnblocked(TodoId { id: 1 }),
        });
        assert_eq!(
            told.take("a").unwrap(),
            "[todos]\n- Ship: unblocked (rup todo get 1)"
        );
    }

    #[test]
    fn t18_me_and_unassigned_owners_tell_nobody() {
        let mut told = told_with(vec![todo(1, "Ship", None, vec![])]);
        told.record(&updated(
            Actor::user(),
            todo(1, "Ship", Some(Actor::user()), vec![]),
        ));
        told.record(&updated(Actor::user(), todo(1, "Ship", None, vec![])));
        told.record(&updated(Actor::user(), todo(1, "Ship", None, vec![2])));
        assert!(told.waiting().is_empty());
    }

    #[test]
    fn t18_title_body_complete_and_own_changes_tell_nothing() {
        let a = Some(agent_actor("a"));
        let mut told = told_with(vec![todo(1, "Ship", a.clone(), vec![])]);
        let mut edited = todo(1, "Ship now", a.clone(), vec![]);
        edited.body = "more".into();
        told.record(&updated(Actor::user(), edited.clone()));
        edited.done = true;
        told.record(&updated(Actor::user(), edited));
        told.record(&updated(
            agent_actor("a"),
            todo(1, "Ship now", a.clone(), vec![4]),
        ));
        assert!(told.waiting().is_empty());
        // Handing a Todo from `b` to `c` tells both, each its own change.
        let mut told = told_with(vec![todo(2, "Dig", Some(agent_actor("b")), vec![])]);
        told.record(&updated(
            agent_actor("a"),
            todo(2, "Dig", Some(agent_actor("c")), vec![]),
        ));
        assert!(told.take("b").unwrap().contains("taken from you"));
        assert!(told.take("c").unwrap().contains("assigned to you"));
    }

    #[test]
    fn t18_changes_during_a_turn_become_one_message_at_idle() {
        let a = Some(agent_actor("a"));
        let mut told = told_with(vec![
            todo(1, "One", None, vec![]),
            todo(2, "Two", None, vec![]),
        ]);
        told.record(&updated(Actor::user(), todo(1, "One", a.clone(), vec![])));
        told.record(&updated(Actor::user(), todo(2, "Two", a.clone(), vec![])));
        told.record(&updated(Actor::user(), todo(1, "One", a.clone(), vec![2])));
        assert_eq!(
            told.take("a").unwrap(),
            "[todos]\n- One: assigned to you, now blocked by 2 (rup todo get 1)\n- Two: assigned to you (rup todo get 2)"
        );
        assert!(told.take("a").is_none());
    }

    #[test]
    fn t18_message_lines_name_title_change_and_rup_command() {
        let a = Some(agent_actor("a"));
        let long = "x".repeat(100);
        let mut told = told_with(Vec::new());
        for id in 1..=22 {
            let created = Event {
                seq: None,
                actor: Actor::user(),
                data: EventData::TodoCreated(Box::new(todo(id, &long, a.clone(), vec![]))),
            };
            told.record(&created);
        }
        let body = told.take("a").unwrap();
        assert_eq!(body.lines().count(), 22);
        assert_eq!(
            body.lines().nth(1).unwrap(),
            format!("- {}: assigned to you (rup todo get 1)", "x".repeat(80))
        );
        assert_eq!(body.lines().last().unwrap(), "[+2 more]");
        // A list that became empty is told once.
        let mut told = told_with(vec![todo(1, "Ship", a.clone(), vec![2])]);
        told.record(&updated(Actor::user(), todo(1, "Ship", a.clone(), vec![])));
        told.record(&Event {
            seq: None,
            actor: Actor::user(),
            data: EventData::TodoUnblocked(TodoId { id: 1 }),
        });
        assert_eq!(
            told.take("a").unwrap(),
            "[todos]\n- Ship: now unblocked (rup todo get 1)"
        );
    }

    struct Stub {
        nodes: Mutex<Vec<Value>>,
        sent: Mutex<Vec<Value>>,
    }

    #[async_trait]
    impl Module for Stub {
        fn namespaces(&self) -> &'static [&'static str] {
            &["rail", "todo", "pad", "message"]
        }

        async fn call(&self, _: &Ctx, method: &str, params: Value) -> Result<Value, RpcError> {
            match method {
                "rail.tree" => Ok(Value::Array(self.nodes.lock().unwrap().clone())),
                "todo.list" | "pad.list" | "message.list" => Ok(json!([])),
                "message.send" => {
                    self.sent.lock().unwrap().push(params);
                    Err(RpcError::internal("stub"))
                }
                other => panic!("unexpected {other}"),
            }
        }
    }

    fn node(id: &str, kind: &str, terminal: bool) -> Value {
        json!({
            "id": id, "kind": "agent", "name": id, "parent": null, "order": 0,
            "status": {"kind": kind, "label": kind, "since": 0},
            "attempt": "1", "status_revision": null,
            "terminal_id": terminal.then_some("t"), "worktree": null, "can_resume": false,
            "yolo": false, "channel": null, "work": null, "stray": [], "model": null,
            "effort": null,
        })
    }

    fn rig(nodes: Vec<Value>) -> (Arc<Stub>, Reader) {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::Daemon::open(&dir.path().join("data")).unwrap();
        let stub = Arc::new(Stub {
            nodes: Mutex::new(nodes),
            sent: Mutex::new(Vec::new()),
        });
        let mut modules = daemon.modules.clone();
        for name in ["rail", "todo", "pad", "message"] {
            modules.insert(name, stub.clone());
        }
        let reader = Reader::new(&modules, Bus::new(), daemon.touches.clone(), None);
        (stub, reader)
    }

    fn assigned() -> Told {
        let mut told = told_with(vec![todo(1, "Ship", None, vec![])]);
        let a = Some(agent_actor("a"));
        told.record(&updated(Actor::user(), todo(1, "Ship", a, vec![])));
        told
    }

    #[tokio::test]
    async fn t18_idle_agent_is_told_at_once_with_one_message() {
        let (stub, reader) = rig(vec![node("a", "idle", true)]);
        let mut told = assigned();
        flush(&mut told, &reader).await;
        let sent = stub.sent.lock().unwrap().clone();
        assert_eq!(
            sent,
            vec![json!({
                "to": "a", "kind": "note",
                "body": "[todos]\n- Ship: assigned to you (rup todo get 1)",
            })]
        );
        flush(&mut told, &reader).await;
        assert_eq!(stub.sent.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn t18_takeover_holds_and_removed_agent_drops() {
        // Any Kind but idle (a Takeover shows as one) holds the changes until the turn ends.
        let (stub, reader) = rig(vec![node("a", "working", true)]);
        let mut told = assigned();
        flush(&mut told, &reader).await;
        assert!(stub.sent.lock().unwrap().is_empty());
        *stub.nodes.lock().unwrap() = vec![node("a", "idle", true)];
        flush(&mut told, &reader).await;
        assert_eq!(stub.sent.lock().unwrap().len(), 1);
        // A removed Agent, and one with no Terminal program, are dropped and never retried.
        for nodes in [vec![], vec![node("a", "idle", false)]] {
            *stub.nodes.lock().unwrap() = nodes;
            let mut told = assigned();
            flush(&mut told, &reader).await;
            assert!(told.waiting().is_empty());
            *stub.nodes.lock().unwrap() = vec![node("a", "idle", true)];
            flush(&mut told, &reader).await;
            assert_eq!(stub.sent.lock().unwrap().len(), 1);
        }
    }
}
