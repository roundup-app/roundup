//! PS8.1 through a real Daemon: a program's status report shows on its `terminal.list` entry.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::path::Path;
use std::time::Duration;

use serde_json::json;

#[tokio::test(flavor = "multi_thread")]
async fn ps8_terminal_list_carries_a_terminals_program_status() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        dir.path(),
        true,
        |_| {},
    );
    let client = rpc::Client::connect(&daemon.socket).await.unwrap();
    let spawn = |script: &str| {
        json!({"cwd": dir.path(), "command": ["sh", "-c", script], "env": {}, "cols": 80, "rows": 24})
    };
    let plain = client
        .request("terminal.spawn", spawn("sleep 30"))
        .await
        .unwrap()["id"]
        .clone();
    let reporting = client
        .request(
            "terminal.spawn",
            spawn("printf '\\033]7501;state=working:msg=YnVpbGQ=\\033\\\\'; sleep 30"),
        )
        .await
        .unwrap()["id"]
        .clone();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let list = client.request("terminal.list", json!({})).await.unwrap();
            let status_of = |id: &serde_json::Value| {
                list.as_array()
                    .unwrap()
                    .iter()
                    .find(|t| &t["id"] == id)
                    .map(|t| t["status"].clone())
            };
            assert!(status_of(&plain).is_some_and(|s| s.is_null()));
            if let Some(status) = status_of(&reporting).filter(|s| !s.is_null()) {
                assert_eq!(status["kind"], "working");
                assert_eq!(status["label"], "build");
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the report reaches terminal.list");
}
