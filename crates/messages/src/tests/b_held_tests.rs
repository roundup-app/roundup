//! B6 Takeover, B7 order, B9 receiver gone, B10 the user as receiver. Written by an architect
//! before slice 2; the Builder makes these pass and never edits this file (the one-line `mod` in
//! `lib.rs` and the `Messages::open` call in the older `Harness` are the Builder's to amend).
//!
//! Pinned seams, the only names these tests need that the contract does not give:
//! - `Messages::open(dir, bus, agents, deliver: Deliver)` with
//!   `pub type Deliver = Arc<dyn Fn(String, String) -> Pin<Box<dyn Future<Output = Result<(),
//!   Refusal>> + Send>> + Send + Sync>` and `pub enum Refusal { Busy, NotAccepted, NotFound }`;
//!   the arguments are the Agent id and the text. Slice 3 maps `Agents::prompt` onto it.
//! - `Messages` reads `agent.status` events on the `bus` it is opened with: that is how it learns
//!   a Kind changed. An `idle` event calls `deliver` once, for the oldest deliverable Message to
//!   that Agent (B2's "next time `a` becomes `idle`"; typing at the moment of a send, and the
//!   outcomes of a refusal, are slice 3). A `done` or `error` event is B9, and ends a Takeover.
//! - A Message's `reason` on the wire is a string: `ask-first`, `takeover`, `receiver gone`.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use contracts::agent::{NodeKind, StatusEvent};
use contracts::{Actor, Event, EventData, Kind, Status};
use rpc::code;
use serde_json::{Value, json};
use tokio::sync::broadcast::Receiver;

use super::*;
use super::{FakeRail, agent, agent_node, node};

type Calls = Arc<StdMutex<Vec<(String, String)>>>;

struct Held2 {
    messages: Arc<Messages>,
    bus: Bus,
    rail: Arc<FakeRail>,
    calls: Calls,
    events: Receiver<Event>,
    touches: Arc<provenance::Touches>,
    dir: std::path::PathBuf,
}

fn recording() -> (Deliver, Calls) {
    let calls: Calls = Arc::default();
    let seen = Arc::clone(&calls);
    let deliver: Deliver = Arc::new(move |id: String, text: String| {
        seen.lock().unwrap().push((id, text));
        let done: Pin<Box<dyn Future<Output = Result<(), Refusal>> + Send>> =
            Box::pin(async { Ok(()) });
        done
    });
    (deliver, calls)
}

impl Held2 {
    fn new(dir: &Path, nodes: Vec<RailNode>) -> Self {
        let rail = FakeRail::new(nodes);
        Self::over(dir, rail, Bus::new())
    }

    fn over(dir: &Path, rail: Arc<FakeRail>, bus: Bus) -> Self {
        let (deliver, calls) = recording();
        Self::over_with(dir, rail, bus, deliver, calls)
    }

    fn over_with(
        dir: &Path,
        rail: Arc<FakeRail>,
        bus: Bus,
        deliver: Deliver,
        calls: Calls,
    ) -> Self {
        let events = bus.subscribe();
        let agents: Arc<dyn Module> = rail.clone();
        let messages = Arc::new(Messages::open(dir, bus.clone(), agents, deliver).unwrap());
        Self {
            messages,
            bus,
            rail,
            calls,
            events,
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
            dir: dir.to_path_buf(),
        }
    }

    /// The same Project, a new Daemon: a fresh `Messages` over the same files and Rail.
    fn restarted(self) -> Self {
        let Self { rail, dir, .. } = self;
        Self::over(&dir, rail, Bus::new())
    }

    async fn call_as(&self, actor: Actor, method: &str, p: Value) -> Result<Value, RpcError> {
        let ctx = Ctx {
            actor,
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        };
        self.messages.call(&ctx, method, p).await
    }

    async fn call(&self, method: &str, p: Value) -> Result<Value, RpcError> {
        self.call_as(Actor::user(), method, p).await
    }

    async fn send_as(&self, from: Actor, to: &str, body: &str) -> Value {
        let p = json!({"to": to, "kind": "note", "body": body});
        self.call_as(from, "message.send", p).await.unwrap()
    }

    async fn get(&self, id: u32) -> Value {
        self.call("message.get", json!({"id": id})).await.unwrap()
    }

    /// `(status, reason)` of each Message, by id.
    async fn states(&self) -> BTreeMap<u32, (String, Value)> {
        let all = self.call("message.list", json!({})).await.unwrap();
        all.as_array()
            .unwrap()
            .iter()
            .map(|m| {
                let state = (
                    m["status"].as_str().unwrap().to_owned(),
                    m["reason"].clone(),
                );
                (m["id"].as_u64().unwrap() as u32, state)
            })
            .collect()
    }

    async fn route(&self, to: &str, delivery: &str) {
        let p = json!({"from": "a", "to": to, "delivery": delivery});
        self.call("route.set", p).await.unwrap();
    }

    /// Tell `Messages` an Agent's Kind changed, the way the Agents module does: update the Rail,
    /// then announce it on the bus.
    fn becomes(&self, id: &str, kind: Kind) {
        let status = Status {
            kind,
            label: "x".into(),
            since: 0,
        };
        let mut revision = "1".to_owned();
        for node in self
            .rail
            .0
            .lock()
            .unwrap()
            .iter_mut()
            .filter(|n| n.id == id)
        {
            node.status = Some(status.clone());
            revision = (node
                .status_revision
                .as_deref()
                .unwrap()
                .parse::<i64>()
                .unwrap()
                + 1)
            .to_string();
            node.status_revision = Some(revision.clone());
        }
        let data = EventData::AgentStatus(StatusEvent {
            id: id.into(),
            attempt: "1".into(),
            status_revision: revision,
            status,
        });
        self.bus.emit(Actor::daemon(), data);
    }

    /// `name` plus payload of each event since the last call, oldest first.
    fn seen(&mut self) -> Vec<(String, Value)> {
        let mut seen = vec![];
        while let Ok(event) = self.events.try_recv() {
            let wire = serde_json::to_value(&event.data).unwrap();
            seen.push((
                wire["name"].as_str().unwrap().to_owned(),
                wire["data"].clone(),
            ));
        }
        seen
    }

