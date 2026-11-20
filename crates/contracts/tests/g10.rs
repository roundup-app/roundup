//! G8, G10: `Worktree.adopted` is required, and no Agent tool reaches adoption.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use contracts::agent::Worktree;
use contracts::methods::{McpChoice, metadata};
use serde_json::json;

#[test]
fn g8_rail_node_worktree_is_required() {
    let own = json!({"path": "/p", "branch": "b", "base": "main"});
    assert!(serde_json::from_value::<Worktree>(own).is_err());
    let adopted = json!({"path": "/p", "branch": "b", "base": "main", "adopted": true});
    assert!(serde_json::from_value::<Worktree>(adopted).unwrap().adopted);
}

#[test]
fn g10_no_agent_tool_reaches_adoption() {
    for name in ["agent.adopt", "agent.adoptable"] {
        let method = metadata().into_iter().find(|m| m.name == name).unwrap();
        assert!(matches!(method.mcp, McpChoice::None(_)), "{name}");
    }
}
