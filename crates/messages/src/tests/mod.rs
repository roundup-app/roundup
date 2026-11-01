use std::sync::Mutex as StdMutex;

use contracts::agent::{NodeKind, RailNode};
use contracts::{Actor, ActorKind, Event, Kind, Status};
use provenance::Touches;
use rpc::code;
use serde_json::json;
use tokio::sync::broadcast::Receiver;

use super::*;

mod a35_tests;
mod b_fault_tests;
mod b_hop_tests;
mod b_idle_tests;
mod b_push_tests;
mod b_resume_tests;
mod inv_tests;
mod routes;
mod send;
mod u3782_tests;

/// Stands in for the `agents` module's `rail.tree`: the only Rail fact `message.send` needs,
/// without a real Agent, Terminal or Launcher.
struct FakeRail(StdMutex<Vec<RailNode>>);

impl FakeRail {
    fn new(nodes: Vec<RailNode>) -> Arc<Self> {
        Arc::new(Self(StdMutex::new(nodes)))
    }
}

#[async_trait]
impl Module for FakeRail {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent", "rail"]
    }

    async fn call(&self, _ctx: &Ctx, method: &str, _params: Value) -> Result<Value, RpcError> {
        match method {
            "rail.tree" => Ok(serde_json::to_value(&*self.0.lock().unwrap()).unwrap()),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}

mod node;
pub(crate) use node::node;

fn agent_node(id: &str, kind: Kind) -> RailNode {
    node(
        id,
        NodeKind::Agent,
        false,
        Some(Status {
            kind,
            label: "status".into(),
            since: 0,
            finished: "0".into(),
        }),
    )
}

fn agent(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    }
}

/// The Claude inbox as tests see it: entries written are kept as `(agent, text)`.
/// With `confirm`, a write also stands for the transcript receipt, as Claude Code's would.
struct FakeInbox {
    state: StdMutex<contracts::agent::Inbox>,
    entries: StdMutex<Vec<(String, u32, contracts::message::MessageKind, String)>>,
    confirm: std::sync::atomic::AtomicBool,
    inner: StdMutex<std::sync::Weak<Inner>>,
}

impl FakeInbox {
    fn set(&self, state: contracts::agent::Inbox) {
        *self.state.lock().unwrap() = state;
    }

    /// Every entry written, in order, as `(agent, id, kind, text)`.
    fn entries(&self) -> Vec<(String, u32, contracts::message::MessageKind, String)> {
        self.entries.lock().unwrap().clone()
    }

    /// `(agent, text)` of every entry written.
    fn typed(&self) -> Vec<(String, String)> {
        self.entries().into_iter().map(|e| (e.0, e.3)).collect()
    }

    /// The ids of every entry written, in order.
    fn written(&self) -> Vec<u32> {
        self.entries().into_iter().map(|e| e.1).collect()
    }

    /// Whether a write also stands for the transcript receipt.
    fn receipt(&self, on: bool) {
        self.confirm.store(on, std::sync::atomic::Ordering::SeqCst);
    }
}

#[async_trait]
impl NoteInbox for FakeInbox {
    async fn check(&self, _agent: &str) -> contracts::agent::Inbox {
        *self.state.lock().unwrap()
    }

    fn write(
        &self,
        agent: &str,
        notes: &[agents::claude_code::inbox::Entry],
    ) -> Result<(), contracts::agent::Inbox> {
        let state = *self.state.lock().unwrap();
        if state != contracts::agent::Inbox::Ok {
            return Err(state);
        }
        let ids: Vec<u32> = notes.iter().map(|n| n.id).collect();
        self.entries.lock().unwrap().extend(
            notes
                .iter()
                .map(|n| (agent.to_owned(), n.id, n.kind, n.text.clone())),
        );
        if self.confirm.load(std::sync::atomic::Ordering::SeqCst)
            && let Some(inner) = self.inner.lock().unwrap().upgrade()
        {
            crate::flight::confirm_ids(&inner, agent, &ids);
        }
        Ok(())
    }
}