    fn names(&mut self) -> Vec<String> {
        self.seen().into_iter().map(|(name, _)| name).collect()
    }

    /// Wait until `deliver` has been called `n` times; the bodies it was given, in order.
    async fn typed(&self, n: usize) -> Vec<String> {
        for _ in 0..500 {
            if self.calls.lock().unwrap().len() >= n {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let calls = self.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), n, "{calls:?}");
        calls.into_iter().map(|(_, text)| text).collect()
    }

    /// Wait for Message `id` to reach `status`.
    async fn until(&self, id: u32, status: &str) {
        for _ in 0..500 {
            if self.get(id).await["status"] == status {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("Message {id} never became {status}: {}", self.get(id).await);
    }

    async fn settle(&self) {
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

fn held(reason: &str) -> (String, Value) {
    ("held".into(), json!(reason))
}

fn pending() -> (String, Value) {
    ("pending".into(), Value::Null)
}

fn dropped(reason: &str) -> (String, Value) {
    ("dropped".into(), json!(reason))
}

fn project() -> (tempfile::TempDir, Held2) {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    (dir, h)
}

#[tokio::test]
async fn b6_only_the_user_begins_and_ends_a_takeover() {
    let (_dir, h) = project();

    for method in ["takeover.begin", "takeover.end"] {
        let err = h
            .call_as(agent("a"), method, json!({"agent": "b"}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::FORBIDDEN, "{method}");
    }
}

#[tokio::test]
async fn b6_an_id_that_names_no_agent_is_not_found_and_an_ended_agent_is_a_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(
        dir.path(),
        vec![
            agent_node("done", Kind::Done),
            agent_node("bad", Kind::Error),
        ],
    );

    let ghost = h
        .call("takeover.begin", json!({"agent": "ghost"}))
        .await
        .unwrap_err();
    let done = h
        .call("takeover.begin", json!({"agent": "done"}))
        .await
        .unwrap_err();
    let bad = h
        .call("takeover.begin", json!({"agent": "bad"}))
        .await
        .unwrap_err();

    assert_eq!(
        (ghost.code, done.code, bad.code),
        (code::NOT_FOUND, code::CONFLICT, code::CONFLICT)
    );
}

#[tokio::test]
async fn b6_each_change_emits_once_and_a_repeat_changes_nothing() {
    let (_dir, mut h) = project();

    h.call("takeover.end", json!({"agent": "b"})).await.unwrap();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.call("takeover.end", json!({"agent": "b"})).await.unwrap();
    h.call("takeover.end", json!({"agent": "b"})).await.unwrap();

    let changes: Vec<Value> = h
        .seen()
        .into_iter()
        .filter(|(name, _)| name == "takeover.changed")
        .map(|(_, data)| data)
        .collect();
    assert_eq!(
        changes,
        [
            json!({"agent": "b", "on": true}),
            json!({"agent": "b", "on": false})
        ]
    );
}

#[tokio::test]
async fn b6_during_a_takeover_a_message_from_anyone_is_held_for_it() {
    let (_dir, mut h) = project();
    h.route("b", "auto").await;
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.names();

    let auto = h.send_as(agent("a"), "b", "auto").await;
    let other = h.send_as(agent("c"), "b", "no route set").await;
    h.route("b", "ask-first").await;
    let ask = h.send_as(agent("a"), "b", "ask").await;
    h.route("b", "drop").await;
    let drop = h.send_as(agent("a"), "b", "drop").await;
    h.route("b", "auto").await;
    let user = h.send_as(Actor::user(), "b", "from the user").await;

    let status = |m: &Value| {
        (
            m["status"].as_str().unwrap().to_owned(),
            m["reason"].clone(),
        )
    };
    assert_eq!(status(&auto), held("takeover"));
    assert_eq!(status(&other), held("takeover"));
    assert_eq!(status(&ask), held("ask-first"));
    assert_eq!(status(&drop).0, "dropped");
    assert_eq!(status(&user), held("takeover"));
    assert_eq!(
        h.names(),
        [
            "message.sent",
            "message.held",
            "message.sent",
            "message.held",
            "route.changed",
            "message.sent",
            "message.held",
            "route.changed",
            "message.sent",
            "message.dropped",
            "route.changed",
            "message.sent",
            "message.held"
        ]
    );
}

#[tokio::test]
async fn b6_the_end_releases_takeover_holds_in_id_order_and_keeps_ask_first_held() {
    let (_dir, h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "one").await;
    h.route("b", "ask-first").await;
    h.send_as(agent("a"), "b", "two").await;
    h.route("b", "auto").await;
    h.send_as(agent("a"), "b", "three").await;

    h.call("takeover.end", json!({"agent": "b"})).await.unwrap();
    h.becomes("b", Kind::Idle);

    let states = h.states().await;
    assert_eq!(states[&2], held("ask-first"));
    assert_eq!(
        h.typed(1).await,
        ["[from a, note] one\n\n[from a, note] three"]
    );
    h.until(1, "delivered").await;
    h.until(3, "delivered").await;
}

#[tokio::test]
async fn b6_deliver_on_a_takeover_hold_releases_it_though_the_takeover_goes_on() {
    let (_dir, h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "one").await;
    h.send_as(agent("a"), "b", "two").await;

    h.call("message.deliver", json!({"id": 2})).await.unwrap();

    let states = h.states().await;
    assert_eq!(
        (states[&1].clone(), states[&2].clone()),
        (held("takeover"), pending())
    );
    h.becomes("b", Kind::Idle);
    assert!(h.typed(1).await[0].contains("two"));
}

#[tokio::test]
async fn b6_a_takeover_ends_by_itself_when_the_agent_exits_and_its_holds_are_then_dropped() {
    let (_dir, mut h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "one").await;
    h.seen();

    h.becomes("b", Kind::Done);

    h.until(1, "dropped").await;
    assert_eq!(h.states().await[&1], dropped("receiver gone"));
    let order: Vec<(String, Value)> = h.seen();
    let names: Vec<&str> = order
        .iter()
        .map(|(n, _)| n.as_str())
        .filter(|n| n.starts_with("takeover") || n.starts_with("message"))
        .collect();
    assert_eq!(names, ["takeover.changed", "message.dropped"]);
    let changed = order.iter().find(|(n, _)| n == "takeover.changed").unwrap();
    assert_eq!(changed.1, json!({"agent": "b", "on": false}));
}

#[tokio::test]
async fn b6_a_new_daemon_has_no_takeover_and_its_holds_are_pending() {
    let (_dir, h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "one").await;
    h.route("b", "ask-first").await;
    h.send_as(agent("a"), "b", "two").await;

    let h = h.restarted();

    let states = h.states().await;
    assert_eq!(
        (states[&1].clone(), states[&2].clone()),
        (pending(), held("ask-first"))
    );
    let later = h.send_as(agent("c"), "b", "three").await;
    assert_eq!(later["status"], "pending");
}

#[tokio::test]
async fn b7_messages_are_typed_in_the_order_they_became_deliverable() {
    let (_dir, h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "held-first").await;
    h.send_as(Actor::user(), "b", "pending-a").await;
    h.send_as(Actor::user(), "b", "pending-b").await;
    for id in [2, 3, 1] {
        h.call("message.deliver", json!({"id": id})).await.unwrap();
    }

    h.becomes("b", Kind::Idle);

    assert_eq!(
        h.typed(1).await,
        ["[from you, note] pending-a\n\n[from you, note] pending-b\n\n[from a, note] held-first"]
    );
}

#[tokio::test]
async fn b30_ten_pending_messages_are_one_prompt() {
    let (_dir, h) = project();
    let lines: Vec<String> = (0..10).map(|n| format!("[from a, note] m{n}")).collect();
    for n in 0..10 {
        h.send_as(agent("a"), "b", &format!("m{n}")).await;
    }

    h.becomes("b", Kind::Idle);
    h.settle().await;

    assert_eq!(h.typed(1).await, [lines.join("\n\n")]);
    for id in 1..=10 {
        h.until(id, "delivered").await;
    }
}

#[tokio::test]
async fn b30_a_batch_of_one_is_the_b2_prompt() {
    let (_dir, h) = project();
    h.send_as(agent("a"), "b", "one").await;

    h.becomes("b", Kind::Idle);

    assert_eq!(h.typed(1).await, ["[from a, note] one"]);
}

#[tokio::test]
async fn b30_the_batch_stops_at_32768_bytes_and_the_rest_waits_for_the_next_idle() {
    let (_dir, h) = project();
    let big = "x".repeat(8192);
    for _ in 0..5 {
        h.send_as(agent("a"), "b", &big).await;
    }

    h.becomes("b", Kind::Idle);
    let first = h.typed(1).await;
    assert!(first[0].len() <= 32_768, "{}", first[0].len());
    assert_eq!(first[0].matches("[from a, note]").count(), 3);
    h.until(4, "pending").await;
    h.becomes("b", Kind::Working);
    h.becomes("b", Kind::Idle);

    let typed = h.typed(2).await;
    assert_eq!(typed[1].matches("[from a, note]").count(), 2);
    h.until(5, "delivered").await;
}

#[tokio::test]
async fn b7_a_held_message_never_blocks_a_later_one() {
    let (_dir, h) = project();
    h.route("b", "ask-first").await;
    h.send_as(agent("a"), "b", "held").await;
    h.route("b", "auto").await;
    h.send_as(agent("a"), "b", "later").await;

    h.becomes("b", Kind::Idle);

    assert!(h.typed(1).await[0].contains("later"));
    assert_eq!(h.states().await[&1], held("ask-first"));
}

#[tokio::test]
async fn b9_an_agent_that_ends_drops_its_pending_messages_in_id_order() {
    for kind in [Kind::Done, Kind::Error] {
        let (_dir, mut h) = project();
        h.send_as(agent("a"), "b", "one").await;
        h.route("b", "ask-first").await;
        h.send_as(agent("a"), "b", "kept").await;
        h.route("b", "auto").await;
        h.send_as(agent("a"), "b", "three").await;
        h.seen();

        h.becomes("b", kind);

        h.until(3, "dropped").await;
        let states = h.states().await;
        assert_eq!(
            (states[&1].clone(), states[&2].clone(), states[&3].clone()),
            (
                dropped("receiver gone"),
                held("ask-first"),
                dropped("receiver gone")
            ),
            "{kind:?}"
        );
        let dropped_ids: Vec<u64> = h
            .seen()
            .into_iter()
            .filter(|(name, _)| name == "message.dropped")
            .map(|(_, data)| data["id"].as_u64().unwrap())
            .collect();
        assert_eq!(dropped_ids, [1, 3], "{kind:?}");
    }
}

#[tokio::test]
async fn b9_a_later_send_or_a_deliver_to_an_ended_agent_is_a_conflict_and_changes_nothing() {
    let (_dir, h) = project();
    h.route("b", "ask-first").await;
    h.send_as(agent("a"), "b", "kept").await;
    h.becomes("b", Kind::Done);
    h.settle().await;

    let send = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "late"}),
        )
        .await
        .unwrap_err();
    let deliver = h
        .call("message.deliver", json!({"id": 1}))
        .await
        .unwrap_err();

    assert_eq!((send.code, deliver.code), (code::CONFLICT, code::CONFLICT));
    assert_eq!(h.states().await[&1], held("ask-first"));
}

#[tokio::test]
async fn b10_a_message_to_the_user_is_delivered_at_once_with_no_status_event() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);

    let sent = h.send_as(agent("b"), "you", "hello").await;

    assert_eq!(sent["status"], "delivered");
    assert_eq!(h.names(), ["message.sent", "message.delivered"]);
    assert!(h.calls.lock().unwrap().is_empty());
}

