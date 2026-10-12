//! O12: the Door spawns the Agent with the order it wrote, against a real `rupd` and a fake `claude`.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::path::Path;
use std::time::{Duration, Instant};

use contracts::Kind;
use daemon::{Project, rail_tree};
use serde_json::{Value, json};

/// A digest of the Door's Subagents arrives as a prompt too, and is not a user's words.
const DIGEST: &str = r"\[from rupd";
const TYPED: &str = "fix the build, it fails on main since Friday";

async fn until<T>(what: &str, mut probe: impl AsyncFnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(found) = probe().await {
            return found;
        }
        assert!(Instant::now() < deadline, "never: {what}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// A Door that, on each prompt, spawns an Agent with its own `ask` and the prompt it was typed,
/// then tells the user which Agent it started.
async fn door_that_spawns(log: &Path) -> (Project, rpc::Client, String) {
    let dir = tempfile::tempdir().unwrap();
    let project_dir = dir.path().to_owned();
    let calls = json!([
        {"name": "agent_spawn", "skip_prompt": DIGEST, "arguments": {
            "cwd": project_dir,
            "order": {"kind": "work", "ask": "Make the build pass on main.", "done": "just check is green", "limits": ["no force push"]},
            "prompt": "$prompt",
            "name": "fix the build",
        }},
        {"name": "message_send", "skip_prompt": DIGEST, "arguments": {
            "to": "you",
            "kind": "note",
            "body": "Started fix the build: it will make the build pass on main.",
        }},
    ]);
    let project = daemon::start_in(
        dir,
        tempfile::tempdir().unwrap(),
        &[
            ("FAKE_CLAUDE_ON_PROMPT", &calls.to_string()),
            ("FAKE_CLAUDE_PASTE_WHOLE", "1"),
            ("FAKE_CLAUDE_ORDER_PROMPTS", "1"),
            ("FAKE_CLAUDE_PROMPT_LOG", log.to_str().unwrap()),
        ],
    );
    let user = project.client().await;
    let door = user
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    until("the Door is idle", async || {
        rail_tree(&user)
            .await
            .into_iter()
            .find(|n| n.id == door)
            .and_then(|n| n.status)
            .filter(|s| s.kind == Kind::Idle)
    })
    .await;
    (project, user, door)
}

async fn run() -> (Project, rpc::Client, String, String, String) {
    let scratch = tempfile::tempdir().unwrap().keep();
    let log = scratch.join("prompts.jsonl");
    let (project, user, door) = door_that_spawns(&log).await;
    user.request(
        "message.send",
        json!({"to": door, "kind": "note", "body": TYPED}),
    )
    .await
    .unwrap();
    let agent = until("the Door's Agent", async || {
        rail_tree(&user)
            .await
            .into_iter()
            .find(|n| n.parent.as_deref() == Some(&door))
            .map(|n| n.id)
    })
    .await;
    let typed = until("the Door's prompt", async || {
        std::fs::read_to_string(&log)
            .unwrap_or_default()
            .lines()
            .map(|l| {
                serde_json::from_str::<Value>(l).unwrap()["prompt"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .find(|p| p.contains(TYPED))
    })
    .await;
    (project, user, door, agent, typed)
}

#[tokio::test]
async fn o12_the_door_spawns_with_order_and_the_users_words() {
    let (_project, user, _door, agent, typed) = run().await;

    let stored = user
        .request("agent.spawnPrompt", json!({"id": agent}))
        .await
        .unwrap();
    assert_eq!(stored["prompt"], typed);
    assert!(typed.ends_with(TYPED), "{typed}");
    let node = rail_tree(&user)
        .await
        .into_iter()
        .find(|n| n.id == agent)
        .unwrap();
    let order = serde_json::to_value(&node).unwrap();
    let ask = order["work"]["ask"].as_str().unwrap();
    assert_eq!(ask, "Make the build pass on main.");
    assert_ne!(ask, typed);
}

#[tokio::test]
async fn o12_the_door_reports_the_new_agent_to_the_user() {
    let (_project, user, door, _agent, _typed) = run().await;

    let note = until("the Door's note", async || {
        let listed = user
            .request("message.list", json!({"to": "you"}))
            .await
            .unwrap();
        listed
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["from"]["id"] == door.as_str())
            .cloned()
    })
    .await;
    assert_eq!(note["kind"], "note");
    assert!(note["body"].as_str().unwrap().contains("fix the build"));
}
