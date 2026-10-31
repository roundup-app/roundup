//! D2, E3, H15: real Claude drives the Agent status through its hooks and session start.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::{EventData, Kind};

use serde_json::{Value, json};
use std::time::Duration;

#[tokio::test]
async fn e3_real_claude_runs_both_session_start_commands_and_reads_the_context() {
    let project = daemon::start_real("e3_startup_context", &[]);
    let user = project.client().await;
    let mut events = project.subscribed().await;
    // Exclude A9's extra rename-note turn from this single-request observer.
    // d2_the_first_prompt_names_the_agent retains the first-prompt naming proof.
    let node = user
        .request(
            "agent.spawn",
            json!({
                "cwd": project.dir.path(), "name":"context-reader", "prompt": "E3"
            }),
        )
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let request = tokio::time::timeout(project.bound(), async {
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
            "Your Rail name is {}. Say it, never an id, when you speak of yourself or another Agent.",
            node["name"].as_str().unwrap()
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
    assert_eq!(hook["hookSpecificOutput"]["hookEventName"], "SessionStart");
    // The naming lines follow the live first-prompt state, not the request's Context.
    for line in hook["hookSpecificOutput"]["additionalContext"]
        .as_str()
        .unwrap()
        .lines()
        .filter(|line| {
            !line.starts_with("Automatic self-naming") && !line.starts_with("Naming guide:")
        })
    {
        assert!(messages.contains(line), "{line}");
    }
    for kind in [Kind::Working, Kind::Idle] {
        project
            .next(&mut events, |event| match event {
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
}

#[tokio::test]
async fn d2_the_first_prompt_names_the_agent() {
    let project = daemon::start_real("d2_the_first_prompt_names_the_agent", &[]);
    let mut client = project.subscribed().await;
    let agent: contracts::agent::RailNode = serde_json::from_value(
        tokio::time::timeout(
            project.bound(),
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
        project
            .next(&mut client, |event| match event {
                EventData::AgentStatus(status)
                    if status.id == agent.id && status.status.kind == kind =>
                {
                    Some(())
                }
                _ => None,
            })
            .await;
    }
    let tree = project.rail_tree(&client).await;
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
async fn h15_every_hook_call_of_a_ten_tool_use_loop_is_answered_and_the_final_stop_leaves_the_agent_idle()
 {
    use std::os::unix::fs::PermissionsExt;
    let probe = tempfile::tempdir().unwrap();
    let wrapper = probe.path().join("rup-hook-observer");
    let log = probe.path().join("hooks.jsonl");
    std::fs::write(&wrapper, r##"#!/usr/bin/env python3
import json, os, subprocess, sys
if sys.argv[1] != "signal":
    os.execv(os.environ["REAL_CLAUDE_RUP_BIN"], [os.environ["REAL_CLAUDE_RUP_BIN"], *sys.argv[1:]])
payload = sys.stdin.buffer.read()
result = subprocess.run([os.environ["REAL_CLAUDE_RUP_BIN"], *sys.argv[1:]], input=payload, stdout=subprocess.PIPE, timeout=5)
with open(os.environ["REAL_CLAUDE_HOOK_LOG"], "a") as log:
    log.write(json.dumps({"event": json.loads(payload)["hook_event_name"], "exit": result.returncode}) + "\n")
sys.stdout.buffer.write(result.stdout)
sys.exit(result.returncode)
"##).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let project = daemon::start_real(
        "h15_ten_tools",
        &[
            ("ROUNDUP_RUP_BIN", wrapper.to_str().unwrap()),
            ("REAL_CLAUDE_RUP_BIN", env!("CARGO_BIN_EXE_rup")),
            ("REAL_CLAUDE_HOOK_LOG", log.to_str().unwrap()),
        ],
    );
    for index in 0..10 {
        std::fs::write(
            project.dir.path().join(format!("h15-{index:03}.txt")),
            "H15 hook round\n",
        )
        .unwrap();
    }
    let mut client = project.subscribed().await;
    let agent: contracts::agent::RailNode = serde_json::from_value(
        tokio::time::timeout(
            project.bound(),
            client.request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "name":"hook-reader", "prompt": "H15 exercise ten tools"}),
            ),
        )
        .await
        .expect("agent.spawn answers within the bound")
        .unwrap(),
    )
    .unwrap();
    tokio::time::timeout(Duration::from_secs(180), async {
        let mut working = false;
        loop {
            let event = client
                .next_event()
                .await
                .expect("the connection stays open");
            if let EventData::AgentStatus(status) = event.data
                && status.id == agent.id
            {
                if status.status.kind == Kind::Working {
                    working = true;
                } else if status.status.kind == Kind::Idle && working {
                    break;
                }
            }
        }
    })
    .await
    .expect("the ten-tool turn completes");
    let model = project.model.as_ref().unwrap();
    model.assert_matched();
    let journal = model.journal();
    // Aimock truncates long request bodies at 64 KB. Its selected fixture records the
    // last-result ID and content constraints that actually matched even after that cap.
    for index in 0..10 {
        let id = format!("toolu_h15_{index:03}");
        assert!(
            journal.iter().any(|entry| {
                let matched = &entry["response"]["fixture"]["match"];
                matched["toolCallId"] == id && matched["toolResultContains"] == "H15 hook round"
            }),
            "missing successful tool result {id}"
        );
    }
    let hooks: Vec<Value> = std::fs::read_to_string(log)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert!(hooks.iter().all(|hook| hook["exit"] == 0), "{hooks:#?}");
    let uses: Vec<_> = hooks
        .iter()
        .filter(|hook| matches!(hook["event"].as_str(), Some("PreToolUse" | "PostToolUse")))
        .collect();
    assert_eq!(uses.len(), 20, "{hooks:#?}");
    assert!(
        uses.chunks(2).all(|pair| pair[0]["event"] == "PreToolUse"
            && pair[1]["event"] == "PostToolUse"
            && pair.iter().all(|hook| hook["exit"] == 0)),
        "{hooks:#?}"
    );
    let tree = project.rail_tree(&client).await;
    assert_eq!(
        tree.iter()
            .find(|node| node.id == agent.id)
            .unwrap()
            .status
            .as_ref()
            .map(|status| status.label.as_str()),
        Some("idle")
    );
}
