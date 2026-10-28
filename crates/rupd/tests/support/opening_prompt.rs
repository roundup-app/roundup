//! A4452c: saved Opening prompts through the existing Door test harness.
use super::{
    child_run::{BOUND, Run},
    door_terminals::{idle, recorded_bytes},
};
use serde_json::{Value, json};

async fn door(prompt: Option<&str>) -> Run {
    let mut run = Run::start().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let node = run
        .user
        .request(
            "rail.createWorkstream",
            json!({"name":"team","parent":null}),
        )
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().to_owned();
    run.user
        .request(
            "workstream.setOpeningPrompt",
            json!({"id":run.child,"prompt":prompt}),
        )
        .await
        .unwrap();
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    let node = run
        .user
        .request("rail.startDoor", json!({"id":run.child}))
        .await
        .unwrap();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(&run).await;
    run
}

async fn restart(run: &mut Run, request: &str) -> Result<Value, rpc::RpcError> {
    let node = run
        .user
        .request(
            "workstream.restart",
            json!({"id":run.child,"request":request}),
        )
        .await?;
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(run).await;
    Ok(node)
}

#[tokio::test]
async fn a4452c_restart_sends_exactly_the_saved_prompt_once() {
    let prompt = "  /compose exact words\nKeep spacing  ";
    let mut run = door(Some(prompt)).await;
    let child = run
        .user
        .request(
            "agent.spawn",
            json!({"name":"retained child","cwd":run.dir.path(),"parent":run.child}),
        )
        .await
        .unwrap();
    let todo = run
        .user
        .request("todo.create", json!({"title":"retained task"}))
        .await
        .unwrap();
    let todo = run
        .user
        .request("todo.move", json!({"id":todo["id"],"home":run.child}))
        .await
        .unwrap();
    let pad = run
        .user
        .request(
            "pad.create",
            json!({"name":"retained pad","text":"unchanged"}),
        )
        .await
        .unwrap();
    run.user
        .request("pad.move", json!({"name":"retained pad","home":run.child}))
        .await
        .unwrap();
    run.user
        .request("rail.rename", json!({"id":run.child,"name":"Fresh team"}))
        .await
        .unwrap();
    let before = run.attempt.clone();
    let node = restart(&mut run, "fresh-1").await.unwrap();
    assert_ne!(node["attempt"], before);
    assert_eq!(node["opening_prompt"], prompt);
    tokio::time::timeout(BOUND, async {
        let inbox = run.dir.path().join(format!("received-{}.jsonl", run.child));
        loop {
            if std::fs::read_to_string(&inbox).is_ok_and(|text| {
                text.lines().any(|line| {
                    line.contains("roundup-context")
                        && line.contains("Your Rail name is Fresh team")
                })
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("fresh Context reaches the Claude inbox");
    let expected = format!("\x1b[200~{prompt}\x1b[201~\r").into_bytes();
    assert_eq!(recorded_bytes(&run).await, expected);
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == child["id"]
                && n["terminal_id"] == child["terminal_id"]
                && n["parent"] == run.child)
    );
    let todos = run.user.request("todo.list", ()).await.unwrap();
    assert!(todos.as_array().unwrap().contains(&todo));
    let pads = run.user.request("pad.list", ()).await.unwrap();
    assert!(
        pads.as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == pad["name"]
                && p["text"] == "unchanged"
                && p["home"] == run.child)
    );
    let retried = restart(&mut run, "fresh-1").await.unwrap();
    assert_eq!(retried["attempt"], node["attempt"]);
    assert_eq!(recorded_bytes(&run).await, expected);
    run.finish().await;
}

#[tokio::test]
async fn a4452c_no_saved_prompt_starts_idle() {
    let mut run = door(None).await;
    restart(&mut run, "empty-1").await.unwrap();
    assert!(recorded_bytes(&run).await.is_empty());
    run.finish().await;
}

#[tokio::test]
async fn a4452c_failed_recording_retries_without_another_physical_write() {
    let mut run = door(Some("Keep this exact prompt")).await;
    std::fs::write(
        run.dir.path().join("messages-fault"),
        "record_restart_prompt",
    )
    .unwrap();
    assert!(restart(&mut run, "record-1").await.is_err());
    std::fs::remove_file(run.dir.path().join("messages-fault")).unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let failed = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap();
    run.terminal = failed["terminal_id"].clone();
    let written = recorded_bytes(&run).await;
    let retried = restart(&mut run, "record-1").await.unwrap();
    assert_eq!(retried["attempt"], failed["attempt"]);
    assert_eq!(recorded_bytes(&run).await, written);
    assert_eq!(
        recorded_bytes(&run).await,
        b"\x1b[200~Keep this exact prompt\x1b[201~\r"
    );
    run.finish().await;
}

#[tokio::test]
async fn a4452c_agent_cannot_restart_or_edit_the_opening_prompt() {
    let run = door(Some("User's saved text")).await;
    let agent = rpc::Client::connect(&run.daemon.socket).await.unwrap();
    agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    for (method, params) in [
        (
            "workstream.restart",
            json!({"id":run.child,"request":"agent-1"}),
        ),
        (
            "workstream.setOpeningPrompt",
            json!({"id":run.child,"prompt":"Agent text"}),
        ),
    ] {
        let error = agent.request(method, params).await.unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN, "{error}");
    }
    run.finish().await;
}

#[tokio::test]
async fn a4452c_unknown_input_outcome_never_retypes_on_retry() {
    let mut run = door(Some("Only once")).await;
    std::fs::write(run.dir.path().join("input-gate"), "flush").unwrap();
    assert!(restart(&mut run, "unknown-1").await.is_err());
    std::fs::remove_file(run.dir.path().join("input-gate")).unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let node = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap();
    run.terminal = node["terminal_id"].clone();
    let written = recorded_bytes(&run).await;
    assert!(restart(&mut run, "unknown-1").await.is_err());
    assert_eq!(recorded_bytes(&run).await, written);
    assert_eq!(written, b"\x1b[200~Only once\x1b[201~");
    run.finish().await;
}
