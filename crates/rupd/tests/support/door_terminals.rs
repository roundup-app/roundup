//! Setup shared by the tests that drive a Door-spawned child Terminal.
use super::child_run::{BOUND, Run};

use rpc::Client;
use serde_json::json;
use std::sync::Arc;

pub async fn order_child() -> (Run, Arc<Client>) {
    let mut run = Run::start().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let door = run
        .user
        .request(
            "rail.createWorkstream",
            json!({"name":"team","parent":null}),
        )
        .await
        .unwrap();
    let caller = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
    caller
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":door["id"]}}),
        )
        .await
        .unwrap();
    let child = caller
        .request(
            "agent.spawn",
            json!({"name":"ordered child","cwd":run.dir.path()}),
        )
        .await
        .unwrap();
    run.child = child["id"].as_str().unwrap().to_owned();
    run.terminal = child["terminal_id"].clone();
    run.attempt = child["attempt"].clone();
    tokio::time::timeout(BOUND, async {
        while !run.screen().await.contains("READY") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (run, caller)
}

pub async fn recorded_bytes(run: &Run) -> Vec<u8> {
    run.recorded_input()
        .await
        .lines()
        .filter_map(|line| {
            line.trim_start()
                .strip_prefix("BYTE:")
                .and_then(|hex| u8::from_str_radix(hex.trim(), 16).ok())
        })
        .collect()
}
