//! LC12–LC13 through the real Daemon and recorded fake-Claude launches.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
use contracts::agent::RailNode;
use rpc::Client;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::Duration;

struct Run {
    _daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    user: Client,
    door: Client,
}
impl Run {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bin = PathBuf::from(env!("CARGO_BIN_EXE_rupd"));
        let rup = bin.with_file_name("rup");
        assert!(rup.is_file(), "cargo build -p rup first");
        let daemon = rupd_harness::start(&bin, dir.path(), true, |cmd| {
            cmd.env("ROUNDUP_RUP_BIN", rup)
                .env(
                    "ROUNDUP_CLAUDE_BIN",
                    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../rup/tests/e2e/fake_claude.py"),
                )
                .env("CLAUDE_CONFIG_DIR", dir.path().join("config"))
                .env("FAKE_CLAUDE_LAUNCH_LOG", dir.path().join("launches"))
                .env("FAKE_CLAUDE_INPUT_LOG", dir.path().join("inputs"));
        });
        let user = Client::connect(&daemon.socket).await.unwrap();
        let workstream = user
            .request("rail.createWorkstream", json!({"name":"work"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        user.request("rail.startDoor", json!({"id":workstream}))
            .await
            .unwrap();
        let door = Client::connect(&daemon.socket).await.unwrap();
        door.request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":workstream}}),
        )
        .await
        .unwrap();
        Self {
            _daemon: daemon,
            dir,
            user,
            door,
        }
    }
    async fn spawn(&self, name: Option<&str>, scout: bool) -> Result<RailNode, rpc::RpcError> {
        let value = self.door.request("agent.spawn", json!({"cwd":self.dir.path(), "scout":scout,"specialist":name,"name":"reader", "order":{"kind":"work","title":"Read repository","ask":"Read repository","done":"Report findings","limits":["Read only"]}})).await?;
        Ok(serde_json::from_value(value).unwrap())
    }
    async fn tree(&self) -> Vec<RailNode> {
        serde_json::from_value(self.user.request("rail.tree", json!({})).await.unwrap()).unwrap()
    }
    async fn idle(&self, id: &str) {
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if self.tree().await.iter().any(|n| {
                    n.id == id
                        && n.status
                            .as_ref()
                            .is_some_and(|s| s.kind == contracts::Kind::Idle)
                }) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }
    async fn launches(&self, count: usize) -> Vec<Value> {
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let values: Vec<Value> = std::fs::read_to_string(self.dir.path().join("launches"))
                    .unwrap_or_default()
                    .lines()
                    .map(|s| serde_json::from_str(s).unwrap())
                    .collect();
                if values.len() >= count {
                    break values;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap()
    }
}
#[tokio::test]
async fn lc12_two_lookups_give_one_child_start() {
    let run = Run::start().await;
    let (a, b) = tokio::join!(run.spawn(Some("repo"), true), run.spawn(Some("repo"), true));
    assert_eq!(a.unwrap().id, b.unwrap().id);
    run.spawn(Some("docs"), true).await.unwrap();
    assert_eq!(run.launches(3).await.len(), 3);
    let other = run
        .user
        .request("rail.createWorkstream", json!({"name":"other"}))
        .await
        .unwrap()["id"]
        .clone();
    let door = Client::connect(&run._daemon.socket).await.unwrap();
    door.request(
        "daemon.identify",
        json!({"actor":{"kind":"agent","id":other}}),
    )
    .await
    .unwrap();
    let child = door
        .request(
            "agent.spawn",
            json!({"cwd":run.dir.path(),"scout":true,"specialist":"repo"}),
        )
        .await
        .unwrap();
    assert!(child["id"].is_string());
    assert_eq!(run.launches(4).await.len(), 4);
}
#[tokio::test]
async fn lc12_an_ended_specialist_is_started_again() {
    let run = Run::start().await;
    let first = run.spawn(Some("repo"), true).await.unwrap();
    run.idle(&first.id).await;
    run.user
        .request("agent.stop", json!({"id":first.id}))
        .await
        .unwrap();
    let next = run.spawn(Some("repo"), true).await.unwrap();
    assert_ne!(first.id, next.id);
    assert_eq!(run.launches(3).await.len(), 3);
}
#[tokio::test]
async fn lc12_a_specialist_requires_scout() {
    let run = Run::start().await;
    assert_eq!(
        run.spawn(Some("repo"), false).await.unwrap_err().code,
        rpc::code::INVALID_PARAMS
    );
    assert_eq!(run.launches(1).await.len(), 1);
    assert_eq!(run.tree().await.len(), 1);
    let invalid = run
        .user
        .request(
            "agent.spawn",
            json!({"cwd":run.dir.path(),"scout":true,"specialist":"repo"}),
        )
        .await
        .unwrap_err();
    assert_eq!(invalid.code, rpc::code::INVALID_PARAMS);
    let invalid = run
        .door
        .request(
            "agent.spawn",
            json!({"cwd":run.dir.path(),"specialist":"repo"}),
        )
        .await
        .unwrap_err();
    assert_eq!(invalid.code, rpc::code::INVALID_PARAMS);
    assert_eq!(run.tree().await.len(), 1);
}

impl Run {
    async fn stop_signal(&self, node: &RailNode, tokens: u64) {
        let path = self.dir.path().join(format!("{}.jsonl", node.id));
        // Only the last usage counts; cache tokens count toward the threshold.
        std::fs::write(&path, format!("{}\n{}\n", json!({"message":{"usage":{"input_tokens":900000}}}), json!({"message":{"usage":{"input_tokens":1000,"cache_read_input_tokens":tokens-2000,"cache_creation_input_tokens":1000}}}))).unwrap();
        let result = self.user.request("agent.signal",json!({"id":node.id,"attempt":node.attempt,"payload":{"hook_event_name":"Stop","transcript_path":path}})).await;
        if let Err(err) = result {
            assert_eq!(err.code, rpc::code::NOT_FOUND);
            assert!(
                self.tree()
                    .await
                    .iter()
                    .any(|n| n.id == node.id && n.terminal_id.is_none())
            );
        }
    }
    async fn requests(&self, id: &str) -> Vec<Value> {
        self.user
            .request("message.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["to"] == id && m["body"].as_str().unwrap().contains("600 bytes"))
            .cloned()
            .collect()
    }
    async fn summary(&self, child: &RailNode, request: &Value) {
        let agent = Client::connect(&self._daemon.socket).await.unwrap();
        agent
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":child.id}}),
            )
            .await
            .unwrap();
        agent.request("message.send",json!({"to":request["from"]["id"],"kind":"note","body":"Repository findings to retain.","replyTo":request["id"]})).await.unwrap();
    }
}
#[tokio::test]
async fn lc13_repeated_stops_wait_for_one_handoff() {
    let run = Run::start().await;
    let first = run.spawn(Some("repo"), true).await.unwrap();
    run.idle(&first.id).await;
    tokio::join!(
        run.stop_signal(&first, 161000),
        run.stop_signal(&first, 161000),
        run.stop_signal(&first, 161000)
    );
    let requests = run.requests(&first.id).await;
    assert_eq!(requests.len(), 1);
    assert_eq!(run.launches(2).await.len(), 2);
    assert_eq!(run.spawn(Some("repo"), true).await.unwrap().id, first.id);
    run.summary(&first, &requests[0]).await;
    run.stop_signal(&first, 161000).await;
    let next = run.spawn(Some("repo"), true).await.unwrap();
    assert_ne!(next.id, first.id);
    assert_eq!(run.requests(&first.id).await.len(), 1);
    assert_eq!(run.launches(3).await.len(), 3);
    assert!(
        run.tree()
            .await
            .iter()
            .find(|n| n.id == first.id)
            .unwrap()
            .terminal_id
            .is_none()
    );
}
#[tokio::test]
async fn lc13_a_specialist_crossing_160k_is_replaced_once_with_the_summary() {
    let run = Run::start().await;
    let first = run.spawn(Some("repo"), true).await.unwrap();
    run.idle(&first.id).await;
    for count in [90000, 150000] {
        run.stop_signal(&first, count).await;
        assert!(run.requests(&first.id).await.is_empty());
    }
    run.stop_signal(&first, 161000).await;
    run.summary(&first, &run.requests(&first.id).await[0]).await;
    let next = run.spawn(Some("repo"), true).await.unwrap();
    run.idle(&next.id).await;
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            let input = std::fs::read_to_string(run.dir.path().join("inputs")).unwrap_or_default();
            if input.contains("Handoff from the previous specialist") {
                assert!(input.contains("Repository findings to retain."));
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    run.stop_signal(&next, 161000).await;
    assert_eq!(run.launches(3).await.len(), 3);
    run.summary(&next, &run.requests(&next.id).await[0]).await;
    let third = run.spawn(Some("repo"), true).await.unwrap();
    assert_ne!(next.id, third.id);
    assert_eq!(run.launches(4).await.len(), 4);
}
#[tokio::test]
async fn lc13_under_160k_makes_no_replacement() {
    let run = Run::start().await;
    let first = run.spawn(Some("repo"), true).await.unwrap();
    run.idle(&first.id).await;
    for count in [90000, 150000, 159999] {
        run.stop_signal(&first, count).await;
    }
    assert!(run.requests(&first.id).await.is_empty());
    assert_eq!(run.spawn(Some("repo"), true).await.unwrap().id, first.id);
    assert_eq!(run.launches(2).await.len(), 2);
}
#[tokio::test]
async fn lc13_a_job_sized_child_is_not_replaced() {
    let run = Run::start().await;
    let first = run.spawn(None, false).await.unwrap();
    run.idle(&first.id).await;
    run.stop_signal(&first, 161000).await;
    assert!(run.requests(&first.id).await.is_empty());
    assert_eq!(run.launches(2).await.len(), 2);
    assert_eq!(run.tree().await.len(), 2);
}
