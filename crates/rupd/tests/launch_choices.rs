//! U3801/U3802: launch choices through the real Daemon, with an isolated fake vendor.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use rpc::Client;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::Duration;

struct Run {
    daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    user: Client,
}

impl Run {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bin = PathBuf::from(env!("CARGO_BIN_EXE_rupd"));
        let daemon = rupd_harness::start(&bin, dir.path(), true, |cmd| {
            cmd.env("ROUNDUP_RUP_BIN", bin.with_file_name("rup"))
                .env("ROUNDUP_CLAUDE_BIN", PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py"))
                .env("CLAUDE_CONFIG_DIR", dir.path().join("config"))
                .env("FAKE_CLAUDE_LAUNCH_LOG", dir.path().join("launches"));
        });
        let user = Client::connect(&daemon.socket).await.unwrap();
        Self { daemon, dir, user }
    }

    async fn launches(&self, count: usize) -> Vec<Value> {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let values: Vec<Value> = std::fs::read_to_string(self.dir.path().join("launches"))
                    .unwrap_or_default().lines().map(|s| serde_json::from_str(s).unwrap()).collect();
                if values.len() >= count { return values; }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }).await.unwrap()
    }
}

#[tokio::test]
async fn u3802_models_list_returns_the_offered_engines() {
    let run = Run::start().await;
    let listed = run.user.request("models.list", Value::Null).await.unwrap();
    assert_eq!(listed["engines"], json!([{"id":"claude-code", "label":"Claude Code"}]));
    run.user.request("agent.spawn", json!({"cwd":run.dir.path(), "engine":listed["engines"][0]["id"]})).await.unwrap();
    assert_eq!(run.launches(1).await.len(), 1);
    let error = run.user.request("agent.spawn", json!({"cwd":run.dir.path(), "engine":"unimplemented"})).await.unwrap_err();
    assert_eq!(error.code, rpc::code::INVALID_PARAMS);
    assert_eq!(run.user.request("rail.tree", json!({})).await.unwrap().as_array().unwrap().len(), 1);
    assert_eq!(run.launches(1).await.len(), 1);
}