/// An inbox whose check blocks until released: delivery is in progress meanwhile.
struct GatedInbox {
    inbox: Arc<FakeInbox>,
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
}

#[async_trait]
impl NoteInbox for GatedInbox {
    async fn check(&self, agent: &str) -> contracts::agent::Inbox {
        self.entered.notify_one();
        self.release.notified().await;
        self.inbox.check(agent).await
    }

    fn write(
        &self,
        agent: &str,
        notes: &[agents::claude_code::inbox::Entry],
    ) -> Result<(), contracts::agent::Inbox> {
        self.inbox.write(agent, notes)
    }
}

/// A `FakeInbox` for `messages`, not yet set on it.
fn fake_inbox(messages: &Messages, confirm: bool) -> Arc<FakeInbox> {
    Arc::new(FakeInbox {
        state: StdMutex::new(contracts::agent::Inbox::Ok),
        entries: StdMutex::default(),
        confirm: confirm.into(),
        inner: StdMutex::new(Arc::downgrade(&messages.inner)),
    })
}

/// Sets a new `FakeInbox` on `messages`.
fn attach_inbox(messages: &Messages, confirm: bool) -> Arc<FakeInbox> {
    let inbox = fake_inbox(messages, confirm);
    messages.set_inbox(inbox.clone());
    inbox
}

struct Harness {
    messages: Messages,
    bus: Bus,
    bus_events: Receiver<Event>,
    touches: Arc<Touches>,
    inbox: Arc<FakeInbox>,
}

impl Harness {
    /// No inbox is set: Messages to an Agent stay `pending`.
    fn new(dir: &Path, rail: Vec<RailNode>) -> Self {
        Self::open(dir, FakeRail::new(rail), false)
    }

    /// An `ok` inbox that records every entry and confirms it at once.
    fn with_inbox(dir: &Path, rail: Vec<RailNode>) -> Self {
        Self::open(dir, FakeRail::new(rail), true)
    }

    fn open(dir: &Path, rail: Arc<FakeRail>, with_inbox: bool) -> Self {
        let bus = Bus::new();
        let bus_events = bus.subscribe();
        let messages = Messages::open(dir, bus.clone(), rail).unwrap();
        let inbox = if with_inbox {
            attach_inbox(&messages, true)
        } else {
            fake_inbox(&messages, true)
        };
        Self {
            messages,
            bus,
            bus_events,
            touches: Arc::new(Touches::in_memory().unwrap()),
            inbox,
        }
    }

    fn ctx(&self, actor: Actor) -> Ctx {
        Ctx {
            actor,
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        }
    }

    async fn call_as(&self, actor: Actor, method: &str, params: Value) -> Result<Value, RpcError> {
        self.messages.call(&self.ctx(actor), method, params).await
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.call_as(Actor::user(), method, params).await
    }

    /// Event names, oldest first.
    fn events(&mut self) -> Vec<String> {
        let mut seen = Vec::new();
        while let Ok(event) = self.bus_events.try_recv() {
            let event = serde_json::to_value(&event.data).unwrap();
            seen.push(event["name"].as_str().unwrap().to_owned());
        }
        seen
    }

    fn touches(&self, id: u32) -> Vec<(Verb, String)> {
        self.touches
            .history(&item(id))
            .unwrap()
            .into_iter()
            .map(|t| (t.verb, t.actor.id))
            .collect()
    }
}

#[tokio::test]
async fn b3_drop_takes_back_only_a_pending_message_of_the_user_and_only_for_the_user() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    let note = |body: &str| json!({"to": "b", "kind": "note", "body": body});
    h.call_as(agent("a"), "message.send", note("from an agent"))
        .await
        .unwrap();
    h.call("message.send", note("from the user")).await.unwrap();
    h.events();

    let by_agent = h
        .call_as(agent("a"), "message.drop", json!({"id": 2}))
        .await
        .unwrap_err();
    let not_the_users = h.call("message.drop", json!({"id": 1})).await.unwrap_err();
    let unknown = h.call("message.drop", json!({"id": 99})).await.unwrap_err();
    assert_eq!(
        (by_agent.code, not_the_users.code, unknown.code),
        (code::FORBIDDEN, code::CONFLICT, code::NOT_FOUND)
    );
    assert!(h.events().is_empty());

    let dropped = h.call("message.drop", json!({"id": 2})).await.unwrap();
    assert_eq!(
        (&dropped["status"], &dropped["reason"]),
        (&json!("dropped"), &json!("removed"))
    );
    assert_eq!(h.events(), ["message.dropped"]);
    let again = h.call("message.drop", json!({"id": 2})).await.unwrap_err();
    assert_eq!(again.code, code::CONFLICT);
}

