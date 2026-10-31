//! U516: a working Agent is sent nothing until idle.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use serde_json::json;

#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/launch_gate.rs"]
#[allow(dead_code)]
mod launch_gate;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use doors::{requests_holding, started_door};
use launch_gate::Gate;
use waiting::{idle, until, until_async};

/// U516: what the webview sends for a selected Turn: a fenced Excerpt and the Turn's facts.
const U516_BODY: &str = "why?\n\n```\n$ ls\nfile\n```\n\ncommand: ls\ncwd: /work\nexit: 0";

#[tokio::test]
async fn u516_a_working_agent_is_sent_nothing_until_idle() {
    let gate = Gate::new();
    std::fs::remove_file(&gate.hold).unwrap();
    let project = daemon::start_real("u516_excerpt", &[("ROUNDUP_CLAUDE_BIN", &gate.wrapper())]);
    let client = project.subscribed().await;
    let door = started_door(&client).await;
    until(project.bound(), "the Door's launch is held", || {
        gate.held.exists().then_some(())
    })
    .await;
    client
        .request(
            "message.send",
            json!({"to": door, "kind": "note", "body": U516_BODY}),
        )
        .await
        .unwrap();

    let listed = client
        .request("message.list", json!({"to": door}))
        .await
        .unwrap();
    assert_eq!(listed[0]["status"], "pending");
    let model = project.model.as_ref().unwrap();
    assert!(
        model.journal().is_empty(),
        "nothing reaches the model while the Agent has not reached idle"
    );

    std::fs::write(&gate.hold, "").unwrap();
    until_async(project.bound(), "the Excerpt reaches the model", || async {
        (requests_holding(model, "```\n$ ls\nfile\n```") > 0).then_some(())
    })
    .await;
    assert!(
        requests_holding(model, U516_BODY) > 0,
        "the whole body is typed: {:#?}",
        model.journal()
    );
    idle(project.bound(), &client, &door).await;
    model.assert_matched();
}