/// The Daemon is built before its runtime exists (a desktop test builds it, then `block_on`s).
#[test]
fn b2_a_messages_opened_before_any_runtime_still_types_on_idle() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);

    tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap()
        .block_on(async {
            h.send_as(agent("a"), "b", "wait for me").await;
            h.becomes("b", Kind::Idle);
            assert_eq!(h.typed(1).await.len(), 1);
        });
}

/// A `deliver` that records the call, then waits for `release` before it answers `Ok`.
fn blocking() -> (Deliver, Calls, Arc<tokio::sync::Notify>) {
    let calls: Calls = Arc::default();
    let seen = Arc::clone(&calls);
    let release = Arc::new(tokio::sync::Notify::new());
    let gate = Arc::clone(&release);
    let deliver: Deliver = Arc::new(move |id: String, text: String| {
        seen.lock().unwrap().push((id, text));
        let gate = Arc::clone(&gate);
        let done: Pin<Box<dyn Future<Output = Result<(), Refusal>> + Send>> =
            Box::pin(async move {
                gate.notified().await;
                Ok(())
            });
        done
    });
    (deliver, calls, release)
}

/// A `deliver` that records the call and refuses it with `Busy`.
fn refusing() -> (Deliver, Calls) {
    refusing_with(Refusal::Busy)
}

