//! A12a: a surviving Terminal owner keeps its Agent across `Agents::open`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agents::Agents;
use agents::claude_code::Launcher;
use agents::worktree::Git;
use contracts::agent::RailNode;
use contracts::terminal::TerminalInfo;
use contracts::{EventData, Kind};
use rpc::{Bus, Ctx, Module};
use serde_json::{Value, json};
use terminal::Terminals;

fn helper() -> PathBuf {
    let target = std::env::var_os("CARGO_TARGET_DIR").map_or_else(
        || Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target"),
        PathBuf::from,
    );
    let path = target.join("debug/terminal-owner");
    if !path.exists() {
        let built =
            std::process::Command::new(std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
                .args(["build", "-p", "terminal", "--bin", "terminal-owner"])
                .status()
                .unwrap();
        assert!(
            built.success() && path.exists(),
            "cargo build -p terminal --bin terminal-owner"
        );
    }
    path
}

fn open(dir: &Path, bus: &Bus) -> (Agents, Arc<Terminals>) {
    let terminals = Arc::new(
        Terminals::open(dir, bus.clone())
            .unwrap()
            .with_terminal_owner(&helper()),
    );
    let rup = dir.join("rup");
    std::fs::write(&rup, "").unwrap();
    let launcher = Launcher::new(
        dir.join("fake-claude").to_string_lossy().into_owned(),
        dir.join("claude.json"),
        rup,
        None,
    );
    let agents = Agents::open_with(
        dir,
        bus.clone(),
        Arc::clone(&terminals),
        launcher,
        Git::from_env(),
        agents::Quiet::default().shared(),
    )
    .unwrap();
    (agents, terminals)
}

async fn call(agents: &Agents, bus: &Bus, method: &str, params: Value) -> Value {
    let ctx = Ctx {
        actor: contracts::Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(provenance::Touches::in_memory().unwrap()),
    };
    agents.call(&ctx, method, params).await.unwrap()
}

async fn tree(agents: &Agents, bus: &Bus) -> Vec<RailNode> {
    serde_json::from_value(call(agents, bus, "rail.tree", Value::Null).await).unwrap()
}

#[tokio::test]
async fn a12a_a_surviving_owner_keeps_its_agent_across_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().canonicalize().unwrap();
    let script = data.join("fake-claude");
    std::fs::write(&script, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bus = Bus::new();

    let (agents, _terminals) = open(&data, &bus);
    let cwd = data.to_string_lossy().into_owned();
    let spawned: RailNode =
        serde_json::from_value(call(&agents, &bus, "agent.spawn", json!({"cwd": cwd})).await)
            .unwrap();
    drop(agents);

    let (agents, terminals) = open(&data, &bus);
    assert_eq!(
        tree(&agents, &bus).await[0].status.as_ref().map(|s| s.kind),
        Some(Kind::Done)
    );
    assert_eq!(
        agents.reattach_owners().await,
        std::slice::from_ref(&spawned.id)
    );

    let node = tree(&agents, &bus).await.remove(0);
    assert_eq!(node.id, spawned.id);
    assert_ne!(node.status.as_ref().map(|s| s.kind), Some(Kind::Done));
    let id = node
        .terminal_id
        .expect("a Terminal of the new client table");
    let running: Vec<TerminalInfo> = terminals
        .list()
        .await
        .into_iter()
        .filter(|t| t.running)
        .collect();
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].id, id);

    terminals.kill(&id).await.unwrap();
}

/// A12a: an owner that exited before the reopen is dropped, and its Agent reports `done` (A8).
#[tokio::test]
async fn a12a_an_exited_owner_falls_back_to_done() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().canonicalize().unwrap();
    let script = data.join("fake-claude");
    std::fs::write(&script, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bus = Bus::new();

    let (agents, terminals) = open(&data, &bus);
    let cwd = data.to_string_lossy().into_owned();
    let spawned: RailNode =
        serde_json::from_value(call(&agents, &bus, "agent.spawn", json!({"cwd": cwd})).await)
            .unwrap();
    terminals
        .kill(spawned.terminal_id.as_deref().unwrap())
        .await
        .unwrap();
    drop(agents);

    let (agents, terminals) = open(&data, &bus);
    assert!(agents.reattach_owners().await.is_empty());
    let node = tree(&agents, &bus).await.remove(0);
    assert_eq!(node.status.as_ref().map(|s| s.kind), Some(Kind::Done));
    assert_eq!(node.terminal_id, None);
    // U5151d: the label says what to do next, not an internal state.
    let label = node.status.as_ref().unwrap().label.as_str();
    assert!(
        label.contains("resume") && !label.contains("gone"),
        "{label}"
    );
    assert!(terminals.list().await.iter().all(|t| !t.running));
}

