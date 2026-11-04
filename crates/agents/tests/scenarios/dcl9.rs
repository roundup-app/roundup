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

/// The Attempts of the reports each Agent has retained, as the Messages store reads them.
fn reports(of: &[(&str, Vec<&str>)]) -> impl Fn(&str) -> Result<Vec<String>, RpcError> + use<> {
    let of: Vec<(String, Vec<String>)> = of
        .iter()
        .map(|(id, attempts)| {
            (
                (*id).to_owned(),
                attempts.iter().map(|a| (*a).to_owned()).collect(),
            )
        })
        .collect();
    move |id| {
        Ok(of
            .iter()
            .find(|(agent, _)| agent == id)
            .map(|(_, attempts)| attempts.clone())
            .unwrap_or_default())
    }
}

#[tokio::test]
async fn dcl9_idle_job_without_report_is_actionable_consult_idle_is_rest() {
    let f = Fixture::new();
    let door = f.spawn(None, None).await.unwrap().id;
    let job = spawn_as_agent(&f, &door, json!({"role": "job"}))
        .await
        .unwrap()
        .id;
    let consult = spawn_as_agent(&f, &door, json!({"role": "consult"}))
        .await
        .unwrap()
        .id;
    let attempt = f.attempt(&job).await;

    // A question alone is no report: the Job's idle is one stop fact, the same on every pass.
    let none = reports(&[]);
    let stop = f
        .agents
        .idle_stop(&job, &none)
        .unwrap()
        .expect("a stop fact");
    assert_eq!(
        (stop.agent.as_str(), stop.attempt.as_str()),
        (job.as_str(), attempt.as_str())
    );
    assert_eq!(f.agents.idle_stop(&job, &none).unwrap(), Some(stop));

    // A Consult's idle, and the Door's own, are rest.
    assert_eq!(f.agents.idle_stop(&consult, &none).unwrap(), None);
    assert_eq!(f.agents.idle_stop(&door, &none).unwrap(), None);

    // An earlier Attempt's report does not complete this one; the current Attempt's does.
    let earlier = reports(&[(job.as_str(), vec!["0"])]);
    assert!(f.agents.idle_stop(&job, &earlier).unwrap().is_some());
    let current = reports(&[(job.as_str(), vec![attempt.as_str()])]);
    assert_eq!(f.agents.idle_stop(&job, &current).unwrap(), None);
}

async fn attempts_of(f: &Fixture, ids: &[String]) -> Vec<String> {
    let mut seen = Vec::new();
    for id in ids {
        seen.push(f.attempt(id).await);
    }
    seen
}

#[tokio::test]
async fn dcl9_restart_preserves_roles_without_launching_agents() {
    let f = Fixture::new();
    let door = f.spawn(None, None).await.unwrap().id;
    let job = spawn_as_agent(&f, &door, json!({"role": "job"}))
        .await
        .unwrap()
        .id;
    let done = spawn_as_agent(&f, &door, json!({"role": "job"}))
        .await
        .unwrap()
        .id;
    let consult = spawn_as_agent(&f, &door, json!({"role": "consult"}))
        .await
        .unwrap()
        .id;
    let ids = [job.clone(), done.clone(), consult.clone()];
    let before = attempts_of(&f, &ids).await;
    let done_attempt = before[1].clone();

    let f = f.reopen();
    let reported = reports(&[(done.as_str(), vec![done_attempt.as_str()])]);
    let open = f.agents.open_jobs(&reported).unwrap();
    assert_eq!(
        open.iter().map(|j| j.id.as_str()).collect::<Vec<_>>(),
        [job.as_str()],
        "the unreported Job is open; a reported Job and a Consult are not"
    );
    assert_eq!(role_of(&f, &consult).await, json!("consult"));
    assert_eq!(
        attempts_of(&f, &ids).await,
        before,
        "no Agent was resumed or started"
    );
    assert!(f.inbox().is_empty());
}
