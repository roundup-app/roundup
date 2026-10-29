//! X11 an Agent's Run and X12 a Terminal the user opens: Terminals a bubble shows, never Rail rows.

use std::time::Duration;

use contracts::agent::NodeKind;
use contracts::terminal::TerminalInfo;
use contracts::{Actor, ActorKind, EventData};
use rpc::code;
use serde_json::{Value, json};

use crate::common::{Fixture, until_file};

impl Fixture {
    async fn run(&self, agent: &str, script: &str) -> Result<String, rpc::RpcError> {
        let run = self
            .call(
                "agent.run",
                json!({"id": agent, "command": ["/bin/sh", "-c", script]}),
            )
            .await?;
        Ok(run["terminal_id"].as_str().unwrap().to_owned())
    }

    async fn open(&self, workstream: &str) -> Result<String, rpc::RpcError> {
        let opened = self
            .call("terminal.open", json!({"workstream": workstream}))
            .await?;
        Ok(opened["terminal_id"].as_str().unwrap().to_owned())
    }

    async fn close(&self, id: &str) -> Result<Value, rpc::RpcError> {
        self.terminals_call("terminal.close", json!({"id": id}))
            .await
    }

    async fn listed(&self, id: &str) -> Option<TerminalInfo> {
        self.terminals.list().await.into_iter().find(|t| t.id == id)
    }

    async fn until_exited(&self, id: &str) {
        for _ in 0..500 {
            if self.listed(id).await.is_some_and(|t| !t.running) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("terminal {id} never exited");
    }
}

/// How many `terminal.changed` events arrived on `events` since the last call.
fn terminal_changes(events: &mut tokio::sync::broadcast::Receiver<contracts::Event>) -> usize {
    std::iter::from_fn(|| events.try_recv().ok())
        .filter(|event| matches!(event.data, EventData::TerminalChanged))
        .count()
}

#[tokio::test]
async fn x11_agent_run_starts_an_owned_terminal_and_adds_no_rail_node() {
    let mut f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    let mut events = f.bus.subscribe();
    let tree = f.tree().await;
    f.changed();

    let id = f.run(&agent.id, "sleep 30").await.unwrap();

    let run = f.listed(&id).await.expect("the Run is listed");
    assert_eq!(run.owner.as_deref(), Some(agent.id.as_str()));
    assert!(run.running);
    assert_eq!(f.tree().await, tree);
    assert_eq!(f.changed(), 0);
    assert_eq!(terminal_changes(&mut events), 1);
}

#[tokio::test]
async fn x11_the_run_prints_and_the_agent_status_is_unchanged() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    let before = f.tree().await;

    f.run(&agent.id, "echo hi > ran; sleep 30").await.unwrap();

    assert_eq!(until_file(&f.dir.path().join("ran")).await, "hi\n");
    assert_eq!(f.tree().await, before);
}

#[tokio::test]
async fn x11_a_run_exit_never_changes_the_agent_status() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    let before = f.tree().await;

    let id = f.run(&agent.id, "exit 3").await.unwrap();
    f.until_exited(&id).await;

    assert_eq!(f.listed(&id).await.unwrap().exit_code, Some(3));
    assert_eq!(f.tree().await, before);
}

#[tokio::test]
async fn x11_an_unknown_workstream_or_empty_command_is_refused() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    let workstream = f.workstream("team", None).await;

    let unknown = f.run("999", "true").await.unwrap_err();
    let not_an_agent = f.run(&workstream, "true").await.unwrap_err();
    let empty = f
        .call("agent.run", json!({"id": agent.id, "command": []}))
        .await
        .unwrap_err();

    assert_eq!(
        (unknown.code, not_an_agent.code, empty.code),
        (code::NOT_FOUND, code::INVALID_PARAMS, code::INVALID_PARAMS)
    );
    assert!(f.terminals.list().await.iter().all(|t| t.owner.is_none()));
}

#[tokio::test]
async fn x11_the_ninth_forgets_the_oldest_exited_and_conflicts_when_all_run() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    let mut ids = Vec::new();
    for _ in 0..8 {
        ids.push(f.run(&agent.id, "exit 0").await.unwrap());
    }
    for id in &ids {
        f.until_exited(id).await;
    }

    let ninth = f.run(&agent.id, "sleep 30").await.unwrap();

    assert!(f.listed(&ids[0]).await.is_none());
    for id in &ids[1..] {
        assert!(f.listed(id).await.is_some());
    }
    assert!(f.listed(&ninth).await.is_some_and(|t| t.running));

    let workstream = f.workstream("team", None).await;
    for _ in 0..8 {
        f.open(&workstream).await.unwrap();
    }
    let before = f.terminals.list().await.len();
    let refused = f.open(&workstream).await.unwrap_err();
    assert_eq!(refused.code, code::CONFLICT);
    assert_eq!(f.terminals.list().await.len(), before);
}

#[tokio::test]
async fn x11_remove_the_agent_forgets_its_runs() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    let mut events = f.bus.subscribe();
    f.run(&agent.id, "sleep 30").await.unwrap();
    f.run(&agent.id, "sleep 30").await.unwrap();
    terminal_changes(&mut events);

    f.call("rail.remove", json!({"id": agent.id}))
        .await
        .unwrap();

    assert!(
        f.terminals
            .list()
            .await
            .iter()
            .all(|t| t.owner.as_deref() != Some(agent.id.as_str()))
    );
    assert_eq!(terminal_changes(&mut events), 1);
}

