//! DCL2: a Workstream's state, derived from its Door and every Agent below it, apart from the
//! Door's own Kind.

use parking_lot::Mutex;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use contracts::agent::{NodeKind, RailNode, WorkstreamState};
use contracts::{Actor, EventData, Kind};
use tokio::sync::broadcast::error::RecvError;

/// What one node's Status adds. A done node adds no active urgency, and `settled` is DCL6's.
fn contribution(kind: Kind) -> Option<WorkstreamState> {
    match kind {
        Kind::NeedsYou => Some(WorkstreamState::NeedsYou),
        Kind::Error => Some(WorkstreamState::Error),
        Kind::Working => Some(WorkstreamState::Working),
        Kind::Blocked => Some(WorkstreamState::Waiting),
        Kind::Idle => Some(WorkstreamState::Idle),
        Kind::Done => None,
    }
}

/// Set `workstream_state` on each Workstream of `nodes`.
pub(crate) fn derive(nodes: &mut [RailNode], stalled: &HashSet<String>) {
    let parents: HashMap<&str, Option<&str>> = nodes
        .iter()
        .map(|n| (n.id.as_str(), n.parent.as_deref()))
        .collect();
    let workstreams: HashSet<&str> = nodes
        .iter()
        .filter(|n| n.kind == NodeKind::Workstream)
        .map(|n| n.id.as_str())
        .collect();
    let mut states: HashMap<String, WorkstreamState> = HashMap::new();
    for node in nodes.iter() {
        let Some(mut add) = node.status.as_ref().and_then(|s| contribution(s.kind)) else {
            continue;
        };
        // DCL5: a working Agent with no activity is stalled, which outranks working.
        if add == WorkstreamState::Working && stalled.contains(&node.id) {
            add = WorkstreamState::Stalled;
        }
        // Walk up at most once per node; the bound guards a cyclic parent chain.
        let mut at = Some(node.id.as_str());
        for _ in 0..nodes.len() {
            let Some(id) = at else { break };
            if workstreams.contains(id) {
                states
                    .entry(id.to_owned())
                    .and_modify(|s| *s = (*s).min(add))
                    .or_insert(add);
            }
            at = parents.get(id).copied().flatten();
        }
    }
    for node in nodes.iter_mut() {
        if node.kind == NodeKind::Workstream {
            node.workstream_state = Some(
                states
                    .get(&node.id)
                    .copied()
                    .unwrap_or(WorkstreamState::Idle),
            );
        }
    }
}

/// DCL1, DCL2, DCL10, DCL5: the derived values of every row, set in the one place that computes them:
/// each row's delivery failure, each Workstream's waiting count and stalled label, then its state.
pub(crate) fn present(
    nodes: &mut [RailNode],
    counts: &HashMap<String, u32>,
    stalled: &HashSet<String>,
    messages: Option<&Arc<messages::Messages>>,
) {
    for node in nodes.iter_mut() {
        // DCL1: the cause rides the Agent's row and, through its Door, the Workstream's.
        let cause = messages.and_then(|messages| messages.delivery_failure(&node.id));
        node.unreachable = cause.map(str::to_owned);
        if node.kind == NodeKind::Workstream {
            node.waiting = counts
                .get(&node.id)
                .copied()
                .filter(|n| *n > 0 && messages::ended(node));
            if stalled.contains(&node.id)
                && let Some(status) = node.status.as_mut()
            {
                status.label = "stalled".into();
            }
        }
    }
    derive(nodes, stalled);
}

/// U6243a: what the App was last told of each row's derived values.
pub(crate) type Told =
    BTreeMap<String, (Option<WorkstreamState>, Option<u32>, Option<String>, bool)>;

/// U6243a: the derived values of a presented Rail.
pub(crate) fn told_of(nodes: &[RailNode]) -> Told {
    nodes
        .iter()
        .map(|n| {
            let stalled = n.kind == NodeKind::Workstream
                && n.status.as_ref().is_some_and(|s| s.label == "stalled");
            (
                n.id.clone(),
                (
                    n.workstream_state,
                    n.waiting,
                    n.unreachable.clone(),
                    stalled,
                ),
            )
        })
        .collect()
}

