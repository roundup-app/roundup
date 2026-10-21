//! Setup shared by the Takeover tests that drive a Door-spawned child Terminal.
#![allow(dead_code)] // each includer uses its own part of the helpers
use super::takeover_run::{BOUND, Run};

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::{Client, RpcError};
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
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

pub async fn idle(run: &Run) {
    tokio::time::timeout(BOUND, async {
        loop {
            let tree = run.user.request("rail.tree", ()).await.unwrap();
            if tree
                .as_array()
                .unwrap()
                .iter()
                .any(|node| node["id"] == run.child && node["status"]["kind"] == "idle")
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

pub async fn order_result(
    run: &Run,
    caller: Arc<Client>,
) -> tokio::task::JoinHandle<Result<Value, RpcError>> {
    let child = run.child.clone();
    tokio::spawn(async move {
        caller
            .request(
                "agent.setOrder",
                json!({"id":child,"order":{"kind":"work","ask":"first order","limits":[]}}),
            )
            .await
    })
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

pub async fn notice_events(run: &Run) -> Client {
    let client = Client::connect(&run.daemon.socket).await.unwrap();
    tokio::time::timeout(BOUND, client.request("events.subscribe", ()))
        .await
        .unwrap()
        .unwrap();
    client
}

pub async fn door_terminal() -> (Run, Arc<Client>) {
    let (mut run, caller) = order_child().await;
    // Agent panes are ownerless (M14); a child-owned Run is in the Door's Reach.
    let child = Client::connect(&run.daemon.socket).await.unwrap();
    child
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let opened = child.request("terminal.spawn", json!({
        "cwd":run.dir.path(), "cols":80,"rows":24,"env":{},
        "command":["python3","-u","-c", "import os, tty\ntty.setraw(0)\nprint('READY')\nwhile True:\n b = os.read(0, 1)\n if not b: break\n print('BARRIER' if b == b'\\x00' else 'BYTE:' + b.hex())"]
    })).await.unwrap();
    run.terminal = opened["id"].clone();
    tokio::time::timeout(BOUND, async {
        while !run.screen().await.contains("READY") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (run, caller)
}

pub async fn start_answer_door(run: &Run) -> (Value, Value) {
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let door = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap()["parent"]
        .clone();
    let started = run
        .user
        .request("rail.startDoor", json!({"id":door}))
        .await
        .unwrap();
    let terminal = started["terminal_id"].clone();
    tokio::time::timeout(BOUND, async {
        loop {
            let output = run
                .user
                .request("terminal.read", json!({"id":terminal,"after":0}))
                .await
                .unwrap();
            if output["text"].as_str().unwrap().contains("READY") {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (door, terminal)
}

pub async fn door_peer_request(run: &Run, terminal: &Value, request: Value) -> Value {
    let result = run.dir.path().join("peer-result");
    if result.exists() {
        std::fs::remove_file(&result).unwrap();
    }
    std::fs::write(
        run.dir.path().join("peer-request"),
        serde_json::to_vec(&request).unwrap(),
    )
    .unwrap();
    run.user
        .request(
            "terminal.write",
            json!({"id":terminal,"data":STANDARD.encode(b"\x02")}),
        )
        .await
        .unwrap();
    // Fake Claude writes this only after reading the real Daemon's RPC replies.
    tokio::time::timeout(BOUND, async {
        loop {
            if let Ok(text) = std::fs::read_to_string(&result)
                && let Ok(reply) = serde_json::from_str(&text)
            {
                return reply;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

/// Replaces the fake `claude` while a launched one may be running: a write in place fails with
/// `Text file busy` (ETXTBSY) when a process executes the file, so the new script is renamed over it.
pub fn rewrite_script(path: &Path, text: impl AsRef<[u8]>) {
    let staged = path.with_extension("staged");
    std::fs::write(&staged, text).unwrap();
    std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::fs::rename(&staged, path).unwrap();
}

pub async fn ordered_ask(run: &Run) -> Value {
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    tree.as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == run.child)
        .map(|node| node["work"]["ask"].clone())
        .unwrap()
}

pub async fn child_attempt(run: &Run) -> Value {
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    tree.as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == run.child)
        .map(|node| node["attempt"].clone())
        .unwrap()
}
