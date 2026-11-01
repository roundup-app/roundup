//! U5501: authoritative levels through the real Daemon's public calls.
#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use rpc::Client;
use serde_json::{Value, json};

async fn workstream(c: &Client, name: &str) -> String {
    c.request("rail.createWorkstream", json!({"name":name})).await.unwrap()["id"].as_str().unwrap().into()
}

async fn set(p: &daemon::Project, c: &Client, id: &str, level: &str) -> Result<Value, rpc::RpcError> {
    c.request("rail.setAlertLevel", json!({"project":p.dir.path(), "id":id, "level":level})).await
}

async fn levels(c: &Client) -> Vec<(String, Value)> {
    c.request("rail.tree", Value::Null).await.unwrap().as_array().unwrap().iter().map(|n| (n["id"].as_str().unwrap().into(), n["alert_level"].clone())).collect()
}

#[tokio::test]
async fn u5501_levels_survive_reopen_restart_and_home_move() {
    let mut p = daemon::start(&[]);
    let c = p.client().await;
    let home = workstream(&c, "Home").await;
    let a = p.spawn_agent(&c).await;
    assert_eq!(levels(&c).await.last().unwrap().1, "default");
    c.request("agent.stop", json!({"id":a.id})).await.unwrap();
    set(&p, &c, &a.id, "quiet").await.unwrap();
    c.request("rail.move", json!({"id":a.id,"parent":home,"index":0})).await.unwrap();
    // A fresh connection observes the acknowledged value, independent of the caller's lifetime.
    assert_eq!(levels(&p.client().await).await.last().unwrap().1, "quiet");
    p.close().await;
    p.restart(&[]);
    let c = p.client().await;
    let tree = daemon::rail_tree(&c).await;
    let agent = tree.iter().find(|n| n.id == a.id).unwrap();
    assert_eq!(agent.parent.as_deref(), Some(home.as_str()));
    assert_eq!(serde_json::to_value(agent).unwrap()["alert_level"], "quiet");
    assert!(tree.iter().all(|n| n.terminal_id.is_none()), "choosing/restoring levels starts no Agent");
}
