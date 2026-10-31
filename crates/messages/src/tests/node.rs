//! Rail fixtures for Message scenarios.
use super::*;

pub(crate) fn node(id: &str, kind: NodeKind, _door: bool, status: Option<Status>) -> RailNode {
    RailNode {
        id: id.into(),
        auto: (kind == NodeKind::Workstream).then_some(false),
        opening_prompt: None,
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
        can_make_workstream: false,
        can_save_as_mode: false,
        yolo: false,
        channel: None,
        stray: Vec::new(),
        model: None,
        effort: None,
        work: None,
        inbox: None,
        tool_call: None,
        overview: None,
    }
}
