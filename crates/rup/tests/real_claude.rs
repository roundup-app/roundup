//! A26, D2, E3, E6, E11, E12, F3, M9, Q11: real Claude at the model boundary; aimock owns matching and the request journal.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
use daemon::aimock;

use contracts::{EventData, Kind};
use daemon::{next, rail_tree};
use serde_json::{Value, json};
use std::time::Duration;

#[test]
fn e11_an_unmatched_request_fails() {
    let model = aimock::Model::start("unmatched");
    let response = std::process::Command::new("curl")
        .args(["--silent", "--show-error", "--max-time", "10", "-X", "POST"])
        .arg(format!("{}/v1/messages", model.url))
        .args(["-H", "content-type: application/json", "-H"])
        .arg(format!("x-api-key: {}", aimock::KEY))
        .arg("-d")
        .arg(
            json!({
                "model": "claude-sonnet-4-6", "max_tokens": 32,
                "messages": [{"role": "user", "content": "this turn has no fixture"}]
            })
            .to_string(),
        )
        .output()
        .unwrap();
    assert!(response.status.success());
    let journal = model.journal();
    assert_eq!(journal.len(), 1);
    assert_eq!(journal[0]["response"]["status"], 503, "{journal:#?}");
    assert!(journal[0]["response"]["fixture"].is_null());
}

