//! E3, E11, E12: real Claude at the model boundary; aimock owns matching and the request journal.
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