#[tokio::test]
async fn x11_a_killed_run_stays_exited_until_closed() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    let id = f.run(&agent.id, "sleep 30").await.unwrap();

    f.terminals.kill(&id).await.unwrap();
    f.until_exited(&id).await;

    assert!(f.listed(&id).await.is_some_and(|t| !t.running));
    f.close(&id).await.unwrap();
    assert!(f.listed(&id).await.is_none());
}

#[tokio::test]
async fn x11_no_run_survives_a_restart() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();
    f.run(&agent.id, "sleep 30").await.unwrap();

    let f = f.reopen();

    assert!(f.terminals.list().await.is_empty());
}

#[tokio::test]
async fn x11_rail_spawn_terminal_and_a_kind_terminal_no_longer_exist() {
    let f = Fixture::new();

    let gone = f
        .call(
            "rail.spawnTerminal",
            json!({"cwd": f.dir.path(), "parent": null}),
        )
        .await
        .unwrap_err();

    assert_eq!(gone.code, code::METHOD_NOT_FOUND);
    assert!(serde_json::from_value::<NodeKind>(json!("terminal")).is_err());
}

#[tokio::test]
async fn x12_open_starts_the_login_shell_owned_by_the_workstream_with_no_rail_node() {
    let mut f = Fixture::new();
    let workstream = f.workstream("team", None).await;
    let mut events = f.bus.subscribe();
    let tree = f.tree().await;
    f.changed();

    let id = f.open(&workstream).await.unwrap();

    let terminal = f.listed(&id).await.expect("the Terminal is listed");
    assert_eq!(terminal.owner.as_deref(), Some(workstream.as_str()));
    assert!(terminal.running);
    // The Fixture's folder stands in for `.roundup/`: the Project folder is its parent.
    assert_eq!(
        std::path::Path::new(&terminal.cwd).canonicalize().unwrap(),
        f.dir.path().parent().unwrap().canonicalize().unwrap()
    );
    assert_eq!(f.tree().await, tree);
    assert_eq!(f.changed(), 0);
    assert_eq!(terminal_changes(&mut events), 1);
}

#[tokio::test]
async fn x12_an_unknown_or_non_workstream_owner_is_refused() {
    let f = Fixture::running("sleep 30");
    let agent = f.spawn(None, None).await.unwrap();

    let unknown = f.open("999").await.unwrap_err();
    let agent = f.open(&agent.id).await.unwrap_err();

    assert_eq!(
        (unknown.code, agent.code),
        (code::NOT_FOUND, code::INVALID_PARAMS)
    );
    assert!(f.terminals.list().await.iter().all(|t| t.owner.is_none()));
}

#[tokio::test]
async fn x12_close_kills_and_forgets_an_owned_terminal() {
    let f = Fixture::new();
    let workstream = f.workstream("team", None).await;
    let id = f.open(&workstream).await.unwrap();
    let mut events = f.bus.subscribe();

    f.close(&id).await.unwrap();

    assert!(f.listed(&id).await.is_none());
    assert_eq!(terminal_changes(&mut events), 1);
    for method in [
        "terminal.write",
        "terminal.kill",
        "terminal.snapshot",
        "terminal.close",
    ] {
        let err = f
            .terminals_call(method, json!({"id": id, "data": ""}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND, "{method}");
    }
}

#[tokio::test]
async fn x12_close_on_an_ownerless_terminal_is_refused_and_leaves_it() {
    let f = Fixture::new();
    let spawned = f
        .terminals
        .spawn(contracts::terminal::SpawnParams {
            cwd: f.dir.path().to_string_lossy().into_owned(),
            command: Some(vec!["/bin/sh".into(), "-c".into(), "sleep 30".into()]),
            env: Default::default(),
            cols: 80,
            rows: 24,
        })
        .await
        .unwrap();

    let err = f.close(&spawned.id).await;

    assert_eq!(err.unwrap_err().code, code::INVALID_PARAMS);
    assert!(f.listed(&spawned.id).await.is_some_and(|t| t.running));
}

#[tokio::test]
async fn x12_removing_the_workstream_closes_its_terminals() {
    let f = Fixture::running("sleep 30");
    let workstream = f.workstream("team", None).await;
    let child = f.spawn(Some(&workstream), None).await.unwrap();
    let id = f.open(&workstream).await.unwrap();
    let mut events = f.bus.subscribe();

    f.call("rail.remove", json!({"id": workstream}))
        .await
        .unwrap();

    assert!(f.listed(&id).await.is_none());
    assert_eq!(terminal_changes(&mut events), 1);
    let tree = f.tree().await;
    assert!(tree.iter().any(|n| n.id == child.id && n.parent.is_none()));
    assert!(
        f.listed(child.terminal_id.as_deref().unwrap())
            .await
            .is_some_and(|t| t.running)
    );
}

impl Fixture {
    async fn terminals_call(&self, method: &str, params: Value) -> Result<Value, rpc::RpcError> {
        let ctx = rpc::Ctx {
            actor: Actor {
                kind: ActorKind::User,
                id: "you".into(),
                parent: None,
            },
            ..self.ctx()
        };
        rpc::Module::call(&*self.terminals, &ctx, method, params).await
    }
}
