//! Rail fixtures for Message scenarios.
use super::*;
use contracts::agent::{AgentNode, DoorFacts, NodeBase, Role, WorkstreamNode};

pub(crate) fn node(id: &str, kind: NodeKind, _door: bool, status: Option<Status>) -> RailNode {
    let door = DoorFacts {
        status,
        attempt: Some(contracts::agent::Ordinal::parse("1").unwrap()),
        status_revision: Some(contracts::agent::Ordinal::parse("1").unwrap()),
        ..Default::default()
    };
    let role = match kind {
        NodeKind::Group => Role::Group,
        NodeKind::Workstream => Role::Workstream(WorkstreamNode {
            door,
            ..Default::default()
        }),
        NodeKind::Agent => Role::Agent(AgentNode {
            door,
            ..Default::default()
        }),
    };
    RailNode {
        base: NodeBase {
            id: id.into(),
            name: id.into(),
            ..Default::default()
        },
        role,
    }
}

/// The same facts as a Workstream's Door.
pub(crate) fn workstream(node: RailNode) -> RailNode {
    let door = node.door().cloned().unwrap_or_default();
    RailNode {
        role: Role::Workstream(WorkstreamNode {
            door,
            ..Default::default()
        }),
        ..node
    }
}

/// The node with its Door facts changed by `change`.
pub(crate) fn edit(mut node: RailNode, change: impl FnOnce(&mut DoorFacts)) -> RailNode {
    change(node.door_mut().expect("a node with Door facts"));
    node
}

/// The node at Attempt `attempt`, Status revision `revision`.
pub(crate) fn at(node: RailNode, attempt: &str, revision: &str) -> RailNode {
    edit(node, |door| {
        door.attempt = contracts::agent::Ordinal::parse(attempt);
        door.status_revision = contracts::agent::Ordinal::parse(revision);
    })
}
