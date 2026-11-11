//! AMG3: a guard end of a fake Agent's `sleep` under a test budget sends one note to the Agent and
//! one to its Door, through a real Daemon and its Message store.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#![allow(clippy::disallowed_methods)] // a test starts its own `sleep` and reads its own harness path
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::path::{Path, PathBuf};
use std::time::Duration;

use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};

async fn inbox(user: &Client, to: &str) -> Vec<Value> {
    user.request("message.list", json!({"to": to}))
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| {
            m["body"]
                .as_str()
                .is_some_and(|b| b.contains("roundup ended sleep ("))
        })
        .cloned()
        .collect()
}

#[tokio::test]
async fn amg3_an_end_notes_the_agent_and_its_door() {
    let dir = tempfile::tempdir().unwrap();
    let bin = PathBuf::from(env!("CARGO_BIN_EXE_rupd"));
    let rup = bin.with_file_name("rup");
    assert!(rup.is_file(), "cargo build -p rup first");
    let daemon = rupd_harness::start(&bin, dir.path(), true, |cmd| {
        cmd.env("ROUNDUP_RUP_BIN", rup)
            .env(
                "ROUNDUP_CLAUDE_BIN",
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py"),
            )
            .env("CLAUDE_CONFIG_DIR", dir.path().join("config"))
            .env("FAKE_CLAUDE_LAUNCH_LOG", dir.path().join("launches"))
            .env("FAKE_CLAUDE_INPUT_LOG", dir.path().join("inputs"))
            .env("RUPD_MEMORY_BUDGET", "1");
    });
    let user = Client::connect(&daemon.socket).await.unwrap();
    let door = user
        .request("rail.createWorkstream", json!({"name": "work"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let caller = Client::connect(&daemon.socket).await.unwrap();
    caller
        .request(
            "daemon.identify",
            json!({"actor": {"kind": "agent", "id": door}}),
        )
        .await
        .unwrap();
    let agent = caller
        .request(
            "agent.spawn",
            json!({"cwd": dir.path(), "name": "worker", "scout": true, "role": "job",
                "order": {"kind": "work", "title": "Work", "ask": "Work", "done": "Done", "limits": []}}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut events = Client::connect(&daemon.socket).await.unwrap();
    events.request("events.subscribe", json!({})).await.unwrap();
    let mut sleep = std::process::Command::new("sleep")
        .arg("30")
        .env("ROUNDUP_AGENT", &agent)
        .spawn()
        .unwrap();

    tokio::time::timeout(Duration::from_secs(15), async {
        let mut seen = 0;
        while seen < 2 {
            let event = events.next_event().await.expect("Daemon event connection open");
            if matches!(event.data, EventData::MessageSent(m) if m.body.contains("roundup ended sleep (")) {
                seen += 1;
            }
        }
    })
    .await
    .expect("the guard's note reached the Agent and its Door");

    let status = sleep.wait().unwrap();
    assert!(!status.success(), "the ended command fails");
    let to_agent = inbox(&user, &agent).await;
    let to_door = inbox(&user, &door).await;
    assert_eq!(to_agent.len(), 1, "one note to the Agent");
    assert_eq!(to_door.len(), 1, "one note to its Door");
    for note in to_agent.iter().chain(&to_door) {
        let body = note["body"].as_str().unwrap();
        assert!(body.contains("roundup ended sleep ("), "{body}");
        assert!(body.contains(" MB)"), "{body}");
        assert!(
            body.contains("Agents used over half of this Mac's memory"),
            "{body}"
        );
        assert!(body.contains("run fewer at once"), "{body}");
    }
}
