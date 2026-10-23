//! U3801/U3802: launch choices through the real Daemon, with an isolated fake vendor.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use rpc::Client;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::Duration;

struct Run {
    _daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    user: Client,
}

impl Run {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bin = PathBuf::from(env!("CARGO_BIN_EXE_rupd"));
        let daemon = rupd_harness::start(&bin, dir.path(), true, |cmd| {
            cmd.env("ROUNDUP_RUP_BIN", bin.with_file_name("rup"))
                .env(
                    "ROUNDUP_CLAUDE_BIN",
                    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../rup/tests/e2e/fake_claude.py"),
                )
                .env("CLAUDE_CONFIG_DIR", dir.path().join("config"))
                .env("FAKE_CLAUDE_LAUNCH_LOG", dir.path().join("launches"));
        });
        let user = Client::connect(&daemon.socket).await.unwrap();
        Self {
            _daemon: daemon,
            dir,
            user,
        }
    }

    async fn launches(&self, count: usize) -> Vec<Value> {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let values: Vec<Value> = std::fs::read_to_string(self.dir.path().join("launches"))
                    .unwrap_or_default()
                    .lines()
                    .map(|s| serde_json::from_str(s).unwrap())
                    .collect();
                if values.len() >= count {
                    return values;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    }
}

#[tokio::test]
async fn u3802_models_list_returns_the_offered_engines() {
    let run = Run::start().await;
    let listed = run.user.request("models.list", Value::Null).await.unwrap();
    assert_eq!(
        listed["engines"],
        json!([{"id":"claude-code", "label":"Claude Code"}])
    );
    run.user
        .request(
            "agent.spawn",
            json!({"cwd":run.dir.path(), "engine":listed["engines"][0]["id"]}),
        )
        .await
        .unwrap();
    assert_eq!(run.launches(1).await.len(), 1);
    let error = run
        .user
        .request(
            "agent.spawn",
            json!({"cwd":run.dir.path(), "engine":"unimplemented"}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::INVALID_PARAMS);
    assert_eq!(
        run.user
            .request("rail.tree", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(run.launches(1).await.len(), 1);
}

impl Run {
    async fn node(&self, id: &Value, iteration: Option<u32>) -> Value {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let tree = self.user.request("rail.tree", json!({})).await.unwrap();
                if let Some(node) = tree.as_array().unwrap().iter().find(|n| n["id"] == *id)
                    && node["status"]["kind"] == "idle"
                    && iteration.is_none_or(|i| node["iteration"] == i)
                {
                    return node.clone();
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    }
}

fn mode(launch: &Value) -> Option<&str> {
    launch["argv"]
        .as_array()
        .unwrap()
        .windows(2)
        .find(|a| a[0] == "--permission-mode")
        .and_then(|a| a[1].as_str())
}

#[tokio::test]
async fn u3801_rpc_launch_choices_reach_spawn_resume_and_the_cleared_door() {
    let run = Run::start().await;
    let mut count = 0;
    for selected in [
        None,
        Some("default"),
        Some("acceptEdits"),
        Some("plan"),
        Some("auto"),
    ] {
        let mut params = json!({"cwd":run.dir.path()});
        if let Some(selected) = selected {
            params["permissionMode"] = selected.into();
        }
        let child = run.user.request("agent.spawn", params).await.unwrap();
        run.node(&child["id"], None).await;
        count += 1;
        assert_eq!(mode(&run.launches(count).await[count - 1]), selected);
        let mut params = json!({"id":child["id"], "mode":"normal"});
        if let Some(selected) = selected {
            params["permissionMode"] = selected.into();
        }
        run.user.request("agent.resume", params).await.unwrap();
        count += 1;
        assert_eq!(mode(&run.launches(count).await[count - 1]), selected);
        run.user
            .request("agent.stop", json!({"id":child["id"]}))
            .await
            .unwrap();
        let door = run
            .user
            .request("rail.createWorkstream", json!({"name":"work"}))
            .await
            .unwrap();
        let mut params = json!({"id":door["id"]});
        if let Some(selected) = selected {
            params["permissionMode"] = selected.into();
        }
        run.user.request("rail.startDoor", params).await.unwrap();
        run.node(&door["id"], None).await;
        count += 1;
        assert_eq!(mode(&run.launches(count).await[count - 1]), selected);
        run.user
            .request("agent.stop", json!({"id":door["id"]}))
            .await
            .unwrap();
        let mut start = json!({"id":door["id"]});
        if let Some(selected) = selected {
            start["permissionMode"] = selected.into();
        }
        run.user.request("rail.startDoor", start).await.unwrap();
        count += 1;
        let launches = run.launches(count).await;
        assert_eq!(mode(&launches[count - 1]), selected);
        assert!(
            launches[count - 1]["argv"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a == "--resume")
        );
        let mut params =
            json!({"id":door["id"], "reason":"new launch choices", "without_handoff":true});
        if let Some(selected) = selected {
            params["permissionMode"] = selected.into();
        }
        run.user.request("workstream.clear", params).await.unwrap();
        run.node(&door["id"], Some(2)).await;
        count += 1;
        let launches = run.launches(count).await;
        assert_eq!(mode(&launches[count - 1]), selected);
        assert!(
            !launches[count - 1]["argv"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a == "--resume")
        );
        run.user
            .request("agent.stop", json!({"id":door["id"]}))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn u3801_an_agent_cannot_select_launch_permissions() {
    let run = Run::start().await;
    let child = run
        .user
        .request("agent.spawn", json!({"cwd":run.dir.path()}))
        .await
        .unwrap();
    run.node(&child["id"], None).await;
    let agent = Client::connect(&run._daemon.socket).await.unwrap();
    agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":child["id"]}}),
        )
        .await
        .unwrap();
    for (method, params) in [
        (
            "agent.spawn",
            json!({"cwd":run.dir.path(), "permissionMode":"acceptEdits"}),
        ),
        (
            "agent.resume",
            json!({"id":child["id"], "permissionMode":"auto"}),
        ),
    ] {
        let error = agent.request(method, params).await.unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN);
    }
    assert_eq!(run.launches(1).await.len(), 1);
}

#[tokio::test]
async fn u3801_an_agent_restart_keeps_the_users_permission_choice() {
    let run = Run::start().await;
    let door = run
        .user
        .request("rail.createWorkstream", json!({"name":"work"}))
        .await
        .unwrap();
    run.user
        .request("rail.startDoor", json!({"id":door["id"]}))
        .await
        .unwrap();
    run.node(&door["id"], None).await;
    let agent = Client::connect(&run._daemon.socket).await.unwrap();
    agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":door["id"]}}),
        )
        .await
        .unwrap();
    let child = agent.request("agent.spawn", json!({"cwd":run.dir.path(), "order":{"kind":"work","title":"Read repository","ask":"Read repository","done":"Report findings","limits":["Read only"]}})).await.unwrap();
    run.node(&child["id"], None).await;
    run.user
        .request(
            "agent.resume",
            json!({"id":child["id"], "mode":"normal", "permissionMode":"plan"}),
        )
        .await
        .unwrap();
    agent
        .request("agent.extras_add", json!({"id":child["id"], "extras":{}}))
        .await
        .unwrap();
    assert_eq!(mode(&run.launches(4).await[3]), Some("plan"));
}
