//! Receiver lifecycle reconciliation and pending inbox delivery.
#![deny(clippy::struct_excessive_bools)]

use super::*;

/// Starts the status listener at most once for this `Inner` (its `Once`), and only when a Tokio
/// runtime is there to run it on. The subscription itself was already taken at `open`, so no
/// `agent.status` fired between `open` and this first poll is lost.
pub(super) fn start_listener(inner: &Arc<Inner>) {
    inner.listener_started.call_once(|| {
        spawn_push_clock(Arc::downgrade(inner));
        let events = lock(&inner.events)
            .take()
            .expect("subscribed once, at open");
        spawn_status_listener(Arc::clone(inner), events);
    });
}

/// B22: every half second, sends the pushed digests whose window ended by the Daemon's clock.
fn spawn_push_clock(inner: std::sync::Weak<Inner>) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
        // A stalled clock (a suspended host, a paused test clock) owes one pass, not one per missed tick.
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let Some(inner) = inner.upgrade() else {
                break;
            };
            pushes::flush(&inner).await;
            failure::sweep(&inner).await;
            #[cfg(test)]
            let _ = inner.completed.send("clock");
        }
    });
}

/// Reads `agent.status` off `events` for as long as `inner` has a subscriber: an `idle` Kind
/// or live `error` Kind delivers pending Messages (B2, B30, B37); a `done` or
/// exited `error` Kind drops its `pending` Messages with the reason
/// `receiver gone` (B9). A `Lagged` receiver may have missed one of those, so it resyncs from
/// the Rail instead of guessing what it lost (B9), and tries again on its next event while the
/// Rail cannot answer.
fn spawn_status_listener(
    inner: Arc<Inner>,
    mut events: tokio::sync::broadcast::Receiver<contracts::Event>,
) {
    tokio::spawn(async move {
        let mut resync_due = !resync(&inner).await;
        #[cfg(test)]
        let _ = inner.completed.send("initial");
        loop {
            match events.recv().await {
                Ok(contracts::Event {
                    data: EventData::AgentStatus(status),
                    ..
                }) => {
                    let _ = guarded(
                        "on_status",
                        on_status_labeled(
                            &inner,
                            &status.id,
                            &status.attempt,
                            &status.status_revision,
                            status.status.kind,
                            &status.status.label,
                        ),
                    )
                    .await;
                    #[cfg(test)]
                    let _ = inner.completed.send("on_status");
                }
                Ok(contracts::Event {
                    data: EventData::RailRenamed { id, name },
                    ..
                }) => {
                    lock(&inner.store)
                        .record_sender_name(&id, &name)
                        .expect("message sender name");
                    #[cfg(test)]
                    let _ = inner.completed.send("rename");
                }
                Ok(contracts::Event {
                    data: EventData::RailChanged,
                    ..
                }) => resync_due = true,
                Ok(_) => {}
                Err(RecvError::Lagged(_)) => resync_due = true,
                Err(RecvError::Closed) => break,
            }
            if resync_due {
                resync_due = !resync(&inner).await;
            }
        }
    });
}

#[cfg(test)]
pub(super) async fn on_status(
    inner: &Arc<Inner>,
    agent: &str,
    attempt: &str,
    revision: &str,
    kind: Kind,
) {
    let (attempt, revision) = (
        contracts::agent::Ordinal::parse(attempt).expect("test Attempt"),
        contracts::agent::Ordinal::parse(revision).expect("test Status revision"),
    );
    on_status_labeled(inner, agent, &attempt, &revision, kind, "").await;
}