fn refusing_with(refusal: Refusal) -> (Deliver, Calls) {
    let calls: Calls = Arc::default();
    let seen = Arc::clone(&calls);
    let deliver: Deliver = Arc::new(move |id: String, text: String| {
        seen.lock().unwrap().push((id, text));
        let done: Pin<Box<dyn Future<Output = Result<(), Refusal>> + Send>> =
            Box::pin(async move { Err(refusal) });
        done
    });
    (deliver, calls)
}

#[tokio::test]
async fn b6_a_message_recorded_delivered_before_begin_stays_delivered() {
    let dir = tempfile::tempdir().unwrap();
    let (deliver, calls, release) = blocking();
    let rail = FakeRail::new(vec![agent_node("b", Kind::Working)]);
    let h = Held2::over_with(dir.path(), rail, Bus::new(), deliver, calls);
    h.send_as(agent("a"), "b", "one").await;
    h.becomes("b", Kind::Idle);
    h.typed(1).await;

    let begin = tokio::time::timeout(
        Duration::from_secs(1),
        h.call("takeover.begin", json!({"agent": "b"})),
    )
    .await;
    release.notify_waiters();
    h.settle().await;
    h.call("takeover.end", json!({"agent": "b"})).await.unwrap();
    h.becomes("b", Kind::Working);
    h.becomes("b", Kind::Idle);
    h.settle().await;

    assert!(begin.is_ok(), "begin waited for a prompt being typed");
    assert_eq!(h.get(1).await["status"], "delivered");
    assert_eq!(h.typed(1).await.len(), 1, "typed twice");
}

#[tokio::test]
async fn b6_pending_messages_are_held_when_a_takeover_begins() {
    let (_dir, mut h) = project();
    h.send_as(agent("a"), "b", "one").await;
    h.send_as(Actor::user(), "b", "two").await;
    h.names();

    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();

    let states = h.states().await;
    assert_eq!(
        (states[&1].clone(), states[&2].clone()),
        (held("takeover"), held("takeover"))
    );
    assert_eq!(
        h.names(),
        ["message.held", "message.held", "takeover.changed"]
    );
}

#[tokio::test]
async fn b7_messages_released_by_an_end_go_behind_those_already_pending() {
    let (_dir, h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "one").await;
    h.route("b", "ask-first").await;
    h.send_as(agent("a"), "b", "two").await;
    h.call("message.deliver", json!({"id": 2})).await.unwrap();
    h.call("takeover.end", json!({"agent": "b"})).await.unwrap();

    h.becomes("b", Kind::Idle);

    assert_eq!(
        h.typed(1).await,
        ["[from a, note] two\n\n[from a, note] one"]
    );
}

#[tokio::test]
async fn b7_a_message_sent_after_a_release_goes_behind_it() {
    let (_dir, h) = project();
    h.route("b", "ask-first").await;
    h.send_as(agent("a"), "b", "one").await;
    h.call("message.deliver", json!({"id": 1})).await.unwrap();
    h.route("b", "auto").await;
    h.send_as(agent("a"), "b", "two").await;

    h.becomes("b", Kind::Idle);

    assert_eq!(
        h.typed(1).await,
        ["[from a, note] one\n\n[from a, note] two"]
    );
}

#[tokio::test]
async fn b7_a_hold_released_on_reopen_goes_behind_the_pending_messages() {
    let (_dir, h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "one").await;
    h.route("b", "ask-first").await;
    h.send_as(agent("a"), "b", "two").await;
    h.call("message.deliver", json!({"id": 2})).await.unwrap();

    let h = h.restarted();
    h.states().await;
    h.becomes("b", Kind::Idle);

    assert_eq!(
        h.typed(1).await,
        ["[from a, note] two\n\n[from a, note] one"]
    );
}

#[tokio::test]
async fn b2_an_idle_records_delivered_and_emits_message_delivered() {
    let (_dir, mut h) = project();
    h.send_as(agent("a"), "b", "one").await;
    h.names();

    h.becomes("b", Kind::Idle);
    h.until(1, "delivered").await;

    assert_eq!(h.names(), ["agent.status", "message.delivered"]);
}

#[tokio::test]
async fn b2_a_refused_delivery_leaves_the_message_pending_and_emits_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (deliver, calls) = refusing();
    let rail = FakeRail::new(vec![agent_node("b", Kind::Working)]);
    let mut h = Held2::over_with(dir.path(), rail, Bus::new(), deliver, calls);
    h.send_as(agent("a"), "b", "one").await;
    h.names();

    h.becomes("b", Kind::Idle);
    h.typed(1).await;
    h.settle().await;

    assert_eq!(h.get(1).await["status"], "pending");
    assert_eq!(h.names(), ["agent.status"]);
}

#[tokio::test]
async fn b2_typed_text_is_from_name_kind_body() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(
        dir.path(),
        vec![
            agent_node("a", Kind::Working),
            agent_node("b", Kind::Working),
        ],
    );
    let question = json!({"to": "b", "kind": "question", "body": "x"});
    h.call_as(agent("a"), "message.send", question)
        .await
        .unwrap();
    h.send_as(Actor::user(), "b", "y").await;

    h.becomes("b", Kind::Idle);

    assert_eq!(
        h.typed(1).await,
        ["[from a, question] x\n\n[from you, note] y"]
    );
}

