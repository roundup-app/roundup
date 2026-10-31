//! RO3: no Daemon call waits on the overview reader.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use rpc::Client;
use serde_json::json;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

const BOUND: Duration = Duration::from_millis(1000);
const FAKE: &str = r#"#!/usr/bin/env python3
import json, os, subprocess, sys, tty
if sys.argv[1:3] == ['plugin', 'list']:
    print('[]'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'test']:
    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
tty.setraw(0)
settings = json.load(open(sys.argv[sys.argv.index('--settings')+1]))
payload = json.dumps({'hook_event_name':'SessionStart','source':'startup','session_id':'11111111-1111-4111-8111-111111111111'})
for group in settings['hooks']['SessionStart']:
    for hook in group['hooks']:
        subprocess.run(hook['command'], shell=True, input=payload, text=True, check=True, stdout=subprocess.DEVNULL)
print('SAVED', flush=True)
while True:
    data = os.read(0, 1)
    if not data or data == b'\x03': break
"#;

async fn saved(user: &Client, node: &serde_json::Value) {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let screen = user
                .request("terminal.read", json!({"id":node["terminal_id"],"after":0}))
                .await
                .unwrap();
            if screen["text"].as_str().unwrap().contains("SAVED") {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the fake Agent saved its conversation");
}

#[tokio::test]
async fn ro3_pad_list_and_rename_answer_while_rail_tree_is_slow() {
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let fake = dir.path().join("claude");
    std::fs::write(&fake, FAKE).unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup");
    assert!(rup.is_file(), "cargo build -p rup first");
    let gate = dir.path().join("overview");
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        dir.path(),
        true,
        |c| {
            c.env("ROUNDUP_DATA_DIR", data.path())
                .env("ROUNDUP_CLAUDE_BIN", &fake)
                .env("ROUNDUP_RUP_BIN", rup)
                .env("CLAUDE_CONFIG_DIR", dir.path().join("config"))
                .env("RUPD_OVERVIEW_READ_GATE", &gate)
                .stderr(std::process::Stdio::null());
        },
    );
    let user = Client::connect(&daemon.socket).await.unwrap();
    let closed = user
        .request("agent.spawn", json!({"name":"closed","cwd":dir.path()}))
        .await
        .unwrap();
    saved(&user, &closed).await;
    user.request("agent.stop", json!({"id":closed["id"]}))
        .await
        .unwrap();
    let other = user
        .request("agent.spawn", json!({"name":"other","cwd":dir.path()}))
        .await
        .unwrap();

    // The first `rail.tree` asks for the closed Agent's overview; the reader then sits on the gate.
    std::fs::write(&gate, "hold").unwrap();
    user.request("rail.tree", ()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the overview reader reached its gate");

    tokio::time::timeout(BOUND, user.request("pad.list", ()))
        .await
        .expect("pad.list answers")
        .unwrap();
    tokio::time::timeout(
        BOUND,
        user.request("rail.rename", json!({"id":other["id"],"name":"renamed"})),
    )
    .await
    .expect("rail.rename answers")
    .unwrap();
    let _ = tokio::time::timeout(
        BOUND,
        user.request("agent.signal", json!({"id":closed["id"],"payload":{}})),
    )
    .await
    .expect("agent.signal answers");
    let tree = tokio::time::timeout(BOUND, user.request("rail.tree", ()))
        .await
        .expect("rail.tree answers")
        .unwrap();
    let renamed = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == other["id"])
        .unwrap();
    assert_eq!(renamed["name"], "renamed");
    std::fs::remove_file(&gate).unwrap();
}