/// U6243a: the last told values, and a recheck for the one change that sends no event: a hook that
/// leaves a status as it was but clears a stall.
#[derive(Default)]
pub(crate) struct Tell {
    pub(crate) told: Mutex<Told>,
    pub(crate) recheck: tokio::sync::Notify,
}

/// U6243a: how often a pass compares the derived values with what was told, event or none, so a
/// stall bound that passes in silence still reaches the App (DCL4's period).
pub(crate) const TELL_PERIOD: Duration = Duration::from_secs(30);

/// U6243a: whether `data` can move a derived value (an Agent's status, background work, the queue,
/// the backlog, the Rail's shape).
fn moves_a_derived_value(data: &EventData) -> bool {
    matches!(
        data,
        EventData::AgentStatus(_)
            | EventData::RailChanged
            | EventData::WorkstreamQueueChanged
            | EventData::MessageSent(_)
            | EventData::MessageDelivered(_)
            | EventData::MessageDropped(_)
            | EventData::RouteChanged(_)
    )
}

/// U6243a: the Rail as `rail.tree` presents it, reduced to its derived values.
async fn derived_now(
    reader: &crate::digest::Reader,
    messages: &OnceLock<Arc<messages::Messages>>,
    agents: &agents::Agents,
) -> Option<Told> {
    let mut nodes = reader.rail().await.ok()?;
    let counts = match messages.get() {
        Some(messages) => messages.waiting_counts().await.ok()?,
        None => Default::default(),
    };
    present(
        &mut nodes,
        &counts,
        &agents.stalled(crate::facts::STALL_MS),
        messages.get(),
    );
    Some(told_of(&nodes))
}

/// U6243a: emit `rail.changed` when, and only when, a derived value differs from the last told one
/// (kept in `tell`). A pass also runs each `TELL_PERIOD`, since a stall bound or a delivery
/// failure can pass with no event. Runs until the Bus closes.
pub(crate) async fn tell_changes(
    reader: crate::digest::Reader,
    messages: Arc<OnceLock<Arc<messages::Messages>>>,
    agents: Arc<agents::Agents>,
    bus: rpc::Bus,
    tell: Arc<Tell>,
    mut events: tokio::sync::broadcast::Receiver<contracts::Event>,
) {
    if let Some(now) = derived_now(&reader, &messages, &agents).await {
        *tell.told.lock() = now;
    }
    let mut timer =
        tokio::time::interval_at(tokio::time::Instant::now() + TELL_PERIOD, TELL_PERIOD);
    loop {
        tokio::select! {
            _ = timer.tick() => {}
            () = tell.recheck.notified() => {}
            received = events.recv() => match received {
                Ok(event) if moves_a_derived_value(&event.data) => {
                    // A burst is judged once.
                    while events.try_recv().is_ok() {}
                }
                Ok(_) => continue,
                Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => return,
            },
        }
        let Some(now) = derived_now(&reader, &messages, &agents).await else {
            continue;
        };
        let changed = {
            let mut last = tell.told.lock();
            // A row that came or went is the Rail's shape, which `rail.changed` already told.
            let changed = now
                .iter()
                .any(|(id, value)| last.get(id).is_some_and(|v| v != value));
            *last = now;
            changed
        };
        if changed {
            bus.emit(Actor::daemon(), EventData::RailChanged);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, kind: &str, parent: Option<&str>, status: &str) -> RailNode {
        serde_json::from_value(serde_json::json!({
            "id": id, "kind": kind, "name": id, "parent": parent, "order": 0,
            "status": {"kind": status, "label": "", "since": 1, "finished": "0"},
            "can_resume": false, "can_make_workstream": false, "can_save_as_mode": false,
            "yolo": false, "stray": [],
        }))
        .unwrap()
    }

    #[test]
    fn dcl2_stalled_child_outranks_working_and_yields_to_error() {
        let stalled = HashSet::from(["3".to_owned()]);
        let mut nodes = vec![
            node("1", "workstream", None, "idle"),
            node("2", "agent", Some("1"), "working"),
            node("3", "agent", Some("2"), "working"),
        ];
        derive(&mut nodes, &stalled);
        assert_eq!(nodes[0].workstream_state, Some(WorkstreamState::Stalled));
        nodes[2].status.as_mut().unwrap().kind = Kind::Error;
        derive(&mut nodes, &stalled);
        assert_eq!(nodes[0].workstream_state, Some(WorkstreamState::Error));
    }
}
