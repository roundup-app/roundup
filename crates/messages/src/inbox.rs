//! B50, B51, B3563c: every Message to an Agent uses the receiver's inbox, never Terminal input.
//! A failed check leaves them `pending`; the next eligible event retries them in id order.

use contracts::agent::Inbox;

use crate::plan::{self, Batch, Plan};

use super::*;

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
pub(crate) async fn refuse_mismatch(inner: &Arc<Inner>, note: &Message) -> Result<(), Error> {
    let Some(inbox) = inner.inbox.get() else {
        return Ok(());
    };
    if inbox.check(&note.to).await != Inbox::Mismatch {
        return Ok(());
    }
    Err(Error::inbox_unavailable(
        "Message pending: Claude Code changed its message format",
    ))
}

/// DCL8: the open-Job snapshot the first batch of a Door's Attempt carries, listing each Job
/// whose current Attempt has no report; `None` when it was given or no Job is open.
fn open_job_snapshot(inner: &Arc<Inner>, agent: &str, at: store::Binding) -> Option<String> {
    let inbox = inner.inbox.get()?;
    if lock(&inner.snapshotted).contains(&(agent.to_owned(), at.0)) {
        return None;
    }
    let attempts = |id: &str| -> Result<Vec<String>, Error> {
        let store = lock(&inner.store);
        let mut rows = store
            .db
            .prepare("SELECT record FROM message_results WHERE agent=? ORDER BY seq")
            .map_err(Error::internal)?;
        let records = rows
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(Error::internal)?;
        let mut attempts = Vec::new();
        for record in records {
            let report: contracts::message::ResultReport =
                serde_json::from_str(&record.map_err(Error::internal)?).map_err(Error::internal)?;
            attempts.push(report.attempt);
        }
        Ok(attempts)
    };
    // The seam to `agents` speaks `RpcError`.
    let reported = |id: &str| attempts(id).map_err(RpcError::from);
    let jobs: Vec<_> = inbox
        .open_jobs(agent, &reported)
        .into_iter()
        .filter(|(id, ..)| inbox.in_reach(agent, id))
        .collect();
    if jobs.is_empty() {
        return None;
    }
    let lines: Vec<String> = jobs
        .into_iter()
        .map(|(id, name, attempt)| format!("- {id} {name} (attempt {attempt})"))
        .collect();
    Some(format!("[open jobs]\n{}", lines.join("\n")))
}

/// What `commit` found when it took the batch's Messages.
enum Committed {
    /// A revision, binding or concurrent write moved on first: nothing was written.
    Stale,
    Written,
    /// A prefix may be written: the comparison value and the flights are cleared.
    WriteFailed,
}

/// B50(a), B50(c): writes `notes` to `agent`'s inbox when `state` is `ok` and leaves them
/// `pending` otherwise. A note already written and not yet recorded is not written again. The
/// answer is the plan carried out: `Stale` when the batch must not go on (a stale revision or a
/// Message no longer `pending`).
pub(crate) async fn send(
    inner: &Arc<Inner>,
    agent: &str,
    at: store::Binding,
    pick: Pick,
    notes: Vec<Message>,
    state: Inbox,
) -> Result<Plan, Error> {
    failure::forget_settled(inner)?;
    let (batch, session) = match load(inner, agent, at, pick, notes, state).await? {
        Ok(loaded) => loaded,
        Err(plan) => return Ok(plan),
    };
    let plan = plan::plan(&batch);
    match &plan {
        Plan::Stale => {}
        Plan::Hold { ids, why } => failure::hold(inner, ids, *why),
        Plan::Write { .. } => {
            if let Committed::Stale = commit(inner, &batch, &session, &plan)? {
                return Ok(Plan::Stale);
            }
        }
    }
    Ok(plan)
}

