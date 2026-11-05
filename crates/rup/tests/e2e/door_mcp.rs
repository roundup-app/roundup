//! B24 through the real Daemon and the pinned Claude behind aimock: a Door reads its
//! Brief, calls its tools over MCP,.

use contracts::todo::Todo;
use contracts::{Actor, ActorKind, EventData};
use serde_json::json;

use super::daemon::{self, Project};
use crate::{HOLD_PLAIN, REDUCE, SHOW_ME};

#[tokio::test]
async fn b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp() {
    let project = daemon::start_real(
        "b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp",
        &[],
    );
    let mut client = project.subscribed().await;
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name": "workstream", "parent": null, "order":{"kind":"work","ask":"What is this Workstream for?","limits":[]}}),
        )
        .await
        .unwrap();
    let door = workstream["id"].as_str().unwrap().to_owned();
    client
        .request("rail.startDoor", json!({ "id": door }))
        .await
        .unwrap();

    let updated = project
        .next(&mut client, |data| match data {
            EventData::TodoUpdated(todo) if !todo.body.is_empty() => Some(todo),
            _ => None,
        })
        .await;
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_update_todo").await;
    assert!(
        result["content"]
            .as_str()
            .unwrap()
            .contains("owned files: none yet"),
        "{result}"
    );
    let journal = model.journal();
    let request = &journal
        .iter()
        .find(|entry| entry["body"]["tools"].is_array())
        .unwrap()["body"];
    let brief = request["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "system")
        .map(|m| m["content"].as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(brief.contains("coordinating Door"), "{request}");
    assert!(
        !brief.contains(HOLD_PLAIN),
        "LC3: the Door's Brief omits the pinned hold:Plain body"
    );
    assert!(
        brief.contains(REDUCE) && brief.contains(SHOW_ME),
        "Q6: the pinned reduce and show-me bodies"
    );
    assert!(!brief.contains(&format!("Agent id is {door}")));
    assert_eq!(updated.title, "plan the workstream");
    assert_eq!(updated.body, "owned files: none yet");
    assert_eq!(
        updated.creator,
        Actor {
            kind: ActorKind::Agent,
            id: door,
            parent: None
        }
    );
    let stored: Vec<Todo> = serde_json::from_value(
        project
            .client()
            .await
            .request("todo.list", json!(null))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(
        (&stored[0].title, &stored[0].body),
        (&updated.title, &updated.body)
    );
}
