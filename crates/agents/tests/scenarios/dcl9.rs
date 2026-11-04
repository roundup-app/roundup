//! DCL9: every Agent's spawn names Job or Consult, which the Rail keeps across a reopen.

use contracts::{Actor, ActorKind};
use rpc::{Ctx, Module, RpcError, code};
use serde_json::{Value, json};

use crate::common::Fixture;

async fn spawn_as_agent(
    f: &Fixture,
    by: &str,
    extra: Value,
) -> Result<contracts::agent::RailNode, RpcError> {
    let mut ctx: Ctx = f.ctx();
    ctx.actor = Actor {
        kind: ActorKind::Agent,
        id: by.to_owned(),
        parent: None,
    };
    let mut params =
        json!({"cwd": f.dir.path(), "order": {"kind": "work", "ask": "ask", "limits": []}});
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let node = f.agents.call(&ctx, "agent.spawn", params).await?;
    Ok(serde_json::from_value(node).unwrap())
}

async fn role_of(f: &Fixture, id: &str) -> Value {
    f.call("agent.spawnPrompt", json!({"id": id}))
        .await
        .unwrap()["role"]
        .clone()
}

#[tokio::test]
async fn dcl9_spawn_requires_and_persists_job_or_consult() {
    let f = Fixture::new();
    let door = f.spawn(None, None).await.unwrap().id;

    for refused in [json!({}), json!({"role": "worker"}), json!({"role": null})] {
        let err = spawn_as_agent(&f, &door, refused).await.unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }
    assert_eq!(f.tree().await.len(), 1, "a refused spawn leaves no node");

    let job = spawn_as_agent(&f, &door, json!({"role": "job"}))
        .await
        .unwrap()
        .id;
    let consult = spawn_as_agent(&f, &door, json!({"role": "consult"}))
        .await
        .unwrap()
        .id;
    assert_eq!(role_of(&f, &job).await, json!("job"));
    assert_eq!(role_of(&f, &consult).await, json!("consult"));

    let f = f.reopen();
    assert_eq!(role_of(&f, &job).await, json!("job"));
    assert_eq!(role_of(&f, &consult).await, json!("consult"));

    // The user's own Agent has no role, and may not name one.
    let own = f.spawn(None, None).await.unwrap().id;
    assert_eq!(role_of(&f, &own).await, Value::Null);
    let err = f
        .call(
            "agent.spawn",
            json!({"cwd": f.dir.path(), "parent": null, "role": "job"}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
}
