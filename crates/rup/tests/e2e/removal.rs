//! Shared RPC setup and reads for coordinated Workstream removal proofs.
use crate::daemon::Project;
use contracts::agent::RailNode;
use contracts::todo::Todo;
use serde_json::{Value, json};

pub(super) async fn workstream(client: &rpc::Client, name: &str) -> String {
    let node = client
        .request(
            "rail.createWorkstream",
            json!({ "name": name, "parent": null }),
        )
        .await
        .unwrap();
    node["id"].as_str().unwrap().to_owned()
}

pub(super) async fn agent_in(project: &Project, client: &rpc::Client, parent: &str) -> String {
    let node = client
        .request(
            "agent.spawn",
            json!({ "cwd": project.dir.path(), "prompt": null, "parent": parent }),
        )
        .await
        .unwrap();
    serde_json::from_value::<RailNode>(node).unwrap().id
}

pub(super) async fn todo_in(
    client: &rpc::Client,
    title: &str,
    home: Option<&str>,
    done: bool,
) -> u32 {
    let todo = client
        .request("todo.create", json!({ "title": title }))
        .await
        .unwrap();
    let id = serde_json::from_value::<Todo>(todo).unwrap().id;
    client
        .request("todo.move", json!({ "id": id, "home": home }))
        .await
        .unwrap();
    if done {
        client
            .request("todo.complete", json!({ "id": id }))
            .await
            .unwrap();
    }
    id
}

pub(super) async fn todos(client: &rpc::Client) -> Vec<Todo> {
    serde_json::from_value(client.request("todo.list", json!(null)).await.unwrap()).unwrap()
}

pub(super) async fn pad_in(client: &rpc::Client, name: &str, home: &str, _actor: Option<&str>) {
    client
        .request("pad.create", json!({ "name": name }))
        .await
        .unwrap();
    client
        .request("pad.move", json!({ "name": name, "home": home }))
        .await
        .unwrap();
}

pub(super) async fn pads(client: &rpc::Client) -> Vec<(String, Value)> {
    let listed = client.request("pad.list", json!(null)).await.unwrap();
    let mut pads: Vec<_> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|pad| {
            (
                pad["name"].as_str().unwrap().to_owned(),
                pad["home"].clone(),
            )
        })
        .collect();
    pads.sort_by(|a, b| a.0.cmp(&b.0));
    pads
}
