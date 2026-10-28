//! A3516: production hook replies and MCP identity across a vendor relaunch.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

#[tokio::test]
async fn a3516b_start_context_carries_the_brief() {
    let reports = tempfile::tempdir().unwrap();
    let prompts = reports.path().join("prompts.jsonl");
    let project = daemon::start(&[("FAKE_CLAUDE_PROMPT_LOG", prompts.to_str().unwrap())]);
    let client = project.client().await;
    let agent: contracts::agent::RailNode = serde_json::from_value(
        client
            .request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "name": "start-context", "prompt": "first work"}),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    daemon::h21_poll("the user's initial prompt", async || {
        std::fs::read_to_string(&prompts).ok()
    })
    .await;
    let files = project.data_dir().join("agents");
    let brief = std::fs::read_to_string(files.join(format!("{}.brief.md", agent.id))).unwrap();
    let settings: Value = serde_json::from_slice(
        &std::fs::read(files.join(format!("{}.settings.json", agent.id))).unwrap(),
    )
    .unwrap();
    let hook = settings["hooks"]["SessionStart"][0]["hooks"][1]["command"]
        .as_str()
        .unwrap();
    let expected = client
        .request("agent.brief", json!({"id": agent.id}))
        .await
        .unwrap();
    let context: Value = serde_json::from_str(expected["stdout"].as_str().unwrap()).unwrap();
    for source in ["startup", "resume"] {
        let mut child = Command::new("sh")
            .args(["-c", hook])
            .env("RUPD_SOCKET", project.socket())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(
                json!({"hook_event_name":"SessionStart", "source": source})
                    .to_string()
                    .as_bytes(),
            )
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(output.stderr.is_empty(), "{output:?}");
        let reply: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(
            reply["hookSpecificOutput"]["additionalContext"],
            format!(
                "{brief}\n{}",
                context["hookSpecificOutput"]["additionalContext"]
                    .as_str()
                    .unwrap()
            )
        );
    }
    let delivered: Vec<Value> = std::fs::read_to_string(&prompts)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap()["prompt"].clone())
        .collect();
    assert_eq!(delivered.len(), 1);
    assert!(
        delivered[0]
            .as_str()
            .unwrap()
            .starts_with("first work\n\n<roundup-context>"),
        "{delivered:?}"
    );
    assert_eq!(
        std::fs::read_to_string(files.join(format!("{}.brief.md", agent.id))).unwrap(),
        brief
    );
}

#[tokio::test]
async fn a3516b_relaunch_keeps_hook_and_tool_identity() {
    let reports = tempfile::tempdir().unwrap();
    let report = reports.path().join("relaunch.json");
    let project = daemon::start(&[("FAKE_CLAUDE_RELAUNCH_REPORT", report.to_str().unwrap())]);
    let client = project.client().await;
    let agent = project.spawn_agent(&client).await;
    let seen = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(bytes) = std::fs::read(&report)
                && let Ok(seen) = serde_json::from_slice::<Vec<Value>>(&bytes)
            {
                break seen;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("fake vendor's two real hook/MCP rounds");
    assert_eq!(seen.len(), 2);
    for round in seen {
        assert_eq!(round["context"]["self"]["id"], agent.id);
        let statuses = round["statuses"].as_array().unwrap();
        assert_eq!(statuses[0]["id"], agent.id);
        assert_eq!(statuses[0]["status"]["kind"], "working");
        assert_eq!(statuses[1]["id"], agent.id);
        assert_eq!(statuses[1]["status"]["kind"], "idle");
    }
}