#[tokio::test]
async fn b9_a_done_lost_to_lag_still_drops_pending() {
    let (_dir, h) = project();
    h.send_as(agent("a"), "b", "one").await;
    h.becomes("b", Kind::Done);
    for _ in 0..2000 {
        h.bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(StatusEvent {
                id: "z".into(),
                attempt: "1".into(),
                status_revision: "1".into(),
                status: Status {
                    kind: Kind::Working,
                    label: "x".into(),
                    since: 0,
                },
            }),
        );
    }

    h.until(1, "dropped").await;

    assert_eq!(h.states().await[&1], dropped("receiver gone"));
}

#[test]
fn b2_a_reopened_store_opened_before_any_runtime_types_on_an_idle_before_the_first_call() {
    let dir = tempfile::tempdir().unwrap();
    let first = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    let runtime = || {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
    };
    runtime().block_on(first.send_as(agent("a"), "b", "one"));

    let h = first.restarted();
    h.becomes("b", Kind::Idle);

    runtime().block_on(async {
        h.states().await;
        assert_eq!(h.typed(1).await.len(), 1);
    });
}

#[tokio::test]
async fn b6_the_user_and_a_group_cannot_be_taken_over() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(
        dir.path(),
        vec![node("g", NodeKind::Workstream, false, None)],
    );

    for id in ["you", "g", "ghost"] {
        for method in ["takeover.begin", "takeover.end"] {
            let err = h.call(method, json!({"agent": id})).await.unwrap_err();
            assert_eq!(
                err.code,
                if id == "g" {
                    code::CONFLICT
                } else {
                    code::NOT_FOUND
                },
                "{method} {id}"
            );
        }
    }
}

/// A `deliver` that records the call, waits for `release`, then refuses with `Busy`.
fn blocking_then_busy() -> (Deliver, Calls, Arc<tokio::sync::Notify>) {
    let calls: Calls = Arc::default();
    let seen = Arc::clone(&calls);
    let release = Arc::new(tokio::sync::Notify::new());
    let gate = Arc::clone(&release);
    let deliver: Deliver = Arc::new(move |id: String, text: String| {
        seen.lock().unwrap().push((id, text));
        let gate = Arc::clone(&gate);
        let done: Pin<Box<dyn Future<Output = Result<(), Refusal>> + Send>> =
            Box::pin(async move {
                gate.notified().await;
                Err(Refusal::Busy)
            });
        done
    });
    (deliver, calls, release)
}

#[tokio::test]
async fn b6_a_busy_refusal_during_a_takeover_holds_the_message_for_it() {
    let dir = tempfile::tempdir().unwrap();
    let (deliver, calls, release) = blocking_then_busy();
    let rail = FakeRail::new(vec![agent_node("b", Kind::Working)]);
    let mut h = Held2::over_with(dir.path(), rail, Bus::new(), deliver, calls);
    h.send_as(agent("a"), "b", "one").await;
    h.becomes("b", Kind::Idle);
    h.typed(1).await;
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.names();

    release.notify_waiters();
    h.until(1, "held").await;
    h.becomes("b", Kind::Working);
    h.becomes("b", Kind::Idle);
    h.settle().await;

    assert_eq!(h.states().await[&1], held("takeover"));
    assert_eq!(h.typed(1).await.len(), 1, "typed during the Takeover");
    assert!(h.names().contains(&"message.held".to_owned()));
}

#[tokio::test]
async fn b9_a_lag_drops_nothing_for_a_live_agent() {
    let (_dir, h) = project();
    h.send_as(agent("a"), "b", "one").await;
    for _ in 0..2000 {
        h.bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(StatusEvent {
                id: "z".into(),
                attempt: "1".into(),
                status_revision: "1".into(),
                status: Status {
                    kind: Kind::Working,
                    label: "x".into(),
                    since: 0,
                },
            }),
        );
    }
    h.settle().await;

    assert_eq!(h.states().await[&1], pending());
}

#[tokio::test]
async fn b2_a_reopened_store_on_a_runtime_types_on_an_idle_before_any_call() {
    let (_dir, h) = project();
    h.send_as(agent("a"), "b", "one").await;

    let h = h.restarted();
    h.becomes("b", Kind::Idle);

    assert_eq!(h.typed(1).await.len(), 1);
}

#[tokio::test]
async fn b6_drop_of_a_takeover_held_message() {
    let (_dir, mut h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.send_as(agent("a"), "b", "one").await;
    h.names();

    h.call("message.drop", json!({"id": 1})).await.unwrap();
    let later = h.send_as(agent("a"), "b", "two").await;
    h.call("takeover.end", json!({"agent": "b"})).await.unwrap();

    assert_eq!(h.states().await[&1], ("dropped".into(), Value::Null));
    assert_eq!(
        later["status"], "held",
        "the Takeover went on after the drop"
    );
    assert_eq!(
        h.names(),
        [
            "message.dropped",
            "message.sent",
            "message.held",
            "takeover.changed"
        ]
    );
}

#[tokio::test]
async fn b1_held_for_takeover_messages_count_toward_the_bound_of_32() {
    let (_dir, h) = project();
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    for _ in 0..32 {
        h.send_as(agent("a"), "b", "x").await;
    }

    let err = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "x"}),
        )
        .await
        .unwrap_err();

    assert_eq!(err.code, code::CONFLICT);
}

#[tokio::test]
async fn b6_a_door_can_be_taken_over() {
    let dir = tempfile::tempdir().unwrap();
    let working = Status {
        kind: Kind::Working,
        label: "x".into(),
        since: 0,
    };
    let h = Held2::new(
        dir.path(),
        vec![node("m", NodeKind::Workstream, true, Some(working))],
    );

    h.call("takeover.begin", json!({"agent": "m"}))
        .await
        .unwrap();
    let sent = h.send_as(agent("a"), "m", "one").await;

    assert_eq!(
        (sent["status"].clone(), sent["reason"].clone()),
        ("held".into(), json!("takeover"))
    );
}

#[tokio::test]
async fn b2_typed_text_names_an_agent_by_its_rail_name() {
    let dir = tempfile::tempdir().unwrap();
    let mut renamed = agent_node("a", Kind::Working);
    renamed.name = "builder".into();
    let h = Held2::new(dir.path(), vec![renamed, agent_node("b", Kind::Working)]);
    h.send_as(agent("a"), "b", "x").await;

    h.becomes("b", Kind::Idle);

    assert_eq!(h.typed(1).await, ["[from builder, note] x"]);
}

