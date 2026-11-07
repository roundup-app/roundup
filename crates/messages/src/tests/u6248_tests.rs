//! U6248a: only a written Message can miss its receipt.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

use agents::claude_code::inbox::Entry;
use contracts::agent::Inbox;

use super::*;
use crate::failure;
use crate::inbox::tests::{BatchInbox, BatchRail, live, pending};

/// An inbox that holds Agent notes until first input, as A5556a does.
#[derive(Default)]
struct Gated {
    inner: BatchInbox,
    input_started: AtomicBool,
}

#[async_trait::async_trait]
impl crate::NoteInbox for Gated {
    async fn check(&self, _: &str) -> Inbox {
        Inbox::Ok
    }
    fn admits(&self, _: &str, from: &Actor) -> bool {
        from.kind == ActorKind::User || self.input_started.load(Ordering::SeqCst)
    }
    fn write(&self, agent: &str, notes: &[Entry]) -> Result<(), Inbox> {
        self.inner.write(agent, notes)
    }
}

fn open(dir: &std::path::Path) -> (Messages, Arc<Gated>, Arc<AtomicI64>) {
    open_on(dir, Bus::new())
}

fn open_on(dir: &std::path::Path, bus: Bus) -> (Messages, Arc<Gated>, Arc<AtomicI64>) {
    let rail = Arc::new(BatchRail::default());
    let mut node = live("m");
    node.status = Some(Status {
        kind: Kind::Idle,
        ..node.status.clone().expect("live node has a Status")
    });
    lock(&rail.nodes).push(node);
    let now = Arc::new(AtomicI64::new(100_000));
    let clock = now.clone();
    let env = Env {
        touches: Arc::new(Touches::in_memory().unwrap()),
        clock: Arc::new(move || clock.load(Ordering::SeqCst)),
        fault: Arc::new(|_| Ok(())),
    };
    let messages = Messages::open_with(dir, bus, rail, env).unwrap();
    let inbox = Arc::new(Gated::default());
    messages.set_inbox(inbox.clone());
    lock(&messages.inner.store)
        .set_generation(
            "m",
            crate::store::ReceiverState {
                attempt: 1,
                revision: 2,
                closed_revision: -1,
                closed: false,
            },
        )
        .unwrap();
    (messages, inbox, now)
}

fn writes(inbox: &Gated) -> Vec<Vec<u32>> {
    lock(&inbox.inner.batches)
        .iter()
        .map(|batch| batch.iter().map(|w| w.0).collect())
        .collect()
}

#[tokio::test]
async fn u6248a_waiting_messages_are_not_delivery_failures() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, inbox, now) = open(dir.path());
    let note = pending(&messages, &Actor::daemon(), "from daemon");
    let inner = &messages.inner;
    for _ in 0..20 {
        failure::sweep(inner).await;
        crate::delivery::deliver_pending(inner, "m").await;
        now.fetch_add(30_000, Ordering::SeqCst);
        assert_eq!(messages.delivery_failure("m"), None);
    }
    assert!(writes(&inbox).is_empty());
    inbox.input_started.store(true, Ordering::SeqCst);
    crate::delivery::deliver_pending(inner, "m").await;
    assert_eq!(writes(&inbox), vec![vec![note.id]]);
}

#[tokio::test]
async fn u6248a_redelivery_backs_off_and_shows_after_four_misses() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, inbox, now) = open(dir.path());
    inbox.input_started.store(true, Ordering::SeqCst);
    lock(&messages.inner.failures).jitter = Some(7);
    let note = pending(&messages, &Actor::daemon(), "from daemon");
    let inner = &messages.inner;
    crate::delivery::deliver_pending(inner, "m").await;
    assert_eq!(writes(&inbox).len(), 1);
    let mut at = Vec::new();
    let mut shown_after = None;
    let start = now.load(Ordering::SeqCst);
    while now.load(Ordering::SeqCst) - start < 40 * 60_000 && at.len() < 6 {
        now.fetch_add(1_000, Ordering::SeqCst);
        failure::sweep(inner).await;
        if writes(&inbox).len() > at.len() + 1 {
            at.push(now.load(Ordering::SeqCst) - start);
            if shown_after.is_none() && messages.delivery_failure("m").is_some() {
                shown_after = Some(at.len());
            }
        }
        if at.len() < 4 {
            assert_eq!(messages.delivery_failure("m"), None);
        }
    }
    assert_eq!(shown_after, Some(4));
    assert!(writes(&inbox).iter().all(|batch| batch == &vec![note.id]));
    // Each wait is its step plus jitter of at most the step, so never early and never double.
    let steps = [30_000, 60_000, 120_000, 240_000];
    let mut last = 0;
    for (wait, step) in at.iter().zip(steps) {
        let gap = wait - last;
        assert!((step..=2 * step + 1_000).contains(&gap), "{gap} for {step}");
        last = *wait;
    }
    messages.confirm_inbox("m", &[note.id]);
    assert_eq!(messages.delivery_failure("m"), None);
}

#[tokio::test]
async fn u6248a_a_receipt_after_the_second_miss_keeps_the_line_empty() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, inbox, now) = open(dir.path());
    inbox.input_started.store(true, Ordering::SeqCst);
    let note = pending(&messages, &Actor::daemon(), "from daemon");
    let inner = &messages.inner;
    crate::delivery::deliver_pending(inner, "m").await;
    for _ in 0..2 {
        now.fetch_add(480_000, Ordering::SeqCst);
        failure::sweep(inner).await;
        assert_eq!(messages.delivery_failure("m"), None);
    }
    assert_eq!(writes(&inbox).len(), 3);
    messages.confirm_inbox("m", &[note.id]);
    assert_eq!(messages.delivery_failure("m"), None);
}

#[tokio::test]
async fn u177_a_message_waits_for_the_channel_event_then_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let (messages, inbox, _) = open_on(dir.path(), bus.clone());
    let mut completed = messages.inner.completed.subscribe();
    while completed.recv().await.unwrap() != "initial" {}
    let note = pending(&messages, &Actor::daemon(), "from daemon");
    for channel in [
        contracts::agent::Channel::Pending,
        contracts::agent::Channel::Up,
    ] {
        if channel == contracts::agent::Channel::Up {
            inbox.input_started.store(true, Ordering::SeqCst);
        }
        bus.emit(
            Actor::daemon(),
            EventData::AgentChannel(contracts::agent::ChannelEvent {
                id: "m".into(),
                channel,
            }),
        );
        if channel == contracts::agent::Channel::Pending {
            tokio::task::yield_now().await;
            assert!(writes(&inbox).is_empty());
        } else {
            for _ in 0..100 {
                if !writes(&inbox).is_empty() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }
    }
    assert_eq!(writes(&inbox), vec![vec![note.id]]);
}