pub(super) async fn on_status_labeled(
    inner: &Arc<Inner>,
    agent: &str,
    attempt: &contracts::agent::Ordinal,
    revision: &contracts::agent::Ordinal,
    kind: Kind,
    label: &str,
) {
    let at = (attempt.get(), revision.get());
    // StopFailure ends a turn, not its Terminal. Read authoritative liveness so a late
    // error cannot reopen an exited Attempt or close a resumed one.
    // A Door's pending Messages outlive its Attempts: read the Rail where an ending or a new
    // Attempt would otherwise apply B9.
    let new_attempt = lock(&inner.store)
        .generation(agent)
        .expect("message store")
        .is_none_or(|state| state.attempt < at.0);
    let retained = if new_attempt || matches!(kind, Kind::Done | Kind::Error) {
        let Ok(nodes) = load_rail_nodes(inner).await else {
            return;
        };
        nodes
            .iter()
            .any(|node| node.id == agent && node.kind == contracts::agent::NodeKind::Workstream)
    } else {
        false
    };
    let (closed, ready) = if kind == Kind::Error {
        let Ok(nodes) = load_rail_nodes(inner).await else {
            return;
        };
        let node = nodes
            .iter()
            .find(|node| node.id == agent && binding(node).0 == at.0);
        (
            node.is_none_or(ended),
            node.is_some_and(|node| {
                binding(node) == at && node.status.as_ref().is_some_and(|s| s.kind == Kind::Error)
            }),
        )
    } else {
        (
            kind == Kind::Done,
            matches!(kind, Kind::Idle | Kind::Blocked) || stop_recorded(kind, label),
        )
    };
    {
        let mut store = lock(&inner.store);
        if let Err(cause) = (inner.fault)("on_status") {
            panic!("{cause}");
        }
        reconcile(
            inner,
            &mut store,
            agent,
            at,
            Ending {
                end: if closed { End::Closed } else { End::Live },
                receiver: receiver_of(retained),
                restart: false,
            },
        )
        .expect("message store");
    }
    if !closed && ready {
        on_idle(inner, agent, at, Pick::Next).await;
    }
}

/// Resync after bus lag or Rail changes so missed endings cannot leave Messages deliverable.
/// A failed Rail read is retried on the next event; it never guesses that an Agent recovered.
pub(super) async fn resync(inner: &Arc<Inner>) -> bool {
    let known = {
        let store = lock(&inner.store);
        store
            .receivers()
            .expect("message store")
            .into_iter()
            .map(|id| {
                let generation = store.generation(&id).expect("message store");
                (id, generation)
            })
            .collect::<Vec<_>>()
    };
    let Ok(nodes) = load_rail_nodes(inner).await else {
        return false;
    };
    let mut store = lock(&inner.store);
    for (id, generation) in known {
        if !nodes.iter().any(|node| node.id == id)
            && store.generation(&id).expect("message store") == generation
        {
            // Restart reservations end at removal; retirement protection is permanent.
            store.end_restart(&id).expect("message store");
            // B8: a removed Agent cannot be resumed, so nothing in flight waits for it.
            store.clear_flights_to(&id).expect("message store");
            let attempt = generation.map_or(0, |state| state.attempt);
            reconcile(
                inner,
                &mut store,
                &id,
                (attempt, i64::MAX),
                Ending {
                    end: End::Gone,
                    receiver: Receiver::Agent,
                    restart: false,
                },
            )
            .expect("message store");
        }
    }
    for node in nodes {
        reconcile_node(inner, &mut store, &node, true).expect("message store");
    }
    true
}

/// Read the Rail as the Daemon and persist its current sender names for removal/reopen.
pub(super) async fn load_rail_nodes(inner: &Inner) -> Result<Vec<RailNode>, RpcError> {
    let ctx = Ctx {
        actor: Actor::daemon(),
        bus: inner.bus.clone(),
        touches: Arc::clone(&inner.touches),
    };
    let tree = inner.agents.call(&ctx, "rail.tree", Value::Null).await?;

    let nodes: Vec<RailNode> = serde_json::from_value(tree).map_err(RpcError::internal)?;
    record_sender_names(inner, &nodes)?;
    Ok(nodes)
}

/// Save the last Rail names observed by Messages for delivery after removal.
fn record_sender_names(inner: &Inner, nodes: &[RailNode]) -> Result<(), RpcError> {
    let mut store = lock(&inner.store);
    store.atomically(|store| {
        for node in nodes {
            store.record_sender_name(&node.id, &node.name)?;
        }
        Ok(())
    })
}