#[tokio::test]
async fn b32_a_busy_refusal_of_a_users_message_during_a_takeover_holds_it() {
    let dir = tempfile::tempdir().unwrap();
    let (deliver, calls, release) = blocking_then_busy();
    let rail = FakeRail::new(vec![agent_node("b", Kind::Working)]);
    let mut h = Held2::over_with(dir.path(), rail, Bus::new(), deliver, calls);
    h.send_as(Actor::user(), "b", "one").await;
    h.becomes("b", Kind::Idle);
    h.typed(1).await;
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();
    h.names();

    release.notify_waiters();
    h.settle().await;

    assert_eq!(h.states().await[&1], held("takeover"));
    assert!(h.names().contains(&"message.held".to_owned()));
}

#[tokio::test]
async fn b2_a_rail_that_cannot_answer_leaves_the_message_pending_for_the_next_idle() {
    let (_dir, h) = project();
    h.send_as(agent("a"), "b", "one").await;

    h.rail.fail(true);
    h.becomes("b", Kind::Idle);
    h.settle().await;
    assert_eq!(h.get(1).await["status"], "pending");
    assert!(h.calls.lock().unwrap().is_empty());

    h.rail.fail(false);
    h.becomes("b", Kind::Working);
    h.becomes("b", Kind::Idle);
    h.until(1, "delivered").await;
    assert_eq!(h.typed(1).await.len(), 1);
}

fn status_flood(h: &Held2) {
    for _ in 0..2000 {
        h.bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(StatusEvent {
                id: "z".into(),
                attempt: "1".into(),
                status_revision: "1".into(),
                status: Status {
                    kind: Kind::Working,
                    label: "x".into(),
                    since: 0,
                },
            }),
        );
    }
}

#[tokio::test]
async fn b9_a_lag_while_the_rail_cannot_answer_still_drops_pending_once_it_can() {
    let (_dir, h) = project();
    h.send_as(agent("a"), "b", "one").await;

    h.rail.fail(true);
    h.becomes("b", Kind::Done);
    status_flood(&h);
    h.settle().await;
    h.rail.fail(false);
    h.becomes("z", Kind::Working);

    h.until(1, "dropped").await;
    assert_eq!(h.states().await[&1], dropped("receiver gone"));
}

#[tokio::test]
async fn b2_a_sender_no_longer_on_the_rail_is_named_by_its_id() {
    let (_dir, h) = project();
    h.send_as(agent("a"), "b", "one").await;

    h.becomes("b", Kind::Idle);

    assert_eq!(h.typed(1).await, ["[from a, note] one"]);
}

#[tokio::test]
async fn b9_old_exit_idle_and_receiver_lookup_cannot_touch_new_attempt() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    let old_node = h.rail.0.lock().unwrap()[0].clone();
    let old = h.send_as(agent("a"), "b", "old").await;
    super::super::on_status(
        &h.messages.inner,
        "b",
        "1",
        "9223372036854775807",
        Kind::Done,
    )
    .await;
    assert_eq!(
        h.get(old["id"].as_u64().unwrap() as u32).await["status"],
        "dropped"
    );
    h.rail.0.lock().unwrap()[0].attempt = Some("2".into());
    h.call("takeover.begin", json!({"agent":"b"}))
        .await
        .unwrap();
    let new = h.send_as(Actor::user(), "b", "new pending").await;
    h.call("message.deliver", json!({"id": new["id"]}))
        .await
        .unwrap();
    let held = h.send_as(agent("a"), "b", "new held").await;
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Done).await;
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Idle).await;
    assert!(h.calls.lock().unwrap().is_empty());
    let mut store = h.messages.store().unwrap();
    assert_eq!(
        super::super::accept_receiver(&h.messages.inner, &mut store, &old_node)
            .unwrap_err()
            .code,
        code::CONFLICT
    );
    assert!(store.is_takeover_active("b"));
    assert_eq!(
        store
            .get(new["id"].as_u64().unwrap() as u32)
            .unwrap()
            .unwrap()
            .status,
        MessageStatus::Pending
    );
    assert_eq!(
        store
            .get(held["id"].as_u64().unwrap() as u32)
            .unwrap()
            .unwrap()
            .status,
        MessageStatus::Held
    );
    assert_eq!(
        store
            .get(old["id"].as_u64().unwrap() as u32)
            .unwrap()
            .unwrap()
            .status,
        MessageStatus::Dropped
    );
}

#[tokio::test]
async fn b9_recovered_live_attempt_accepts_new_work_without_reviving_finals() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    h.rail.0.lock().unwrap()[0].terminal_id = Some("live-terminal".into());
    let stale = h.rail.0.lock().unwrap()[0].clone();
    let old = h.send_as(agent("a"), "b", "old").await;
    h.rail.0.lock().unwrap()[0].status.as_mut().unwrap().kind = Kind::Error;
    h.rail.0.lock().unwrap()[0].status_revision = Some("2".into());
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Error).await;
    {
        let mut store = h.messages.store().unwrap();
        assert_eq!(
            super::super::accept_receiver(&h.messages.inner, &mut store, &stale)
                .unwrap_err()
                .code,
            code::CONFLICT
        );
    }
    h.rail.0.lock().unwrap()[0].status.as_mut().unwrap().kind = Kind::Working;
    h.rail.0.lock().unwrap()[0].status_revision = Some("3".into());
    super::super::on_status(&h.messages.inner, "b", "1", "3", Kind::Working).await;
    let new = h.send_as(Actor::user(), "b", "new").await;
    h.call("takeover.begin", json!({"agent":"b"}))
        .await
        .unwrap();
    assert_eq!(new["status"], "pending");
    assert_eq!(
        h.get(old["id"].as_u64().unwrap() as u32).await["status"],
        "dropped"
    );
}

#[tokio::test]
async fn b9_old_active_status_cannot_reopen_a_stopped_attempt() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    h.send_as(agent("a"), "b", "old").await;
    {
        let mut nodes = h.rail.0.lock().unwrap();
        nodes[0].terminal_id = None;
        nodes[0].status.as_mut().unwrap().kind = Kind::Done;
    }
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Done).await;
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Working).await;
    assert_eq!(
        h.call("message.send", json!({"to":"b","kind":"note","body":"new"}))
            .await
            .unwrap_err()
            .code,
        code::CONFLICT
    );
}

