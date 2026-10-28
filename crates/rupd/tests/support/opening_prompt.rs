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
    assert!(recorded_bytes(&run).await.is_empty(), "first launch starts idle");
    clear(&mut run).await;
    assert!(recorded_bytes(&run).await.is_empty(), "Clear cannot type an Opening prompt");
    let tree = run.user.request("rail.tree", Value::Null).await.unwrap();
    let node = tree.as_array().unwrap().iter().find(|node| node["id"] == run.child).unwrap();
    assert_eq!(node["status"]["kind"], "idle");
    assert_eq!(node["opening_prompt"], "/compose /intent keep spacing");
    run.finish().await;
}