/// B3563c: writes every pending Message to `agent`'s Claude inbox as one batch, in id order. The
/// inbox write leaves each in flight until its transcript receipt (B50); a missing or mismatched
/// inbox leaves them `pending` for the next eligible event.
///
/// `Pick::Fresh` is for work that became deliverable while its receiver was already `idle` (a
/// Message just sent or passed on to it): no `idle` event will follow for it, so the batch the next
/// `idle` would pick is written now, though its Status revision is the current one.
async fn on_idle(inner: &Arc<Inner>, agent: &str, at: store::Binding, pick: Pick) {
    // Preserve physical write order through comparison, inbox write and durable history.
    let _delivery = inner.delivery.write().await;
    let state = match inner.inbox.get() {
        Some(inbox) => inbox.check(agent).await,
        None => contracts::agent::Inbox::Missing,
    };
    let found = {
        let store = lock(&inner.store);
        let reserved = store.is_reserved(agent).expect("message store");
        if matches!(
            step::retirement_event(
                store.retirement(agent).expect("message store").is_some(),
                step::restart_event(reserved, Event::Idle)
            ),
            Event::Busy
        ) || store.require_generation(agent, at).is_err()
        {
            if reserved {
                let ids: Vec<u32> = store
                    .list_pending_to(agent)
                    .expect("message store")
                    .iter()
                    .map(|m| m.id)
                    .collect();
                failure::hold(inner, &ids, Some(failure::RESTART_RESERVED));
            }
            return;
        }
        // A just-sent Message is bound to the current revision, which the queue excludes.
        let upto = (at.0, at.1.saturating_add(i64::from(pick == Pick::Fresh)));
        let typing = lock(&inner.typing);
        let pending = store
            .pending_queue(agent, upto)
            .expect("message store")
            .into_iter()
            .filter(|m| !typing.contains(&m.id))
            .collect::<Vec<_>>();
        drop(typing);
        let ids = idle_batch(&pending);
        pending
            .into_iter()
            .filter(|m| ids.contains(&m.id))
            .collect::<Vec<_>>()
    };
    if !found.is_empty() {
        inbox::send(inner, agent, at, pick, found, state).await;
    }
}

/// Which pending Messages an `idle` may type.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Pick {
    /// An `idle` event: those bound to an earlier Status revision.
    Next,
    /// The receiver is idle already: those bound to this revision too.
    Fresh,
}

/// B2, B13, B37: delivers pending Messages when the receiver is ready for a turn.
pub(super) async fn deliver_pending(inner: &Arc<Inner>, agent: &str) {
    let Ok(nodes) = load_rail_nodes(inner).await else {
        return;
    };
    if let Some(node) = nodes.iter().find(|node| {
        node.id == agent
            && !ended(node)
            && node.status_revision.is_some()
            && node.status.as_ref().is_some_and(ready)
    }) {
        on_idle(inner, agent, binding(node), Pick::Fresh).await;
    } else if let Some(node) = nodes
        .iter()
        .find(|node| node.id == agent && !ended(node) && node.status_revision.is_some())
    {
        // U6296a: a live receiver that is not ready keeps its Messages pending, with the reason.
        let ids: Vec<u32> = lock(&inner.store)
            .list_pending_to(&node.id)
            .expect("message store")
            .iter()
            .map(|m| m.id)
            .collect();
        // U6307a: a Message with its own reason keeps it.
        let fresh: Vec<u32> = {
            let waiting = lock(&inner.waiting);
            ids.into_iter()
                .filter(|id| !waiting.contains_key(id))
                .collect()
        };
        failure::hold(inner, &fresh, Some(failure::RECEIVER_BUSY));
    }
}

/// U6404a: a Stop that a DCL3d hold keeps `working` (DCL3e's label) ends the turn, so the receiver
/// takes input at its prompt. The label is the one fact of the Stop the Rail carries.
fn stop_recorded(kind: Kind, label: &str) -> bool {
    kind == Kind::Working && label.starts_with("waiting on ")
}

/// Whether the receiver's status lets a Message be written: idle, blocked, a live error, or a Stop
/// under a hold (U6404a).
pub(super) fn ready(status: &contracts::Status) -> bool {
    matches!(status.kind, Kind::Idle | Kind::Blocked | Kind::Error)
        || stop_recorded(status.kind, &status.label)
}

pub(super) fn binding(node: &RailNode) -> store::Binding {
    (
        node.attempt
            .as_ref()
            .map_or(0, contracts::agent::Ordinal::get),
        node.status_revision
            .as_ref()
            .map_or(0, contracts::agent::Ordinal::get),
    )
}