#[tokio::test]
async fn b9_queued_error_cannot_drop_work_accepted_after_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    let old = h.send_as(agent("a"), "b", "old").await;
    h.rail.0.lock().unwrap()[0].status_revision = Some("3".into());
    h.call("takeover.begin", json!({"agent":"b"}))
        .await
        .unwrap();
    let new = h.send_as(Actor::user(), "b", "new").await;
    h.call("message.deliver", json!({"id": new["id"]}))
        .await
        .unwrap();
    let held = h.send_as(agent("a"), "b", "new held").await;
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Error).await;
    for (message, expected) in [(&old, "dropped"), (&new, "pending"), (&held, "held")] {
        assert_eq!(
            h.get(message["id"].as_u64().unwrap() as u32).await["status"],
            expected
        );
    }
    assert!(h.messages.store().unwrap().is_takeover_active("b"));
}

#[tokio::test]
async fn b2_queued_idle_cannot_deliver_work_accepted_after_it_was_published() {
    let dir = tempfile::tempdir().unwrap();
    let h = Held2::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    h.rail.0.lock().unwrap()[0].status_revision = Some("2".into());
    let new = h.send_as(agent("a"), "b", "new").await;
    super::super::on_status(&h.messages.inner, "b", "1", "2", Kind::Idle).await;
    assert!(h.calls.lock().unwrap().is_empty());
    assert_eq!(
        h.get(new["id"].as_u64().unwrap() as u32).await["status"],
        "pending"
    );
    h.rail.0.lock().unwrap()[0].status_revision = Some("4".into());
    super::super::on_status(&h.messages.inner, "b", "1", "4", Kind::Idle).await;
    assert_eq!(h.typed(1).await, ["[from a, note] new"]);
}

const TERMINAL: &str = "t-b";

impl Held2 {
    /// The user writes `bytes` to the Terminal of Agent `b`, as `terminal.write` does.
    async fn user_writes(&self, bytes: &[u8]) {
        self.rail.0.lock().unwrap()[0].terminal_id = Some(TERMINAL.into());
        self.messages.user_wrote(TERMINAL, bytes).await;
    }

    async fn takeover(&self, method: &str) {
        self.call(method, json!({"agent": "b"})).await.unwrap();
    }
}

#[tokio::test]
async fn b32_a_user_message_under_takeover_is_held_not_typed() {
    let (_dir, mut h) = project();
    h.takeover("takeover.begin").await;
    h.names();

    h.send_as(Actor::user(), "b", "my own note").await;
    h.becomes("b", Kind::Idle);
    h.settle().await;

    assert_eq!(h.states().await[&1], held("takeover"));
    assert!(h.calls.lock().unwrap().is_empty(), "nothing is typed");
    assert!(h.names().contains(&"message.held".to_owned()));
}

#[tokio::test]
async fn b32_a_message_waits_while_the_user_has_unsent_input() {
    let (_dir, h) = project();
    h.user_writes(b"We need to design").await;

    h.send_as(agent("a"), "b", "from an agent").await;
    h.send_as(Actor::user(), "b", "from the user").await;
    h.becomes("b", Kind::Idle);
    h.settle().await;

    let states = h.states().await;
    assert_eq!(
        (states[&1].clone(), states[&2].clone()),
        (held("takeover"), held("takeover"))
    );
    assert!(
        h.calls.lock().unwrap().is_empty(),
        "the user's text is never glued to a prompt"
    );
}

#[tokio::test]
async fn b32_the_end_of_takeover_or_a_submit_releases_the_held_messages_as_one_batch() {
    let (_dir, h) = project();
    h.takeover("takeover.begin").await;
    h.send_as(agent("a"), "b", "one").await;
    h.send_as(Actor::user(), "b", "two").await;
    h.takeover("takeover.end").await;
    let states = h.states().await;
    assert_eq!(
        (states[&1].clone(), states[&2].clone()),
        (pending(), pending())
    );

    h.user_writes(b"typing").await;
    h.send_as(agent("a"), "b", "three").await;
    h.send_as(agent("a"), "b", "four").await;
    assert_eq!(h.states().await[&3], held("takeover"));
    h.user_writes(b" more\r").await;
    let states = h.states().await;
    assert_eq!(
        (states[&3].clone(), states[&4].clone()),
        (pending(), pending())
    );

    h.becomes("b", Kind::Idle);
    assert_eq!(
        h.typed(1).await,
        [
            "[from a, note] one\n\n[from you, note] two\n\n[from a, note] three\n\n[from a, note] four"
        ]
    );
}

#[test]
fn u399_escape_carriage_return_is_neither_a_submit_nor_a_clear() {
    use super::super::input_effect;
    assert_eq!(input_effect(b"\x1b\r"), (false, true), "counts as input");
    assert_eq!(
        input_effect(b"ab\x1b\r\x1b\r"),
        (false, true),
        "a line each time"
    );
    assert_eq!(
        input_effect(b"ab\x1b\r\r"),
        (true, false),
        "a later \\r submits"
    );
}

#[tokio::test]
async fn u399_a_message_held_for_unsent_input_stays_held_after_shift_enter() {
    let (_dir, h) = project();
    h.user_writes(b"half").await;
    h.send_as(agent("a"), "b", "one").await;
    assert_eq!(h.get(1).await["status"], "held");

    h.user_writes(b"\x1b\r").await;
    assert_eq!(
        h.get(1).await["status"],
        "held",
        "a new line submits nothing"
    );

    h.user_writes(b"\r").await;
    assert_eq!(
        h.get(1).await["status"],
        "pending",
        "the \\r that submits releases it"
    );
}

#[tokio::test]
async fn b32_a_clear_releases_the_held_messages() {
    for clear in [0x15u8, 0x03] {
        let (_dir, h) = project();
        h.user_writes(b"half a sentence").await;
        h.send_as(agent("a"), "b", "one").await;
        assert_eq!(h.get(1).await["status"], "held");

        h.user_writes(&[clear]).await;

        assert_eq!(h.get(1).await["status"], "pending", "byte {clear:#x}");
    }
}

