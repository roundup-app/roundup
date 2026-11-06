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
    let flaky = Arc::new(Flaky::default());
    let (messages, rail, now) = open_with(dir, flaky.clone());
    (messages, rail, flaky, now)
}

fn open_with<I: crate::NoteInbox + 'static>(
    dir: &std::path::Path,
    inbox: Arc<I>,
) -> (Messages, Arc<BatchRail>, Arc<AtomicI64>) {
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
    messages.set_inbox(inbox);
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
    (messages, rail, now)
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

/// An inbox that admits automatic notes only once its gate is opened (A5556a).
#[derive(Default)]
struct Gated {
    inner: BatchInbox,
    open: AtomicBool,
}

#[async_trait::async_trait]
impl crate::NoteInbox for Gated {
    async fn check(&self, _: &str) -> Inbox {
        Inbox::Ok
    }
    fn admits(&self, _: &str, _: &Actor) -> bool {
        self.open.load(Ordering::SeqCst)
    }
    fn write(&self, agent: &str, notes: &[Entry]) -> Result<(), Inbox> {
        self.inner.write(agent, notes)
    }
}

#[tokio::test]
async fn u6260a_held_prompt_is_reported_to_its_sender() {
    let dir = tempfile::tempdir().unwrap();
    let gated = Arc::new(Gated::default());
    let (messages2, _, _) = open_with(dir.path(), gated.clone());
    let note = pending(&messages2, &Actor::daemon(), "please continue");
    let inner = &messages2.inner;
    crate::inbox::send(
        inner,
        "m",
        (1, 2),
        Pick::Next,
        vec![note.clone()],
        Inbox::Ok,
    )
    .await;
    let seen = failure::with_waiting(inner, lock(&inner.store).get(note.id).unwrap().unwrap());
    assert_eq!(seen.status, MessageStatus::Pending);
    assert_eq!(seen.waiting.as_deref(), Some(failure::AWAITING_INPUT));
    assert_eq!(messages2.delivery_failure("m"), None);
    assert!(lock(&gated.inner.batches).is_empty());

    gated.open.store(true, Ordering::SeqCst);
    crate::inbox::send(
        inner,
        "m",
        (1, 2),
        Pick::Next,
        vec![note.clone()],
        Inbox::Ok,
    )
    .await;
    assert_eq!(written_by(&gated), vec![vec![note.id]]);
    let seen = failure::with_waiting(inner, lock(&inner.store).get(note.id).unwrap().unwrap());
    assert_eq!(seen.waiting, None);
}

#[tokio::test]
async fn u6260a_a_reserved_restart_is_reported_and_a_settled_message_forgets_its_reason() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, _, _) = open_with(dir.path(), Arc::new(Gated::default()));
    let inner = &messages.inner;
    let note = pending(&messages, &Actor::daemon(), "after the restart");
    lock(&inner.store)
        .reserve_restart("m", "restart", 1, None)
        .unwrap();
    crate::nudge(inner, "m").await;
    let seen = failure::with_waiting(inner, lock(&inner.store).get(note.id).unwrap().unwrap());
    assert_eq!(seen.waiting.as_deref(), Some(failure::RESTART_RESERVED));

    assert!(lock(&inner.store).drop_merged(note.id).unwrap());
    failure::forget_settled(inner);
    assert!(lock(&inner.waiting).is_empty());
}

#[tokio::test]
async fn u6296a_a_message_to_a_busy_receiver_shows_its_reason() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, rail, inbox, _) = open(dir.path());
    let inner = &messages.inner;
    let idle = lock(&rail.nodes)[0].clone();
    let mut busy = idle.clone();
    busy.status.as_mut().unwrap().kind = Kind::Working;
    lock(&rail.nodes)[0] = busy;
    let note = pending(&messages, &Actor::daemon(), "when you can");
    crate::nudge(inner, "m").await;
    let seen = failure::with_waiting(inner, lock(&inner.store).get(note.id).unwrap().unwrap());
    assert_eq!(seen.waiting.as_deref(), Some(failure::RECEIVER_BUSY));
    assert_eq!(messages.delivery_failure("m"), None);
    assert!(written(&inbox).is_empty());

    lock(&rail.nodes)[0] = idle;
    crate::nudge(inner, "m").await;
    assert_eq!(written(&inbox), vec![vec![note.id]]);
    let seen = failure::with_waiting(inner, lock(&inner.store).get(note.id).unwrap().unwrap());
    assert_eq!(seen.waiting, None);
    assert_eq!(messages.delivery_failure("m"), None);
}

#[tokio::test]
async fn u6307a_a_busy_receiver_keeps_the_messages_own_held_reason() {
    let dir = tempfile::tempdir().unwrap();
    let (messages, rail, inbox, _) = open(dir.path());
    let inner = &messages.inner;
    let idle = lock(&rail.nodes)[0].clone();
    let mut busy = idle.clone();
    busy.status.as_mut().unwrap().kind = Kind::Working;
    lock(&rail.nodes)[0] = busy;
    let first = pending(&messages, &Actor::daemon(), "first input");
    let unread = pending(&messages, &Actor::daemon(), "unreadable");
    let plain = pending(&messages, &Actor::daemon(), "no reason");
    failure::hold(inner, &[first.id], Some(failure::AWAITING_INPUT));
    failure::hold(inner, &[unread.id], Some(failure::UNREADABLE));
    crate::nudge(inner, "m").await;
    let reason = |id: u32| {
        failure::with_waiting(inner, lock(&inner.store).get(id).unwrap().unwrap()).waiting
    };
    assert_eq!(reason(first.id).as_deref(), Some(failure::AWAITING_INPUT));
    assert_eq!(reason(unread.id).as_deref(), Some(failure::UNREADABLE));
    assert_eq!(reason(plain.id).as_deref(), Some(failure::RECEIVER_BUSY));
    assert!(written(&inbox).is_empty());
}

fn written_by(inbox: &Gated) -> Vec<Vec<u32>> {
    lock(&inbox.inner.batches)
        .iter()
        .map(|batch| batch.iter().map(|w| w.0).collect())
        .collect()
}
