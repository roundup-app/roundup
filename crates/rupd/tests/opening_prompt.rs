//! A4452c: the real clear coordinator, Claude inbox and recorded Terminal bytes.
#[path = "support/child_run.rs"]
mod child_run;
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use child_run::{BOUND, Run};
use door_terminals::{idle, recorded_bytes};
use serde_json::{Value, json};

async fn door(prompt: Option<&str>) -> Run {
    let mut run = Run::start().await;
    run.user.request("agent.stop", json!({"id":run.child})).await.unwrap();
    let node = run.user.request("rail.createWorkstream", json!({"name":"team","parent":null})).await.unwrap();
    run.child = node["id"].as_str().unwrap().to_owned();
    run.user.request("workstream.setOpeningPrompt", json!({"id":run.child,"prompt":prompt})).await.unwrap();
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    let node = run.user.request("rail.startDoor", json!({"id":run.child})).await.unwrap();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(&run).await;
    run
}

async fn clear(run: &mut Run) {
    let watcher = rpc::Client::connect(&run.daemon.socket).await.unwrap();
    watcher.request("events.subscribe", ()).await.unwrap();
    run.user.request("workstream.clear", json!({"id":run.child,"reason":"fresh start","without_handoff":true})).await.unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            match watcher.next_event().await.unwrap().data {
                contracts::EventData::WorkstreamCleared(done) if done.id == run.child => break,
                contracts::EventData::WorkstreamClearFailed(failed) if failed.id == run.child => panic!("{}", failed.message),
                _ => {}
            }
        }
    }).await.unwrap();
    let nodes = run.user.request("rail.tree", ()).await.unwrap();
    let node = nodes.as_array().unwrap().iter().find(|node| node["id"] == run.child).unwrap();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(run).await;
}

#[tokio::test]
async fn a4452c_clear_sends_exactly_the_saved_prompt_once() {
    let mut run = door(Some("/compose /intent keep spacing")).await;
    assert!(recorded_bytes(&run).await.is_empty(), "first launch starts idle");
    clear(&mut run).await;
    assert_eq!(recorded_bytes(&run).await, b"\x1b[200~/compose /intent keep spacing\x1b[201~\r");
    let notes = run.user.request("message.list", json!({"agent":run.child})).await.unwrap();
    assert!(notes.as_array().unwrap().iter().any(|note| note["body"] == "/compose /intent keep spacing" && note["status"] == "delivered"));
    run.finish().await;
}

#[tokio::test]
async fn a4452c_no_saved_prompt_starts_idle() {
    let mut run = door(None).await;
    clear(&mut run).await;
    assert!(recorded_bytes(&run).await.is_empty());
    let tree = run.user.request("rail.tree", Value::Null).await.unwrap();
    let node = tree.as_array().unwrap().iter().find(|node| node["id"] == run.child).unwrap();
    assert_eq!(node["status"]["kind"], "idle");
    run.finish().await;
}
