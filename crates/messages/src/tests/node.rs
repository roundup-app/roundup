//! Rail fixtures for Message scenarios.
use super::*;

pub(super) fn node(id: &str, kind: NodeKind, _door: bool, status: Option<Status>) -> RailNode {
    RailNode {
        id: id.into(),
        auto: (kind == NodeKind::Workstream).then_some(false),
        kind,
        name: id.into(),
        parent: None,
        order: 0,
        status,
        attempt: Some("1".into()),
        status_revision: Some("1".into()),
        terminal_id: None,
        worktree: None,
        can_resume: false,
        yolo: false,
        channel: None,
        stray: Vec::new(),
        model: None,
        effort: None,
        work: None,
        iteration: None,
        inbox: None,
        tool_call: None,
        overview: None,
    }
}
