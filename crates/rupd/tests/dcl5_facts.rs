//! DCL5a: the end and stall facts reach the Door through a real Daemon over its socket, with a
//! fake `claude` that only reads stdin and an injected clock. Each wait is on the stored note, not
//! on time.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;

const STALL_MS: i64 = 10 * 60 * 1000;
const BOUND: Duration = Duration::from_secs(5);

struct Run {
    client: Client,
    door: String,
    dir: tempfile::TempDir,
}

impl Run {
    async fn call(&self, method: &str, params: Value) -> Value {
        self.client.request(method, params).await.unwrap()
    }

    async fn node(&self, id: &str) -> Value {
        let tree = self.call("rail.tree", Value::Null).await;
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .unwrap()
            .clone()
    }

    async fn signal(&self, id: &str, event: &str) {
        let attempt = self.node(id).await["attempt"].clone();
        self.call(
            "agent.signal",
            json!({"id":id,"attempt":attempt,"payload":{"hook_event_name":event}}),
        )
        .await;
    }

    async fn spawn(&self, name: &str) -> String {
        let node = self
            .call(
                "agent.spawn",
                json!({"name":name,"parent":self.door,"cwd":self.dir.path()}),
            )
            .await;
        node["id"].as_str().unwrap().to_owned()
    }

    /// A Todo event starts one supervisor pass.
    async fn pass(&self) {
        self.call("todo.create", json!({"title":"pass"})).await;
    }

    /// The Daemon's stored notes to the Door that start with `tag`.
    async fn notes(&self, tag: &str) -> Vec<String> {
        self.call("message.list", json!({}))
            .await
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| {
                m["to"] == self.door.as_str() && m["from"] == json!(contracts::Actor::daemon())
            })
            .filter_map(|m| m["body"].as_str())
            .filter(|b| b.starts_with(tag))
            .map(str::to_owned)
            .collect()
    }

    async fn note_naming(&self, tag: &str, name: &str) -> String {
        tokio::time::timeout(BOUND, async {
            loop {
                if let Some(note) = self.notes(tag).await.into_iter().find(|b| b.contains(name)) {
                    return note;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap_or_else(|_| panic!("no {tag} note naming {name}"))
    }
}

#[tokio::test]
async fn dcl5_end_and_stall_facts_reach_the_door_through_the_daemon() {
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
    let (daemon, watchers) = rupd::test_support::daemon_with_clock(
        project,
        &project.join("data"),
        launcher,
        move || clock.load(Ordering::SeqCst),
    );
    let daemon = Arc::new(daemon);
    let socket = project.join("rupd.sock");
    let server = tokio::spawn(rupd::serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::clone(&daemon),
        watchers,
    ));
    let client = Client::connect(&socket).await.unwrap();
    let mut run = Run {
        client,
        door: String::new(),
        dir,
    };
    run.door = run
        .call("rail.createWorkstream", json!({"name":"Ship"}))
        .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    run.call("rail.startDoor", json!({"id":run.door})).await;
    run.signal(&run.door.clone(), "UserPromptSubmit").await;

    // (a) A killed Subagent owning seven open Todos.
    let sub = run.spawn("sub").await;
    let owner = json!({"kind":"agent","id":sub,"parent":run.door});
    for i in 0..7 {
        let todo = run
            .call(
                "todo.create",
                json!({"title":format!("owned {i}"),"owner":owner}),
            )
            .await;
        run.call("todo.move", json!({"id":todo["id"],"home":run.door}))
            .await;
    }
    run.call("agent.stop", json!({"id":sub})).await;
    run.pass().await;
    let ended = run.note_naming("[ended]", "sub").await;
    assert!(ended.contains("7 open Todos"), "{ended}");
    let todos = run.call("todo.list", Value::Null).await;
    let owned = todos
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["owner"]["id"] == sub.as_str())
        .count();
    assert_eq!(owned, 7, "owners are unchanged");

    // (b) A working Agent unchanged past the stall limit, and (c) the Door itself.
    let first = run.spawn("idle-one").await;
    run.signal(&first, "UserPromptSubmit").await;
    now.store(STALL_MS + 1, Ordering::SeqCst);
    run.pass().await;
    run.note_naming("[stalled]", "idle-one").await;
    assert_eq!(run.node(&run.door).await["status"]["label"], "stalled");
    // A later pass, shown to have run by a second Agent's stall, repeats neither fact.
    let second = run.spawn("idle-two").await;
    run.signal(&second, "UserPromptSubmit").await;
    now.store(2 * STALL_MS + 2, Ordering::SeqCst);
    run.pass().await;
    run.note_naming("[stalled]", "idle-two").await;
    assert_eq!(run.notes("[ended]").await.len(), 1);
    let stalled = run.notes("[stalled]").await;
    assert_eq!(
        stalled.iter().filter(|b| b.contains("idle-one")).count(),
        1,
        "{stalled:?}"
    );
    assert!(
        stalled.iter().all(|b| !b.contains("Ship")),
        "the Door's stall is a row label, not a note: {stalled:?}"
    );
    server.abort();
    daemon.stop_terminals().await.unwrap();
}
