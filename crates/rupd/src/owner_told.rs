//! T18: an Agent that owns a Todo hears, as one `note` from the Daemon when it is `idle`, that the
//! Todo was assigned to it, taken from it, re-nested or unblocked. Changes wait here in memory
//! while the Agent has any other Kind, and go out through `message.send` like any note.

use std::collections::HashMap;
use std::time::Duration;

use contracts::agent::{NodeKind, RailNode};
use contracts::todo::{Comment, Todo};
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
    /// T22: a comment by the user, flattened to one line.
    Commented(String),
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
            Change::Commented(body) => format!("new comment from you: {body}"),
        }
    }
}

/// The Todos as last seen, and the changes each owner Agent has not yet been told.
#[derive(Default)]
pub struct Told {
    todos: HashMap<u32, Todo>,
    pending: HashMap<String, Vec<(u32, Change)>>,
    /// The newest comment of each Todo already read, so a comment is told once.
    comments_seen: HashMap<u32, u32>,
    /// When the Daemon started, in ms: a Todo's first read tells only the comments made since.
    started: i64,
    /// T25: the Agents whose Status became `idle` since the last hand-off round.
    idled: Vec<String>,
}

fn now_ms() -> i64 {
    let millis = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    i64::try_from(millis.max(0)).unwrap_or(i64::MAX)
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
            comments_seen: HashMap::new(),
            started: now_ms(),
            idled: Vec::new(),
        }
    }

    /// T4597: each fresh user reply tells its current owner and earlier Agent authors once.
    pub fn commented(&mut self, id: u32, thread: &[Comment]) {
        let seen = self.comments_seen.get(&id).copied();
        let owner = self.todos.get(&id).and_then(|todo| agent(&todo.owner));
        let mut recipients: Vec<String> = owner.map(str::to_owned).into_iter().collect();
        for comment in thread {
            if comment.author.kind == ActorKind::Agent {
                if !recipients.contains(&comment.author.id) {
                    recipients.push(comment.author.id.clone());
                }
                continue;
            }
            let fresh = seen.map_or(comment.created_at >= self.started, |seen| comment.id > seen);
            if fresh && comment.author.kind == ActorKind::User {
                let line = comment
                    .body
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ");
                for recipient in &recipients {
                    self.tell(
                        recipient,
                        &comment.author,
                        id,
                        Change::Commented(line.clone()),
                    );
                }
            }
        }
        if let Some(newest) = thread.iter().map(|c| c.id).max() {
            self.comments_seen.insert(id, newest.max(seen.unwrap_or(0)));
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
            EventData::TodoRestored(todo) => {
                self.todos.insert(todo.id, (**todo).clone());
            }
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
            EventData::AgentStatus(status) if status.status.kind == Kind::Idle => {
                if !self.idled.contains(&status.id) {
                    self.idled.push(status.id.clone());
                }
            }
            EventData::TodoDeleted(id) => {
                self.todos.remove(&id.id);
                self.comments_seen.remove(&id.id);
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

/// T25: each Agent whose Status became `idle` and still is gets one Message for its next owned
/// Todo. `todo.hand` writes the hand-off Change first; without it nothing is sent.
async fn hand_off(told: &mut Told, reader: &Reader) {
    let idled = std::mem::take(&mut told.idled);
    if idled.is_empty() {
        return;
    }
    let Ok(world) = reader.world().await else {
        return;
    };
    for id in idled {
        let ready = world.nodes().iter().any(|n| {
            n.id == id
                && is_agent(n)
                && n.terminal_id.is_some()
                && n.status.as_ref().is_some_and(|s| s.kind == Kind::Idle)
        });
        if !ready {
            continue;
        }
        let handed = reader
            .call::<Option<Todo>>("todo", "todo.hand", json!({"agent": id}), Actor::daemon())
            .await;
        let todo = match handed {
            Ok(Some(todo)) => todo,
            Ok(None) => continue,
            Err(err) => {
                eprintln!("owner told: hand-off to {id} not recorded: {err}");
                continue;
            }
        };
        let title: String = todo.title.chars().take(MAX_TITLE).collect();
        let body = format!("Next: #{} {title}", todo.id);
        let sent = reader
            .call::<contracts::message::Message>(
                "message",
                "message.send",
                json!({"to": id, "kind": "note", "body": body}),
                Actor::daemon(),
            )
            .await;
        if let Err(err) = sent {
            eprintln!("owner told: hand-off to {id} not sent: {err}");
        }
    }
}

/// `record`, but a comment's text is read from the thread, since its event carries only the Todo.
async fn read(told: &mut Told, reader: &Reader, event: &Event) {
    let EventData::TodoCommented(todo) = &event.data else {
        return told.record(event);
    };
    let thread = reader
        .call::<Vec<Comment>>(
            "todo",
            "todo.comments",
            json!({"id": todo.id}),
            Actor::daemon(),
        )
        .await;
    match thread {
        Ok(thread) => told.commented(todo.id, &thread),
        Err(err) => eprintln!("owner told: comments of Todo {} not read: {err}", todo.id),
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
        read(&mut told, &reader, &event).await;
        // The rest of one call's events join this batch.
        while let Ok(Some(more)) = tokio::time::timeout(SETTLE, events.next()).await {
            read(&mut told, &reader, &more).await;
        }
        flush(&mut told, &reader).await;
        hand_off(&mut told, &reader).await;
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
            updated_at: 0,
            creator: Actor::user(),
            home: None,
            owner,
            refs: vec![],
            estimate_minutes: None,
            priority: None,
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
        thread: Mutex<Value>,
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
                "todo.comments" => Ok(self.thread.lock().unwrap().clone()),
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
            "status": {"kind": kind, "label": kind, "since": 0,"finished":"0"},
            "attempt": "1", "status_revision": null,
            "terminal_id": terminal.then_some("t"), "worktree": null, "can_resume": false,
            "yolo": false, "channel": null, "work": null, "stray": [], "model": null,
            "effort": null,
        })
    }

    fn rig(nodes: Vec<Value>) -> (Arc<Stub>, Reader) {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(&dir.path().join("data")).unwrap();
        let stub = Arc::new(Stub {
            nodes: Mutex::new(nodes),
            sent: Mutex::new(Vec::new()),
            thread: Mutex::new(json!([])),
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
    async fn t18_busy_agent_waits_and_removed_agent_drops() {
        // Any Kind but idle keeps the changes waiting until the turn ends.
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

    fn comment(id: u32, by: Actor, body: &str) -> Comment {
        Comment {
            id,
            author: by,
            body: body.into(),
            created_at: now_ms(),
            read: false,
        }
    }

    #[test]
    fn t4597_user_replies_reach_owner_and_earlier_authors_once() {
        for owner in [
            None,
            Some(Actor::user()),
            Some(agent_actor("a")),
            Some(agent_actor("b")),
        ] {
            let mut told = told_with(vec![todo(1, "Ship", owner.clone(), vec![])]);
            let thread = vec![
                comment(1, agent_actor("a"), "question"),
                comment(2, agent_actor("a"), "detail"),
                comment(3, Actor::user(), "answer"),
            ];
            told.commented(1, &thread);
            told.commented(1, &thread);
            for id in ["a", "b", "c"] {
                let expected = id == "a" || agent(&owner) == Some(id);
                assert_eq!(
                    told.take(id),
                    expected.then(|| {
                        "[todos]\n- Ship: new comment from you: answer (rup todo get 1)".into()
                    }),
                    "{id}, {owner:?}"
                );
                assert!(told.take(id).is_none());
            }
        }
    }

    #[test]
    fn t4597_only_user_replies_to_existing_participants_are_told() {
        let mut told = told_with(vec![todo(1, "Ship", None, vec![])]);
        let thread = vec![
            comment(1, Actor::user(), "before"),
            comment(2, agent_actor("a"), "question"),
            comment(3, Actor::daemon(), "system"),
            comment(4, Actor::user(), "first"),
            comment(5, agent_actor("b"), "later"),
            comment(6, Actor::user(), "second"),
        ];
        told.commented(1, &thread);
        assert_eq!(
            told.take("a").unwrap(),
            "[todos]\n- Ship: new comment from you: first, new comment from you: second (rup todo get 1)"
        );
        assert_eq!(
            told.take("b").unwrap(),
            "[todos]\n- Ship: new comment from you: second (rup todo get 1)"
        );
        assert!(told.waiting().is_empty());
    }

    #[test]
    fn t24_two_quick_user_comments_after_a_start_are_both_told() {
        let mut told = told_with(vec![todo(1, "Ship", None, vec![])]);
        let mut author = comment(1, agent_actor("a"), "question before start");
        author.created_at = 0;
        let mut old = comment(2, Actor::user(), "before the start");
        old.created_at = 0;
        let thread = vec![
            author,
            old,
            comment(3, Actor::user(), "first"),
            comment(4, Actor::user(), "second"),
        ];
        told.commented(1, &thread);
        assert_eq!(
            told.take("a").unwrap(),
            "[todos]\n- Ship: new comment from you: first, new comment from you: second (rup todo get 1)"
        );
    }

    #[test]
    fn t24_agent_comments_in_that_window_are_not_told() {
        let a = Some(agent_actor("a"));
        let mut told = told_with(vec![todo(1, "Ship", a, vec![])]);
        let thread = vec![
            comment(1, agent_actor("a"), "q?"),
            comment(2, Actor::user(), "answer"),
            comment(3, agent_actor("b"), "hi"),
        ];
        told.commented(1, &thread);
        assert_eq!(
            told.take("a").unwrap(),
            "[todos]\n- Ship: new comment from you: answer (rup todo get 1)"
        );
        assert!(told.take("b").is_none());
    }

    #[test]
    fn t22_a_user_comment_tells_the_owner_agent_once_it_is_idle() {
        let a = Some(agent_actor("a"));
        let mut told = told_with(vec![todo(1, "Ship", a, vec![])]);
        let thread = vec![comment(1, Actor::user(), "use\nthe  main branch")];
        told.commented(1, &thread);
        told.commented(1, &thread);
        assert_eq!(
            told.take("a").unwrap(),
            "[todos]\n- Ship: new comment from you: use the main branch (rup todo get 1)"
        );
        assert!(told.take("a").is_none());
    }

    #[test]
    fn t22_other_comments_tell_nobody() {
        let a = Some(agent_actor("a"));
        let mut told = told_with(vec![
            todo(1, "Mine", a, vec![]),
            todo(2, "Yours", Some(Actor::user()), vec![]),
            todo(3, "Nobody", None, vec![]),
            todo(4, "Theirs", Some(agent_actor("b")), vec![]),
        ]);
        told.commented(1, &[comment(1, agent_actor("a"), "q?")]);
        told.commented(
            1,
            &[
                comment(1, agent_actor("a"), "q?"),
                comment(2, agent_actor("b"), "hi"),
            ],
        );
        for id in [2, 3] {
            told.commented(id, &[comment(1, Actor::user(), "x")]);
        }
        assert!(told.waiting().is_empty());
        // A comment by another Agent on `b`'s Todo tells `b` nothing; the user's tells `b` only.
        told.commented(4, &[comment(1, agent_actor("a"), "x")]);
        assert!(told.waiting().is_empty());
    }

    #[tokio::test]
    async fn t22_a_comment_waits_until_the_agent_is_idle() {
        let (stub, reader) = rig(vec![node("a", "working", true)]);
        let mut told = told_with(vec![todo(1, "Ship", None, vec![])]);
        *stub.thread.lock().unwrap() = serde_json::to_value(vec![
            comment(1, agent_actor("a"), "question"),
            comment(2, Actor::user(), "go"),
        ])
        .unwrap();
        let event = Event {
            seq: None,
            actor: Actor::user(),
            data: EventData::TodoCommented(TodoId { id: 1 }),
        };
        read(&mut told, &reader, &event).await;
        flush(&mut told, &reader).await;
        assert!(stub.sent.lock().unwrap().is_empty());
        *stub.nodes.lock().unwrap() = vec![node("a", "idle", true)];
        flush(&mut told, &reader).await;
        assert_eq!(
            stub.sent.lock().unwrap().clone(),
            vec![json!({
                "to": "a", "kind": "note",
                "body": "[todos]\n- Ship: new comment from you: go (rup todo get 1)",
            })]
        );
        for nodes in [vec![], vec![node("a", "idle", false)]] {
            *stub.nodes.lock().unwrap() = nodes;
            let mut told = told_with(vec![todo(1, "Ship", None, vec![])]);
            told.started = 0;
            read(&mut told, &reader, &event).await;
            assert!(!told.waiting().is_empty());
            flush(&mut told, &reader).await;
            assert!(told.waiting().is_empty());
            *stub.nodes.lock().unwrap() = vec![node("a", "idle", true)];
            flush(&mut told, &reader).await;
            assert_eq!(stub.sent.lock().unwrap().len(), 1);
        }
    }
}
