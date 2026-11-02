//! Receiver lifecycle reconciliation and pending inbox delivery.

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
                        on_status(
                            &inner,
                            &status.id,
                            &status.attempt,
                            &status.status_revision,
                            status.status.kind,
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

pub(super) async fn on_status(
    inner: &Arc<Inner>,
    agent: &str,
    attempt: &str,
    revision: &str,
    kind: Kind,
) {
    let at = (
        contracts::agent::parse_positive_ordinal(attempt).expect("wire Attempt"),
        contracts::agent::parse_positive_ordinal(revision).expect("wire Status revision"),
    );
    // StopFailure ends a turn, not its Terminal. Read authoritative liveness so a late
    // error cannot reopen an exited Attempt or close a resumed one.
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
            matches!(kind, Kind::Idle | Kind::Blocked),
        )
    };
    {
        let mut store = lock(&inner.store);
        if let Err(cause) = (inner.fault)("on_status") {
            panic!("{cause}");
        }
        reconcile(inner, &mut store, agent, at, closed, false, false).expect("message store");
    }
    if !closed && ready {
        on_idle(inner, agent, at, Pick::Next).await;
    }
}

/// Resync after bus lag or Rail changes so missed endings cannot leave Messages deliverable.
/// A failed Rail read is retried on the next event; it never guesses that an Agent recovered.
async fn resync(inner: &Arc<Inner>) -> bool {
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
                true,
                true,
                false,
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

/// B2's `<sender's name>`: the Rail name for an Agent, since a Rail node can be renamed; the
/// Actor's id for the user (`you`), the Daemon and an Extension.
pub(super) async fn sender_name(inner: &Inner, from: &Actor) -> Result<String, RpcError> {
    if from.kind != ActorKind::Agent {
        return Ok(from.id.clone());
    }
    load_rail_nodes(inner).await?;
    lock(&inner.store).sender_name(&from.id)
}

/// B3563c: writes every pending Message to `agent`'s Claude inbox as one batch, in id order. The
/// inbox write leaves each in flight until its transcript receipt (B50); a missing or mismatched
/// inbox leaves them `pending` for the next eligible event.
///
/// `Pick::Fresh` is for work that became deliverable while its receiver was already `idle` (a
/// Message just sent or passed on to it): no `idle` event will follow for it, so the batch the next
/// `idle` would pick is written now, though its Status revision is the current one.
async fn on_idle(inner: &Arc<Inner>, agent: &str, at: store::Binding, pick: Pick) {
    let _delivery = inner.delivery.read().await;
    let state = match inner.inbox.get() {
        Some(inbox) => inbox.check(agent).await,
        None => contracts::agent::Inbox::Missing,
    };
    let found = {
        let store = lock(&inner.store);
        if matches!(
            step::retirement_event(
                store.retirement(agent).expect("message store").is_some(),
                step::restart_event(
                    store.is_reserved(agent).expect("message store"),
                    Event::Idle
                )
            ),
            Event::Busy
        ) || store.require_generation(agent, at).is_err()
        {
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
        let batch = pending
            .into_iter()
            .filter(|m| ids.contains(&m.id))
            .collect::<Vec<_>>();
        // B5168f: a batch of Quiet Digests alone starts no turn; it rides the next delivery.
        let given = batch
            .iter()
            .any(|m| pushes::is_digest(&m.from, &m.body))
            .then(|| store.delivered_to(agent))
            .transpose()
            .expect("message store")
            .unwrap_or_default();
        if batch
            .iter()
            .all(|m| receiver_view::is_quiet_digest(&given, m))
        {
            return;
        }
        batch
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
            && node
                .status
                .as_ref()
                .is_some_and(|s| matches!(s.kind, Kind::Idle | Kind::Blocked | Kind::Error))
    }) {
        on_idle(inner, agent, binding(node), Pick::Fresh).await;
    }
}

pub(super) fn binding(node: &RailNode) -> store::Binding {
    (
        node.attempt.as_deref().map_or(0, |n| {
            contracts::agent::parse_positive_ordinal(n).expect("Rail Attempt")
        }),
        node.status_revision.as_deref().map_or(0, |n| {
            contracts::agent::parse_positive_ordinal(n).expect("Rail Status revision")
        }),
    )
}

pub(super) fn ended(node: &RailNode) -> bool {
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
        && (node.status_revision.is_none() || poisoned)
    {
        store.atomically(|store| {
            for message in store.list_pending_to(&node.id)? {
                if store.bound(message.id)?.0 == at.0 {
                    store.bind(message.id, (at.0, 0))?;
                }
            }
            if poisoned {
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
        ended(node),
        permanently_ended(node),
        restart,
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

pub(super) fn reconcile(
    inner: &Inner,
    store: &mut Store,
    agent: &str,
    at: store::Binding,
    closed: bool,
    permanent: bool,
    restart: bool,
) -> Result<(), RpcError> {
    let mut events = Vec::new();
    let result = reconcile_into(store, agent, at, closed, permanent, restart, &mut events);
    for event in events {
        inner.bus.emit(Actor::daemon(), event);
    }
    result
}

fn reconcile_into(
    store: &mut Store,
    agent: &str,
    at: store::Binding,
    closed: bool,
    permanent: bool,
    restart: bool,
    events: &mut Vec<EventData>,
) -> Result<(), RpcError> {
    let previous = store.generation(agent)?;
    let reserved = store.is_reserved(agent)?;
    let retiring = store.retirement(agent)?.is_some();
    let through = if permanent {
        Some((at.0, i64::MAX))
    } else if closed {
        Some(at)
    } else if previous.is_none_or(|state| state.attempt < at.0) {
        Some((at.0.saturating_sub(1), i64::MAX))
    } else {
        None
    };
    if let Some(through) = through.filter(|_| {
        matches!(
            step::retirement_event(retiring, step::restart_event(reserved, Event::ReceiverExit)),
            Event::ReceiverExit
        )
    }) {
        // B8: a Message written and not confirmed waits for the Agent to be resumed.
        let rebind = (through.0 < at.0).then_some((at.0, 0));
        let keep = Some(rebind);
        for message in store.drop_all_pending(
            agent,
            Reason::ReceiverGone,
            through,
            gone_drops,
            keep,
            restart,
        )? {
            events.push(EventData::MessageDropped(message.into()));
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
    state.closed |= retiring || (permanent && !reserved);
    store.set_generation(agent, state)
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
