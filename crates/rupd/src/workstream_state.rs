//! DCL2: a Workstream's state, derived from its Door and every Agent below it, apart from the
//! Door's own Kind.

use std::collections::{HashMap, HashSet};

use contracts::Kind;
use contracts::agent::{NodeKind, RailNode, WorkstreamState};

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
