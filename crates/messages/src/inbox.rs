//! B50, B51, B3563c: every Message to an Agent uses the receiver's inbox, never Terminal input.
//! A failed check leaves them `pending`; the next eligible event retries them in id order.

use agents::claude_code::inbox::Entry;
use contracts::agent::Inbox;

use super::*;

/// What the adapter exposes for an Agent's Claude inbox; the Daemon passes `Agents`.
#[async_trait]
pub trait NoteInbox: Send + Sync {
    /// B51: check the inbox of `agent` and show the outcome on the Rail.
    async fn check(&self, agent: &str) -> Inbox;
    /// A5556: automatic entries wait for first input; authenticated user entries may start it.
    fn admits(&self, _agent: &str, _from: &Actor) -> bool {
        true
    }
    /// Account for the authenticated sender only after physical delivery.
    fn submitted(&self, _agent: &str, _from: &Actor) {}
    /// B50: write `notes` as entries; the answer names the failed state.
    fn write(&self, agent: &str, notes: &[Entry]) -> Result<(), Inbox>;
}

#[async_trait]
impl NoteInbox for agents::Agents {
    async fn check(&self, agent: &str) -> Inbox {
        self.inbox_check(agent)
    }

    fn admits(&self, agent: &str, from: &Actor) -> bool {
        from.kind == contracts::ActorKind::User || self.input_started(agent)
    }

    fn submitted(&self, agent: &str, from: &Actor) {
        if from.kind == contracts::ActorKind::User {
            self.admit_input(agent);
        }
    }

    fn write(&self, agent: &str, notes: &[Entry]) -> Result<(), Inbox> {
        self.inbox_write(agent, notes)
    }
}

/// B51(g): what the sender hears of a note Claude Code would drop for repeating the last one.
pub(crate) const REPEAT: &str = "same text as your last Message; Claude Code drops repeats";

/// B51(f), B51(g): whether this send uses the inbox and its refusal rules.
pub(crate) fn is_inbox_send(p: &SendParams) -> bool {
    p.to != Actor::user().id
}

/// B51(f): after a note is stored, the sender hears `INBOX_UNAVAILABLE` when its receiver's inbox
/// is a `mismatch`: the note stays `pending` until Claude Code or the Daemon changes. A `missing`
/// inbox is not told: the session is starting or gone, and the note goes at the Agent's next
/// passing check.
pub(crate) async fn refuse_mismatch(inner: &Arc<Inner>, note: &Message) -> Result<(), RpcError> {
    let Some(inbox) = inner.inbox.get() else {
        return Ok(());
    };
    if inbox.check(&note.to).await != Inbox::Mismatch {
        return Ok(());
    }
    Err(RpcError::new(
        code::INBOX_UNAVAILABLE,
        "Message pending: Claude Code changed its message format",
    ))
}

/// B50(a), B50(c): writes `notes` to `agent`'s inbox when `state` is `ok` and leaves them
/// `pending` otherwise. A note already written and not yet recorded is not written again. `false`
/// when the batch must not go on (a stale revision or a Message no longer `pending`).
pub(crate) async fn send(
    inner: &Arc<Inner>,
    agent: &str,
    at: store::Binding,
    pick: Pick,
    mut notes: Vec<Message>,
    state: Inbox,
) -> bool {
    {
        let store = lock(&inner.store);
        notes.retain(|m| {
            !store.in_flight(m.id).expect("message store")
                && inner
                    .inbox
                    .get()
                    .is_none_or(|inbox| inbox.admits(agent, &m.from))
        });
    }
    if notes.is_empty() {
        return true;
    }
    if state != Inbox::Ok {
        return true;
    }
    let (mut entries, mut texts) = (Vec::new(), pushes::bodies_of(&notes).into_iter());
    for note in &notes {
        let Ok(from) = sender_name(inner, &note.from).await else {
            return false;
        };
        let text = texts.next().unwrap_or_default();
        entries.push(Entry {
            id: note.id,
            kind: note.kind,
            from,
            one_line: note.kind == MessageKind::Note
                && (text.starts_with("[wake]") || text.starts_with("[digest]")),
            text,
        });
    }
    let ids: Vec<u32> = notes.iter().map(|m| m.id).collect();
    let _typing = {
        let mut store = lock(&inner.store);
        if store.require_generation(agent, at).is_err() {
            return false;
        }
        for note in &notes {
            let bound = store.bound(note.id).expect("message store");
            if bound.0 != at.0 || (pick == Pick::Next && bound.1 >= at.1) {
                return false;
            }
        }
        {
            let mut typing = lock(&inner.typing);
            if ids.iter().any(|id| typing.contains(id)) {
                return false;
            }
            typing.extend(ids.iter().copied());
        }
        let guard = Typing {
            set: &inner.typing,
            ids: ids.clone(),
        };
        if store
            .record_flight_all(&ids)
            .expect("message store")
            .is_none()
        {
            return false;
        }
        guard
    };
    // A note with nothing left to say (B34) has no entry to wait for.
    let (empty, said): (Vec<Entry>, Vec<Entry>) =
        entries.into_iter().partition(|entry| entry.text.is_empty());
    let written = match inner.inbox.get() {
        Some(inbox) if !said.is_empty() => inbox.write(agent, &said),
        _ => Ok(()),
    };
    if written.is_err() {
        for id in &ids {
            lock(&inner.store).clear_flight(*id).expect("message store");
        }
        return true;
    }
    if let Some(inbox) = inner.inbox.get() {
        for note in &notes {
            inbox.submitted(agent, &note.from);
        }
    }
    if !empty.is_empty() {
        let empty: Vec<u32> = empty.iter().map(|entry| entry.id).collect();
        confirm_ids(inner, agent, &empty);
    }
    true
}

