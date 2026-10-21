//! E11, E12, E14: real Claude takes every model request through aimock, with credentials kept out of hooks and MCP.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
use daemon::aimock;

use contracts::{EventData, Kind};
use daemon::next;
use serde_json::{Value, json};
use std::time::Duration;
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use doors::user_texts;
use waiting::{turn_done, until_async};

// E12's runtime observer is Linux-only; the Mac lane does not select this target.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn e12_a_complete_turn_has_only_loopback_traffic() {
    use std::process::Command;
    if std::env::var_os("E12_LOOPBACK_ONLY").is_some() {
        let devices = std::fs::read_to_string("/proc/net/dev").unwrap();
        let interfaces = devices
            .lines()
            .skip(2)
            .map(|line| line.split(':').next().unwrap().trim())
            .collect::<Vec<_>>();
        assert_eq!(interfaces, ["lo"]);
        let project = daemon::start_real("e12_loopback", &[]);
        let client = project.client().await;
        let agent = client
            .request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "prompt": "E12 loopback complete turn"}),
            )
            .await
            .unwrap();
        let model = project.model.as_ref().unwrap();
        turn_done(
            model,
            &client,
            agent["id"].as_str().unwrap(),
            "E12 loopback complete turn",
        )
        .await;
        let result = model.tool_result("toolu_e12_loopback").await;
        assert!(
            result["content"]
                .as_str()
                .unwrap()
                .contains("E12 loopback todo")
        );
        model.assert_matched();
        // Project shutdown and all descendants remain inside strace's observation window.
        drop(client);
        drop(project);
        return;
    }
    let identity = |flag| {
        let output = Command::new("id").arg(flag).output().unwrap();
        assert!(output.status.success());
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    };
    let trace = tempfile::NamedTempFile::new().unwrap();
    let mut command = tokio::process::Command::new("sudo");
    command
        .args(["-n", "--preserve-env=PATH", "unshare", "--net", "--fork", "--kill-child", "--", "sh", "-ec"])
        .arg(r#"ip link set lo up
exec setpriv --reuid "$1" --regid "$2" --clear-groups strace -f -qq -e trace=connect,sendto,sendmsg,sendmmsg -o "$4" env E12_LOOPBACK_ONLY=1 "$3" --exact e12_a_complete_turn_has_only_loopback_traffic --nocapture"#)
        .arg("e12-network")
        .arg(identity("-u"))
        .arg(identity("-g"))
        .arg(std::env::current_exe().unwrap())
        .arg(trace.path())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(90), command.output())
        .await
        .expect("isolated complete turn finished within 90 seconds")
        .expect("sudo, unshare, setpriv and strace are installed");
    assert!(
        output.status.success(),
        "isolated observer failed: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let trace = std::fs::read_to_string(trace.path()).unwrap();
    let mut destinations = 0;
    for line in trace.lines() {
        for (prefix, suffix) in [
            ("sin_addr=inet_addr(\"", "\")"),
            ("inet_pton(AF_INET6, \"", "\""),
        ] {
            for address in line.split(prefix).skip(1) {
                let address = address.split(suffix).next().unwrap();
                let address: std::net::IpAddr =
                    address.parse().expect("strace decoded an IP address");
                assert!(address.is_loopback(), "non-loopback destination: {address}");
                destinations += 1;
            }
        }
    }
    assert!(destinations > 0, "strace observed no IP destinations");
}

#[tokio::test]
async fn e12_a_fresh_configuration_accepts_the_first_prompt() {
    use base64::Engine;
    let project = daemon::start_real("e12_fresh_configuration", &[]);
    let client = project.client().await;
    let agent = client
        .request("agent.spawn", json!({"cwd": project.dir.path()}))
        .await
        .unwrap();
    let id = agent["id"].as_str().unwrap();
    let screen = || async {
        // Snapshots encode blank cells as cursor movements; text assertions need rendered rows.
        let screen: contracts::terminal::Screen = serde_json::from_value(
            client
                .request("terminal.screen", json!({"id": id}))
                .await
                .unwrap(),
        )
        .unwrap();
        screen.lines.join("\n")
    };
    until_async(
        "fresh Claude reaches prompt input without answering a dialog",
        || async { screen().await.contains('❯').then_some(()) },
    )
    .await;
    // Bracketed paste prevents the TUI treating the prompt as a burst of keyboard shortcuts.
    let prompt = "E12 fresh profile first prompt";
    client
        .request(
            "terminal.write",
            json!({"id": id, "data": base64::engine::general_purpose::STANDARD
                .encode(format!("\x1b[200~{prompt}\x1b[201~"))}),
        )
        .await
        .unwrap();
    let mut last_screen = String::new();
    let accepted = tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            last_screen = screen().await;
            if last_screen.contains(prompt) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await;
    if accepted.is_err() {
        let snapshot = client
            .request("terminal.snapshot", json!({"id": id}))
            .await
            .unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(snapshot["data"].as_str().unwrap())
            .unwrap();
        panic!(
            "Claude did not accept the pasted first prompt; rendered screen: {last_screen:?}; \
             terminal snapshot: {:?}",
            String::from_utf8_lossy(&bytes)
        );
    }
    client
        .request(
            "terminal.write",
            json!({"id": id, "data": base64::engine::general_purpose::STANDARD.encode("\r")}),
        )
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    turn_done(model, &client, id, prompt).await;
    assert!(
        model.journal().iter().any(|entry| {
            !entry["body"]["tools"].is_null()
                && user_texts(entry).iter().any(|text| text.contains(prompt))
        }),
        "the first interactive prompt reached the real model route"
    );
    model.assert_matched();
}

