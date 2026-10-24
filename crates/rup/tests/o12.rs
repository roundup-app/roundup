//! O12: real Claude must keep the Door's order separate from the user's words.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::{EventData, Kind};
use daemon::{next, rail_tree};
use serde_json::json;

#[tokio::test]
async fn o12_the_door_spawns_with_order_and_the_users_words() {
    const TYPED: &str = "fix the build, it fails on main since Friday";
    let project = daemon::start_real("o12_order", &[]);
    let mut client = project.subscribed().await;
    let door = client
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let mut working = false;
    loop {
        let kind = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == door => Some(status.status.kind),
            _ => None,
        })
        .await;
        working |= kind == Kind::Working;
        if working && kind == Kind::Idle {
            break;
        }
    }
    client
        .request(
            "message.send",
            json!({"to": door, "kind": "note", "body": TYPED}),
        )
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_o12_spawn").await;
    let spawned: contracts::agent::RailNode =
        serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    let journal = model.journal();
    let typed = journal
        .iter()
        .filter_map(|entry| entry["body"]["messages"].as_array())
        .flatten()
        .filter(|message| message["role"] == "user")
        .filter_map(|message| message["content"].as_str())
        .find(|text| text.contains(TYPED))
        .expect("the model received the user's words")
        .split_once("\">\n")
        .and_then(|(_, rest)| rest.split_once("\n</cross-session-message>"))
        .expect("Claude shows the delivered Message as a cross-session message")
        .0;
    assert_eq!(typed, TYPED);
    let stored = client
        .request("agent.spawnPrompt", json!({"id": spawned.id}))
        .await
        .unwrap();
    assert_eq!(stored["prompt"], typed);
    let tree = rail_tree(&client).await;
    let node = tree.iter().find(|node| node.id == spawned.id).unwrap();
    let order = serde_json::to_value(node).unwrap();
    assert_eq!(order["work"]["ask"], "Make the build pass on main.");
    assert_ne!(order["work"]["ask"], typed);
    assert_eq!(node.parent.as_deref(), Some(door.as_str()));
    let mut working = false;
    loop {
        let kind = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if status.id == spawned.id => Some(status.status.kind),
            _ => None,
        })
        .await;
        working |= kind == Kind::Working;
        if working && kind == Kind::Idle {
            break;
        }
    }
    model.assert_matched();
}