/// Whether the node's program is not running: never started, finished, or failed with no Terminal.
pub fn ended(node: &RailNode) -> bool {
    ((node.status_revision.is_none() || node.status.is_none()) && node.terminal_id.is_none())
        || node.status.as_ref().is_some_and(|s| {
            s.kind == Kind::Done || (s.kind == Kind::Error && node.terminal_id.is_none())
        })
}

fn permanently_ended(node: &RailNode) -> bool {
    ended(node) && node.terminal_id.is_none()
}

/// A reattached Terminal restarts its Status counter, so pending bindings must not wait
/// for a revision from the previous Daemon. Final Messages remain final.
fn reconcile_node(
    inner: &Inner,
    store: &mut Store,
    node: &RailNode,
    restart: bool,
) -> Result<(), RpcError> {
    let at = binding(node);
    let poisoned = store.generation(&node.id)?.is_some_and(|state| {
        state.attempt == at.0
            && state.revision == i64::MAX
            && state.closed_revision == i64::MAX
            && state.closed
    });
    if node.terminal_id.is_some()
        && !ended(node)
        && store.retirement(&node.id)?.is_none()
        && (restart || node.status_revision.is_none() || poisoned)
    {
        store.atomically(|store| {
            for message in store.list_pending_to(&node.id)? {
                if store.bound(message.id)?.0 == at.0 {
                    store.bind(message.id, (at.0, 0))?;
                }
            }
            if restart || poisoned {
                store.set_generation(
                    &node.id,
                    store::ReceiverState {
                        attempt: at.0,
                        revision: at.1,
                        closed_revision: -1,
                        closed: false,
                    },
                )?;
            }
            Ok(())
        })?;
    }
    reconcile(
        inner,
        store,
        &node.id,
        at,
        Ending {
            end: if permanently_ended(node) {
                End::Gone
            } else if ended(node) {
                End::Closed
            } else {
                End::Live
            },
            receiver: receiver_of(node.kind == contracts::agent::NodeKind::Workstream),
            restart,
        },
    )
}

pub(super) fn accept_receiver(
    inner: &Inner,
    store: &mut Store,
    node: &RailNode,
) -> Result<(), RpcError> {
    if store.retirement(&node.id)?.is_some() {
        return Err(RpcError::conflict("receiver reserved for retirement"));
    }
    reconcile_node(inner, store, node, false)?;
    store.require_generation(&node.id, binding(node))
}

/// Both A35 operations can select an already stopped Agent; reconcile its ordinary B9
/// ending first so a new reservation never revives final records.
pub(super) fn accept_reservation(
    inner: &Inner,
    store: &mut Store,
    node: &RailNode,
) -> Result<(), RpcError> {
    let at = binding(node);
    reconcile_node(inner, store, node, false)?;
    if ended(node) {
        if store
            .generation(&node.id)?
            .is_none_or(|state| state.attempt != at.0)
        {
            return Err(RpcError::conflict("stale receiver Attempt"));
        }
        Ok(())
    } else {
        store.require_generation(&node.id, at)
    }
}

/// How far a binding ended: still running, the Attempt over, or its Terminal gone for good.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum End {
    Live,
    Closed,
    Gone,
}

/// Whether the receiver is a Door still on the Rail (DCL8) or an Agent.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Receiver {
    Door,
    Agent,
}

fn receiver_of(retained: bool) -> Receiver {
    if retained {
        Receiver::Door
    } else {
        Receiver::Agent
    }
}

/// What ended at a binding, which receiver it was, and whether a Daemon reopen caused it.
#[derive(Clone, Copy)]
pub(super) struct Ending {
    pub(super) end: End,
    pub(super) receiver: Receiver,
    pub(super) restart: bool,
}

pub(super) fn reconcile(
    inner: &Inner,
    store: &mut Store,
    agent: &str,
    at: store::Binding,
    end: Ending,
) -> Result<(), RpcError> {
    let mut events = Vec::new();
    let result = reconcile_into(store, agent, at, end, &mut events);
    for event in events {
        inner.bus.emit(Actor::daemon(), event);
    }
    result
}

