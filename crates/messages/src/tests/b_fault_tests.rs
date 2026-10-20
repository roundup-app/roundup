//! B28: one failure fails one operation. `Env::fault` stands in for a Store that panics or errs
//! while an operation holds the lock.

use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};

use contracts::agent::StatusEvent;
use contracts::{Actor, EventData, Kind, Status};
use serde_json::{Value, json};

use super::*;
use super::{FakeRail, agent_node};

/// What the next call of one operation does when it reaches the lock.
#[derive(Clone, Copy)]
enum Fail {
    Panic,
    Err,
}

struct Faulty {
    messages: Messages,
    rail: Arc<FakeRail>,
    bus: Bus,
    touches: Arc<provenance::Touches>,
    typed: Arc<StdMutex<Vec<(String, String)>>>,
    armed: Arc<StdMutex<Option<(&'static str, Fail)>>>,
    calls: Arc<AtomicUsize>,
    clock: Arc<AtomicI64>,
    completed: tokio::sync::Mutex<tokio::sync::broadcast::Receiver<&'static str>>,
}

impl Faulty {
    fn new(dir: &Path) -> Self {
        Self::over(dir, vec![agent_node("a", Kind::Working)])
    }

    fn over(dir: &Path, nodes: Vec<RailNode>) -> Self {
        let bus = Bus::new();
        let touches = Arc::new(provenance::Touches::in_memory().unwrap());
        let typed: Arc<StdMutex<Vec<(String, String)>>> = Arc::default();
        let seen = Arc::clone(&typed);
        let deliver: Deliver = Arc::new(move |id, text| {
            seen.lock().unwrap().push((id, shown(text)));
            Box::pin(async { Ok(()) })
        });
        let armed: Arc<StdMutex<Option<(&'static str, Fail)>>> = Arc::default();
        let calls = Arc::new(AtomicUsize::new(0));
        let (trigger, counted) = (Arc::clone(&armed), Arc::clone(&calls));
        let clock: Arc<AtomicI64> = Arc::default();
        let reads = Arc::clone(&clock);
        let env = Env {
            touches: Arc::clone(&touches),
            clock: Arc::new(move || reads.load(Ordering::SeqCst)),
            fault: Arc::new(move |op| {
                if op == "clock" {
                    counted.fetch_add(1, Ordering::SeqCst);
                }
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
        let messages = Messages::open_with(dir, bus.clone(), rail.clone(), deliver, env).unwrap();
        let completed = tokio::sync::Mutex::new(messages.inner.completed.subscribe());
        Self {
            messages,
            rail,
            bus,
            touches,
            typed,
            armed,
            calls,
            clock,
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

    async fn clock_at(&self, at: i64) {
        let mut completed = self.completed.lock().await;
        // These tests use Tokio's current-thread runtime: no pass can run between draining
        // old acknowledgements and supplying the next clock input, without an await.
        while completed.try_recv().is_ok() {}
        self.clock.store(at, Ordering::SeqCst);
        drop(completed);
        // Two completed passes include a successful pass after the armed clock panic.
        self.completed("clock", 2, 1_100).await;
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
        };
        self.bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(Box::new(StatusEvent {
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
    h.call("takeover.begin", json!({"agent": "a"}))
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
async fn b28_a_failure_in_on_status_or_settle_does_not_stop_delivery_or_the_clock() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());
    h.call("message.send", send()).await.unwrap();

    h.completed("initial", 1, 100).await;
    h.arm("on_status", Fail::Panic);
    h.becomes_idle("2");
    h.completed("on_status", 1, 100).await;
    assert!(h.armed.lock().unwrap().is_none());
    assert!(h.typed.lock().unwrap().is_empty());

    h.arm("settle", Fail::Panic);
    h.becomes_idle("3");
    h.completed("on_status", 1, 100).await;
    assert!(h.armed.lock().unwrap().is_none());
    assert_eq!(h.typed.lock().unwrap().len(), 1);

    a_hop_passes_at_the_bound(None).await;
}

#[tokio::test(start_paused = true)]
async fn b28_a_failure_in_the_clock_does_not_stop_it() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());
    h.call("route.list", json!({})).await.unwrap();

    h.completed("initial", 1, 100).await;
    {
        let mut completed = h.completed.lock().await;
        while completed.try_recv().is_ok() {}
    }
    h.arm("clock", Fail::Panic);
    let before = h.calls.load(Ordering::SeqCst);
    h.completed("clock", 3, 1_600).await;
    assert!(h.armed.lock().unwrap().is_none());
    assert!(h.calls.load(Ordering::SeqCst) >= before + 3);

    a_hop_passes_at_the_bound(Some("clock")).await;
}

/// A pending hop has not passed at 59 999 ms of the fake clock and has at 60 000 ms.
async fn a_hop_passes_at_the_bound(arm: Option<&'static str>) {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::over(dir.path(), super::b_hop_tests::tree());
    let ask = json!({"to": "sub", "kind": "question", "body": "which?"});
    let ctx = Ctx {
        actor: super::agent("c"),
        bus: h.bus.clone(),
        touches: Arc::clone(&h.touches),
    };
    h.messages.call(&ctx, "message.send", ask).await.unwrap();
    h.completed("initial", 1, 100).await;
    if let Some(op) = arm {
        h.arm(op, Fail::Panic);
    }
    h.clock_at(59_999).await;
    assert_eq!(
        h.call("message.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    h.clock_at(60_000).await;
    assert_eq!(
        h.call("message.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn b32_r16_partial_input_failure_rolls_back_store_memory_and_events() {
    let dir = tempfile::tempdir().unwrap();
    let mut node = agent_node("a", Kind::Working);
    node.terminal_id = Some("terminal".into());
    let h = Faulty::over(dir.path(), vec![node]);
    h.call(
        "message.send",
        json!({"to":"a","kind":"note","body":"wait"}),
    )
    .await
    .unwrap();
    let mut events = h.bus.subscribe();
    h.arm("user_wrote", Fail::Err);
    h.messages.user_wrote("terminal", b"text").await;
    assert_eq!(
        h.call("message.get", json!({"id":1})).await.unwrap()["status"],
        "pending"
    );
    assert!(
        !std::iter::from_fn(|| events.try_recv().ok())
            .any(|e| matches!(e.data, EventData::MessageHeld(_)))
    );
    h.messages.user_wrote("terminal", b"text").await;
    assert_eq!(
        h.call("message.get", json!({"id":1})).await.unwrap()["status"],
        "held",
        "failed insert did not leave an in-memory positive"
    );
    h.call("takeover.begin", json!({"agent":"a"}))
        .await
        .unwrap();
    h.rail.0.lock().unwrap()[0].attempt = Some("2".into());
    let mut events = h.bus.subscribe();
    h.arm("user_wrote", Fail::Err);
    h.messages.user_wrote("terminal", b"next").await;
    assert!(
        h.messages.takeover_active("a"),
        "failed reconciliation restores Takeover"
    );
    assert_eq!(
        h.call("message.get", json!({"id":1})).await.unwrap()["status"],
        "held"
    );
    assert!(
        !std::iter::from_fn(|| events.try_recv().ok()).any(|e| matches!(
            e.data,
            EventData::MessageDropped(_) | EventData::TakeoverChanged(_)
        ))
    );
    h.messages.user_wrote("terminal", b"next").await;
    assert!(!h.messages.takeover_active("a"));
    assert_eq!(
        h.call("message.get", json!({"id":1})).await.unwrap()["status"],
        "dropped"
    );
    h.arm("user_wrote", Fail::Err);
    h.messages.user_wrote("terminal", b"\r").await;
    let sent = h
        .call(
            "message.send",
            json!({"to":"a","kind":"note","body":"still wait"}),
        )
        .await
        .unwrap();
    assert_eq!(
        sent["status"], "held",
        "failed clear did not leave an in-memory negative"
    );
    h.messages.user_wrote("terminal", b"\r").await;
    assert_eq!(
        h.call("message.get", json!({"id":2})).await.unwrap()["status"],
        "pending"
    );
}

#[tokio::test(start_paused = true)]
async fn b28_status_acknowledgement_waits_for_delivery_to_finish() {
    let dir = tempfile::tempdir().unwrap();
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (seen, proceed) = (entered.clone(), release.clone());
    let deliver: Deliver = Arc::new(move |_, _| {
        let (seen, proceed) = (seen.clone(), proceed.clone());
        Box::pin(async move {
            seen.notify_one();
            proceed.notified().await;
            Ok(())
        })
    });
    let bus = Bus::new();
    let messages = Messages::open(
        dir.path(),
        bus.clone(),
        FakeRail::new(vec![agent_node("a", Kind::Working)]),
        deliver,
    )
    .unwrap();
    let mut completed = messages.inner.completed.subscribe();
    tokio::time::timeout(std::time::Duration::from_millis(100), async {
        while completed.recv().await.unwrap() != "initial" {}
        let ctx = Ctx {
            actor: Actor::user(),
            bus: bus.clone(),
            touches: Arc::new(Touches::in_memory().unwrap()),
        };
        messages.call(&ctx, "message.send", send()).await.unwrap();
        bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(Box::new(StatusEvent {
                id: "a".into(),
                attempt: "1".into(),
                status_revision: "2".into(),
                status: Status {
                    kind: Kind::Idle,
                    label: "x".into(),
                    since: 0,
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

fn fire(operation: &str) -> reaction::Fire {
    reaction::Fire {
        reaction: "r1".into(),
        operation: operation.into(),
        to: "a".into(),
        body: "ship it".into(),
        evidence: "run".into(),
        matched: false,
    }
}

fn save_reaction(h: &Faulty, state: &str, max: u32) {
    let record = json!({"state": state, "max_firings": max}).to_string();
    h.messages
        .store()
        .unwrap()
        .db
        .execute(
            "INSERT INTO reactions (id, actor_key, operation, request, record) VALUES ('r1','u','o','q',?1)",
            [record],
        )
        .unwrap();
}

#[tokio::test]
async fn nr3_firing_and_message_commit_together() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());
    save_reaction(&h, "active", 2);

    h.arm("reaction", Fail::Err);
    h.messages.fire_reaction(fire("one")).await.unwrap_err();
    assert!(h.messages.firings_of("r1").unwrap().is_empty());
    let listed = h.call("message.list", json!({})).await.unwrap();
    assert!(listed.as_array().unwrap().is_empty(), "{listed}");

    let (first, message) = h.messages.fire_reaction(fire("one")).await.unwrap();
    assert_eq!((first.ordinal, first.message), (1, message.id));
    assert_eq!(message.body, "ship it");
    assert_eq!(first.definition, r#"{"state":"active","max_firings":2}"#);
    // A retry is the same firing and the same Message; nothing new is sent.
    let (again, same) = h.messages.fire_reaction(fire("one")).await.unwrap();
    assert_eq!((again.id, same.id), (first.id, message.id));
    // The bound counts accepted firings only.
    h.messages.fire_reaction(fire("two")).await.unwrap();
    h.messages.fire_reaction(fire("three")).await.unwrap_err();
    assert_eq!(h.messages.firings_of("r1").unwrap().len(), 2);
}

#[tokio::test]
async fn nr3_a_stopped_reaction_accepts_no_firing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Faulty::new(dir.path());
    save_reaction(&h, "stopped", 1);
    h.messages.fire_reaction(fire("one")).await.unwrap_err();
    assert!(h.messages.firings_of("r1").unwrap().is_empty());
}
