//! H7200: `agent.handoff` through a real Daemon and a fake Claude.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#[path = "support/child_run.rs"]
mod child_run;
#[allow(dead_code)]
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/idle.rs"]
mod idle;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use child_run::{BOUND, Run};
use door_terminals::recorded_bytes;
use rpc::Client;
use serde_json::{Value, json};

fn order() -> Value {
    json!({"kind":"work","title":"Build it","ask":"build the settled plan","done":"CI is green","limits":["touch nothing else"]})
}

async fn tree(run: &Run) -> Vec<Value> {
    run.user
        .request("rail.tree", ())
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
}

/// The ids under `parent`, in Rail order.
async fn children(run: &Run, parent: Option<&str>) -> Vec<String> {
    tree(run)
        .await
        .iter()
        .filter(|n| n["parent"].as_str() == parent && n["kind"] != "group")
        .map(|n| n["id"].as_str().unwrap().to_owned())
        .collect()
}

async fn as_agent(run: &Run, id: &str) -> Client {
    let agent = Client::connect(&run.daemon.socket).await.unwrap();
    agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":id,"parent":null}}),
        )
        .await
        .unwrap();
    agent
}

async fn gone(run: &Run, id: &str) {
    tokio::time::timeout(BOUND, async {
        while tree(run).await.iter().any(|n| n["id"] == id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

/// Three Agents under one Workstream; the middle one is the caller.
async fn row() -> (Run, String, [String; 3]) {
    let mut run = Run::start().await;
    let ws = run
        .user
        .request(
            "rail.createWorkstream",
            json!({"name":"work","parent":null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    run.door = Some(ws.clone());
    let mut ids = Vec::new();
    for _ in 0..3 {
        run.spawn().await;
        ids.push(run.child.clone());
    }
    run.user
        .request("pad.create", json!({"name":"plan","text":"the detail"}))
        .await
        .unwrap();
    let [a, b, c] = <[String; 3]>::try_from(ids).unwrap();
    (run, ws, [a, b, c])
}

#[tokio::test]
async fn h7200a_the_builder_takes_the_callers_place() {
    let (run, ws, [first, caller, last]) = row().await;
    let agent = as_agent(&run, &caller).await;
    let builder = agent
        .request("agent.handoff", json!({"order":order(),"pad":"plan"}))
        .await
        .unwrap();
    let b = builder["id"].as_str().unwrap().to_owned();
    assert_eq!(builder["parent"], ws.as_str());
    assert_eq!(builder["work"]["ask"], "build the settled plan");
    let prompt = run
        .user
        .request("agent.spawnPrompt", json!({"id":b}))
        .await
        .unwrap()
        .to_string();
    assert!(prompt.contains("plan"), "{prompt}");
    gone(&run, &caller).await;
    assert_eq!(children(&run, Some(&ws)).await, [first, b.clone(), last]);
    // The builder is no child of the caller, so ending the caller left it running.
    let nodes = tree(&run).await;
    let node = nodes.iter().find(|n| n["id"] == b).unwrap();
    assert!(node["terminal_id"].is_string(), "{node}");
}

#[tokio::test]
async fn h7200a_an_unknown_pad_starts_nothing() {
    let (run, ws, _) = row().await;
    let before = children(&run, Some(&ws)).await;
    let agent = as_agent(&run, &before[1]).await;
    let err = agent
        .request("agent.handoff", json!({"order":order(),"pad":"missing"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::NOT_FOUND);
    assert_eq!(children(&run, Some(&ws)).await, before);
}

#[tokio::test]
async fn h7200b_a_failed_start_keeps_the_caller_running() {
    let (run, ws, _) = row().await;
    let before = children(&run, Some(&ws)).await;
    let agent = as_agent(&run, &before[1]).await;
    let bad = json!({"kind":"work","ask":"","limits":[]});
    let err = agent
        .request("agent.handoff", json!({"order":bad,"pad":"plan"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::INVALID_PARAMS);
    // Time for an end that must not come.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    assert_eq!(children(&run, Some(&ws)).await, before);
    let nodes = tree(&run).await;
    assert!(nodes.iter().find(|n| n["id"] == before[1]).unwrap()["terminal_id"].is_string());
}

#[tokio::test]
async fn h7200b_the_caller_is_stopped_after_its_reply() {
    let (run, _, [_, caller, _]) = row().await;
    let agent = as_agent(&run, &caller).await;
    // The reply reaches the caller's own connection, which would drop with the caller's end.
    let builder = agent
        .request("agent.handoff", json!({"order":order(),"pad":"plan"}))
        .await
        .unwrap();
    assert!(
        builder["terminal_id"].is_string(),
        "the builder runs when the caller hears of it"
    );
    gone(&run, &caller).await;
}

#[tokio::test]
async fn h7200c_agent_stop_on_oneself_is_still_refused() {
    let (run, _, [_, caller, _]) = row().await;
    let agent = as_agent(&run, &caller).await;
    let err = agent
        .request("agent.stop", json!({"id":caller}))
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::FORBIDDEN);
    assert!(tree(&run).await.iter().any(|n| n["id"] == caller));
}

#[tokio::test]
async fn h7200c_handoff_acts_only_on_its_caller() {
    let (run, ws, _) = row().await;
    let before = children(&run, Some(&ws)).await;
    let err = run
        .user
        .request("agent.handoff", json!({"order":order(),"pad":"plan"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::FORBIDDEN);
    assert_eq!(children(&run, Some(&ws)).await, before);
}

async fn mode(run: &mut Run, prompt: &str) {
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let node = run
        .user
        .request("agent.createMode", json!({"name":"team","prompt":prompt}))
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().to_owned();
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    let node = run
        .user
        .request(
            "agent.restartMode",
            json!({"id":run.child,"request":"initial"}),
        )
        .await
        .unwrap();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle::idle(run).await;
    run.user
        .request("pad.create", json!({"name":"plan","text":"the detail"}))
        .await
        .unwrap();
}

#[tokio::test]
async fn h7200e_a_mode_keeps_its_row_and_restarts_fresh() {
    let mut run = Run::start().await;
    let prompt = "/compose exact words";
    mode(&mut run, prompt).await;
    let before = run.attempt.clone();
    let agent = as_agent(&run, &run.child).await;
    let builder = agent
        .request("agent.handoff", json!({"order":order(),"pad":"plan"}))
        .await
        .unwrap();
    assert!(builder["parent"].is_null());
    assert_ne!(builder["id"], run.child.as_str());
    let attempt = tokio::time::timeout(BOUND, async {
        loop {
            let nodes = tree(&run).await;
            let node = nodes
                .iter()
                .find(|n| n["id"] == run.child.as_str())
                .unwrap();
            if node["attempt"] != before && node["status"]["kind"] == "idle" {
                return node.clone();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    run.terminal = attempt["terminal_id"].clone();
    assert_eq!(attempt["mode_prompt"], prompt);
    let expected = format!("\x1b[200~{prompt}\x1b[201~\r").into_bytes();
    // The fake takes the typed prompt as submitted once its Enter arrives.
    tokio::time::timeout(BOUND, async {
        while !run.screen().await.contains("SUBMITTED") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(recorded_bytes(&run).await, expected);
    assert!(tree(&run).await.iter().any(|n| n["id"] == builder["id"]));
}

#[tokio::test]
async fn h7200e_a_failed_start_does_not_restart_the_mode() {
    let mut run = Run::start().await;
    mode(&mut run, "/compose exact words").await;
    let before = run.attempt.clone();
    let rows = tree(&run).await.len();
    let agent = as_agent(&run, &run.child).await;
    let bad = json!({"kind":"work","ask":"","limits":[]});
    agent
        .request("agent.handoff", json!({"order":bad,"pad":"plan"}))
        .await
        .unwrap_err();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let nodes = tree(&run).await;
    let node = nodes
        .iter()
        .find(|n| n["id"] == run.child.as_str())
        .unwrap();
    assert_eq!(node["attempt"], before);
    assert_eq!(nodes.len(), rows);
}
