//! MC70: `machine.add` is a method the App calls and a Door's tool; `machine.remove` is the App's alone.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use contracts::methods::{McpChoice, metadata, owner_namespace};

#[test]
fn mc70_machine_add_is_callable_by_the_app_and_a_door() {
    let tool = |name: &str| {
        metadata()
            .into_iter()
            .find(|method| method.name == name)
            .unwrap()
            .mcp
    };

    assert!(owner_namespace("machine.add").is_some());
    assert!(matches!(tool("machine.add"), McpChoice::Door));
    assert!(matches!(tool("machine.remove"), McpChoice::None(_)));
}