/// A12a: an owner no record of the rail can adopt is stopped, so a resume never runs beside it.
#[tokio::test]
async fn a12a_an_owner_that_cannot_be_adopted_is_stopped() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().canonicalize().unwrap();
    let script = data.join("fake-claude");
    std::fs::write(&script, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bus = Bus::new();

    let (agents, _terminals) = open(&data, &bus);
    let cwd = data.to_string_lossy().into_owned();
    let spawned: RailNode =
        serde_json::from_value(call(&agents, &bus, "agent.spawn", json!({"cwd": cwd})).await)
            .unwrap();
    drop(agents);

    let file = data.join("owners").join(format!("{}.json", spawned.id));
    let mut record: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    let owner: terminal::TerminalOwner = serde_json::from_value(record["owner"].clone()).unwrap();
    owner.connect(&data).await.expect("the owner is alive");
    record["attempt"] = json!("99");
    std::fs::write(&file, serde_json::to_vec(&record).unwrap()).unwrap();

    let (agents, terminals) = open(&data, &bus);
    assert!(agents.reattach_owners().await.is_empty());
    assert!(terminals.list().await.iter().all(|t| !t.running));
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(100));
    let stopped = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while owner.connect(&data).await.is_ok() {
            tick.tick().await;
        }
    })
    .await;
    assert!(stopped.is_ok(), "the unadopted owner still runs");
}

/// A5335a: two restarts in a row keep every live child, each with its Terminal and never
/// `terminal gone`, and the owner records survive the first restart.
#[tokio::test]
async fn a5335a_two_restarts_keep_every_live_child() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().canonicalize().unwrap();
    let script = data.join("fake-claude");
    std::fs::write(&script, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bus = Bus::new();

    let (agents, _terminals) = open(&data, &bus);
    let cwd = data.to_string_lossy().into_owned();
    let mut ids = Vec::new();
    for _ in 0..3 {
        let node: RailNode =
            serde_json::from_value(call(&agents, &bus, "agent.spawn", json!({"cwd": cwd})).await)
                .unwrap();
        ids.push(node.id);
    }
    drop(agents);

    for _ in 0..2 {
        let (agents, terminals) = open(&data, &bus);
        let mut kept = agents.reattach_owners().await;
        kept.sort();
        assert_eq!(kept, ids);
        let nodes = tree(&agents, &bus).await;
        assert_eq!(nodes.len(), 3);
        for node in &nodes {
            assert!(node.terminal_id.is_some());
            let status = node.status.as_ref().expect("status");
            assert_ne!(status.kind, Kind::Done);
            assert!(!status.label.starts_with("Terminal closed"));
        }
        assert_eq!(
            terminals.list().await.iter().filter(|t| t.running).count(),
            3
        );
        drop(agents);
    }
}

/// A5335d: a reopen launches no child again; the fake `claude` logs its cwd on each launch.
#[tokio::test]
async fn a5335d_reopen_keeps_each_launch_count_at_one() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().canonicalize().unwrap();
    let log = data.join("launches.log");
    let script = data.join("fake-claude");
    std::fs::write(&script, format!("#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\npwd >> '{}'\nexec sleep 30\n", log.display())).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bus = Bus::new();

    let (agents, _terminals) = open(&data, &bus);
    let mut ids = Vec::new();
    for name in ["one", "two", "three"] {
        let cwd = data.join(name);
        std::fs::create_dir(&cwd).unwrap();
        let node: RailNode = serde_json::from_value(
            call(
                &agents,
                &bus,
                "agent.spawn",
                json!({"cwd": cwd.to_string_lossy()}),
            )
            .await,
        )
        .unwrap();
        ids.push(node.id);
    }
    drop(agents);

    for round in 0..2 {
        let (agents, terminals) = open(&data, &bus);
        let mut kept = agents.reattach_owners().await;
        kept.sort();
        ids.sort();
        assert_eq!(kept, ids);
        let nodes = tree(&agents, &bus).await;
        assert_eq!(nodes.len(), 3);
        assert!(
            nodes.iter().all(|n| n.terminal_id.is_some()
                && n.status.as_ref().map(|s| s.kind) != Some(Kind::Done))
        );
        assert_eq!(
            terminals.list().await.iter().filter(|t| t.running).count(),
            3
        );
        let launched = std::fs::read_to_string(&log).unwrap();
        for name in ["one", "two", "three"] {
            let n = launched
                .lines()
                .filter(|l| l.ends_with(&format!("/{name}")))
                .count();
            assert_eq!(n, 1, "{name} launched {n} times");
        }
        drop(agents);
        if round == 1 {
            for t in terminals.list().await {
                terminals.kill(&t.id).await.unwrap();
            }
        }
    }
}

