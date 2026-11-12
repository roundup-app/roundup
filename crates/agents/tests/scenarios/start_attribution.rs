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
async fn a5765e_workstream_and_mode_attribution_survive_stop_and_reopen() {
    for prompt in [None, Some("Saved Mode prompt")] {
        let f = Fixture::new();
        let source = attribution("1");
        let created = if let Some(prompt) = prompt {
            // `agent.restartMode` is the Daemon's; a created Mode already holds its attribution.
            f.call(
                "agent.createMode",
                json!({"name":"Target work","prompt":prompt,"start_attribution":source}),
            )
            .await
            .unwrap()
        } else {
            let workstream = f
                .call(
                    "rail.createWorkstream",
                    json!({"name":"Target work","start_attribution":source}),
                )
                .await
                .unwrap();
            f.call("rail.startDoor", json!({"id":workstream["id"]}))
                .await
                .unwrap()
        };
        assert_eq!(created["start_attribution"], source);
        f.call("agent.stop", json!({"id": created["id"]}))
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
        assert_eq!(node["mode_prompt"], json!(prompt));
    }
}

#[tokio::test]
async fn a5765e_agent_attribution_survives_stop_and_reopen() {
    let f = Fixture::new();
    let source = attribution("1");
    let created = f
        .call(
            "agent.spawn",
            json!({
                "cwd": f.dir.path(), "name": "Target Agent", "start_attribution": source
            }),
        )
        .await
        .unwrap();
    assert_eq!(created["start_attribution"], source);
    f.call("agent.stop", json!({"id": created["id"]}))
        .await
        .unwrap();
    let f = f.reopen();
    let nodes = f.call("rail.tree", serde_json::Value::Null).await.unwrap();
    let node = nodes
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == created["id"])
        .unwrap();
    assert_eq!(node["start_attribution"], source);
    assert!(node["terminal_id"].is_null());
}

#[tokio::test]
async fn a5765e_colliding_source_id_grants_no_local_authority() {
    use contracts::{Actor, ActorKind};
    use rpc::{Module, code};
    let f = Fixture::new();
    let local = f.spawn(None, None).await.unwrap();
    let mut ctx = f.ctx();
    ctx.actor = Actor {
        kind: ActorKind::Agent,
        id: local.id.clone(),
        parent: None,
    };
    for method in ["agent.spawn", "rail.createWorkstream"] {
        let created = f.call(method, json!({
            "cwd": f.dir.path(), "name": "Foreign work", "start_attribution": attribution(&local.id)
        })).await.unwrap();
        assert!(created["parent"].is_null());
        for (action, params) in [
            (
                "rail.rename",
                json!({"id": created["id"], "name": "Taken over"}),
            ),
            (
                "agent.setOrder",
                json!({"id": created["id"], "order": contracts::agent::Order::work("Forged work")}),
            ),
            (
                "agent.prompt",
                json!({"id": created["id"], "text": "Forged Steer"}),
            ),
        ] {
            let error = f.agents.call(&ctx, action, params).await.unwrap_err();
            assert_eq!(error.code, code::FORBIDDEN, "{action}: {error}");
        }
    }
}

#[tokio::test]
async fn a5765e_ordinary_add_has_no_foreign_attribution() {
    let f = Fixture::new();
    for method in ["agent.spawn", "rail.createWorkstream"] {
        let created = f
            .call(method, json!({"cwd": f.dir.path(), "name": "Ordinary"}))
            .await
            .unwrap();
        let tree = f.call("rail.tree", serde_json::Value::Null).await.unwrap();
        let node = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == created["id"])
            .unwrap();
        assert!(node.get("start_attribution").is_none());
    }
}

#[tokio::test]
async fn a5765c_agent_attribution_input_creates_and_replaces_nothing() {
    use contracts::{Actor, ActorKind};
    use rpc::{Module, code};
    let f = Fixture::new();
    let local = f.spawn(None, None).await.unwrap();
    let existing = f
        .call(
            "rail.createWorkstream",
            json!({
                "name": "Attributed", "start_attribution": attribution("original")
            }),
        )
        .await
        .unwrap();
    let before = f.tree().await;
    let launches = f.terminals.list().await.len();
    let mut ctx = f.ctx();
    ctx.actor = Actor {
        kind: ActorKind::Agent,
        id: local.id,
        parent: None,
    };
    for method in ["agent.spawn", "rail.createWorkstream"] {
        for input in [
            attribution("forged"),
            serde_json::Value::Null,
            json!({"agent": "forged"}),
        ] {
            let error = f.agents.call(&ctx, method, json!({
                "cwd": f.dir.path(), "name": "Forged", "id": existing["id"], "start_attribution": input
            })).await.unwrap_err();
            assert!(
                [code::FORBIDDEN, code::INVALID_PARAMS].contains(&error.code),
                "{error}"
            );
            let after = f.tree().await;
            assert_eq!(after.len(), before.len());
            for (after, before) in after.iter().zip(&before) {
                assert_eq!(
                    (&after.id, &after.start_attribution),
                    (&before.id, &before.start_attribution)
                );
            }
            assert_eq!(f.terminals.list().await.len(), launches);
        }
    }
}