fn reconcile_into(
    store: &mut Store,
    agent: &str,
    at: store::Binding,
    end: Ending,
    events: &mut Vec<EventData>,
) -> Result<(), RpcError> {
    let Ending {
        end,
        receiver,
        restart,
    } = end;
    let closed = end != End::Live;
    let retained = receiver == Receiver::Door;
    let previous = store.generation(agent)?;
    let reserved = store.is_reserved(agent)?;
    let retiring = store.retirement(agent)?.is_some();
    let through = if end == End::Gone {
        Some((at.0, i64::MAX))
    } else if closed {
        Some(at)
    } else if previous.is_none_or(|state| state.attempt < at.0) {
        Some((at.0.saturating_sub(1), i64::MAX))
    } else {
        None
    };
    if let Some(through) = through.filter(|_| {
        !retiring && matches!(step::door_event(retained, Event::ReceiverExit), Event::Busy)
    }) {
        // DCL8: a Door on the Rail is a logical receiver that outlives its Attempts. A stopped
        // or crashed Attempt drops nothing; the pending Messages wait, in id order, and move to
        // the next Attempt once it exists.
        if through.0 < at.0 {
            store.atomically(|store| {
                for message in store.list_pending_to(agent)? {
                    if store.bound(message.id)? <= through {
                        store.bind(message.id, (at.0, 0))?;
                        store.clear_flight(message.id)?;
                    }
                }
                Ok(())
            })?;
        }
    } else if let Some(through) = through.filter(|_| {
        matches!(
            step::retirement_event(retiring, step::restart_event(reserved, Event::ReceiverExit)),
            Event::ReceiverExit
        )
    }) {
        // B8: a Message written and not confirmed waits for the Agent to be resumed.
        let rebind = (through.0 < at.0).then_some((at.0, 0));
        let keep = Some(rebind);
        // DCL4: the drops and each sender's one return note commit together, so a crash and
        // replay find either both or neither; a replay drops nothing and so notes nothing.
        let (dropped, notes) = store.atomically(|store| {
            let dropped = store.drop_all_pending(
                agent,
                Reason::ReceiverGone,
                through,
                gone_drops,
                keep,
                restart,
            )?;
            let notes = return_notes(store, agent, &dropped)?;
            Ok((dropped, notes))
        })?;
        for message in dropped {
            events.push(EventData::MessageDropped(message.into()));
        }
        for note in notes {
            events.push(EventData::MessageSent(note.into()));
        }
    }
    if previous.is_some_and(|state| state.attempt > at.0) {
        return Ok(());
    }
    let mut state =
        previous
            .filter(|state| state.attempt == at.0)
            .unwrap_or(store::ReceiverState {
                attempt: at.0,
                revision: at.1,
                closed_revision: -1,
                closed: false,
            });
    state.revision = state.revision.max(at.1);
    if closed {
        state.closed_revision = state.closed_revision.max(at.1);
    }
    state.closed |= retiring || (end == End::Gone && !reserved);
    store.set_generation(agent, state)
}

const NOTE_IDS: usize = 32;
const NOTE_CAUSE_BYTES: usize = 512;

/// RN1 RN2: the note body lists at most 32 ids, counts the rest, and cuts the cause at a
/// character boundary at or before byte 512, so it stays under B1's 8192-byte body limit.
fn return_note_body(ids: &[u32], name: &str, cause: &str) -> String {
    let list = |ids: &[u32]| {
        ids.iter()
            .map(|id| format!("#{id}"))
            .collect::<Vec<_>>()
            .join(" ")
    };
    let cause = if cause.len() > NOTE_CAUSE_BYTES {
        let end = (0..=NOTE_CAUSE_BYTES)
            .rev()
            .find(|&i| cause.is_char_boundary(i))
            .unwrap_or(0);
        format!("{} [cut]", &cause[..end])
    } else {
        cause.to_owned()
    };
    if ids.len() <= NOTE_IDS {
        return format!("[return] {} never reached {name}: {cause}", list(ids));
    }
    let (head, rest) = ids.split_at(NOTE_IDS);
    format!(
        "[return] {}\n[+{} more: #{} to #{}]\nnever reached {name}: {cause}",
        list(head),
        rest.len(),
        rest[0],
        rest[rest.len() - 1]
    )
}