/// DCL3c: an open background Agent survives a Daemon reopen with its owner, so the stop that
/// follows the reopen ends it; a stop for an Agent never started ends nothing.
#[tokio::test]
async fn dcl3c_reopen_keeps_open_background_agent_until_its_own_stop() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().canonicalize().unwrap();
    let script = data.join("fake-claude");
    std::fs::write(&script, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bus = Bus::new();

    let (agents, _terminals) = open(&data, &bus);
    let cwd = data.to_string_lossy().into_owned();
    let spawned: RailNode =
        serde_json::from_value(call(&agents, &bus, "agent.spawn", json!({"cwd": cwd})).await)
            .unwrap();
    let signal = async |agents: &Agents, event: Value| {
        let payload = json!({"id": spawned.id, "attempt": "1", "payload": event});
        call(agents, &bus, "agent.signal", payload).await
    };
    for event in [
        json!({"hook_event_name":"SessionStart","source":"startup"}),
        json!({"hook_event_name":"UserPromptSubmit"}),
        json!({"hook_event_name":"SubagentStart","agent_id":"C"}),
        json!({"hook_event_name":"Stop"}),
    ] {
        signal(&agents, event).await;
    }
    assert_eq!(kind(&agents, &bus).await, Kind::Working, "held by C");
    drop(agents);

    let (agents, terminals) = open(&data, &bus);
    let mut events = bus.subscribe();
    assert_eq!(
        agents.reattach_owners().await,
        std::slice::from_ref(&spawned.id)
    );
    // The dropped SubagentStop of another id (ADR 0006) ends nothing.
    signal(
        &agents,
        json!({"hook_event_name":"SubagentStop","agent_id":"other"}),
    )
    .await;
    assert_eq!(kind(&agents, &bus).await, Kind::Working);
    signal(
        &agents,
        json!({"hook_event_name":"SubagentStop","agent_id":"C"}),
    )
    .await;
    // The first process snapshot of the reopened Daemon, or this stop, releases the hold.
    let idle = async {
        loop {
            if let Ok(event) = events.recv().await
                && matches!(&event.data, EventData::AgentStatus(s) if s.status.kind == Kind::Idle)
            {
                break;
            }
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(15), idle)
        .await
        .expect("the stop of the retained Agent ends the hold");
    assert_eq!(kind(&agents, &bus).await, Kind::Idle);
    let terminal = tree(&agents, &bus).await.remove(0).terminal_id.unwrap();
    terminals.kill(&terminal).await.unwrap();
}

async fn kind(agents: &Agents, bus: &Bus) -> Kind {
    tree(agents, bus).await[0].status.as_ref().unwrap().kind
}

/// X6570b: a failed owner lookup fails the save and writes no owner file.
#[tokio::test]
async fn x6570b_save_owner_fails_when_the_lookup_fails() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().canonicalize().unwrap();
    let script = data.join("fake-claude");
    std::fs::write(&script, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bus = Bus::new();
    let (agents, terminals) = open(&data, &bus);
    let cwd = data.to_string_lossy().into_owned();
    let spawned: RailNode =
        serde_json::from_value(call(&agents, &bus, "agent.spawn", json!({"cwd": cwd})).await)
            .unwrap();
    let terminal = spawned.terminal_id.clone().unwrap();
    let file = data.join("owners").join(format!("{}.json", spawned.id));
    assert!(file.exists());

    std::fs::remove_file(&file).unwrap();
    terminals.kill(&terminal).await.unwrap();
    terminals.poison_remote_table_for_test();
    let err = agents
        .save_owner_for_test(&spawned.id, &terminal)
        .unwrap_err();
    assert_eq!(err.code, rpc::code::INTERNAL);
    assert!(!file.exists());

    // A directly owned Terminal writes no file and succeeds.
    let direct = Terminals::open(&data, bus.clone()).unwrap();
    assert!(direct.terminal_owner(&terminal).unwrap().is_none());
}

/// A12a: a new process for an Agent never starts beside a surviving owner nothing adopted.
#[tokio::test]
async fn a12a_a_start_stops_the_surviving_owner_of_the_same_agent() {
    let dir = tempfile::tempdir().unwrap();
    let data = dir.path().canonicalize().unwrap();
    let script = data.join("fake-claude");
    std::fs::write(&script, "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nexec sleep 30\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let bus = Bus::new();
    let (agents, _terminals) = open(&data, &bus);
    let cwd = data.to_string_lossy().into_owned();
    let spawned: RailNode =
        serde_json::from_value(call(&agents, &bus, "agent.spawn", json!({"cwd": cwd})).await)
            .unwrap();
    drop(agents);

    // A reopened Daemon that never adopted the owner is about to start a second process.
    let (agents, _terminals) = open(&data, &bus);
    agents.stop_recorded_owner_for_test(&spawned.id).await;
    // The surviving owner is gone, so a new process starts alone. Adopting finds nothing.
    assert!(agents.reattach_owners().await.is_empty());
}
