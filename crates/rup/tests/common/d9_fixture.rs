//! D9's real Daemon and delayed Handoff, shared by the socket and App observers.
#![allow(dead_code)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde_json::{Value, json};

#[path = "../e2e/aimock.rs"]
#[allow(dead_code)]
mod aimock;

pub struct Fixture {
    pub dir: tempfile::TempDir,
    pub project: PathBuf,
    pub wrapper: PathBuf,
    pub model: aimock::Model,
}

impl Fixture {
    pub fn new(handoff_bound_ms: u32) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.name", "roundup"],
            vec!["config", "user.email", "roundup@example.com"],
            vec!["commit", "--allow-empty", "-qm", "base"],
        ] {
            assert!(
                Command::new("git")
                    .current_dir(&project)
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        let home = dir.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let model = aimock::Model::start_at(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fixtures/d9_clear.json"),
        );
        aimock::configure(&dir.path().join("claude-config"), dir.path(), &model.url);
        let bin = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let wrapper = dir.path().join("rupd");
        std::fs::write(&wrapper, format!("#!/bin/sh\nexport ROUNDUP_CLAUDE_BIN='{}' HOME='{}' CLAUDE_CODE_OAUTH_TOKEN='' CLAUDE_CONFIG_DIR='{}/claude-config' ROUNDUP_RUP_BIN='{}/rup' ROUNDUP_HANDOFF_BOUND_MS='{}'\nexec '{}/rupd' \"$@\"\n", aimock::package_bin("claude").display(), home.display(), dir.path().display(), bin.display(), handoff_bound_ms, bin.display())).unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        Self {
            dir,
            project,
            wrapper,
            model,
        }
    }

    fn has_tool_result(entry: &Value, id: &str) -> bool {
        entry["body"]["messages"].as_array().is_some_and(|m| {
            m.iter()
                .any(|m| m["role"] == "tool" && m["tool_call_id"] == id)
        })
    }

    fn user_text(entry: &Value, needle: &str) -> bool {
        entry["body"]["messages"]
            .as_array()
            .is_some_and(|messages| {
                messages.iter().any(|m| {
                    m["role"] == "user" && m["content"].as_str().is_some_and(|t| t.contains(needle))
                })
            })
    }

    async fn seen(&self, what: &str, found: impl Fn(&Value) -> bool) {
        tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                let journal = self.model.journal();
                assert!(
                    journal.iter().all(|e| !e["response"]["fixture"].is_null()),
                    "unmatched aimock request: {journal:#?}"
                );
                if journal.iter().any(&found) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("aimock never saw {what}: {:#?}", self.model.journal()));
    }

    /// The Door answered its first turn and the Daemon reports it idle.
    pub async fn ready(&self, tree: impl AsyncFn() -> Value) {
        self.seen("the Door's first turn", |entry| {
            entry["response"]["status"] == 200 && Self::has_tool_result(entry, "toolu_d9_todos")
        })
        .await;
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                if tree().await[0]["status"]["kind"] == "idle" {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("the Door never went idle");
    }

    /// After Clear ends, aimock's own log holds every expected request and none unmatched. A
    /// completed Clear shows the Handoff round trip and the new session's prompt, all 200; a
    /// failed one shows the Clear prompt, whose delayed response may be cut off.
    pub async fn clear_requests(&self, completion: bool) {
        self.seen("the Clear prompt", |entry| {
            Self::user_text(entry, "clearing Workstream")
        })
        .await;
        if completion {
            self.model.tool_result("toolu_d9_handoff").await;
            self.seen("the new session's Handoff prompt", |entry| {
                entry["response"]["status"] == 200 && Self::user_text(entry, "D9 handoff")
            })
            .await;
            self.model.assert_matched();
        }
    }

    /// Real Claude recorded the Clear prompt in its transcript. aimock journals a delayed
    /// response only once it is sent, so the request log cannot show the prompt arriving.
    pub async fn received(&self) {
        let projects = self.dir.path().join("claude-config/projects");
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                if transcripts(&projects)
                    .iter()
                    .any(|text| text.contains("clearing Workstream"))
                {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("Claude's transcript never held the Clear prompt");
    }
}

fn transcripts(dir: &Path) -> Vec<String> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(transcripts(&path));
        } else if path.extension().is_some_and(|e| e == "jsonl")
            && let Ok(text) = std::fs::read_to_string(&path)
        {
            found.push(text);
        }
    }
    found
}

pub async fn start_door(client: &rpc::Client) -> String {
    let ws = client
        .request("rail.createWorkstream", json!({"name":"D9", "parent":null}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let todo = client
        .request(
            "todo.create",
            json!({"title":"keep until Handoff", "body":"D9"}),
        )
        .await
        .unwrap();
    client
        .request("todo.move", json!({"id":todo["id"], "home":ws}))
        .await
        .unwrap();
    client
        .request(
            "pad.create",
            json!({"name":"D9", "text":"keep until Handoff"}),
        )
        .await
        .unwrap();
    client
        .request("pad.move", json!({"name":"D9", "home":ws}))
        .await
        .unwrap();
    client
        .request("rail.startDoor", json!({"id":ws}))
        .await
        .unwrap();
    ws
}

async fn signal(path: &Path) {
    tokio::time::timeout(Duration::from_secs(30), async {
        while !path.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("fake claude did not signal {}", path.display()));
}

pub async fn terminal_events(client: &mut rpc::Client, ws: &str, completion: bool) {
    let bound = if completion {
        Duration::from_secs(90)
    } else {
        Duration::from_secs(15)
    };
    let mut changed = false;
    tokio::time::timeout(bound, async {
        while let Some(event) = client.next_event().await {
            match event.data {
                contracts::EventData::RailChanged => changed = true,
                contracts::EventData::WorkstreamCleared(done) => {
                    assert!(completion);
                    assert_eq!(done.id, ws);
                    assert_eq!(done.iteration, 2);
                    assert!(changed, "Clear reports progress");
                    return;
                }
                contracts::EventData::WorkstreamClearFailed(failed) => {
                    assert!(!completion);
                    assert_eq!(failed.id, ws);
                    assert_eq!(i64::from(failed.code), rpc::code::NOT_ACKED);
                    return;
                }
                _ => {}
            }
        }
        panic!("connection ended before Clear's terminal event");
    })
    .await
    .unwrap();
    // Drain through a later round-trip, then observe that no second terminal event was queued.
    client.request("rail.tree", Value::Null).await.unwrap();
    while let Ok(Some(event)) =
        tokio::time::timeout(Duration::from_millis(100), client.next_event()).await
    {
        assert!(
            !matches!(
                event.data,
                contracts::EventData::WorkstreamCleared(_)
                    | contracts::EventData::WorkstreamClearFailed(_)
            ),
            "exactly one terminal event"
        );
    }
}