#[tokio::test]
async fn b11_a_forbidden_get_leaves_no_touch() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
    h.call_as(
        agent("a"),
        "message.send",
        json!({"to": "b", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();

    let forbidden = h
        .call_as(agent("c"), "message.get", json!({"id": 1}))
        .await
        .unwrap_err();

    assert_eq!(forbidden.code, code::FORBIDDEN);
    assert_eq!(h.touches(1), [(Verb::Wrote, "a".to_owned())]);
}

#[tokio::test]
async fn b11_send_touches_wrote_get_touches_read_list_touches_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
    h.call_as(
        agent("a"),
        "message.send",
        json!({"to": "b", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();
    h.call_as(agent("b"), "message.get", json!({"id": 1}))
        .await
        .unwrap();
    h.call_as(agent("b"), "message.list", json!({}))
        .await
        .unwrap();

    assert_eq!(
        h.touches(1),
        [(Verb::Wrote, "a".to_owned()), (Verb::Read, "b".to_owned()),]
    );
}

#[tokio::test]
async fn b11_drop_touches_wrote_by_the_user() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
    h.call(
        "message.send",
        json!({"to": "b", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();

    h.call("message.drop", json!({"id": 1})).await.unwrap();

    assert_eq!(
        h.touches(1),
        [
            (Verb::Wrote, "you".to_owned()),
            (Verb::Wrote, "you".to_owned()),
        ]
    );
}

#[tokio::test]
async fn b11_provenance_touched_lists_a_message_under_each_actor_that_touched_it() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
    h.call_as(
        agent("a"),
        "message.send",
        json!({"to": "b", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();
    h.call_as(agent("b"), "message.get", json!({"id": 1}))
        .await
        .unwrap();

    let by_sender: Vec<_> = h
        .touches
        .touched("a")
        .unwrap()
        .into_iter()
        .map(|t| (t.verb, t.item))
        .collect();
    let by_reader: Vec<_> = h
        .touches
        .touched("b")
        .unwrap()
        .into_iter()
        .map(|t| (t.verb, t.item))
        .collect();

    assert_eq!(by_sender, [(Verb::Wrote, "message:1".to_owned())]);
    assert_eq!(by_reader, [(Verb::Read, "message:1".to_owned())]);
}

#[tokio::test]
async fn b11_reading_is_by_actor_the_user_may_read_any_an_agent_only_its_own() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(
        dir.path(),
        vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
    );
    h.call_as(
        agent("a"),
        "message.send",
        json!({"to": "b", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();

    let forbidden = h
        .call_as(agent("c"), "message.get", json!({"id": 1}))
        .await
        .unwrap_err();
    assert_eq!(forbidden.code, code::FORBIDDEN);

    h.call_as(agent("a"), "message.get", json!({"id": 1}))
        .await
        .unwrap();
    h.call_as(agent("b"), "message.get", json!({"id": 1}))
        .await
        .unwrap();
    h.call("message.get", json!({"id": 1})).await.unwrap();
}

#[tokio::test]
async fn b11_list_for_an_agent_returns_only_messages_it_sent_or_received() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(
        dir.path(),
        vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
    );
    h.call_as(
        agent("a"),
        "message.send",
        json!({"to": "b", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();
    h.call_as(
        agent("c"),
        "message.send",
        json!({"to": "b", "kind": "note", "body": "yo"}),
    )
    .await
    .unwrap();

    let listed_by_a = h
        .call_as(agent("a"), "message.list", json!({}))
        .await
        .unwrap();
    let ids: Vec<_> = listed_by_a
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].clone())
        .collect();
    assert_eq!(ids, [json!(1)]);

    let listed_by_b = h
        .call_as(agent("b"), "message.list", json!({}))
        .await
        .unwrap();
    assert_eq!(listed_by_b.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn b11_list_to_filters_by_receiver() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(
        dir.path(),
        vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
    );
    h.call_as(
        agent("a"),
        "message.send",
        json!({"to": "b", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();
    h.call_as(
        agent("a"),
        "message.send",
        json!({"to": "c", "kind": "note", "body": "yo"}),
    )
    .await
    .unwrap();

    let listed = h.call("message.list", json!({"to": "b"})).await.unwrap();
    let ids: Vec<_> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].clone())
        .collect();

    assert_eq!(ids, [json!(1)]);
}

#[tokio::test]
async fn b11_list_for_an_agent_never_matches_an_extension_sharing_its_id() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("y", Kind::Idle)]);
    let ext_x = Actor {
        kind: ActorKind::Ext,
        id: "x".into(),
        parent: None,
    };
    h.call_as(
        ext_x,
        "message.send",
        json!({"to": "y", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();

    let listed_by_agent_x = h
        .call_as(agent("x"), "message.list", json!({}))
        .await
        .unwrap();

    assert_eq!(
        listed_by_agent_x.as_array().unwrap().len(),
        0,
        "Agent x must not see the Extension x's Message just because the id strings match"
    );
}

#[tokio::test]
async fn b11_reading_an_agent_never_matches_an_extension_sharing_its_id() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("y", Kind::Idle)]);
    let ext_x = Actor {
        kind: ActorKind::Ext,
        id: "x".into(),
        parent: None,
    };
    let sent = h
        .call_as(
            ext_x,
            "message.send",
            json!({"to": "y", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    let id = sent["id"].as_u64().unwrap() as u32;

    let err = h
        .call_as(agent("x"), "message.get", json!({"id": id}))
        .await
        .unwrap_err();

    assert_eq!(
        err.code,
        code::FORBIDDEN,
        "Agent x may not read a Message the Extension x sent, just because the id strings match"
    );
}

fn ext(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Ext,
        id: id.into(),
        parent: None,
    }
}

#[tokio::test]
async fn b11_an_extension_sharing_a_receivers_id_cannot_read_or_list_its_messages() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    let got = h
        .call_as(ext("b"), "message.get", json!({"id": sent["id"]}))
        .await
        .unwrap_err();
    let listed = h
        .call_as(ext("b"), "message.list", json!({}))
        .await
        .unwrap();

    assert_eq!(got.code, code::FORBIDDEN);
    assert_eq!(listed.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn b11_list_status_filters_by_status() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    for body in ["first", "second"] {
        h.call(
            "message.send",
            json!({"to": "b", "kind": "note", "body": body}),
        )
        .await
        .unwrap();
    }
    h.call("message.drop", json!({"id": 1})).await.unwrap();

    let listed = h
        .call("message.list", json!({"status": "pending"}))
        .await
        .unwrap();
    let ids: Vec<_> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].clone())
        .collect();

    assert_eq!(ids, [json!(2)]);
}

fn door(id: &str, parent: Option<&str>) -> RailNode {
    let mut door = node(
        id,
        NodeKind::Workstream,
        true,
        Some(Status {
            kind: Kind::Idle,
            label: "status".into(),
            since: 0,
            finished: "0".into(),
        }),
    );
    door.parent = parent.map(Into::into);
    door
}

#[tokio::test]
async fn b2_a_message_to_an_idle_door_reaches_its_inbox_without_a_later_status_event() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::with_inbox(
        dir.path(),
        vec![door("m", None), agent_node("a", Kind::Working)],
    );

    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "m", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(h.inbox.typed().len(), 1);
    let got = h
        .call("message.get", json!({"id": sent["id"]}))
        .await
        .unwrap();
    assert_eq!(got["status"], "delivered");
}
