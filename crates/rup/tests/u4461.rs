//! U4461: explicit Remove all through the real Daemon.
#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;
#[path = "e2e/removal.rs"]
mod removal;
use daemon::start;
use removal::{agent_in, pad_in, pads, todo_in, todos, workstream};
use serde_json::{Value, json};

#[tokio::test]
async fn u4461_remove_all_stops_and_removes_a_running_agent_with_its_todos_and_pads() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "all").await;
    let agent = agent_in(&project, &client, &ws).await;
    let child_client = project.client().await;
    child_client
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":agent,"parent":null}}),
        )
        .await
        .unwrap();
    let nested = child_client.request("agent.spawn", json!({"cwd":project.dir.path(),"parent":agent,"prompt":"nested", "order":{"kind":"work","ask":"nested","limits":[]}})).await.unwrap()["id"].as_str().unwrap().to_owned();
    let open = todo_in(&client, "open", Some(&ws), false).await;
    let done = todo_in(&client, "done", Some(&ws), true).await;
    pad_in(&client, "owned", &ws, Some(&agent)).await;
    pad_in(&client, "user", &ws, None).await;
    let terminal = client
        .request("terminal.open", json!({"workstream":ws}))
        .await
        .unwrap();
    let result = client
        .request("rail.remove", json!({"id":ws,"scope":"all"}))
        .await
        .unwrap();
    assert_eq!(result["kept"], json!([]));
    let removed = result["removed"].as_array().unwrap();
    assert_eq!(removed.len(), 6);
    for (kind, id) in [
        ("agent", agent),
        ("agent", nested),
        ("todo", open.to_string()),
        ("todo", done.to_string()),
        ("pad", "owned".into()),
        ("pad", "user".into()),
    ] {
        assert!(
            removed
                .iter()
                .any(|item| item["id"] == id && item["kind"] == kind)
        );
    }
    assert_eq!(
        client.request("rail.tree", Value::Null).await.unwrap(),
        json!([])
    );
    assert!(todos(&client).await.is_empty());
    assert!(pads(&client).await.is_empty());
    let terminals = client.request("terminal.list", Value::Null).await.unwrap();
    assert!(
        !terminals
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == terminal["terminal_id"])
    );
    assert!(
        terminals
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["running"] != true)
    );
}

#[tokio::test]
async fn u4461_remove_all_leaves_other_workstreams_untouched() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "all").await;
    let other = workstream(&client, "other").await;
    let agent = agent_in(&project, &client, &other).await;
    let deleted = todo_in(&client, "deleted blocker", Some(&ws), false).await;
    let root = todo_in(&client, "root", None, false).await;
    let kept = todo_in(&client, "other", Some(&other), false).await;
    client
        .request("todo.setBlockers", json!({"id":kept,"blockers":[deleted]}))
        .await
        .unwrap();
    pad_in(&client, "other", &other, Some(&agent)).await;
    let before = client.request("rail.tree", Value::Null).await.unwrap();
    let pads_before = pads(&client).await;
    client
        .request("rail.remove", json!({"id":ws,"scope":"all"}))
        .await
        .unwrap();
    let expected: Vec<_> = before
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["id"] != ws)
        .cloned()
        .collect();
    let after = client.request("rail.tree", Value::Null).await.unwrap();
    // Removing a sibling compacts order; identity, ownership and live processes stay.
    for original in expected {
        let found = after
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == original["id"])
            .unwrap();
        assert_eq!(found["parent"], original["parent"]);
        assert_eq!(found["terminal_id"], original["terminal_id"]);
        assert_eq!(found["worktree"], original["worktree"]);
    }
    let left = todos(&client).await;
    assert_eq!(left.len(), 2);
    assert_eq!(left.iter().find(|t| t.id == root).unwrap().home, None);
    let remaining = left.iter().find(|t| t.id == kept).unwrap();
    assert_eq!(remaining.home.as_deref(), Some(other.as_str()));
    assert!(remaining.blockers.is_empty());
    assert!(!remaining.blocked);
    assert_eq!(pads(&client).await, pads_before);
}

#[tokio::test]
async fn u4461_an_operation_cannot_change_remove_all_to_remove_this() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "all").await;
    let open = todo_in(&client, "open", Some(&ws), false).await;
    let before = client.request("rail.tree", Value::Null).await.unwrap();
    let error = client
        .request(
            "rail.remove",
            json!({"id":ws,"scope":"all","operation":"chosen"}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::INVALID_PARAMS);
    assert_eq!(
        client.request("rail.tree", Value::Null).await.unwrap(),
        before
    );
    assert_eq!(
        todos(&client)
            .await
            .iter()
            .find(|t| t.id == open)
            .unwrap()
            .home
            .as_deref(),
        Some(ws.as_str())
    );
    assert_eq!(
        client
            .request(
                "rail.deletion",
                json!({"project":"unused","operation":"chosen"})
            )
            .await
            .unwrap(),
        Value::Null
    );
}
