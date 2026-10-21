//! Starts, finds and reads the Doors and Workstreams a real Claude runs under.
use crate::daemon::{self, aimock, rail_tree};

use serde_json::{Value, json};

pub async fn as_door(project: &daemon::Project, door: &str) -> rpc::Client {
    let actor = project.client().await;
    actor
        .request(
            "daemon.identify",
            contracts::IdentifyParams {
                actor: contracts::Actor {
                    kind: contracts::ActorKind::Agent,
                    id: door.to_owned(),
                    parent: None,
                },
            },
        )
        .await
        .unwrap();
    actor
}

pub async fn child_of(client: &rpc::Client, parent: &str) -> String {
    rail_tree(client)
        .await
        .into_iter()
        .find(|node| node.parent.as_deref() == Some(parent))
        .unwrap()
        .id
}

pub async fn workstream(client: &rpc::Client, name: &str) -> String {
    client
        .request(
            "rail.createWorkstream",
            json!({"name": name, "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// The model requests with a user message holding `needle`.
pub fn requests_holding(model: &aimock::Model, needle: &str) -> usize {
    model
        .journal()
        .iter()
        .filter(|entry| user_texts(entry).iter().any(|text| text.contains(needle)))
        .count()
}

/// The text of each user message a model request carries, whole or in content blocks.
pub fn user_texts(entry: &Value) -> Vec<String> {
    entry["body"]["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|message| message["role"] == "user")
        .map(|message| match message["content"].as_array() {
            Some(blocks) => blocks
                .iter()
                .filter_map(|block| block["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n"),
            None => message["content"].as_str().unwrap_or_default().to_owned(),
        })
        .collect()
}

pub async fn started_door(client: &rpc::Client) -> String {
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
    door
}

pub fn conversation_entries(project: &daemon::Project) -> Vec<Value> {
    let mut entries = Vec::new();
    let projects = project.dir.path().join("claude-config/projects");
    if !projects.try_exists().expect("read transcript directory") {
        return entries;
    }
    for folder in std::fs::read_dir(projects).unwrap().flatten() {
        if !folder.path().is_dir() {
            continue;
        }
        for file in std::fs::read_dir(folder.path()).unwrap().flatten() {
            if file.path().extension().is_some_and(|ext| ext == "jsonl") {
                for line in std::fs::read_to_string(file.path()).unwrap().lines() {
                    if let Ok(entry) = serde_json::from_str::<Value>(line) {
                        entries.push(entry);
                    }
                }
            }
        }
    }
    entries
}