/// DCL4: one pending note from the Daemon to each Agent sender whose Messages `dropped` closed
/// at `agent`, listing the original ids. The originals keep their identity and are never reset.
fn return_notes(
    store: &mut Store,
    agent: &str,
    dropped: &[Message],
) -> Result<Vec<Message>, RpcError> {
    let mut senders: Vec<&Actor> = Vec::new();
    for message in dropped {
        if message.from.kind == ActorKind::Agent && !senders.contains(&&message.from) {
            senders.push(&message.from);
        }
    }
    let name = store.sender_name(agent)?;
    let mut notes = Vec::new();
    for sender in senders {
        let mut ids: Vec<u32> = dropped
            .iter()
            .filter(|m| &m.from == sender)
            .map(|m| m.id)
            .collect();
        ids.sort_unstable();
        let body = return_note_body(&ids, &name, "it ended before they were read");
        let at = dropped.iter().map(|m| m.at).max().unwrap_or(0);
        let binding = store
            .generation(&sender.id)?
            .map_or((0, 0), |state| (state.attempt, state.revision));
        notes.push(store.insert(
            &Actor::daemon(),
            &sender.id,
            MessageKind::Note,
            &body,
            None,
            MessageStatus::Pending,
            None,
            at,
            binding,
        )?);
    }
    Ok(notes)
}

impl Messages {
    /// `to`'s Status, when it names an Agent or a Door; `None` when it names the user.
    /// `NOT_FOUND` when it names no Actor; `INVALID_PARAMS` when it names a plain
    /// Workstream, which cannot receive a Message.
    pub(super) async fn resolve_receiver(&self, to: &str) -> Result<Option<RailNode>, RpcError> {
        if to == Actor::user().id {
            return Ok(None);
        }
        let nodes = load_rail_nodes(&self.inner).await?;
        let node = nodes
            .into_iter()
            .find(|node| node.id == to)
            .ok_or_else(|| RpcError::not_found(format!("actor {to}")))?;
        Ok(Some(node))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inbox::tests::{pending, setup};
    use contracts::agent::DigestEntry;

    #[tokio::test(start_paused = true)]
    async fn b5640e_quiet_work_rides_one_idle_batch() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, _, inbox) = setup(dir.path());
        let body = crate::digest::push_body(&DigestEntry {
            name: "child".into(),
            kind: Kind::Working,
            last: "unchanged".into(),
            todos: 2,
            link: None,
            pads: vec![],
        });
        let history = lock(&messages.inner.store)
            .insert(
                &Actor::daemon(),
                "m",
                MessageKind::Note,
                &body,
                None,
                MessageStatus::Delivered,
                None,
                0,
                (1, 1),
            )
            .unwrap();
        let quiet = pending(&messages, &Actor::daemon(), &body);
        on_idle(&messages.inner, "m", (1, 2), Pick::Next).await;
        assert!(lock(&inbox.batches).is_empty());
        assert!(!lock(&messages.inner.store).in_flight(quiet.id).unwrap());
        let ordinary = pending(&messages, &Actor::user(), "please continue");
        on_idle(&messages.inner, "m", (1, 2), Pick::Next).await;
        {
            let batches = lock(&inbox.batches);
            assert_eq!(batches.len(), 1);
            assert_eq!(
                batches[0].iter().map(|e| e.0).collect::<Vec<_>>(),
                [quiet.id, ordinary.id]
            );
        }
        for id in [quiet.id, ordinary.id] {
            let store = lock(&messages.inner.store);
            assert!(store.in_flight(id).unwrap());
            assert_eq!(
                store.get(id).unwrap().unwrap().status,
                MessageStatus::Pending
            );
        }
        on_idle(&messages.inner, "m", (1, 2), Pick::Next).await;
        assert_eq!(lock(&inbox.batches).len(), 1);
        messages.confirm_inbox("m", &[quiet.id, ordinary.id]);
        for id in [history.id, quiet.id, ordinary.id] {
            assert_eq!(
                lock(&messages.inner.store).get(id).unwrap().unwrap().status,
                MessageStatus::Delivered
            );
        }
        on_idle(&messages.inner, "m", (1, 2), Pick::Next).await;
        assert_eq!(lock(&inbox.batches).len(), 1);
        // BatchRail rejects every method but rail.tree: no Terminal write or prompt is possible.
    }
}

