//! A35: durable Checkpoint Marks against a real `rupd`, a fake `claude` and real git.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use contracts::agent::RailNode;
use contracts::{Actor, ActorKind, IdentifyParams, Kind};
use daemon::{Project, rail_tree};
use serde_json::{Value, json};

struct Fix {
    project: Project,
    log: PathBuf,
    /// While this file exists the fake `claude` plays its `SessionStart`; a start without it hangs.
    hold: PathBuf,
    user: rpc::Client,
    ws: String,
    a: String,
    b: String,
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

async fn until<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(found) = probe() {
            return found;
        }
        assert!(Instant::now() < deadline, "never: {what}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn as_actor(project: &Project, kind: ActorKind, id: &str) -> rpc::Client {
    let client = project.client().await;
    let actor = Actor {
        kind,
        id: id.into(),
        parent: None,
    };
    client
        .request("daemon.identify", IdentifyParams { actor })
        .await
        .unwrap();
    client
}

async fn node(client: &rpc::Client, id: &str) -> Option<RailNode> {
    rail_tree(client).await.into_iter().find(|n| n.id == id)
}

async fn idle(client: &rpc::Client, id: &str) {
    for _ in 0..1200 {
        if node(client, id)
            .await
            .and_then(|n| n.status)
            .is_some_and(|s| s.kind == Kind::Idle)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("{id} never became idle: {:?}", node(client, id).await);
}

/// Idle and staying idle: Subagents' digests keep steering a Door for a moment after they change.
async fn settle(client: &rpc::Client, id: &str) {
    let mut quiet = Instant::now();
    loop {
        let kind = node(client, id)
            .await
            .and_then(|n| n.status)
            .map(|s| s.kind);
        match kind {
            Some(Kind::Idle) if quiet.elapsed() > Duration::from_millis(1500) => return,
            Some(Kind::Idle) => {}
            Some(Kind::Done | Kind::Error) | None => return,
            _ => quiet = Instant::now(),
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Who is on the Rail and under whom.
async fn shape(client: &rpc::Client) -> Vec<(String, Option<String>)> {
    rail_tree(client)
        .await
        .into_iter()
        .map(|n| (n.id, n.parent))
        .collect()
}

fn prompts(log: &Path) -> Vec<Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|p| !p["prompt"].as_str().unwrap().starts_with("{\"name\""))
        .collect()
}

async fn fixture_with(bound_ms: &str) -> Fix {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "roundup"]);
    git(dir.path(), &["config", "user.email", "roundup@example.com"]);
    std::fs::write(dir.path().join("README"), "keep").unwrap();
    git(dir.path(), &["add", "README"]);
    git(dir.path(), &["commit", "-qm", "base"]);
    let log = dir.path().join("prompts.jsonl");
    let hold = dir.path().join("hold-start");
    std::fs::write(&hold, "").unwrap();
    let tool = json!({"name": "todo_list", "arguments": {}}).to_string();
    let project = daemon::start_in(
        dir,
        tempfile::tempdir().unwrap(),
        &[
            ("FAKE_CLAUDE_ON_PROMPT", &tool),
            ("FAKE_CLAUDE_PASTE_WHOLE", "1"),
            ("FAKE_CLAUDE_PROMPT_LOG", log.to_str().unwrap()),
            ("FAKE_CLAUDE_HOLD_START", hold.to_str().unwrap()),
            ("ROUNDUP_HANDOFF_BOUND_MS", bound_ms),
        ],
    );
    let user = project.client().await;
    user.request("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let ws = user
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({"id": ws}))
        .await
        .unwrap();
    idle(&user, &ws).await;
    let spawn = |parent: Value, client: rpc::Client| {
        let cwd = project.dir.path().to_owned();
        async move {
            let node = client
                .request(
                    "agent.spawn",
                    json!({"cwd": cwd, "prompt": null, "parent": parent}),
                )
                .await
                .unwrap();
            serde_json::from_value::<RailNode>(node).unwrap().id
        }
    };
    let a = spawn(json!(ws), project.client().await).await;
    let b = spawn(Value::Null, as_actor(&project, ActorKind::Agent, &a).await).await;
    Fix {
        project,
        log,
        hold,
        user,
        ws,
        a,
        b,
    }
}

async fn fixture() -> Fix {
    fixture_with("60000").await
}

async fn write(fx: &Fix) -> Value {
    as_actor(&fx.project, ActorKind::Agent, &fx.ws)
        .await
        .request(
            "checkpoint.write",
            json!({"title": "ready", "blocks": [{"kind": "text", "text": "facts"}]}),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn a35_write_records_a_mark_per_agent() {
    let fx = fixture().await;
    let before = git(fx.project.dir.path(), &["status", "--porcelain=v1"]);
    let head = git(fx.project.dir.path(), &["rev-parse", "HEAD"]);
    write(&fx).await;
    let listed = fx
        .user
        .request("checkpoint.list", json!({"workstream": fx.ws}))
        .await
        .unwrap();
    assert_eq!(listed[0]["rewindable"], true);
    assert_eq!(
        git(fx.project.dir.path(), &["status", "--porcelain=v1"]),
        before
    );
    assert_eq!(git(fx.project.dir.path(), &["rev-parse", "HEAD"]), head);
}
