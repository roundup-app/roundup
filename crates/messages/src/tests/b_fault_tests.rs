//! B28: one failure fails one operation. `Env::fault` stands in for a Store that panics or errs
//! while an operation holds the lock.

use std::sync::atomic::{AtomicI64, Ordering};

use contracts::agent::StatusEvent;
use contracts::{Actor, EventData, Kind, Status};
use serde_json::{Value, json};

use super::*;
use super::{FakeInbox, FakeRail, GatedInbox, agent_node, attach_inbox, fake_inbox};

/// What the next call of one operation does when it reaches the lock.
#[derive(Clone, Copy)]
enum Fail {
    Panic,
    Err,
}

struct Faulty {
    messages: Messages,
    bus: Bus,
    touches: Arc<provenance::Touches>,
    inbox: Arc<FakeInbox>,
    armed: Arc<StdMutex<Option<(&'static str, Fail)>>>,
    completed: tokio::sync::Mutex<tokio::sync::broadcast::Receiver<&'static str>>,
}

impl Faulty {
    fn new(dir: &Path) -> Self {
        Self::over(dir, vec![agent_node("a", Kind::Working)])
    }

    fn over(dir: &Path, nodes: Vec<RailNode>) -> Self {
        let bus = Bus::new();
        let touches = Arc::new(provenance::Touches::in_memory().unwrap());
        let armed: Arc<StdMutex<Option<(&'static str, Fail)>>> = Arc::default();
        let trigger = Arc::clone(&armed);
        let clock: Arc<AtomicI64> = Arc::default();
        let reads = Arc::clone(&clock);
        let env = Env {
            touches: Arc::clone(&touches),
            clock: Arc::new(move || reads.load(Ordering::SeqCst)),
            fault: Arc::new(move |op| {
                let mut armed = lock(&trigger);
                match armed.filter(|(name, _)| *name == op) {
                    Some((_, Fail::Panic)) => {
                        *armed = None;
                        drop(armed);
                        panic!("injected panic in {op}");
                    }
                    Some((_, Fail::Err)) => {
                        *armed = None;
                        Err(format!("injected error in {op}"))
                    }
                    None => Ok(()),
                }
            }),
        };
        let rail = FakeRail::new(nodes);
        let messages = Messages::open_with(dir, bus.clone(), rail.clone(), env).unwrap();
        messages.listen();
        let inbox = attach_inbox(&messages, true);
        let completed = tokio::sync::Mutex::new(messages.inner.completed.subscribe());
        Self {
            messages,
            bus,
            touches,
            inbox,
            armed,
            completed,
        }
    }

    /// Waits for `count` completed passes of `op`. A test that waits on the bound clock starts with Tokio's clock
    /// paused: the clock's 500 ms ticks and `budget_ms` then count virtual time, which moves only while every task
    /// waits, so a stalled listener or clock still fails the budget and a busy runner never does.
    async fn completed(&self, op: &str, count: usize, budget_ms: u64) {
        let mut completed = self.completed.lock().await;
        tokio::time::timeout(std::time::Duration::from_millis(budget_ms), async {
            for _ in 0..count {
                while completed.recv().await.unwrap() != op {}
            }
        })
        .await
        .expect("Message operation completed");
    }

    fn arm(&self, op: &'static str, fail: Fail) {
        *self.armed.lock().unwrap() = Some((op, fail));
    }

    async fn call(&self, method: &str, p: Value) -> Result<Value, RpcError> {
        let ctx = Ctx {
            actor: Actor::user(),
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        };
        self.messages.call(&ctx, method, p).await
    }

    fn becomes_idle(&self, revision: &str) {
        let status = Status {
            kind: Kind::Idle,
            label: "x".into(),
            since: 0,
            finished: "0".into(),
        };
        self.bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(Box::new(StatusEvent {
                ended: false,
                id: "a".into(),
                attempt: "1".into(),
                status_revision: revision.into(),
                status,
            })),
        );
    }
}

fn send() -> Value {
    json!({"to": "a", "kind": "note", "body": "hi"})
}

#[tokio::test]
async fn b28_a_panic_in_a_locked_operation_leaves_the_next_calls_working() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());

    h.arm("message.send", Fail::Panic);
    let err = h.call("message.send", send()).await.unwrap_err();
    assert_eq!(err.code, code::INTERNAL);
    assert!(err.message.contains("injected panic in message.send"));
    assert!(!err.message.contains("poisoned"));

    let sent = h.call("message.send", send()).await.unwrap();
    h.call("message.get", json!({"id": sent["id"]}))
        .await
        .unwrap();
    h.call(
        "route.set",
        json!({"from": "user", "to": "a", "delivery": "auto"}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn b28_a_failed_operation_changes_nothing_listed() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());
    h.call("message.send", send()).await.unwrap();
    let mut events = h.bus.subscribe();
    let before = (
        h.call("message.list", json!({})).await.unwrap(),
        h.call("route.list", json!({})).await.unwrap(),
    );

    for (op, fail) in [("message.send", Fail::Panic), ("route.set", Fail::Err)] {
        h.arm(op, fail);
        let params = if op == "route.set" {
            json!({"from": "user", "to": "a", "delivery": "drop"})
        } else {
            send()
        };
        assert_eq!(h.call(op, params).await.unwrap_err().code, code::INTERNAL);
    }

    let after = (
        h.call("message.list", json!({})).await.unwrap(),
        h.call("route.list", json!({})).await.unwrap(),
    );
    assert_eq!(before, after);
    assert!(events.try_recv().is_err());
}

