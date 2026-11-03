//! DCL1: delivery failures are exposed, keep the original pending batch and recover unprompted.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

use agents::claude_code::inbox::Entry;
use contracts::agent::Inbox;

use super::*;
use crate::failure;
use crate::inbox::tests::{BatchInbox, BatchRail, live, pending};

/// An inbox whose previous-entry read and write fail on demand.
#[derive(Default)]
struct Flaky {
    inner: BatchInbox,
    unreadable: AtomicBool,
}

#[async_trait::async_trait]
impl crate::NoteInbox for Flaky {
    async fn check(&self, _: &str) -> Inbox {
        Inbox::Ok
    }
    fn previous(&self, _: &str) -> Result<Option<String>, Inbox> {
        if self.unreadable.load(Ordering::SeqCst) {
            Err(Inbox::Missing)
        } else {
            Ok(None)
        }
    }
    fn write(&self, agent: &str, notes: &[Entry]) -> Result<(), Inbox> {
        self.inner.write(agent, notes)
    }
}

fn open(dir: &std::path::Path) -> (Messages, Arc<BatchRail>, Arc<Flaky>, Arc<AtomicI64>) {
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
    let messages = Messages::open_with(dir, Bus::new(), rail.clone(), env).unwrap();
    let inbox = Arc::new(Flaky::default());
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
    (messages, rail, inbox, now)
}

fn written(inbox: &Flaky) -> Vec<Vec<u32>> {
    lock(&inbox.inner.batches)
        .iter()
        .map(|batch| batch.iter().map(|w| w.0).collect())
        .collect()
}

#[tokio::test]
async fn dcl1_unreadable_transcript_exposes_delivery_failure() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, _, inbox, _) = open(dir.path());
    let note = pending(&messages, &Actor::daemon(), "first");
    inbox.unreadable.store(true, Ordering::SeqCst);
    crate::delivery::deliver_pending(&messages.inner, "m").await;
    assert_eq!(messages.delivery_failure("m"), Some(failure::UNREADABLE));
    assert!(written(&inbox).is_empty());
    assert_eq!(
        lock(&messages.inner.store)
            .get(note.id)
            .unwrap()
            .unwrap()
            .status,
        MessageStatus::Pending
    );
}

#[tokio::test]
async fn dcl1_previous_read_and_write_errors_keep_original_pending_batch() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, _, inbox, _) = open(dir.path());
    let a = pending(&messages, &Actor::daemon(), "first");
    let b = pending(&messages, &Actor::daemon(), "second");
    inbox.inner.fail.store(true, Ordering::SeqCst);
    crate::delivery::deliver_pending(&messages.inner, "m").await;
    assert_eq!(messages.delivery_failure("m"), Some(failure::WRITE_FAILED));
    inbox.inner.fail.store(false, Ordering::SeqCst);
    crate::delivery::deliver_pending(&messages.inner, "m").await;
    // The same ids, in order, in one batch; the failure stays until their receipts.
    assert_eq!(written(&inbox), vec![vec![a.id, b.id]]);
    assert_eq!(messages.delivery_failure("m"), Some(failure::WRITE_FAILED));
    messages.confirm_inbox("m", &[a.id, b.id]);
    assert_eq!(messages.delivery_failure("m"), None);
}

#[tokio::test]
async fn dcl1_eligible_pending_deadline_recovers_without_a_new_event() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, rail, inbox, now) = open(dir.path());
    let note = pending(&messages, &Actor::daemon(), "first");
    inbox.unreadable.store(true, Ordering::SeqCst);
    let inner = &messages.inner;
    failure::sweep(inner).await;
    now.fetch_add(29_000, Ordering::SeqCst);
    failure::sweep(inner).await;
    assert_eq!(messages.delivery_failure("m"), None);
    // Time spent busy does not count toward the bound.
    let idle = lock(&rail.nodes)[0].clone();
    let mut busy = idle.clone();
    busy.status.as_mut().unwrap().kind = Kind::Working;
    lock(&rail.nodes)[0] = busy;
    now.fetch_add(60_000, Ordering::SeqCst);
    failure::sweep(inner).await;
    lock(&rail.nodes)[0] = idle;
    failure::sweep(inner).await;
    now.fetch_add(29_000, Ordering::SeqCst);
    failure::sweep(inner).await;
    assert_eq!(messages.delivery_failure("m"), None);
    now.fetch_add(1_000, Ordering::SeqCst);
    failure::sweep(inner).await;
    assert_eq!(messages.delivery_failure("m"), Some(failure::UNREADABLE));
    // Repair the fault: the next pass writes the original batch, receipt clears the failure.
    inbox.unreadable.store(false, Ordering::SeqCst);
    now.fetch_add(30_000, Ordering::SeqCst);
    failure::sweep(inner).await;
    assert_eq!(written(&inbox), vec![vec![note.id]]);
    messages.confirm_inbox("m", &[note.id]);
    assert_eq!(messages.delivery_failure("m"), None);
}