/// Reads what `plan` decides from, applying the waiting reasons of the Messages that cannot go
/// yet. `Err` is the plan when the batch ends here.
async fn load<'a>(
    inner: &'a Arc<Inner>,
    agent: &'a str,
    at: store::Binding,
    pick: Pick,
    notes: Vec<Message>,
    state: Inbox,
) -> Result<Result<(Batch<'a>, String), Plan>, Error> {
    let asked: Vec<u32> = notes.iter().map(|m| m.id).collect();
    let notes = {
        let store = lock(&inner.store);
        let mut keep = Vec::with_capacity(notes.len());
        for m in notes {
            if store.in_flight(m.id)? && lock(&inner.inbox_written).contains(&m.id) {
                continue;
            }
            let waiting = failure::waiting_reason(failure::admitted(inner, agent, &m), state);
            failure::hold(inner, &[m.id], waiting);
            if waiting.is_none() {
                keep.push(m);
            }
        }
        keep
    };
    let deferred = |why| Plan::Hold {
        ids: asked.clone(),
        why,
    };
    if notes.is_empty() {
        return Ok(Err(deferred(None)));
    }
    let senders: std::collections::HashSet<&str> = notes
        .iter()
        .filter(|m| m.from.kind == ActorKind::Agent)
        .map(|m| m.from.id.as_str())
        .collect();
    if !senders.is_empty() && load_rail_nodes(inner).await.is_err() {
        return Ok(Err(Plan::Stale));
    }
    let names = {
        let store = lock(&inner.store);
        let names: Result<std::collections::HashMap<String, String>, _> = senders
            .into_iter()
            .map(|id| store.sender_name(id).map(|name| (id.to_owned(), name)))
            .collect();
        let Ok(names) = names else {
            return Ok(Err(Plan::Stale));
        };
        names
    };
    // DCL8: the open-Job snapshot goes with the batch that leaves no Message of the receiver pending.
    let last = {
        let store = lock(&inner.store);
        let pending = store.pending_all()?;
        pending.iter().all(|m| {
            m.to != agent
                || store.payload(m.id).is_ok_and(|payload| payload.is_digest())
                || notes.iter().any(|n| n.id == m.id)
                || store.in_flight(m.id).unwrap_or(false)
        })
    };
    let snapshot = if last {
        open_job_snapshot(inner, agent, at)
    } else {
        None
    };
    let Some(inbox) = inner.inbox.get() else {
        return Ok(Err(deferred(None)));
    };
    let session = inbox
        .session(agent)
        .unwrap_or_else(|| format!("attempt:{}", at.0));
    let mut previous = lock(&inner.store).last_inbox(agent, &session)?;
    if previous.is_none() {
        previous = match inbox.previous(agent) {
            Ok(previous) => previous,
            Err(_) => {
                failure::record(inner, agent, failure::UNREADABLE);
                let ids: Vec<u32> = notes.iter().map(|m| m.id).collect();
                failure::hold(inner, &ids, Some(failure::UNREADABLE));
                return Ok(Err(deferred(Some(failure::UNREADABLE))));
            }
        };
        if let Some(content) = &previous {
            lock(&inner.store).record_inbox(agent, &session, content)?;
        }
    }
    let payloads = lock(&inner.store).payloads(&notes)?;
    let quiet = {
        let store = lock(&inner.store);
        let given = if notes.iter().any(|m| payloads.of(m).is_digest()) {
            store.delivered_to(agent)?
        } else {
            Vec::new()
        };
        let history = store.payloads(&given)?;
        receiver_view::are_quiet_digests((&given, &history), (&notes, &payloads))
    };
    let (generation_ok, bounds) = {
        let store = lock(&inner.store);
        let bounds = notes
            .iter()
            .map(|m| store.bound(m.id))
            .collect::<Result<Vec<_>, _>>()?;
        (store.require_generation(agent, at).is_ok(), bounds)
    };
    let batch = Batch {
        agent,
        at,
        pick,
        notes,
        payloads,
        bounds,
        generation_ok,
        names,
        previous,
        rewrite: lock(&inner.rewrite).clone(),
        quiet,
        snapshot,
        render: Box::new(move |entry| inbox.content(agent, entry)),
    };
    Ok(Ok((batch, session)))
}