#[tokio::test]
async fn b28_a_transaction_open_at_a_panic_rolls_back() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = Store::open(&dir.path().join("messages.db")).unwrap();
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = store.atomically(|_| -> Result<(), RpcError> { panic!("mid-transaction") });
    }));
    assert!(panicked.is_err());
    store.atomically(|_| Ok(())).unwrap();
}

#[tokio::test(start_paused = true)]
async fn b28_a_failure_in_on_status_does_not_stop_delivery() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());
    h.call("message.send", send()).await.unwrap();

    h.completed("initial", 1, 100).await;
    h.arm("on_status", Fail::Panic);
    h.becomes_idle("2");
    h.completed("on_status", 1, 100).await;
    assert!(h.armed.lock().unwrap().is_none());
    assert!(h.inbox.typed().is_empty());
}

#[tokio::test(start_paused = true)]
async fn b28_status_acknowledgement_waits_for_delivery_to_finish() {
    let dir = tempfile::tempdir().unwrap();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let bus = Bus::new();
    let messages = Messages::open(
        dir.path(),
        bus.clone(),
        FakeRail::new(vec![agent_node("a", Kind::Working)]),
    )
    .unwrap();
    messages.set_inbox(Arc::new(GatedInbox {
        inbox: fake_inbox(&messages, true),
        entered: entered.clone(),
        release: release.clone(),
    }));
    let mut completed = messages.inner.completed.subscribe();
    tokio::time::timeout(std::time::Duration::from_millis(100), async {
        while completed.recv().await.unwrap() != "initial" {}
        let ctx = Ctx {
            actor: Actor::user(),
            bus: bus.clone(),
            touches: Arc::new(Touches::in_memory().unwrap()),
        };
        // The send's own inbox check passes through the gate; the `idle` delivery's check waits.
        release.notify_one();
        messages.call(&ctx, "message.send", send()).await.unwrap();
        entered.notified().await;
        bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(Box::new(StatusEvent {
                ended: false,
                id: "a".into(),
                attempt: "1".into(),
                status_revision: "2".into(),
                status: Status {
                    kind: Kind::Idle,
                    label: "x".into(),
                    since: 0,
                    finished: "0".into(),
                },
            })),
        );
        entered.notified().await;
        while let Ok(op) = completed.try_recv() {
            assert_ne!(
                op, "on_status",
                "pending delivery cannot acknowledge status completion"
            );
        }
        release.notify_one();
        while completed.recv().await.unwrap() != "on_status" {}
        assert_eq!(
            messages
                .call(&ctx, "message.get", json!({"id":1}))
                .await
                .unwrap()["status"],
            "delivered"
        );
    })
    .await
    .expect("status acknowledged after delivery completes");
}

fn resume(request: &str, actions: &[&str]) -> continuation::Continue {
    continuation::Continue {
        agent: "a".into(),
        request: request.into(),
        payload: format!("payload-{request}"),
        actions: actions.iter().map(|a| a.to_string()).collect(),
        body: format!("resume {}", actions.join(",")),
        evidence: "reconciled".into(),
    }
}

async fn listed(h: &Faulty) -> usize {
    h.call("message.list", json!({}))
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .len()
}

#[tokio::test]
async fn u3078f_decision_and_successor_are_one_commit() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());

    // Before the commit: neither a decision nor a Message; a retry accepts both once.
    h.arm("continuation", Fail::Err);
    h.messages
        .continue_work(resume("r1", &["x"]))
        .await
        .unwrap_err();
    assert!(h.messages.continuation_of("x").unwrap().is_none());
    assert_eq!(listed(&h).await, 0);

    // After the commit: the reply is lost, both exist, and a retry returns the originals.
    h.arm("continuation_reply", Fail::Err);
    h.messages
        .continue_work(resume("r1", &["x"]))
        .await
        .unwrap_err();
    let (kept, message) = h.messages.decision_of("x").unwrap().expect("committed");
    assert_eq!(kept.message, message.id);
    let (again, same) = h
        .messages
        .continue_work(resume("r1", &["x"]))
        .await
        .unwrap();
    assert_eq!((again, same.id), (kept, message.id));
    assert_eq!(listed(&h).await, 1);
}

#[tokio::test]
async fn u3078e_resume_replay_shares_one_successor() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());

    let (first, message) = h
        .messages
        .continue_work(resume("r1", &["x"]))
        .await
        .unwrap();
    assert_eq!(message.body, "resume x");
    // Same request, a fresh client request, and a concurrent observer all find the first decision.
    let (same, _) = h
        .messages
        .continue_work(resume("r1", &["x"]))
        .await
        .unwrap();
    let (fresh, fresh_message) = h
        .messages
        .continue_work(resume("r2", &["x"]))
        .await
        .unwrap();
    assert_eq!(
        (same.id.as_str(), fresh.id.as_str()),
        (first.id.as_str(), first.id.as_str())
    );
    assert_eq!(fresh_message.id, message.id);
    let (a, b) = tokio::join!(
        h.messages.continue_work(resume("r3", &["x"])),
        h.messages.continue_work(resume("r4", &["x"]))
    );
    assert_eq!(
        (a.unwrap().0.id, b.unwrap().0.id),
        (first.id.clone(), first.id.clone())
    );
    // The same request id with other bytes is refused and changes nothing.
    let mut other = resume("r1", &["x"]);
    other.payload = "other".into();
    h.messages.continue_work(other).await.unwrap_err();
    assert_eq!(listed(&h).await, 1);
    // A later genuine action keeps its own identity.
    let (later, later_message) = h
        .messages
        .continue_work(resume("r5", &["y"]))
        .await
        .unwrap();
    assert_ne!((later.id, later_message.id), (first.id.clone(), message.id));
}