#[tokio::test]
async fn e12_model_routing_keeps_credentials_out_of_hooks_and_mcp() {
    use std::os::unix::fs::PermissionsExt;
    let probe = tempfile::tempdir().unwrap();
    let wrapper = probe.path().join("rup-observer");
    let log = probe.path().join("environment.jsonl");
    std::fs::write(
        &wrapper,
        r##"#!/usr/bin/env python3
import json, os, sys
key = "sk-mock-key-000000000000000000000001"
with open(os.environ["REAL_CLAUDE_ENV_LOG"], "a") as log:
    log.write(json.dumps({"command": sys.argv[1], "credentials": [
        name for name, value in os.environ.items()
        if name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN") or key in value
    ]}) + "\n")
os.execv(os.environ["REAL_CLAUDE_RUP_BIN"], [os.environ["REAL_CLAUDE_RUP_BIN"], *sys.argv[1:]])
"##,
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let project = daemon::start_real(
        "e12_model_routing",
        &[
            ("ROUNDUP_RUP_BIN", wrapper.to_str().unwrap()),
            ("REAL_CLAUDE_RUP_BIN", env!("CARGO_BIN_EXE_rup")),
            ("REAL_CLAUDE_ENV_LOG", log.to_str().unwrap()),
            ("ANTHROPIC_API_KEY", "parent-key-must-be-stripped"),
            ("ANTHROPIC_AUTH_TOKEN", "parent-token-must-be-stripped"),
        ],
    );
    let client = project.client().await;
    client
        .request(
            "agent.spawn",
            json!({
                "cwd": project.dir.path(), "prompt": "E10 create split checkout"
            }),
        )
        .await
        .unwrap();
    project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_create_todo")
        .await;
    // Aimock redacts credentials in its journal. Require its inbound-key gate instead:
    // real Claude's successful tool round above used the dummy key; a wrong one is refused.
    let refused = std::process::Command::new("curl")
        .args([
            "--silent",
            "--show-error",
            "--max-time",
            "10",
            "--noproxy",
            "*",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            "-X",
            "POST",
            "-H",
            "x-api-key: wrong-key",
        ])
        .arg(format!(
            "{}/v1/messages",
            project.model.as_ref().unwrap().url
        ))
        .output()
        .unwrap();
    assert!(refused.status.success());
    assert_eq!(String::from_utf8(refused.stdout).unwrap(), "401");
    drop(project); // Observe shutdown hooks too.
    let records: Vec<serde_json::Value> = std::fs::read_to_string(log)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    for command in ["signal", "mcp"] {
        assert!(
            records.iter().any(|entry| entry["command"] == command),
            "no {command}: {records:?}"
        );
    }
    assert!(
        records
            .iter()
            .all(|entry| entry["credentials"].as_array().unwrap().is_empty()),
        "credential reached a hook or MCP: {records:?}"
    );
}

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
async fn e3_real_claude_runs_both_session_start_commands_and_reads_the_context() {
    let project = daemon::start_real("e3_startup_context", &[]);
    let user = project.client().await;
    let mut events = project.subscribed().await;
    let node = user
        .request(
            "agent.spawn",
            json!({
                "cwd": project.dir.path(), "prompt": "E3"
            }),
        )
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let request = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if let Some(entry) = model
                .journal()
                .into_iter()
                .find(|entry| entry["body"]["tools"].is_array())
            {
                return entry;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("real Claude requests its first work turn");
    let messages = request["body"]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|message| message["content"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(messages.contains("Parent: none"), "{request:#?}");
    assert!(
        messages.contains(&format!(
            "Your Agent id is {}. It never changes.",
            node["id"].as_str().unwrap()
        )),
        "{request:#?}"
    );
    for line in ["Ask: the user", "Peers: none.", "Todos: none open."] {
        assert!(messages.contains(line), "{request:#?}");
    }
    let brief = user
        .request("agent.brief", json!({"id": node["id"]}))
        .await
        .unwrap();
    let hook: Value = serde_json::from_str(brief["stdout"].as_str().unwrap()).unwrap();
    assert!(
        messages.contains(
            hook["hookSpecificOutput"]["additionalContext"]
                .as_str()
                .unwrap()
        )
    );
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut events, |event| match event {
            EventData::AgentStatus(status)
                if status.id == node["id"].as_str().unwrap() && status.status.kind == kind =>
            {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    model.assert_matched();
    assert_eq!(
        model
            .journal()
            .iter()
            .filter(|entry| entry["body"]["tools"].is_array())
            .count(),
        1
    );
    assert_eq!(
        rail_tree(&user)
            .await
            .into_iter()
            .find(|item| item.id == node["id"].as_str().unwrap())
            .unwrap()
            .name,
        "e3"
    );
}

#[tokio::test]
async fn d2_the_first_prompt_names_the_agent() {
    let project = daemon::start_real("d2_the_first_prompt_names_the_agent", &[]);
    let mut client = project.subscribed().await;
    let agent: contracts::agent::RailNode = serde_json::from_value(
        tokio::time::timeout(
            Duration::from_secs(30),
            client.request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "prompt": "fix the refresh race"}),
            ),
        )
        .await
        .expect("agent.spawn answers within the bound")
        .unwrap(),
    )
    .unwrap();
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut client, |event| match event {
            EventData::AgentStatus(status)
                if status.id == agent.id && status.status.kind == kind =>
            {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    let tree = rail_tree(&client).await;
    let named: Vec<_> = tree.iter().filter(|node| node.id == agent.id).collect();
    assert_eq!(named.len(), 1);
    assert_eq!(named[0].name, "fix-refresh-race");
    let model = project.model.as_ref().unwrap();
    model.assert_matched();
    assert!(
        model.journal().iter().any(|entry| {
            entry["body"]["tools"].is_array()
                && entry["body"]["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|message| {
                        message["role"] == "user"
                            && message["content"]
                                .as_str()
                                .is_some_and(|text| text.contains("fix the refresh race"))
                    })
        }),
        "real Claude sends the first prompt to aimock"
    );
}

#[tokio::test]
async fn d2_status_follows_the_hooks_in_order() {
    let project = daemon::start_real("d2_status_follows_the_hooks_in_order", &[]);
    let mut client = project.subscribed().await;
    let agent: contracts::agent::RailNode = serde_json::from_value(
        tokio::time::timeout(
            Duration::from_secs(30),
            client.request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "prompt": "fix the refresh race"}),
            ),
        )
        .await
        .expect("agent.spawn answers within the bound")
        .unwrap(),
    )
    .unwrap();
    let mut kinds = Vec::new();
    for _ in 0..5 {
        kinds.push(daemon::next_kind(&mut client).await);
        if kinds.len() == 3 {
            let decisions: Vec<contracts::decision::Decision> = serde_json::from_value(
                tokio::time::timeout(
                    Duration::from_secs(30),
                    client.request("decision.list", Value::Null),
                )
                .await
                .expect("decision.list answers within the bound")
                .unwrap(),
            )
            .unwrap();
            let decision = decisions
                .iter()
                .find(|decision| decision.agent == agent.id)
                .unwrap();
            assert_eq!(decision.tool, "Bash");
            tokio::time::timeout(
                Duration::from_secs(30),
                client.request(
                    "decision.answer",
                    json!({
                        "id": decision.id, "answer": "allow", "proof": "0".repeat(64)
                    }),
                ),
            )
            .await
            .expect("decision.answer answers within the bound")
            .unwrap();
        }
    }
    assert_eq!(
        kinds,
        [
            Kind::Idle,
            Kind::Working,
            Kind::NeedsYou,
            Kind::Working,
            Kind::Idle
        ]
    );
    let model = project.model.as_ref().unwrap();
    model.tool_result("toolu_d2_touch").await;
    assert!(project.dir.path().join("d2-permitted").is_file());
    model.assert_matched();
}

