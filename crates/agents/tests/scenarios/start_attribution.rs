//! A5765e target-side persistence; cross-Project forwarding remains in #5765.
use crate::common::Fixture;
use serde_json::json;

fn attribution(agent: &str) -> serde_json::Value {
    json!({
        "project": "source-project-stable-id",
        "agent": agent,
        "project_name": "Source project",
        "agent_name": "Source builder"
    })
}

#[tokio::test]
async fn a5765e_workstream_attribution_survives_reopen_as_a_mode() {
    let f = Fixture::new();
    let source = attribution("1");
    let created = f
        .call(
            "rail.createWorkstream",
            json!({
                "name": "Target work", "start_attribution": source
            }),
        )
        .await
        .unwrap();
    assert_eq!(created["start_attribution"], source);
    let id = created["id"].as_str().unwrap();
    f.call(
        "workstream.setOpeningPrompt",
        json!({"id": id, "prompt": "Saved Mode prompt"}),
    )
    .await
    .unwrap();
    let f = f.reopen();
    let read = f.call("rail.tree", serde_json::Value::Null).await.unwrap();
    let node = read
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == created["id"])
        .unwrap();
    assert_eq!(node["start_attribution"], source);
    assert_eq!(node["opening_prompt"], "Saved Mode prompt");
}
