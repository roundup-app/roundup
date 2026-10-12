//! A34: removing a Workstream deletes its done Todos and the Pads no kept Agent owns, against a
//! real `rupd`.

#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use contracts::agent::RailNode;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind};
use daemon::{Project, start};
use serde_json::{Value, json};

async fn workstream(client: &rpc::Client, name: &str) -> String {
    let node = client
        .request(
            "rail.createWorkstream",
            json!({ "name": name, "parent": null }),
        )
        .await
        .unwrap();
    node["id"].as_str().unwrap().to_owned()
}

async fn agent_in(project: &Project, client: &rpc::Client, parent: &str) -> String {
    let node = client
        .request(
            "agent.spawn",
            json!({ "cwd": project.dir.path(), "prompt": null, "parent": parent }),
        )
        .await
        .unwrap();
    serde_json::from_value::<RailNode>(node).unwrap().id
}

async fn todo_in(client: &rpc::Client, title: &str, home: Option<&str>, done: bool) -> u32 {
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

async fn todos(client: &rpc::Client) -> Vec<Todo> {
    serde_json::from_value(client.request("todo.list", json!(null)).await.unwrap()).unwrap()
}

async fn pad_in(client: &rpc::Client, name: &str, home: &str, owner: Option<&str>) {
    client
        .request("pad.create", json!({ "name": name }))
        .await
        .unwrap();
    if let Some(owner) = owner {
        let owner = Actor {
            kind: ActorKind::Agent,
            id: owner.to_owned(),
            parent: None,
        };
        client
            .request("pad.setOwner", json!({ "name": name, "owner": owner }))
            .await
            .unwrap();
    }
    client
        .request("pad.move", json!({ "name": name, "home": home }))
        .await
        .unwrap();
}

async fn pads(client: &rpc::Client) -> Vec<(String, Value)> {
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

#[tokio::test]
async fn a34_done_todos_are_deleted_and_open_ones_move() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let finished = todo_in(&client, "finished", Some(&ws), true).await;
    let open = todo_in(&client, "open", Some(&ws), false).await;

    let removal = client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    assert_eq!(
        removal,
        json!({
            "removed": [{"id": finished.to_string(), "kind": "todo", "name": "finished"}],
            "kept": [{"id": open.to_string(), "kind": "todo", "name": "open", "reason": "open"}],
        })
    );
    let left = todos(&client).await;
    assert_eq!(left.len(), 1);
    assert_eq!((left[0].id, left[0].home.clone()), (open, None));
}

#[tokio::test]
async fn a34_a_blocker_deleted_leaves_the_kept_todos_list() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let blocker = todo_in(&client, "blocker", Some(&ws), true).await;
    let kept = todo_in(&client, "kept", Some(&ws), false).await;
    client
        .request(
            "todo.setBlockers",
            json!({ "id": kept, "blockers": [blocker] }),
        )
        .await
        .unwrap();

    client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    let left = todos(&client).await;
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].blockers, Vec::<u32>::new());
    assert!(!left[0].blocked);
}

#[tokio::test]
async fn a34_pads_follow_a_kept_agent_and_the_rest_go() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let running = agent_in(&project, &client, &ws).await;
    let stopped = agent_in(&project, &client, &ws).await;
    client
        .request("agent.stop", json!({ "id": stopped }))
        .await
        .unwrap();
    pad_in(&client, "by-running", &ws, Some(&running)).await;
    pad_in(&client, "by-stopped", &ws, Some(&stopped)).await;
    pad_in(&client, "by-user", &ws, None).await;

    let removal = client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    assert_eq!(
        pads(&client).await,
        [("by-running".to_owned(), Value::Null)]
    );
    let kept: Vec<&Value> = removal["kept"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "pad")
        .collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0]["name"], "by-running");
    assert_eq!(kept[0]["reason"], "running");
    let gone: Vec<&str> = removal["removed"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "pad")
        .map(|item| item["name"].as_str().unwrap())
        .collect();
    assert_eq!(gone, ["by-stopped", "by-user"]);
}

#[tokio::test]
async fn a34_other_workstreams_are_untouched() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let other = workstream(&client, "other").await;
    let theirs = todo_in(&client, "theirs", Some(&other), true).await;
    let rooted = todo_in(&client, "rooted", None, true).await;
    pad_in(&client, "theirs", &other, None).await;
    client
        .request("pad.create", json!({ "name": "rooted" }))
        .await
        .unwrap();

    client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    let ids: Vec<u32> = todos(&client).await.into_iter().map(|t| t.id).collect();
    assert_eq!(ids, [theirs, rooted]);
    assert_eq!(
        pads(&client).await,
        [
            ("rooted".to_owned(), Value::Null),
            ("theirs".to_owned(), json!(other))
        ]
    );
}

#[tokio::test]
async fn a34_removing_an_agent_still_returns_null() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let agent = agent_in(&project, &client, &ws).await;

    let result = client
        .request("rail.remove", json!({ "id": agent }))
        .await
        .unwrap();

    assert_eq!(result, Value::Null);
}