impl Messages {
    /// B50: send every Message to an Agent through `inbox`. Set once, before any Message.
    pub fn set_inbox(&self, inbox: Arc<dyn NoteInbox>) {
        let _ = self.inner.inbox.set(inbox);
    }

    /// B50(c): the transcript of `agent` records these Messages' entries, so they are `delivered`.
    pub fn confirm_inbox(&self, agent: &str, ids: &[u32]) {
        confirm_ids(&self.inner, agent, ids);
    }
}

/// Removes its Messages from `Inner::typing` when the inbox write that carries them is done.
struct Typing<'a> {
    set: &'a Mutex<std::collections::HashSet<u32>>,
    ids: Vec<u32>,
}

impl Drop for Typing<'_> {
    fn drop(&mut self) {
        let mut set = lock(self.set);
        for id in &self.ids {
            set.remove(id);
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use contracts::agent::NodeKind;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    #[derive(Default)]
    pub(crate) struct BatchRail {
        pub nodes: Mutex<Vec<RailNode>>,
        pub reads: AtomicUsize,
        pub fail: AtomicBool,
        pub advance: Mutex<Option<std::sync::Weak<Inner>>>,
    }

    #[async_trait]
    impl Module for BatchRail {
        fn namespaces(&self) -> &'static [&'static str] {
            &["rail"]
        }
        async fn call(&self, _: &Ctx, method: &str, _: Value) -> Result<Value, RpcError> {
            assert_eq!(method, "rail.tree");
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.fail.load(Ordering::SeqCst) {
                return Err(RpcError::internal("read failed"));
            }
            if let Some(inner) = lock(&self.advance).take().and_then(|i| i.upgrade()) {
                lock(&inner.store)
                    .set_generation(
                        "m",
                        store::ReceiverState {
                            attempt: 2,
                            revision: 1,
                            closed_revision: -1,
                            closed: false,
                        },
                    )
                    .unwrap();
            }
            Ok(serde_json::to_value(&*lock(&self.nodes)).unwrap())
        }
    }

    #[derive(Default)]
    pub(crate) struct BatchInbox {
        pub batches: Mutex<Vec<Vec<(u32, MessageKind, String, String)>>>,
        pub fail: AtomicBool,
    }

    #[async_trait]
    impl NoteInbox for BatchInbox {
        async fn check(&self, _: &str) -> Inbox {
            Inbox::Ok
        }
        fn write(&self, _: &str, notes: &[Entry]) -> Result<(), Inbox> {
            if self.fail.load(Ordering::SeqCst) {
                return Err(Inbox::Missing);
            }
            lock(&self.batches).push(
                notes
                    .iter()
                    .map(|n| (n.id, n.kind, n.from.clone(), n.text.clone()))
                    .collect(),
            );
            Ok(())
        }
    }

    pub(crate) fn live(id: &str) -> RailNode {
        let mut node = crate::tests::node(
            id,
            NodeKind::Agent,
            false,
            Some(contracts::Status {
                kind: Kind::Working,
                label: String::new(),
                since: 0,
                finished: "0".into(),
            }),
        );
        node.terminal_id = Some(format!("terminal-{id}"));
        node
    }

    pub(crate) fn setup(path: &Path) -> (Messages, Arc<BatchRail>, Arc<BatchInbox>) {
        let rail = Arc::new(BatchRail::default());
        lock(&rail.nodes).push(live("m"));
        let messages = Messages::open(path, Bus::new(), rail.clone()).unwrap();
        let inbox = Arc::new(BatchInbox::default());
        messages.set_inbox(inbox.clone());
        lock(&messages.inner.store)
            .set_generation(
                "m",
                store::ReceiverState {
                    attempt: 1,
                    revision: 2,
                    closed_revision: -1,
                    closed: false,
                },
            )
            .unwrap();
        (messages, rail, inbox)
    }

    fn agent(id: &str) -> Actor {
        Actor {
            kind: ActorKind::Agent,
            id: id.into(),
            parent: None,
        }
    }

    pub(crate) fn pending(messages: &Messages, from: &Actor, body: &str) -> Message {
        lock(&messages.inner.store)
            .insert(
                from,
                "m",
                MessageKind::Note,
                body,
                None,
                MessageStatus::Pending,
                None,
                0,
                (1, 1),
            )
            .unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn b5640c_one_sender_refresh_labels_the_whole_batch() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, rail, inbox) = setup(dir.path());
        let mut sender = live("a");
        sender.name = "renamed".into();
        lock(&rail.nodes).push(sender);
        let actors = [
            agent("a"),
            Actor::user(),
            Actor::daemon(),
            Actor {
                kind: ActorKind::Ext,
                id: "extension".into(),
                parent: None,
            },
        ];
        let notes: Vec<_> = (0..32)
            .map(|i| pending(&messages, &actors[i % 4], &format!("text-{i}")))
            .collect();
        rail.reads.store(0, Ordering::SeqCst);
        assert!(
            send(
                &messages.inner,
                "m",
                (1, 2),
                Pick::Next,
                notes.clone(),
                Inbox::Ok
            )
            .await
        );
        assert_eq!(rail.reads.load(Ordering::SeqCst), 1);
        let expected: Vec<_> = notes
            .iter()
            .enumerate()
            .map(|(i, m)| {
                (
                    m.id,
                    m.kind,
                    if i % 4 == 0 {
                        "renamed".into()
                    } else {
                        actors[i % 4].id.clone()
                    },
                    m.body.clone(),
                )
            })
            .collect();
        assert_eq!(*lock(&inbox.batches), vec![expected]);
        let note = pending(&messages, &Actor::user(), "no Agent");
        rail.reads.store(0, Ordering::SeqCst);
        assert!(
            send(
                &messages.inner,
                "m",
                (1, 2),
                Pick::Next,
                vec![note],
                Inbox::Ok
            )
            .await
        );
        assert_eq!(rail.reads.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn b5640c_sender_names_survive_removal_and_reopen() {
        let dir = tempfile::tempdir().unwrap();
        {
            let (messages, rail, _) = setup(dir.path());
            let mut sender = live("a");
            sender.name = "first".into();
            lock(&rail.nodes).push(sender);
            load_rail_nodes(&messages.inner).await.unwrap();
            lock(&rail.nodes)[1].name = "last observed".into();
            load_rail_nodes(&messages.inner).await.unwrap();
        }
        let (messages, _, inbox) = setup(dir.path());
        let notes = vec![
            pending(&messages, &agent("a"), "known"),
            pending(&messages, &agent("missing-id"), "unknown"),
        ];
        assert!(send(&messages.inner, "m", (1, 2), Pick::Next, notes, Inbox::Ok).await);
        let batches = lock(&inbox.batches);
        assert_eq!(batches[0][0].2, "last observed");
        assert_eq!(batches[0][1].2, "an Agent that is gone");
        assert_eq!(
            lock(&messages.inner.store).sender_name("a").unwrap(),
            "last observed"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn b5640e_failed_or_stale_preparation_keeps_pending_identity() {
        for failure in ["read", "write", "generation"] {
            let dir = tempfile::tempdir().unwrap();
            let (messages, rail, inbox) = setup(dir.path());
            let note = pending(&messages, &agent("a"), failure);
            rail.fail.store(failure == "read", Ordering::SeqCst);
            inbox.fail.store(failure == "write", Ordering::SeqCst);
            if failure == "generation" {
                *lock(&rail.advance) = Some(Arc::downgrade(&messages.inner));
            }
            send(
                &messages.inner,
                "m",
                (1, 2),
                Pick::Next,
                vec![note.clone()],
                Inbox::Ok,
            )
            .await;
            assert!(lock(&inbox.batches).is_empty());
            assert!(!lock(&messages.inner.store).in_flight(note.id).unwrap());
            assert_eq!(
                lock(&messages.inner.store)
                    .get(note.id)
                    .unwrap()
                    .unwrap()
                    .status,
                MessageStatus::Pending
            );
            rail.fail.store(false, Ordering::SeqCst);
            inbox.fail.store(false, Ordering::SeqCst);
            if failure == "generation" {
                assert!(
                    !send(
                        &messages.inner,
                        "m",
                        (1, 2),
                        Pick::Next,
                        vec![note],
                        Inbox::Ok
                    )
                    .await
                );
            } else {
                assert!(
                    send(
                        &messages.inner,
                        "m",
                        (1, 2),
                        Pick::Next,
                        vec![note.clone()],
                        Inbox::Ok
                    )
                    .await
                );
                assert_eq!(lock(&inbox.batches)[0][0].0, note.id);
                assert!(lock(&messages.inner.store).in_flight(note.id).unwrap());
            }
        }
    }
}