#[cfg(test)]
mod dcl_tests {
    use super::*;
    use crate::inbox::tests::setup;

    #[tokio::test(start_paused = true)]
    async fn dcl4_killed_subagent_returns_pending_messages_once() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, _, _) = setup(dir.path());
        let door = Actor {
            kind: ActorKind::Agent,
            id: "door".into(),
            parent: None,
        };
        let send = |body: &str| {
            lock(&messages.inner.store)
                .insert(
                    &door,
                    "m",
                    MessageKind::Note,
                    body,
                    None,
                    MessageStatus::Pending,
                    None,
                    5,
                    (1, 1),
                )
                .unwrap()
                .id
        };
        let (a, b) = (send("one"), send("two"));
        for _ in 0..2 {
            let mut store = lock(&messages.inner.store);
            reconcile(
                &messages.inner,
                &mut store,
                "m",
                (1, 9),
                Ending {
                    end: End::Gone,
                    receiver: Receiver::Agent,
                    restart: false,
                },
            )
            .unwrap();
            assert!(store.list_pending_to("m").unwrap().is_empty());
        }
        let store = lock(&messages.inner.store);
        for id in [a, b] {
            let m = store.get(id).unwrap().unwrap();
            assert_eq!(m.status, MessageStatus::Dropped);
            assert_eq!(m.reason, Some(Reason::ReceiverGone));
        }
        let notes = store.list_pending_to("door").unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].from, Actor::daemon());
        assert!(
            notes[0].body.contains(&format!("#{a} #{b} never reached")),
            "{}",
            notes[0].body
        );
    }

    fn kill_with_pending(count: usize) -> (tempfile::TempDir, Messages, Vec<u32>) {
        let dir = tempfile::tempdir().unwrap();
        let (messages, _, _) = setup(dir.path());
        let door = Actor {
            kind: ActorKind::Agent,
            id: "door".into(),
            parent: None,
        };
        let ids: Vec<u32> = (0..count)
            .map(|_| {
                lock(&messages.inner.store)
                    .insert(
                        &door,
                        "m",
                        MessageKind::Note,
                        "x",
                        None,
                        MessageStatus::Pending,
                        None,
                        5,
                        (1, 1),
                    )
                    .unwrap()
                    .id
            })
            .collect();
        for _ in 0..2 {
            let mut store = lock(&messages.inner.store);
            reconcile(
                &messages.inner,
                &mut store,
                "m",
                (1, 9),
                Ending {
                    end: End::Gone,
                    receiver: Receiver::Agent,
                    restart: false,
                },
            )
            .unwrap();
        }
        (dir, messages, ids)
    }

    #[tokio::test(start_paused = true)]
    async fn rn1_a_return_note_lists_32_ids_and_counts_the_rest() {
        let (_dir, messages, ids) = kill_with_pending(40);
        let store = lock(&messages.inner.store);
        for id in &ids {
            assert_eq!(
                store.get(*id).unwrap().unwrap().status,
                MessageStatus::Dropped
            );
        }
        let notes = store.list_pending_to("door").unwrap();
        assert_eq!(notes.len(), 1);
        let lines: Vec<&str> = notes[0].body.lines().collect();
        let listed: Vec<String> = ids[..32].iter().map(|id| format!("#{id}")).collect();
        assert_eq!(lines[0], format!("[return] {}", listed.join(" ")));
        assert_eq!(lines[1], format!("[+8 more: #{} to #{}]", ids[32], ids[39]));
        assert!(lines[2].starts_with("never reached "));
    }

    #[test]
    fn rn2_a_return_note_with_a_long_cause_stays_within_8192_bytes() {
        let ids: Vec<u32> = (1000..1040).collect();
        let body = return_note_body(&ids, "m", &"é".repeat(10_000));
        assert!(body.len() <= 8192, "{}", body.len());
        assert!(body.ends_with("é [cut]"));
        assert!(body.contains("[+8 more: #1032 to #1039]"));
        assert!(body.contains("#1031\n"));
    }
}