#[tokio::test]
async fn b32_input_after_a_takeover_ends_keeps_the_messages_held() {
    let (_dir, h) = project();
    h.takeover("takeover.begin").await;
    h.user_writes(b"x").await;
    h.send_as(agent("a"), "b", "one").await;

    h.takeover("takeover.end").await;
    assert_eq!(
        h.states().await[&1],
        held("takeover"),
        "unsent input still holds it"
    );

    h.user_writes(b"\r").await;
    assert_eq!(h.states().await[&1], pending());
}

#[tokio::test]
async fn b32_a_held_message_is_never_dropped_or_typed_twice() {
    let (_dir, h) = project();
    h.becomes("b", Kind::Idle);
    h.user_writes(b"wip").await;
    h.send_as(agent("a"), "b", "one").await;
    for _ in 0..3 {
        h.becomes("b", Kind::Working);
        h.becomes("b", Kind::Idle);
        h.settle().await;
    }
    assert_eq!(h.get(1).await["status"], "held");

    h.user_writes(b"\r").await;
    h.until(1, "delivered").await;
    for _ in 0..3 {
        h.becomes("b", Kind::Working);
        h.becomes("b", Kind::Idle);
        h.settle().await;
    }

    assert_eq!(h.typed(1).await.len(), 1, "typed once");
    assert_eq!(h.get(1).await["status"], "delivered");
}

#[test]
fn b32_escape_sequences_are_not_text_and_backspace_is_counted() {
    use super::super::input_effect;
    assert_eq!(
        input_effect(b"\x1b[I\x1b[O\x1b[A"),
        (false, false),
        "focus and arrow keys"
    );
    assert_eq!(
        input_effect(b"ab\x7f"),
        (false, true),
        "a deleted byte stays counted"
    );
    assert_eq!(
        input_effect(b"ab\rcd"),
        (true, true),
        "text after a submit is new input"
    );
    assert_eq!(input_effect(b"ab\x15"), (true, false));
}

#[tokio::test]
async fn b30_busy_returns_the_whole_batch_to_pending_and_not_accepted_drops_it() {
    for (refusal, status) in [
        (Refusal::Busy, "pending"),
        (Refusal::NotAccepted, "dropped"),
        (Refusal::NotFound, "dropped"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (deliver, calls) = refusing_with(refusal);
        let rail = FakeRail::new(vec![agent_node("b", Kind::Working)]);
        let h = Held2::over_with(dir.path(), rail, Bus::new(), deliver, calls);
        for body in ["one", "two", "three"] {
            h.send_as(agent("a"), "b", body).await;
        }

        h.becomes("b", Kind::Idle);
        h.typed(1).await;
        h.settle().await;

        for id in 1..=3 {
            assert_eq!(h.get(id).await["status"], status, "{refusal:?} {id}");
        }
    }
}

#[tokio::test]
async fn b30_a_message_sent_while_the_batch_is_typed_waits_for_the_next_idle() {
    let dir = tempfile::tempdir().unwrap();
    let (deliver, calls, release) = blocking();
    let rail = FakeRail::new(vec![agent_node("b", Kind::Working)]);
    let h = Held2::over_with(dir.path(), rail, Bus::new(), deliver, calls);
    h.send_as(agent("a"), "b", "one").await;
    h.send_as(agent("a"), "b", "two").await;
    h.becomes("b", Kind::Idle);
    h.typed(1).await;
    h.becomes("b", Kind::Working);

    tokio::join!(h.send_as(agent("a"), "b", "late"), async {
        h.settle().await;
        release.notify_waiters();
    });
    h.settle().await;

    assert_eq!(h.get(3).await["status"], "pending");
    assert_eq!(
        h.typed(1).await,
        ["[from a, note] one\n\n[from a, note] two"]
    );
}

#[tokio::test]
async fn b30_a_takeover_between_the_check_and_the_record_holds_the_whole_batch() {
    let (_dir, h) = project();
    h.send_as(agent("a"), "b", "one").await;
    h.send_as(agent("a"), "b", "two").await;
    h.call("takeover.begin", json!({"agent": "b"}))
        .await
        .unwrap();

    h.becomes("b", Kind::Idle);
    h.settle().await;

    let states = h.states().await;
    assert_eq!(
        (states[&1].clone(), states[&2].clone()),
        (held("takeover"), held("takeover"))
    );
    assert!(h.calls.lock().unwrap().is_empty(), "something was typed");
}

#[tokio::test]
async fn b30_a_killed_daemon_never_types_the_batch_twice() {
    let dir = tempfile::tempdir().unwrap();
    let (deliver, calls, _never_released) = blocking();
    let rail = FakeRail::new(vec![agent_node("b", Kind::Working)]);
    let h = Held2::over_with(dir.path(), rail, Bus::new(), deliver, calls);
    h.send_as(agent("a"), "b", "one").await;
    h.send_as(agent("a"), "b", "two").await;
    h.becomes("b", Kind::Idle);
    h.typed(1).await;

    let h = h.restarted();
    h.states().await;
    h.becomes("b", Kind::Idle);
    h.settle().await;

    assert_eq!(
        (
            h.get(1).await["status"].clone(),
            h.get(2).await["status"].clone()
        ),
        ("delivered".into(), "delivered".into())
    );
    assert!(h.calls.lock().unwrap().is_empty(), "typed again");
}

#[tokio::test]
async fn b30_a_burst_of_8_pushes_to_a_door_types_at_most_one_prompt_per_idle() {
    let (_dir, h) = project();
    for n in 0..8 {
        let entry = contracts::agent::DigestEntry {
            name: format!("c{n}"),
            kind: Kind::Working,
            last: "x".into(),
            todos: n,
            pads: vec![],
        };
        h.messages.push_digest("b", &entry).await.unwrap();
    }

    h.becomes("b", Kind::Idle);
    h.settle().await;

    let typed = h.typed(1).await;
    assert_eq!(typed.len(), 1, "{typed:?}");
    assert_eq!(typed[0].matches("[digest]").count(), 8);
    assert_eq!(h.calls.lock().unwrap().len(), 1);
}
