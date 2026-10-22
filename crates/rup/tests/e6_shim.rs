//! E6: the shim goes pending, up or missing as real Claude starts.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::{EventData, Kind};
use daemon::{next, rail_tree};
use serde_json::{Value, json};

#[tokio::test]
async fn e6_a_shim_started_at_once_goes_pending_to_up_and_never_missing() {
    use contracts::EventData;
    use contracts::agent::{Channel, RailNode};
    use std::time::Duration;

    let project = daemon::start_real("e6_immediate_shim", &[]);
    let mut events = project.subscribed().await;

    let node: RailNode = serde_json::from_value(
        tokio::time::timeout(
            Duration::from_secs(30),
            events.request(
                "agent.spawn",
                json!({
                    "cwd": project.dir.path(), "prompt": "E10 immediate shim"
                }),
            ),
        )
        .await
        .expect("agent.spawn answers within the bound")
        .unwrap(),
    )
    .unwrap();
    assert_eq!(node.channel, Some(Channel::Pending));

    let started = std::time::Instant::now();
    let mut channels = vec![Channel::Pending];
    loop {
        let channel = daemon::next(&mut events, |data| match data {
            EventData::AgentChannel(event) if event.id == node.id => Some(event.channel),
            _ => None,
        })
        .await;
        eprintln!(
            "E6 channel {channel:?} at {:?} after spawn response",
            started.elapsed()
        );
        channels.push(channel);
        if channel == Channel::Up {
            break;
        }
    }
    assert_eq!(channels, [Channel::Pending, Channel::Up]);
    // Observe events across the Daemon's full default deadline: a final tree read
    // alone would miss a transient Missing followed by Up.
    assert!(
        tokio::time::timeout(agents::CHANNEL_DEADLINE, async {
            loop {
                let channel = daemon::next(&mut events, |data| match data {
                    EventData::AgentChannel(event) if event.id == node.id => Some(event.channel),
                    _ => None,
                })
                .await;
                assert_eq!(channel, Channel::Up, "Channel changed after Up");
            }
        })
        .await
        .is_err()
    );
    assert_eq!(
        daemon::rail_tree(&events)
            .await
            .into_iter()
            .find(|entry| entry.id == node.id)
            .unwrap()
            .channel,
        Some(Channel::Up)
    );
    let model = project.model.as_ref().unwrap();
    tokio::time::timeout(Duration::from_secs(30), async {
        while !model
            .journal()
            .iter()
            .any(|entry| entry["body"]["tools"].is_array())
        {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("real Claude reaches the model");
    model.assert_matched();
}

#[tokio::test]
async fn e6_a_late_shim_goes_missing_then_up() {
    use contracts::agent::Channel;
    use std::os::unix::fs::PermissionsExt;

    let gate = tempfile::tempdir().unwrap();
    let wrapper = gate.path().join("rup-gated");
    let release = gate.path().join("release");
    std::fs::write(
        &wrapper,
        r#"#!/usr/bin/env python3
import os, pathlib, sys, time
if sys.argv[1] == "mcp":
    deadline = time.monotonic() + 30
    while not pathlib.Path(os.environ["E6_SHIM_RELEASE"]).exists():
        if time.monotonic() >= deadline:
            sys.exit("E6 shim release deadline")
        time.sleep(0.025)
os.execv(os.environ["E6_RUP_BIN"], [os.environ["E6_RUP_BIN"], *sys.argv[1:]])
"#,
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let project = daemon::start_real(
        "e6_late_shim",
        &[
            ("ROUNDUP_RUP_BIN", wrapper.to_str().unwrap()),
            ("E6_RUP_BIN", env!("CARGO_BIN_EXE_rup")),
            ("E6_SHIM_RELEASE", release.to_str().unwrap()),
            ("ROUNDUP_CHANNEL_DEADLINE_MS", "100"),
        ],
    );
    let mut events = project.subscribed().await;
    let agent = events
        .request(
            "agent.spawn",
            json!({"cwd": project.dir.path(), "prompt": "E6 late shim"}),
        )
        .await
        .unwrap();
    let id = agent["id"].as_str().unwrap();
    assert_eq!(agent["channel"], "pending");
    let missing = next(&mut events, |event| match event {
        EventData::AgentChannel(channel) if channel.id == id => Some(channel.channel),
        _ => None,
    })
    .await;
    assert_eq!(missing, Channel::Missing);
    std::fs::write(release, "release real MCP").unwrap();
    let up = next(&mut events, |event| match event {
        EventData::AgentChannel(channel) if channel.id == id => Some(channel.channel),
        _ => None,
    })
    .await;
    assert_eq!(up, Channel::Up);
    let model = project.model.as_ref().unwrap();
    model.tool_result("toolu_e6_context").await;
    model.assert_matched();
}

#[tokio::test]
async fn e6_no_shim_is_missing_with_the_status_unchanged_and_hooks_do_not_count() {
    use contracts::agent::Channel;
    use std::os::unix::fs::PermissionsExt;

    let probe = tempfile::tempdir().unwrap();
    let wrapper = probe.path().join("rup-without-mcp");
    let log = probe.path().join("hooks.jsonl");
    std::fs::write(
        &wrapper,
        r#"#!/usr/bin/env python3
import json, os, sys
if sys.argv[1] == "mcp":
    sys.exit(1)
if sys.argv[1] == "signal":
    payload = sys.stdin.read()
    with open(os.environ["E6_HOOK_LOG"], "a") as log:
        log.write(json.dumps(json.loads(payload)) + "\n")
    import subprocess
    sys.exit(subprocess.run([os.environ["E6_RUP_BIN"], *sys.argv[1:]], input=payload, text=True).returncode)
os.execv(os.environ["E6_RUP_BIN"], [os.environ["E6_RUP_BIN"], *sys.argv[1:]])
"#,
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let project = daemon::start_real(
        "e6_no_shim",
        &[
            ("ROUNDUP_RUP_BIN", wrapper.to_str().unwrap()),
            ("E6_RUP_BIN", env!("CARGO_BIN_EXE_rup")),
            ("E6_HOOK_LOG", log.to_str().unwrap()),
            ("ROUNDUP_CHANNEL_DEADLINE_MS", "100"),
        ],
    );
    let mut events = project.subscribed().await;
    let agent = events
        .request(
            "agent.spawn",
            json!({"cwd": project.dir.path(), "prompt": "E6 no shim"}),
        )
        .await
        .unwrap();
    let id = agent["id"].as_str().unwrap();
    assert_eq!(agent["channel"], "pending");
    let mut initial = None;
    let mut working = false;
    let mut stopped = false;
    let mut missing = false;
    while !stopped || !missing {
        let event = next(&mut events, |event| match event {
            EventData::AgentStatus(status) if status.id == id => {
                Some(EventData::AgentStatus(status))
            }
            EventData::AgentChannel(channel) if channel.id == id => {
                Some(EventData::AgentChannel(channel))
            }
            _ => None,
        })
        .await;
        match event {
            EventData::AgentStatus(status) => {
                initial.get_or_insert(status.status.kind);
                working |= status.status.kind == Kind::Working;
                stopped |= working && status.status.kind == Kind::Idle;
            }
            EventData::AgentChannel(channel) => {
                assert_eq!(channel.channel, Channel::Missing);
                missing = true;
            }
            _ => unreachable!(),
        }
    }
    let node = rail_tree(&events)
        .await
        .into_iter()
        .find(|node| node.id == id)
        .unwrap();
    assert_eq!(node.channel, Some(Channel::Missing));
    assert_eq!(node.status.unwrap().kind, initial.unwrap());
    let hooks: Vec<Value> = std::fs::read_to_string(log)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    for name in ["SessionStart", "UserPromptSubmit", "Stop"] {
        assert!(
            hooks.iter().any(|hook| hook["hook_event_name"] == name),
            "{hooks:#?}"
        );
    }
    let model = project.model.as_ref().unwrap();
    model.assert_matched();
    assert!(
        model
            .journal()
            .iter()
            .any(|entry| entry["body"]["tools"].is_array()
                && entry["body"]["messages"].to_string().contains("E6 no shim"))
    );
}