#[tokio::test]
async fn m9_a_door_asked_for_a_workstream_makes_one() {
    let project = daemon::start_real("m9_create_workstream", &[]);
    let mut events = project.subscribed().await;
    let door = events
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    events
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    // SessionStart also emits Idle; observe a completed turn before reusing its bundle.
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut events, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.status.kind == kind => {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    events.request("message.send", json!({"to": door, "kind": "note", "body": "E10 create another Workstream named x and start its Door"})).await.unwrap();
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_m9_create").await;
    let made: contracts::agent::RailNode =
        serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    assert_eq!(made.name, "x");
    model.tool_result("toolu_m9_start").await;
    let tree = rail_tree(&events).await;
    let node = tree.iter().find(|n| n.id == made.id).unwrap();
    assert!(node.parent.is_none());
    assert!(node.attempt.is_some(), "its Door is started");
    assert!(
        tree.iter().any(|n| n.id == door),
        "the Door that asked stays"
    );
    model.assert_matched();
}

#[tokio::test]
async fn q11_a_loaded_bundle_allows_a_subsequent_agent() {
    let project = daemon::start_real("m9_create_workstream", &[]);
    let mut events = project.subscribed().await;
    let door = events
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    events
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    // SessionStart also emits Idle; observe a completed turn before reusing its bundle.
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut events, |event| match event {
            EventData::AgentStatus(status) if status.id == door && status.status.kind == kind => {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    let agent = events
        .request(
            "agent.spawn",
            json!({
                "cwd": project.dir.path(), "prompt": "What is this Workstream for?"
            }),
        )
        .await
        .unwrap();
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut events, |event| match event {
            EventData::AgentStatus(status)
                if status.id == agent["id"].as_str().unwrap() && status.status.kind == kind =>
            {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    let model = project.model.as_ref().unwrap();
    model.assert_matched();
    assert_eq!(
        model
            .journal()
            .iter()
            .filter(|entry| entry["body"]["tools"].is_array())
            .count(),
        2,
        "both real Claude programs reached the model boundary"
    );
}

#[tokio::test]
async fn b37_real_claude_receives_d1_after_a_scripted_server_error() {
    let mut project = daemon::start_real("b37_server_error", &[]);
    let user = project.client().await;
    let mut events = project.subscribed().await;
    let door = user
        .request("rail.createWorkstream", json!({"name":"B37 supervisor"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({"id":door}))
        .await
        .unwrap();
    next(&mut events, |data| match data {
        EventData::AgentStatus(s) if s.id == door && s.status.kind == Kind::Idle => Some(()),
        _ => None,
    })
    .await;
    let child = user
        .request(
            "agent.spawn",
            json!({"parent":door,"cwd":project.dir.path(),"name":"B37 child","prompt":"B37 prepare child"}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_b37_child_ready")
        .await;
    next(&mut events, |data| match data {
        EventData::AgentStatus(s)
            if s.id == child && s.status.kind == Kind::Working && s.status.label == "working" =>
        {
            Some(())
        }
        _ => None,
    })
    .await;
    next(&mut events, |data| match data {
        EventData::AgentStatus(s) if s.id == child && s.status.kind == Kind::Idle => Some(()),
        _ => None,
    })
    .await;
    // The push window closes on the child's final idle Digest, not its earlier Rail status.
    next(&mut events, |data| match data {
        EventData::MessageDelivered(m)
            if m.to == door
                && m.body.contains("[digest] B37 child is idle")
                && m.body.contains("open todos: 1") =>
        {
            Some(())
        }
        _ => None,
    })
    .await;
    next(&mut events, |data| match data {
        EventData::AgentStatus(s) if s.id == door && s.status.kind == Kind::Idle => Some(()),
        _ => None,
    })
    .await;
    // Hold the child's Digests as well as its Decision note: otherwise needs-you can
    // start an intervening turn before tell_doors has queued the note.
    user.request("takeover.begin", json!({"agent":door}))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let nodes = rail_tree(&user).await;
            let node = nodes.iter().find(|n| n.id == door).unwrap();
            if node.status.as_ref().unwrap().kind == Kind::Idle {
                match user
                    .request(
                        "agent.prompt",
                        json!({"id":door,"text":"B37 scripted server error"}),
                    )
                    .await
                {
                    Ok(_) => break,
                    Err(e) if e.code == rpc::code::BUSY => {}
                    Err(e) => panic!("{e}"),
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let failed = next(&mut events, |data| match data {
        EventData::AgentStatus(s) if s.id == door && s.status.kind == Kind::Error => Some(s),
        _ => None,
    })
    .await;
    assert_eq!(failed.status.label, "server_error");
    let nodes = rail_tree(&user).await;
    let live = nodes.iter().find(|n| n.id == door).unwrap();
    assert!(live.terminal_id.is_some());
    assert_eq!(live.attempt.as_deref(), Some(failed.attempt.as_str()));
    let caller = project.client().await;
    let child_id = child.clone();
    let permission = tokio::spawn(async move {
        caller.request("agent.permission", json!({"id":child_id,"payload":{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"echo B37"}}})).await
    });
    let decision = next(&mut events, |data| match data {
        EventData::DecisionOpened(d) if d.agent == child => Some(d),
        _ => None,
    })
    .await;
    assert_eq!(decision.id, "d1");
    next(&mut events, |data| match data {
        EventData::MessageHeld(m) if m.to == door && m.body.starts_with("[decision d1]") => {
            Some(())
        }
        _ => None,
    })
    .await;
    user.request(
        "decision.answer",
        json!({"id":"d1","answer":"allow","proof":"0".repeat(64)}),
    )
    .await
    .unwrap();
    assert!(permission.await.unwrap().is_ok());
    user.request("takeover.end", json!({"agent":door}))
        .await
        .unwrap();
    next(&mut events, |data| match data {
        EventData::MessageDelivered(m) if m.to == door && m.body.starts_with("[decision d1]") => {
            Some(())
        }
        _ => None,
    })
    .await;
    next(&mut events, |data| match data {
        EventData::AgentStatus(s)
            if s.id == door
                && s.status.kind == Kind::Idle
                && s.status_revision != failed.status_revision =>
        {
            assert_eq!(s.attempt, failed.attempt);
            Some(())
        }
        _ => None,
    })
    .await;
    // This observer expects one failed model request; the shared success-only Drop check does not.
    let model = project.model.take().unwrap();
    let journal = model.journal();
    assert_eq!(
        journal
            .iter()
            .filter(|e| e["response"]["status"] == 500)
            .count(),
        1,
        "{journal:#?}"
    );
    assert!(
        journal.iter().all(|e| !e["response"]["fixture"].is_null()),
        "{journal:#?}"
    );
    let failed_request = journal
        .iter()
        .position(|e| e["response"]["status"] == 500)
        .unwrap();
    let identity = &journal[failed_request]["headers"]["x-claude-code-session-id"];
    assert!(identity.is_string());
    let following = journal
        .iter()
        .skip(failed_request + 1)
        .find(|e| {
            &e["headers"]["x-claude-code-session-id"] == identity && e["body"]["stream"] == true
        })
        .expect("the Door makes its next model request");
    assert_eq!(following["response"]["status"], 200);
    assert!(
        following["body"]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| { m["role"] == "user" && m["content"].to_string().contains("[decision d1]") }),
        "Door request sequence: {:#?}",
        journal
            .iter()
            .filter(|e| &e["headers"]["x-claude-code-session-id"] == identity)
            .map(
                |e| json!({"stream": e["body"]["stream"], "response": e["response"],
                "users": e["body"]["messages"].as_array().unwrap().iter()
                    .filter(|m| m["role"] == "user").collect::<Vec<_>>()})
            )
            .collect::<Vec<_>>()
    );
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
async fn a39_the_placement_call_is_one_slim_request() {
    // Inject dirty parent credentials into a test subprocess, without mutating this runner's
    // shared environment. The production call must strip them before its observer starts.
    if std::env::var_os("ROUNDUP_A39_OBSERVER_CHILD").is_none() {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "a39_the_placement_call_is_one_slim_request",
                "--nocapture",
            ])
            .env("ROUNDUP_A39_OBSERVER_CHILD", "1");
        for name in agents::claude_code::MARKERS
            .into_iter()
            .chain(agents::claude_code::OFF_PLAN)
        {
            command.env(name, "must-be-stripped");
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    use agents::{
        claude_code::Launcher,
        placement::{Destination, Request, place},
    };
    use std::os::unix::fs::PermissionsExt;
    let model = aimock::Model::start("a39_placement");
    let dir = tempfile::tempdir().unwrap();
    let config = dir.path().join("config");
    aimock::configure(&config, dir.path(), &model.url);
    let wrapper = dir.path().join("placement");
    let log = dir.path().join("launch.json");
    let script = format!(
        r#"#!/usr/bin/env python3
import os, sys, json
with open({log:?}, 'w') as f:
    json.dump({{'argv':sys.argv[1:], 'files':os.listdir('.'), 'cwd':os.getcwd(), 'pid':os.getpid(), 'off_plan':[n for n in {off_plan:?} if n in os.environ], 'markers':[n for n in {markers:?} if n in os.environ]}}, f)
os.environ['CLAUDE_CONFIG_DIR'] = {config:?}
os.environ['ANTHROPIC_BASE_URL'] = {url:?}
os.environ['ANTHROPIC_API_KEY'] = {key:?}
os.environ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1'
os.environ['DISABLE_AUTOUPDATER'] = '1'
os.environ['CLAUDE_CODE_MAX_RETRIES'] = '0'
os.execv({binary:?}, [{binary:?}, *sys.argv[1:]])
"#,
        log = log.to_str().unwrap(),
        config = config.to_str().unwrap(),
        url = model.url,
        key = aimock::KEY,
        binary = aimock::package_bin("claude").to_str().unwrap(),
        off_plan = agents::claude_code::OFF_PLAN,
        markers = agents::claude_code::MARKERS
    );
    std::fs::write(&wrapper, script).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let launcher = Launcher::from_vars(
        |name| match name {
            "ROUNDUP_CLAUDE_BIN" => Some(wrapper.as_os_str().to_owned()),
            "HOME" => Some(dir.path().as_os_str().to_owned()),
            _ => None,
        },
        &std::env::current_exe().unwrap(),
    )
    .unwrap();
    let rail = serde_json::from_value(json!({"id":"work", "kind":"workstream", "name":"Repair", "parent":null, "order":0, "status":null, "attempt":null, "status_revision":null, "terminal_id":null, "worktree":null, "can_resume":false, "channel":null, "work":{"kind":"work", "title":"Repair café", "ask":"Repair the café", "limits":[]}, "stray":[], "model":null, "effort":null})).unwrap();
    let earlier = (0..7)
        .map(|at| agents::placement::EarlierAsk {
            at,
            parts: vec![agents::placement::AskPart {
                text: format!("earlier {at}"),
                destination: Destination::Routed {
                    workstream: "work".into(),
                },
            }],
        })
        .collect();
    let request = Request::new(
        "A39 fix café; /ship 原文; decide".into(),
        earlier,
        vec![rail],
    );
    let parts = place(&launcher.placement(), "ask-a39", &request, |id, cause| {
        panic!("{id}: {cause}")
    })
    .await;
    assert_eq!(
        parts,
        vec![
            agents::placement::AskPart {
                text: "A39 fix café".into(),
                destination: Destination::Routed {
                    workstream: "work".into()
                }
            },
            agents::placement::AskPart {
                text: "/ship 原文".into(),
                destination: Destination::New {
                    title: "Ship".into()
                }
            },
            agents::placement::AskPart {
                text: "decide".into(),
                destination: Destination::Unclear {
                    question: "Which work?".into(),
                    candidates: vec!["work".into()]
                }
            },
        ]
    );
    model.assert_matched();
    let journal = model.journal();
    assert_eq!(journal.len(), 1, "{journal:#?}");
    let body = &journal[0]["body"];
    assert!(
        body["model"].as_str().unwrap().starts_with("claude-haiku"),
        "{body}"
    );
    assert!(
        body.to_string()
            .contains("You place the user's Ask into Workstreams."),
        "{body}"
    );
    let user = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| message["role"] == "user")
        .map(|message| message["content"].to_string())
        .collect::<String>();
    for fact in ["earlier 6", "earlier 2", "Repair the café", "/ship 原文"] {
        assert!(user.contains(fact), "missing {fact}: {body}");
    }
    for omitted in ["earlier 0", "earlier 1"] {
        assert!(!user.contains(omitted), "{body}");
    }
    let tools = body["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 1, "{tools:?}");
    assert_eq!(tools[0]["function"]["name"], "StructuredOutput");
    let launch: Value = serde_json::from_slice(&std::fs::read(log).unwrap()).unwrap();
    assert!(
        !std::process::Command::new("kill")
            .args(["-0", &launch["pid"].to_string()])
            .output()
            .unwrap()
            .status
            .success(),
        "Placement process remains running or unreaped"
    );
    assert_eq!(launch["files"], json!([]));
    assert_eq!(launch["off_plan"], json!([]));
    assert_eq!(launch["markers"], json!([]));
    assert!(!std::path::Path::new(launch["cwd"].as_str().unwrap()).exists());
    let argv = launch["argv"].as_array().unwrap();
    assert_eq!(argv.len(), 18, "{argv:?}");
    let system = body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| message["role"] == "system")
        .map(|message| message["content"].to_string())
        .collect::<String>();
    assert!(system.contains(argv[17].as_str().unwrap()), "{body}");
    assert_eq!(
        &argv[..10],
        json!([
            "-p",
            "--model",
            "haiku",
            "--effort",
            "low",
            "--no-session-persistence",
            "--output-format",
            "json",
            "--json-schema",
            argv[9]
        ])
        .as_array()
        .unwrap()
    );
    assert_eq!(
        &argv[10..18],
        json!([
            "--tools",
            "",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--setting-sources",
            "",
            "--system-prompt",
            argv[17]
        ])
        .as_array()
        .unwrap()
    );
}

#[tokio::test]
async fn f3_a_door_starts_a_child_with_agent_spawn_and_the_child_is_the_doors_own() {
    let project = daemon::start_real("f3_child_home", &[]);
    let mut client = project.subscribed().await;
    let door = client
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_f3_spawn").await;
    let spawned: contracts::agent::RailNode =
        serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    assert_eq!(spawned.parent.as_deref(), Some(door.as_str()));
    assert!(spawned.worktree.is_none());
    let tree = rail_tree(&client).await;
    let child = tree.iter().find(|n| n.id == spawned.id).unwrap();
    assert_eq!(child.parent.as_deref(), Some(door.as_str()));
    assert!(tree.iter().all(|n| n.parent.as_deref() != Some("999")));
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut client, |event| match event {
            EventData::AgentStatus(status)
                if status.id == spawned.id && status.status.kind == kind =>
            {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    model.assert_matched();
}

#[tokio::test]
async fn f3_a_door_spawns_into_a_worktree_when_the_setting_is_on() {
    let project = daemon::start_real("f3_child_worktree", &[]);
    let path = project.dir.path();
    for args in [
        vec!["init", "-q", "-b", "main"],
        vec!["config", "user.name", "roundup"],
        vec!["config", "user.email", "roundup@example.com"],
    ] {
        assert!(
            std::process::Command::new("git")
                .current_dir(path)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    std::fs::write(path.join("README"), "keep").unwrap();
    for args in [vec!["add", "README"], vec!["commit", "-qm", "base"]] {
        assert!(
            std::process::Command::new("git")
                .current_dir(path)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
    let mut client = project.subscribed().await;
    client
        .request("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let door = client
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_f3_spawn").await;
    let spawned: contracts::agent::RailNode =
        serde_json::from_str(result["content"].as_str().unwrap()).unwrap();
    assert_eq!(spawned.parent.as_deref(), Some(door.as_str()));
    let worktree = spawned.worktree.expect("the child has a Worktree");
    assert_eq!(worktree.branch, format!("roundup/agent-{}", spawned.id));
    let listed = std::process::Command::new("git")
        .current_dir(path)
        .args(["worktree", "list"])
        .output()
        .unwrap();
    assert!(listed.status.success());
    let listed = String::from_utf8(listed.stdout).unwrap();
    assert!(listed.contains(&worktree.path), "{listed}");
    for kind in [Kind::Working, Kind::Idle] {
        next(&mut client, |event| match event {
            EventData::AgentStatus(status)
                if status.id == spawned.id && status.status.kind == kind =>
            {
                Some(())
            }
            _ => None,
        })
        .await;
    }
    model.assert_matched();
}

#[tokio::test]
async fn a26_a_subagent_started_by_a_subagent_sits_three_deep_under_the_door_through_rup_mcp() {
    let project = daemon::start_real("a26_three_deep", &[]);
    let mut client = project.subscribed().await;
    let door = client
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let first = model.tool_result("toolu_a26_child").await;
    let a: contracts::agent::RailNode =
        serde_json::from_str(first["content"].as_str().unwrap()).unwrap();
    let second = model.tool_result("toolu_a26_grandchild").await;
    let b: contracts::agent::RailNode =
        serde_json::from_str(second["content"].as_str().unwrap()).unwrap();
    assert_eq!(a.parent.as_deref(), Some(door.as_str()));
    assert_eq!(b.parent.as_deref(), Some(a.id.as_str()));
    let tree = rail_tree(&client).await;
    let ids: Vec<_> = tree.iter().map(|n| n.id.as_str()).collect();
    assert_eq!(ids, [door.as_str(), a.id.as_str(), b.id.as_str()]);
    // Wait through all three real turns so late unmatched requests cannot escape the observer.
    let mut working = std::collections::BTreeSet::new();
    let mut idle = std::collections::BTreeSet::new();
    while idle.len() < 3 {
        let status = next(&mut client, |event| match event {
            EventData::AgentStatus(status) if [&door, &a.id, &b.id].contains(&&status.id) => {
                Some(status)
            }
            _ => None,
        })
        .await;
        if status.status.kind == Kind::Working {
            working.insert(status.id.clone());
        }
        if status.status.kind == Kind::Idle && working.contains(&status.id) {
            idle.insert(status.id);
        }
    }
    model.assert_matched();
}
