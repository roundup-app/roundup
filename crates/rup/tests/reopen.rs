//! U4547e through a real Daemon: a moved running Agent survives a killed Daemon.

#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use std::path::PathBuf;
use std::time::Duration;

use contracts::Kind;
use contracts::agent::RailNode;
use serde_json::{Value, json};

use daemon::{rail_tree, signal, wait_until_idle};

/// U4547e, A12a, D6: a moved running Agent survives a killed Daemon with its identity, parent and
/// one running Terminal, and its retained hooks still reach the reopened Project.
#[tokio::test]
async fn u4547e_reparenting_survives_reopen() {
    let owner = PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("terminal-owner");
    assert!(owner.is_file(), "run `cargo build -p terminal --bins`");
    let fake = [("RUPD_TERMINAL_OWNER", owner.to_str().unwrap())];
    let mut project = daemon::start(&fake);
    let c = project.client().await;
    let workstream: RailNode = serde_json::from_value(
        c.request(
            "rail.createWorkstream",
            json!({"name": "Plan", "parent": null}),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    let mode: RailNode = serde_json::from_value(
        c.request(
            "rail.createWorkstream",
            json!({"name": "Review", "parent": null}),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    c.request(
        "workstream.setOpeningPrompt",
        json!({"id": mode.id, "prompt": "review it"}),
    )
    .await
    .unwrap();
    let into_workstream = project.spawn_agent(&c).await;
    let into_mode = project.spawn_agent(&c).await;
    for (id, parent) in [
        (&into_workstream.id, &workstream.id),
        (&into_mode.id, &mode.id),
    ] {
        c.request("rail.move", json!({"id": id, "parent": parent, "index": 0}))
            .await
            .unwrap();
    }
    let mut events = project.subscribed().await;
    let ids = [into_workstream.id.clone(), into_mode.id.clone()];
    for id in &ids {
        signal(&c, id, json!({ "hook_event_name": "SessionStart" })).await;
    }
    wait_until_idle(
        &mut events,
        &ids,
        std::time::Instant::now() + Duration::from_secs(30),
    )
    .await
    .unwrap();
    let before = rail_tree(&c).await;
    drop(c);

    project.restart(&fake);
    let c = project.client().await;
    let after = rail_tree(&c).await;
    for (id, parent) in [
        (&into_workstream.id, Some(&workstream.id)),
        (&into_mode.id, Some(&mode.id)),
    ] {
        let was = before.iter().find(|n| &n.id == id).unwrap();
        let now = after.iter().find(|n| &n.id == id).expect("same Agent");
        assert_eq!(now.parent.as_ref(), parent);
        assert_eq!(now.name, was.name);
        assert_ne!(now.status.as_ref().map(|s| s.kind), Some(Kind::Done));
        assert!(
            now.terminal_id.is_some(),
            "a Terminal of the new client table"
        );
    }
    let listed: Vec<contracts::terminal::TerminalInfo> =
        serde_json::from_value(c.request("terminal.list", Value::Null).await.unwrap()).unwrap();
    assert_eq!(listed.iter().filter(|t| t.running).count(), 2);
}
