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

async fn clear(run: &mut Run) {
    let mut watcher = rpc::Client::connect(&run.daemon.socket).await.unwrap();
    watcher.request("events.subscribe", ()).await.unwrap();
    run.user
        .request(
            "workstream.clear",
            json!({"id":run.child,"reason":"fresh start","without_handoff":true}),
        )
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            match watcher.next_event().await.unwrap().data {
                contracts::EventData::WorkstreamCleared(done) if done.id == run.child => break,
                contracts::EventData::WorkstreamClearFailed(failed) if failed.id == run.child => {
                    panic!("{}", failed.message)
                }
                _ => {}
            }
        }
    })
    .await
    .unwrap();
    let nodes = run.user.request("rail.tree", ()).await.unwrap();
    let node = nodes
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == run.child)
        .unwrap();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(run).await;
}

#[tokio::test]
async fn a4452c_clear_never_sends_the_saved_prompt() {
    let mut run = door(Some("/compose /intent keep spacing")).await;
    assert!(
        recorded_bytes(&run).await.is_empty(),
        "first launch starts idle"
    );
    clear(&mut run).await;
    assert!(
        recorded_bytes(&run).await.is_empty(),
        "Clear cannot type an Opening prompt"
    );
    let tree = run.user.request("rail.tree", Value::Null).await.unwrap();
    let node = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == run.child)
        .unwrap();
    assert_eq!(node["status"]["kind"], "idle");
    assert_eq!(node["opening_prompt"], "/compose /intent keep spacing");
    run.finish().await;
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
    let before = run.attempt.clone();
    let node = restart(&mut run, "fresh-1").await.unwrap();
    assert_ne!(node["attempt"], before);
    assert_eq!(node["opening_prompt"], prompt);
    let expected = format!("\x1b[200~{prompt}\x1b[201~\r").into_bytes();
    assert_eq!(recorded_bytes(&run).await, expected);
    restart(&mut run, "fresh-1").await.unwrap();
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
    restart(&mut run, "record-1").await.unwrap();
    assert_eq!(
        recorded_bytes(&run).await,
        b"\x1b[200~Keep this exact prompt\x1b[201~\r"
    );
    run.finish().await;
}
