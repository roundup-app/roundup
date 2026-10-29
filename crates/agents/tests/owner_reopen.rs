//! A12a: a surviving Terminal owner keeps its Agent across `Agents::open`.
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agents::Agents;
use agents::claude_code::Launcher;
use agents::worktree::Git;
use contracts::Kind;
use contracts::agent::RailNode;
use contracts::terminal::TerminalInfo;
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
    assert!(terminals.list().await.iter().all(|t| !t.running));
}