#[tokio::test]
async fn e14_roundup_launches_and_resumes_real_claude() {
    let project = daemon::start_real("e14_launch_resume", &[]);
    let client = project.client().await;
    let model = project.model.as_ref().unwrap();
    for (door, selected, effort, expected) in [
        (false, "sonnet", "low", "claude-sonnet-5-5"),
        (true, "opus", "high", "claude-opus-5-5"),
    ] {
        let node = if door {
            let workstream = client
                .request(
                    "rail.createWorkstream",
                    json!({"name": "E14", "parent": null}),
                )
                .await
                .unwrap();
            client
                .request(
                    "rail.startDoor",
                    json!({"id": workstream["id"], "model": selected, "effort": effort}),
                )
                .await
                .unwrap()
        } else {
            client.request("agent.spawn", json!({"cwd": project.dir.path(), "prompt": "E14 remember the cobalt otter", "model": selected, "effort": effort})).await.unwrap()
        };
        let id = node["id"].as_str().unwrap();
        let initial = if door {
            "What is this Workstream for?"
        } else {
            "E14 remember the cobalt otter"
        };
        turn_done(model, &client, id, initial).await;
        let first = model
            .journal()
            .into_iter()
            .rev()
            .find(|entry| {
                !entry["body"]["tools"].is_null()
                    && user_texts(entry).iter().any(|text| text.contains(initial))
            })
            .expect("initial work request");
        assert_eq!(first["body"]["model"], expected);
        assert_eq!(first["body"]["output_config"]["effort"], effort);
        client
            .request("agent.stop", json!({"id": id}))
            .await
            .unwrap();
        client
            .request(
                if door {
                    "rail.startDoor"
                } else {
                    "agent.resume"
                },
                json!({"id": id}),
            )
            .await
            .unwrap();
        let followup = if door {
            "E14 recall the Door conversation"
        } else {
            "E14 recall the Agent conversation"
        };
        client
            .request(
                "message.send",
                json!({"to": id, "kind": "note", "body": followup}),
            )
            .await
            .unwrap();
        turn_done(model, &client, id, followup).await;
        let journal = model.journal();
        let resumed = journal
            .iter()
            .rev()
            .find(|entry| user_texts(entry).iter().any(|text| text.contains(followup)))
            .unwrap();
        assert_eq!(resumed["body"]["model"], expected);
        assert_eq!(resumed["body"]["output_config"]["effort"], effort);
        assert!(
            user_texts(resumed)
                .iter()
                .any(|text| text.contains(initial)),
            "resume lost the first prompt: {resumed:#?}"
        );
        assert!(
            resumed["body"]["messages"]
                .as_array()
                .unwrap()
                .iter()
                .any(|message| message["role"] == "assistant"
                    && message["content"]
                        .to_string()
                        .contains("E14 retained answer")),
            "resume lost Claude's answer: {resumed:#?}"
        );
        model.assert_matched();
    }
}

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
async fn e12_default_permissions_reach_the_permission_hook() {
    let project = daemon::start_real("e12_default_permissions", &[]);
    let mut client = project.subscribed().await;
    let agent: contracts::agent::RailNode = serde_json::from_value(
        client
            .request(
                "agent.spawn",
                json!({
                    "cwd": project.dir.path(), "prompt": "E12 deny the file creation"
                }),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    next(&mut client, |event| match event {
        EventData::AgentStatus(status)
            if status.id == agent.id && status.status.kind == Kind::NeedsYou =>
        {
            Some(())
        }
        _ => None,
    })
    .await;
    let decisions: Vec<contracts::decision::Decision> =
        serde_json::from_value(client.request("decision.list", Value::Null).await.unwrap())
            .unwrap();
    let decision = decisions
        .iter()
        .find(|decision| decision.agent == agent.id)
        .unwrap();
    assert_eq!(decision.tool, "Bash");
    assert!(!project.dir.path().join("e12-denied").exists());
    client
        .request(
            "decision.answer",
            json!({
                "id": decision.id, "answer": "deny", "proof": "0".repeat(64)
            }),
        )
        .await
        .unwrap();
    next(&mut client, |event| match event {
        EventData::AgentStatus(status)
            if status.id == agent.id && status.status.kind == Kind::Idle =>
        {
            Some(())
        }
        _ => None,
    })
    .await;
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_e12_denied").await;
    assert_eq!(result["content"], "Denied in roundup", "{result}");
    assert!(!project.dir.path().join("e12-denied").exists());
    model.assert_matched();
}
