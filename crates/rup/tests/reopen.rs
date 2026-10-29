//! U4547e through a real Daemon: a moved running Agent survives a killed Daemon.

#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use std::path::PathBuf;
use std::time::Duration;

use contracts::Kind;
use contracts::agent::RailNode;
use serde_json::{Value, json};

use daemon::{rail_tree, wait_until_idle};

/// U4547e, A12a, D6: a moved running Agent survives a killed Daemon with its identity, parent and
/// one running Terminal, and its retained hooks still reach the reopened Project.
#[tokio::test]
async fn u4547e_reparenting_survives_reopen() {
    let owner = PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("terminal-owner");
    assert!(owner.is_file(), "run `cargo build -p terminal --bins`");
    let logs = tempfile::tempdir().unwrap();
    let launches = logs.path().join("launches");
    let inputs = logs.path().join("inputs");
    let fake = [
        ("RUPD_TERMINAL_OWNER", owner.to_str().unwrap()),
        ("FAKE_CLAUDE_LAUNCH_LOG", launches.to_str().unwrap()),
        ("FAKE_CLAUDE_INPUT_LOG", inputs.to_str().unwrap()),
    ];
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
    let mut events = project.subscribed().await;
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
    let ids = [into_workstream.id.clone(), into_mode.id.clone()];
    wait_until_idle(
        &mut events,
        &ids,
        std::time::Instant::now() + Duration::from_secs(30),
    )
    .await
    .unwrap();
    let before = rail_tree(&c).await;
    let original: Vec<contracts::terminal::TerminalInfo> =
        serde_json::from_value(c.request("terminal.list", Value::Null).await.unwrap()).unwrap();
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
    for was in original {
        let now = listed
            .iter()
            .find(|t| t.incarnation == was.incarnation)
            .unwrap();
        assert_eq!(now.program_pid, was.program_pid, "same original program");
    }
    assert_eq!(
        std::fs::read_to_string(launches).unwrap().lines().count(),
        2
    );
    assert!(!inputs.exists(), "move and reopen type no prompt");
}

/// D1/D5/S3, A12a: App exit stops independently owned programs, including recovered ones.
#[tokio::test]
async fn d5_attached_shutdown_stops_owner_held_agents_after_reopen() {
    let owner = PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("terminal-owner");
    assert!(owner.is_file(), "run `cargo build -p terminal --bins`");
    for reopen in [false, true] {
        let logs = tempfile::tempdir().unwrap();
        let child = logs.path().join("child");
        let script = logs.path().join("child.sh");
        std::fs::write(
            &script,
            format!("echo $$ > '{}'; exec sleep 1000\n", child.display()),
        )
        .unwrap();
        let argv = serde_json::to_string(&["sh", script.to_str().unwrap()]).unwrap();
        let fake = [
            ("RUPD_TERMINAL_OWNER", owner.to_str().unwrap()),
            ("FAKE_CLAUDE_CHILD_PROCESS", argv.as_str()),
        ];
        let mut project = daemon::start(&fake);
        let c = project.client().await;
        project.spawn_agent(&c).await;
        let child_pid = daemon::h21_poll("the Agent's child PID", async || {
            std::fs::read_to_string(&child)
                .ok()?
                .trim()
                .parse::<u32>()
                .ok()
        })
        .await;
        let listed: Vec<contracts::terminal::TerminalInfo> =
            serde_json::from_value(c.request("terminal.list", Value::Null).await.unwrap()).unwrap();
        let pid = listed[0].program_pid.unwrap();
        assert!(alive(pid));
        assert!(alive(child_pid));
        drop(c);
        if reopen {
            project.restart(&fake);
        }
        project.close().await;
        for pid in [pid, child_pid] {
            assert!(
                !alive(pid),
                "program {pid} outlived attached shutdown (reopen={reopen})"
            );
        }
    }
}

fn alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success()
}
