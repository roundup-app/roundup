//! D9's real Daemon and delayed Handoff, shared by the socket and App observers.
#![allow(dead_code)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde_json::{Value, json};

pub struct Fixture {
    pub dir: tempfile::TempDir,
    pub project: PathBuf,
    pub wrapper: PathBuf,
    pub receipt: PathBuf,
    ready: PathBuf,
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
        let receipt = dir.path().join("receipt");
        let ready = dir.path().join("ready");
        let fake = dir.path().join("claude.py");
        let source = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py"),
        )
        .unwrap();
        let needle = "        hook(\"UserPromptSubmit\", {\"prompt\": prompt})";
        assert_eq!(source.matches(needle).count(), 1);
        let source = source.replace(needle, &format!("{needle}\n        if prompt.startswith('The user is clearing Workstream'):\n            with open({:?}, 'w') as receipt:\n                receipt.write('received')\n            time.sleep(60)\n            mcp_session([{{'name': 'workstream_handoff', 'arguments': {{'summary': 'D9 handoff', 'keep_todos': [], 'keep_pads': []}}}}])", receipt.to_str().unwrap()));
        let needle = "        hook(\"Stop\")\n\n\ndef claim_kind():";
        assert_eq!(source.matches(needle).count(), 1);
        let source = source.replace(
            needle,
            &format!(
                "        hook(\"Stop\")\n        with open({:?}, 'w') as ready:\n            ready.write('idle')\n\n\ndef claim_kind():",
                ready.to_str().unwrap()
            ),
        );
        std::fs::write(&fake, source).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let bin = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let wrapper = dir.path().join("rupd");
        std::fs::write(&wrapper, format!("#!/bin/sh\nexport ROUNDUP_CLAUDE_BIN='{}' CLAUDE_CONFIG_DIR='{}/claude-config' ROUNDUP_RUP_BIN='{}/rup' ROUNDUP_HANDOFF_BOUND_MS='{}' FAKE_CLAUDE_PASTE_WHOLE=1 FAKE_CLAUDE_ON_PROMPT='{{\"name\":\"todo_list\",\"arguments\":{{}}}}'\nexec '{}/rupd' \"$@\"\n", fake.display(), dir.path().display(), bin.display(), handoff_bound_ms, bin.display())).unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        Self {
            dir,
            project,
            wrapper,
            receipt,
            ready,
        }
    }

    pub async fn received(&self) {
        signal(&self.receipt).await;
    }

    pub async fn ready(&self) {
        signal(&self.ready).await;
    }
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
