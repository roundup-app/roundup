//! DCL5 through a real Daemon over public RPC: a fake `claude` that only reads stdin, hook Signals
//! sent as `agent.signal`, and an injected Agents clock. No pass waits on a timer: each one is
//! started by a Todo event.
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use super::*;
use crate::facts::STALL_MS;
use crate::tests::ask;

pub(crate) struct Run {
    pub(crate) daemon: Daemon,
    pub(crate) now: Arc<AtomicI64>,
    dir: tempfile::TempDir,
    pub(crate) door: String,
}

pub(crate) async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    let response = ask(
        daemon,
        &json!({"id":1,"method":method,"params":params}).to_string(),
    )
    .await;
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

impl Run {
    pub(crate) async fn start() -> Self {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path();
        let fake = project.join("fake-claude");
        std::fs::write(&fake, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nwhile read line; do :; done\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let rup = project.join("rup");
        std::fs::write(&rup, "").unwrap();
        let launcher = agents::claude_code::Launcher::new(
            fake.to_str().unwrap(),
            project.join("claude.json"),
            rup,
            None,
        );
        let now = Arc::new(AtomicI64::new(1));
        let clock = Arc::clone(&now);
        let data = project.join("data");
        let daemon = Daemon::open_stores(project, &data, |_| {
            let bus = Bus::new();
            let terminals = Arc::new(terminal::Terminals::open(&data, bus.clone()).unwrap());
            agents::Agents::open_in(
                project,
                &data,
                bus,
                terminals,
                launcher,
                agents::worktree::Git::from_env(),
            )
            .unwrap()
            .with_clock(move || clock.load(Ordering::SeqCst))
        })
        .unwrap();
        let door = call(&daemon, "rail.createWorkstream", json!({"name":"Ship"})).await["id"]
            .as_str()
            .unwrap()
            .to_owned();
        call(&daemon, "rail.startDoor", json!({"id":door})).await;
        let run = Self {
            daemon,
            now,
            dir,
            door,
        };
        run.signal(&run.door.clone(), "UserPromptSubmit").await;
        run
    }

    pub(crate) async fn spawn(&self, name: &str) -> String {
        let node = call(
            &self.daemon,
            "agent.spawn",
            json!({"name":name,"parent":self.door,"cwd":self.dir.path()}),
        )
        .await;
        node["id"].as_str().unwrap().to_owned()
    }

    pub(crate) async fn signal(&self, id: &str, event: &str) {
        self.signal_with(id, json!({ "hook_event_name": event }))
            .await;
    }

    async fn signal_with(&self, id: &str, payload: Value) {
        let node = call(&self.daemon, "rail.tree", Value::Null).await;
        let node = node
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .unwrap()
            .clone();
        call(
            &self.daemon,
            "agent.signal",
            json!({"id":id,"attempt":node["attempt"],"payload":payload}),
        )
        .await;
    }

    /// A Todo event starts one supervisor pass; the fact it publishes is read back as stored notes.
    async fn pass(&self) {
        call(&self.daemon, "todo.create", json!({"title":"pass"})).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    async fn facts(&self, tag: &str) -> Vec<String> {
        call(&self.daemon, "message.list", json!({"to":self.door}))
            .await
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["from"] == json!(Actor::daemon()))
            .filter_map(|m| m["body"].as_str())
            .filter(|b| b.starts_with(tag))
            .map(str::to_owned)
            .collect()
    }

    async fn label(&self, id: &str) -> String {
        call(&self.daemon, "rail.tree", Value::Null)
            .await
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .unwrap()["status"]["label"]
            .as_str()
            .unwrap()
            .to_owned()
    }
}

#[tokio::test]
async fn dcl5_kill_reports_owned_open_todos_without_reassigning() {
    let run = Run::start().await;
    let child = run.spawn("sub").await;
    let owner = json!({"kind":"agent","id":child,"parent":run.door});
    for i in 0..7 {
        let todo = call(
            &run.daemon,
            "todo.create",
            json!({"title":format!("owned {i}"),"owner":owner}),
        )
        .await;
        call(
            &run.daemon,
            "todo.move",
            json!({"id":todo["id"],"home":run.door}),
        )
        .await;
    }
    for i in 0..14 {
        let todo = call(
            &run.daemon,
            "todo.create",
            json!({"title":format!("loose {i}")}),
        )
        .await;
        call(
            &run.daemon,
            "todo.move",
            json!({"id":todo["id"],"home":run.door}),
        )
        .await;
    }
    run.pass().await;
    assert!(
        run.facts("[ended]").await.is_empty(),
        "the child still lives"
    );
    call(&run.daemon, "agent.stop", json!({"id":child})).await;
    run.pass().await;
    let ended = run.facts("[ended]").await;
    assert_eq!(ended.len(), 1, "{ended:?}");
    assert!(
        ended[0].contains("sub ended with 7 open Todos"),
        "{}",
        ended[0]
    );
    assert!(ended[0].contains("no report"));
    assert!(ended[0].contains("14 open Todos of this Workstream are unassigned"));
    // Published once, and no Todo changed owner.
    run.pass().await;
    assert_eq!(run.facts("[ended]").await.len(), 1);
    let todos = call(&run.daemon, "todo.list", Value::Null).await;
    let owned = todos
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["owner"]["id"] == child.as_str())
        .count();
    assert_eq!(owned, 7);
    run.daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn dcl5_inactive_turn_stalls_but_live_background_work_does_not() {
    let run = Run::start().await;
    let idle = run.spawn("idle-one").await;
    let busy = run.spawn("busy-one").await;
    run.signal(&idle, "UserPromptSubmit").await;
    run.signal(&busy, "UserPromptSubmit").await;
    // A tool call that has not returned is running work.
    run.signal(&busy, "PreToolUse").await;
    run.now.store(STALL_MS + 1, Ordering::SeqCst);
    run.pass().await;
    let stalled = run.facts("[stalled]").await;
    assert_eq!(stalled.len(), 1, "{stalled:?}");
    assert!(stalled.iter().any(|b| b.contains("idle-one")));
    assert!(stalled.iter().all(|b| !b.contains("busy-one")));
    // The Door's own stall is its row's label, not a Message to itself.
    assert_eq!(run.label(&run.door).await, "stalled");
    assert!(stalled.iter().all(|b| !b.contains("Ship")));
    // Once only while the stall holds.
    run.pass().await;
    assert_eq!(run.facts("[stalled]").await.len(), 1);
    // Activity clears the stall.
    run.signal(&idle, "PostToolUse").await;
    run.signal(&run.door.clone(), "PostToolUse").await;
    assert_ne!(run.label(&run.door).await, "stalled");
    run.daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn dcl5_completed_compaction_is_reported_once() {
    let run = Run::start().await;
    let child = run.spawn("compacting").await;
    run.signal(&child, "UserPromptSubmit").await;
    run.signal_with(
        &child,
        json!({"hook_event_name":"PreCompact","trigger":"auto"}),
    )
    .await;
    run.pass().await;
    assert!(
        run.facts("[compacted]").await.is_empty(),
        "a start is not a completion"
    );
    let done = json!({"hook_event_name":"PostCompact","trigger":"auto","compact_summary":"s"});
    run.signal_with(&child, done.clone()).await;
    run.signal_with(&child, done).await;
    run.pass().await;
    run.pass().await;
    let facts = run.facts("[compacted]").await;
    assert_eq!(facts.len(), 1, "{facts:?}");
    assert!(facts[0].contains("compacting"), "{}", facts[0]);
    assert!(!facts[0].contains("token") && !facts[0].contains("cost"));
    run.daemon.stop_terminals().await.unwrap();
}
