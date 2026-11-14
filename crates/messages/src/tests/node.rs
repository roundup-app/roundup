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

/// RO5: `ended` over every kind and Status gives what the old four-option test gave.
#[test]
fn ro5_ended_matches_the_old_four_option_test() {
    use crate::delivery::ended;
    let statuses = [
        None,
        Some(Status {
            kind: Kind::Working,
            label: "w".into(),
            since: 0,
            finished: "0".into(),
        }),
        Some(Status {
            kind: Kind::Idle,
            label: "i".into(),
            since: 0,
            finished: "0".into(),
        }),
        Some(Status {
            kind: Kind::Done,
            label: "d".into(),
            since: 0,
            finished: "0".into(),
        }),
        Some(Status {
            kind: Kind::Error,
            label: "e".into(),
            since: 0,
            finished: "0".into(),
        }),
    ];
    for kind in [NodeKind::Group, NodeKind::Workstream, NodeKind::Agent] {
        for status in &statuses {
            for revision in [false, true] {
                for terminal in [false, true] {
                    let mut n = node("n", kind, false, status.clone());
                    if let Some(door) = n.door_mut() {
                        door.status_revision =
                            revision.then(|| contracts::agent::Ordinal::parse("1").unwrap());
                        door.terminal_id = terminal.then(|| "t".to_owned());
                    }
                    let (st, rev, term) = match n.door() {
                        Some(d) => (
                            d.status.clone(),
                            d.status_revision.is_some(),
                            d.terminal_id.is_some(),
                        ),
                        None => (None, false, false),
                    };
                    let old = ((!rev || st.is_none()) && !term)
                        || st.as_ref().is_some_and(|s| {
                            s.kind == Kind::Done || (s.kind == Kind::Error && !term)
                        });
                    assert_eq!(ended(&n), old, "{kind:?} {st:?} {revision} {terminal}");
                }
            }
        }
    }
}
