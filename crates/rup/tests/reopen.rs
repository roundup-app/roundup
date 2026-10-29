//! U4547e through a real Daemon: a moved running Agent survives a killed Daemon.

#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use std::path::PathBuf;
use std::time::Duration;

use contracts::agent::RailNode;
use contracts::{EventData, Kind};
use rmcp::ServiceExt;
use rmcp::model::CallToolRequestParams;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;

use daemon::{rail_tree, wait_until_idle};

/// U4547e, A12a, D6: a moved running Agent survives a killed Daemon with its identity, parent and
/// one running Terminal, and its retained hooks still reach the reopened Project.
#[tokio::test]
async fn u4547e_reparenting_survives_reopen() {
    let owner = std::env::var_os("ROUNDUP_TEST_APP_BIN")
        .map(|dir| PathBuf::from(dir).join("terminal-owner"))
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("terminal-owner")
        });
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
    // Start the vendor's actual MCP command before the crash. Its process and inherited
    // socket stay unchanged across recovery; every tool call must reconnect to this Project.
    let launched: Vec<Value> = std::fs::read_to_string(&launches)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let mut retained = Vec::new();
    for launch in &launched {
        let argv = launch["argv"].as_array().unwrap();
        let file = |flag| {
            let at = argv.iter().position(|arg| arg == flag).unwrap();
            argv[at + 1].as_str().unwrap()
        };
        let settings: Value =
            serde_json::from_slice(&std::fs::read(file("--settings")).unwrap()).unwrap();
        let mcp: Value =
            serde_json::from_slice(&std::fs::read(file("--mcp-config")).unwrap()).unwrap();
        let config = &mcp["mcpServers"]["roundup"];
        let env: Vec<_> = config["env"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(key, value)| (key.as_str(), value.as_str().unwrap()))
            .collect();
        let mut child = tokio::process::Command::new(config["command"].as_str().unwrap())
            .args(
                config["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|arg| arg.as_str().unwrap()),
            )
            .env("RUPD_SOCKET", project.socket())
            .envs(env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
        let client = tokio::time::timeout(Duration::from_secs(30), ().serve(transport))
            .await
            .unwrap()
            .unwrap();
        let tools = tokio::time::timeout(Duration::from_secs(30), client.list_all_tools())
            .await
            .unwrap()
            .unwrap();
        retained.push((child, client, settings, tools));
    }
    let old_socket = project.socket().to_owned();
    drop(c);

    let new_socket = logs.path().join("reopened.sock");
    let mut reopened = fake.to_vec();
    reopened.push(("RUPD_SOCKET", new_socket.to_str().unwrap()));
    project.restart(&reopened);
    assert_eq!(project.socket(), new_socket);
    assert_ne!(project.socket(), old_socket);
    let c = project.client().await;
    let after = rail_tree(&c).await;
    let listed: Vec<contracts::terminal::TerminalInfo> =
        serde_json::from_value(c.request("terminal.list", Value::Null).await.unwrap()).unwrap();
    assert_eq!(listed.iter().filter(|t| t.running).count(), 2);
    for (id, parent) in [
        (&into_workstream.id, Some(&workstream.id)),
        (&into_mode.id, Some(&mode.id)),
    ] {
        let was = before.iter().find(|n| &n.id == id).unwrap();
        let now = after.iter().find(|n| &n.id == id).expect("same Agent");
        assert_eq!(now.parent.as_ref(), parent);
        assert_eq!(now.name, was.name);
        assert_eq!(now.attempt, was.attempt, "same Attempt");
        let was_terminal = original
            .iter()
            .find(|terminal| Some(&terminal.id) == was.terminal_id.as_ref())
            .unwrap();
        let now_terminal = listed
            .iter()
            .find(|terminal| Some(&terminal.id) == now.terminal_id.as_ref())
            .unwrap();
        assert!(now_terminal.running);
        assert_eq!(now_terminal.incarnation, was_terminal.incarnation);
        assert_eq!(
            now_terminal.program_pid, was_terminal.program_pid,
            "same Agent's original program"
        );
        assert_ne!(now.status.as_ref().map(|s| s.kind), Some(Kind::Done));
        assert!(
            now.terminal_id.is_some(),
            "a Terminal of the new client table"
        );
    }
    for (_child, client, settings, tools) in &retained {
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(30), client.list_all_tools())
                .await
                .unwrap()
                .unwrap(),
            *tools,
            "stable vendor tool list"
        );
        let result = tokio::time::timeout(
            Duration::from_secs(30),
            client.call_tool(CallToolRequestParams::new("agent_context")),
        )
        .await
        .unwrap()
        .unwrap();
        assert_ne!(result.is_error, Some(true), "{result:?}");
        let context: contracts::agent::Context =
            serde_json::from_str(&result.content[0].as_text().unwrap().text).unwrap();
        let id = settings["env"]["ROUNDUP_AGENT_ID"].as_str().unwrap();
        assert_eq!(context.this.id, id);
        let node = after.iter().find(|node| node.id == id).unwrap();
        assert_eq!(
            context.parent.as_ref().map(|parent| parent.id.as_str()),
            node.parent.as_deref()
        );
        let mut events = project.subscribed().await;
        // Run the unchanged vendor hook command with its original inherited routing.
        let mut hook = tokio::process::Command::new("sh")
            .args([
                "-c",
                settings["hooks"]["PermissionRequest"][0]["hooks"][0]["command"]
                    .as_str()
                    .unwrap(),
            ])
            .env("RUPD_SOCKET", &old_socket)
            .envs(
                settings["env"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(key, value)| (key, value.as_str().unwrap())),
            )
            .stdin(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        hook.stdin.take().unwrap().write_all(
            br#"{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"ls"}}"#,
        ).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(30), hook.wait())
                .await
                .unwrap()
                .unwrap()
                .success()
        );
        let status = daemon::next(&mut events, |data| match data {
            EventData::AgentStatus(status) if status.id == id => Some(status.status),
            _ => None,
        })
        .await;
        assert_eq!(status.kind, Kind::NeedsYou);
    }
    assert_eq!(
        std::fs::read_to_string(launches).unwrap().lines().count(),
        2
    );
    assert!(!inputs.exists(), "move and reopen type no prompt");
    for (mut child, ..) in retained {
        tokio::time::timeout(Duration::from_secs(5), child.kill())
            .await
            .unwrap()
            .unwrap();
    }
}

/// D1/D5/S3, A12a: App exit stops independently owned programs, including recovered ones.
#[tokio::test]
async fn d5_attached_shutdown_stops_owner_held_agents_after_reopen() {
    let owner = std::env::var_os("ROUNDUP_TEST_APP_BIN")
        .map(|dir| PathBuf::from(dir).join("terminal-owner"))
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_BIN_EXE_rup")).with_file_name("terminal-owner")
        });
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
        drop(c);
        if reopen {
            project.restart(&fake);
        }
        assert!(alive(pid), "original Agent is live before App exit");
        assert!(alive(child_pid), "its child is live before App exit");
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