/// Takes the planned Messages, writes `said`, then records the outcome and emits the Events.
fn commit(
    inner: &Arc<Inner>,
    batch: &Batch,
    session: &str,
    plan: &Plan,
) -> Result<Committed, Error> {
    let Plan::Write {
        said,
        repeats,
        empty,
        snapshot: attached,
    } = plan
    else {
        return Ok(Committed::Written);
    };
    let (agent, at) = (batch.agent, batch.at);
    let notes: Vec<&Message> = batch
        .notes
        .iter()
        .filter(|m| {
            repeats.contains(&m.id)
                || said.iter().any(|e| e.id == m.id)
                || empty.iter().any(|e| e.id == m.id)
        })
        .collect();
    let ids: Vec<u32> = notes.iter().map(|m| m.id).collect();
    failure::hold(inner, &ids, None);
    let _typing = {
        let mut store = lock(&inner.store);
        let bounds = ids
            .iter()
            .map(|id| store.bound(*id))
            .collect::<Result<Vec<_>, _>>()?;
        if plan::is_stale(
            at,
            batch.pick,
            store.require_generation(agent, at).is_ok(),
            &bounds,
        ) {
            return Ok(Committed::Stale);
        }
        {
            let mut typing = lock(&inner.typing);
            if ids.iter().any(|id| typing.contains(id)) {
                return Ok(Committed::Stale);
            }
            typing.extend(ids.iter().copied());
        }
        let guard = Typing {
            set: &inner.typing,
            ids: ids.clone(),
        };
        if store.record_flight_all(&ids)?.is_none() {
            return Ok(Committed::Stale);
        }
        guard
    };
    let written = match inner.inbox.get() {
        Some(inbox) if !said.is_empty() => inbox.write(agent, said),
        _ => Ok(()),
    };
    lock(&inner.rewrite).retain(|id| !ids.contains(id));
    if written.is_ok() && !said.is_empty() {
        failure::wrote(inner, agent);
    }
    if written.is_ok() && *attached && !said.is_empty() {
        lock(&inner.snapshotted).insert((agent.to_owned(), at.0));
    }
    if written.is_err() {
        failure::record(inner, agent, failure::WRITE_FAILED);
        // A failed batch may have written a prefix; its previous comparison value is uncertain.
        lock(&inner.store)
            .db
            .execute(
                "DELETE FROM message_inbox_last WHERE receiver=? AND session=?",
                rusqlite::params![agent, session],
            )
            .map_err(Error::internal)?;
        for id in &ids {
            lock(&inner.store).clear_flight(*id)?;
        }
        return Ok(Committed::WriteFailed);
    }
    {
        let mut store = lock(&inner.store);
        if !said.is_empty() {
            // What the receiver was last given is the content of the last entry written.
            if let Some(last) = said.last() {
                let previous = (batch.render)(last);
                store.record_inbox(agent, session, &previous)?;
            }
            for entry in said {
                if store.in_flight(entry.id)? {
                    lock(&inner.inbox_written).insert(entry.id);
                }
            }
        }
        for id in repeats {
            if let Some(message) = store.deliver_repeat(*id)? {
                inner
                    .bus
                    .emit(Actor::daemon(), EventData::MessageDelivered(message.into()));
            }
        }
    }
    if let Some(inbox) = inner.inbox.get() {
        for note in &notes {
            if said.iter().any(|entry| entry.id == note.id) {
                inbox.submitted(agent, &note.from);
            }
        }
    }
    if !empty.is_empty() {
        let empty: Vec<u32> = empty.iter().map(|entry| entry.id).collect();
        confirm_ids(inner, agent, &empty);
    }
    Ok(Committed::Written)
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
    use agents::claude_code::inbox::Entry;
    use contracts::agent::NodeKind;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    #[derive(Default)]
    pub(crate) struct BatchRail {
        pub nodes: Mutex<Vec<RailNode>>,
        pub reads: AtomicUsize,
        pub fail: AtomicBool,
        pub advance: Mutex<Option<(std::sync::Weak<Inner>, bool)>>,
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
            if let Some((inner, generation)) = lock(&self.advance).take()
                && let Some(inner) = inner.upgrade()
            {
                let store = lock(&inner.store);
                if generation {
                    store
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
                } else {
                    store.bind(1, (1, 2)).unwrap();
                }
            }
            Ok(serde_json::to_value(&*lock(&self.nodes)).unwrap())
        }
    }

    type Written = (u32, MessageKind, String, String);

    #[derive(Default)]
    pub(crate) struct BatchInbox {
        pub batches: Mutex<Vec<Vec<Written>>>,
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
        let env = Env {
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
            clock: Arc::new(|| 100_000),
            fault: Arc::new(|_| Ok(())),
        };
        let messages = Messages::open_with(path, Bus::new(), rail.clone(), env).unwrap();
        messages.listen();
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

    struct TwoDoors;

    #[async_trait]
    impl NoteInbox for TwoDoors {
        async fn check(&self, _: &str) -> Inbox {
            Inbox::Ok
        }
        fn open_jobs(
            &self,
            _: &str,
            _: &dyn Fn(&str) -> Result<Vec<String>, RpcError>,
        ) -> Vec<(String, String, String)> {
            ["a-job", "b-job"]
                .map(|id| (id.to_owned(), id.to_uppercase(), "1".to_owned()))
                .to_vec()
        }
        fn in_reach(&self, door: &str, job: &str) -> bool {
            job.starts_with(&door[..1])
        }
        fn write(&self, _: &str, _: &[Entry]) -> Result<(), Inbox> {
            Ok(())
        }
    }

    #[test]
    fn dcr3_open_jobs_note_leaves_out_another_workstream() {
        let dir = tempfile::tempdir().unwrap();
        let env = Env {
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
            clock: Arc::new(|| 100_000),
            fault: Arc::new(|_| Ok(())),
        };
        let messages =
            Messages::open_with(dir.path(), Bus::new(), Arc::new(BatchRail::default()), env)
                .unwrap();
        messages.set_inbox(Arc::new(TwoDoors));
        let note = open_job_snapshot(&messages.inner, "a-door", (1, 2)).unwrap();
        assert!(note.contains("a-job"));
        assert!(!note.contains("b-job") && !note.contains("B-JOB"));
        assert_eq!(open_job_snapshot(&messages.inner, "c-door", (1, 2)), None);
    }

    #[tokio::test(start_paused = true)]
    async fn b5763b_identical_entries_write_once_and_close_the_repeat() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, _, inbox) = setup(dir.path());
        let first = pending(&messages, &Actor::daemon(), "same note");
        let repeat = pending(&messages, &Actor::daemon(), "same note");
        assert!(
            send(
                &messages.inner,
                "m",
                (1, 2),
                Pick::Next,
                vec![first.clone(), repeat.clone()],
                Inbox::Ok
            )
            .await
            .unwrap()
            .went()
        );
        assert_eq!(lock(&inbox.batches)[0].len(), 1);
        let store = lock(&messages.inner.store);
        assert_eq!(
            store.get(first.id).unwrap().unwrap().status,
            MessageStatus::Pending
        );
        let closed = store.get(repeat.id).unwrap().unwrap();
        assert_eq!(closed.status, MessageStatus::Delivered);
        assert!(
            serde_json::to_string(&closed.reason)
                .unwrap()
                .contains("repeat")
        );
        assert!(!store.in_flight(repeat.id).unwrap());
    }

    #[tokio::test(start_paused = true)]
    async fn b5763c_reopen_closes_a_known_inflight_repeat_without_a_write() {
        let dir = tempfile::tempdir().unwrap();
        let repeat;
        {
            let (messages, _, _) = setup(dir.path());
            let first = pending(&messages, &Actor::daemon(), "same note");
            send(
                &messages.inner,
                "m",
                (1, 2),
                Pick::Next,
                vec![first.clone()],
                Inbox::Ok,
            )
            .await
            .unwrap();
            messages.confirm_inbox("m", &[first.id]);
            repeat = pending(&messages, &Actor::daemon(), "same note");
            lock(&messages.inner.store)
                .record_flight(repeat.id, repeat.id)
                .unwrap();
        }
        let (messages, _, inbox) = setup(dir.path());
        let mut events = messages.inner.bus.subscribe();
        send(
            &messages.inner,
            "m",
            (1, 2),
            Pick::Next,
            vec![repeat.clone()],
            Inbox::Ok,
        )
        .await
        .unwrap();
        assert!(lock(&inbox.batches).is_empty());
        assert_eq!(
            lock(&messages.inner.store)
                .get(repeat.id)
                .unwrap()
                .unwrap()
                .reason,
            Some(Reason::InboxRepeat)
        );
        assert!(!lock(&messages.inner.store).in_flight(repeat.id).unwrap());
        messages.confirm_inbox("m", &[repeat.id, repeat.id]);
        let mut delivered = 0;
        while let Ok(event) = events.try_recv() {
            if matches!(event.data, EventData::MessageDelivered(_)) {
                delivered += 1;
            }
        }
        assert_eq!(delivered, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn b5763b_quiet_digest_repeat_closes_after_the_vendor_window() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, _, inbox) = setup(dir.path());
        let body = crate::digest::push_body(&contracts::agent::DigestEntry {
            name: "child".into(),
            kind: Kind::Working,
            last: "new work".into(),
            todos: 1,
            link: None,
            pads: vec![],
        });
        let first = pending(&messages, &Actor::daemon(), &body);
        send(
            &messages.inner,
            "m",
            (1, 2),
            Pick::Next,
            vec![first.clone()],
            Inbox::Ok,
        )
        .await
        .unwrap();
        messages.confirm_inbox("m", &[first.id]);
        tokio::time::advance(std::time::Duration::from_secs(31)).await;
        let repeat = pending(&messages, &Actor::daemon(), &body);
        send(
            &messages.inner,
            "m",
            (1, 2),
            Pick::Next,
            vec![repeat.clone()],
            Inbox::Missing,
        )
        .await
        .unwrap();
        assert_eq!(
            lock(&messages.inner.store)
                .get(repeat.id)
                .unwrap()
                .unwrap()
                .status,
            MessageStatus::Pending
        );
        send(
            &messages.inner,
            "m",
            (1, 2),
            Pick::Next,
            vec![repeat.clone()],
            Inbox::Ok,
        )
        .await
        .unwrap();
        assert_eq!(lock(&inbox.batches).len(), 1);
        assert_eq!(
            lock(&messages.inner.store)
                .get(repeat.id)
                .unwrap()
                .unwrap()
                .reason,
            Some(Reason::InboxRepeat)
        );
    }

    fn agent(id: &str) -> Actor {
        Actor {
            kind: ActorKind::Agent,
            id: id.into(),
            parent: None,
        }
    }

    pub(crate) fn pending(messages: &Messages, from: &Actor, body: &str) -> Message {
        pending_as(messages, from, body, &crate::pushes::Payload::Note)
    }

    pub(crate) fn pending_as(
        messages: &Messages,
        from: &Actor,
        body: &str,
        payload: &crate::pushes::Payload,
    ) -> Message {
        let at = (messages.inner.clock)();
        lock(&messages.inner.store)
            .insert(
                from,
                "m",
                MessageKind::Note,
                body,
                None,
                MessageStatus::Pending,
                None,
                at,
                (1, 1),
                payload,
            )
            .unwrap()
    }

    #[tokio::test(start_paused = true)]
    async fn b5640c_one_sender_refresh_labels_the_whole_batch() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, rail, inbox) = setup(dir.path());
        let mut sender = live("a");
        sender.name = "before enqueue".into();
        lock(&rail.nodes).push(sender);
        let mut second = live("b");
        second.name = "second sender".into();
        lock(&rail.nodes).push(second);
        let actors = [
            agent("a"),
            agent("b"),
            Actor::user(),
            Actor::daemon(),
            Actor {
                kind: ActorKind::Ext,
                id: "extension".into(),
                parent: None,
            },
        ];
        let notes: Vec<_> = (0..32)
            .map(|i| {
                lock(&messages.inner.store)
                    .insert(
                        &actors[i % actors.len()],
                        "m",
                        if i % 3 == 0 {
                            MessageKind::Question
                        } else {
                            MessageKind::Note
                        },
                        &format!("text-{i}"),
                        None,
                        MessageStatus::Pending,
                        None,
                        0,
                        (1, 1),
                        &crate::pushes::Payload::Note,
                    )
                    .unwrap()
            })
            .collect();
        lock(&rail.nodes)[1].name = "renamed".into();
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
            .unwrap()
            .went()
        );
        assert_eq!(rail.reads.load(Ordering::SeqCst), 1);
        let expected: Vec<_> = notes
            .iter()
            .enumerate()
            .map(|(i, m)| {
                (
                    m.id,
                    m.kind,
                    match i % actors.len() {
                        0 => "renamed".into(),
                        1 => "second sender".into(),
                        _ => actors[i % actors.len()].id.clone(),
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
            .unwrap()
            .went()
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
            let mut removed = live("b");
            removed.name = "removed original".into();
            lock(&rail.nodes).push(removed);
            lock(&rail.nodes)[1].name = "last observed".into();
            load_rail_nodes(&messages.inner).await.unwrap();
        }
        let (messages, _, inbox) = setup(dir.path());
        let notes = vec![
            pending(&messages, &agent("a"), "known"),
            pending(&messages, &agent("b"), "removed"),
            pending(&messages, &agent("missing-id"), "unknown"),
        ];
        assert!(
            send(&messages.inner, "m", (1, 2), Pick::Next, notes, Inbox::Ok)
                .await
                .unwrap()
                .went()
        );
        let batches = lock(&inbox.batches);
        assert_eq!(batches[0][0].2, "last observed");
        assert_eq!(batches[0][1].2, "removed original");
        assert_eq!(batches[0][2].2, "an Agent that is gone");
        assert_eq!(
            lock(&messages.inner.store).sender_name("a").unwrap(),
            "last observed"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn b5640e_failed_or_stale_preparation_keeps_pending_identity() {
        for failure in ["read", "write", "generation", "binding"] {
            let dir = tempfile::tempdir().unwrap();
            let (messages, rail, inbox) = setup(dir.path());
            let note = pending(&messages, &agent("a"), failure);
            rail.fail.store(failure == "read", Ordering::SeqCst);
            inbox.fail.store(failure == "write", Ordering::SeqCst);
            if matches!(failure, "generation" | "binding") {
                *lock(&rail.advance) =
                    Some((Arc::downgrade(&messages.inner), failure == "generation"));
            }
            send(
                &messages.inner,
                "m",
                (1, 2),
                Pick::Next,
                vec![note.clone()],
                Inbox::Ok,
            )
            .await
            .unwrap();
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
            if matches!(failure, "generation" | "binding") {
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
                    .unwrap()
                    .went()
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
                    .unwrap()
                    .went()
                );
                assert_eq!(lock(&inbox.batches)[0][0].0, note.id);
                assert!(lock(&messages.inner.store).in_flight(note.id).unwrap());
            }
        }
    }
}
