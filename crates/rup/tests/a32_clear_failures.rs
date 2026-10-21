//! A32: a Clear held, failed at stop or failed at restart.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::EventData;
use daemon::{next, rail_tree};
use serde_json::{Value, json};
use std::time::Duration;
#[path = "common/clear_fixture.rs"]
#[allow(dead_code)]
mod clear_fixture;
#[path = "common/doors.rs"]
#[allow(dead_code)]
mod doors;
#[path = "common/launch_gate.rs"]
#[allow(dead_code)]
mod launch_gate;
#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
use clear_fixture::clear_fixture;
use doors::{as_door, child_of, user_texts};
use launch_gate::Gate;
use waiting::{asked, idle, until};

/// Leave Subagent `a` mid-resume, which no stop can claim: it was stopped, and its start waits
/// before real Claude runs, so no SessionStart acknowledges the resume.
async fn hold_a_resume(
    client: &rpc::Client,
    project: &daemon::Project,
    gate: &Gate,
    a: &str,
) -> tokio::task::JoinHandle<Result<Value, rpc::RpcError>> {
    client
        .request("agent.stop", json!({"id": a}))
        .await
        .unwrap();
    std::fs::remove_file(&gate.hold).unwrap();
    let resumer = project.client().await;
    let id = a.to_owned();
    let resume =
        tokio::spawn(async move { resumer.request("agent.resume", json!({"id": id})).await });
    until("resume held before SessionStart", || {
        gate.held.is_file().then_some(())
    })
    .await;
    assert!(
        !resume.is_finished(),
        "resume completed without SessionStart"
    );
    resume
}

async fn gated_clear_fixture(fixture: &str, gate: &Gate) -> (daemon::Project, rpc::Client, String) {
    let wrapper = gate.wrapper();
    clear_fixture(
        fixture,
        &[
            ("ROUNDUP_CLAUDE_BIN", &wrapper),
            ("ROUNDUP_HANDOFF_BOUND_MS", "60000"),
            // These tests wait for a restart that fails, so it keeps the Daemon's own bound.
            ("ROUNDUP_RESTART_BOUND_MS", "8000"),
        ],
    )
    .await
}

#[tokio::test]
async fn a32_resume_is_held_until_session_start() {
    let gate = Gate::new();
    let (project, client, door) = gated_clear_fixture("a32_resume_held", &gate).await;
    let a = child_of(&client, &door).await;
    let resume = hold_a_resume(&client, &project, &gate, &a).await;
    std::fs::write(&gate.hold, "").unwrap();
    tokio::time::timeout(Duration::from_secs(30), resume)
        .await
        .expect("resume did not receive SessionStart")
        .unwrap()
        .unwrap();
    idle(&client, &a).await;
    project.model.as_ref().unwrap().assert_matched();
}

#[tokio::test]
async fn a32_a_failed_stop_retries_without_double_archive() {
    let gate = Gate::new();
    let (project, mut client, door) = gated_clear_fixture("a32_failed_stop", &gate).await;
    let model = project.model.as_ref().unwrap();
    let a = child_of(&client, &door).await;
    let b = child_of(&client, &a).await;
    let sections = |pads: &Value| {
        let archive = pads
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["name"] == "archive-1")
            .unwrap();
        let text = archive["text"].as_str().unwrap();
        text.matches("\n## ").count() + usize::from(text.starts_with("## "))
    };
    assert_eq!(
        client
            .request("workstream.clear", json!({"id": door, "reason": "bloat"}))
            .await
            .unwrap(),
        json!({"pending": true})
    );
    asked(model).await;
    hold_a_resume(&client, &project, &gate, &a).await;
    as_door(&project, &door)
        .await
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "Retry the Handoff.", "keep_todos": [], "keep_pads": []}),
        )
        .await
        .unwrap();
    let failed = next(&mut client, |event| match event {
        EventData::WorkstreamClearFailed(failed) if failed.id == door => Some(failed),
        _ => None,
    })
    .await;
    assert_eq!(
        failed.code,
        rpc::code::CONFLICT as i32,
        "{}",
        failed.message
    );

    let ids: Vec<_> = rail_tree(&client).await.into_iter().map(|n| n.id).collect();
    assert!(!ids.contains(&b), "the deepest Subagent stopped first");
    assert!(ids.contains(&a), "{ids:?}");
    assert!(ids.contains(&door));
    assert_eq!(
        rail_tree(&client)
            .await
            .iter()
            .find(|n| n.id == door)
            .unwrap()
            .iteration,
        Some(1)
    );
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    assert_eq!(sections(&pads), 4, "every item archived once");

    std::fs::write(&gate.hold, "").unwrap();
    idle(&client, &a).await;
    assert_eq!(
        client
            .request("workstream.clear", json!({"id": door, "reason": "bloat"}))
            .await
            .unwrap(),
        json!({"pending": true})
    );
    let cleared = next(&mut client, |event| match event {
        EventData::WorkstreamCleared(cleared) if cleared.id == door => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(cleared.iteration, 2);
    let ids: Vec<_> = rail_tree(&client).await.into_iter().map(|n| n.id).collect();
    assert_eq!(ids.iter().filter(|id| **id == door).count(), 1);
    assert!(!ids.contains(&a));
    assert!(!ids.contains(&b));
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    assert_eq!(sections(&pads), 4, "a retry archives nothing twice");
    until(
        "the restarted Door received the Handoff and archive pointer",
        || {
            model
                .journal()
                .iter()
                .any(|entry| {
                    entry["body"]["messages"]
                        .as_array()
                        .is_some_and(|messages| {
                            messages.iter().any(|m| {
                                m["role"] == "user"
                                    && m["content"].as_str().is_some_and(|t| {
                                        t.contains("Retry the Handoff.") && t.contains("archive-1")
                                    })
                            })
                        })
                })
                .then_some(())
        },
    )
    .await;
    idle(&client, &door).await;
    let journal = model.journal();
    let handoff = journal
        .iter()
        .flat_map(user_texts)
        .find(|text| {
            text.contains("Follow this instruction: Retry the Handoff.")
                && text.contains("archived in the Pad archive-1")
        })
        .expect("restarted Door receives the Handoff and archive pointer");
    let shallow = handoff
        .find(&format!("branch roundup/agent-{a}"))
        .expect("child Worktree in Handoff");
    let deep = handoff
        .find(&format!("branch roundup/agent-{b}"))
        .expect("grandchild Worktree in Handoff");
    assert!(
        deep < shallow,
        "deepest Subagent is handed off first: {handoff}"
    );
    assert_eq!(
        rail_tree(&client)
            .await
            .iter()
            .find(|n| n.id == door)
            .unwrap()
            .iteration,
        Some(2)
    );
    model.assert_matched();
}

#[tokio::test]
async fn a32_a_failed_restart_keeps_the_workstream() {
    let gate = Gate::new();
    let (project, mut client, door) = gated_clear_fixture("a32_failed_restart", &gate).await;
    let model = project.model.as_ref().unwrap();
    let a = child_of(&client, &door).await;
    let b = child_of(&client, &a).await;
    let before = rail_tree(&client)
        .await
        .into_iter()
        .find(|n| n.id == door)
        .unwrap();
    std::fs::remove_file(&gate.hold).unwrap();
    assert_eq!(
        client
            .request("workstream.clear", json!({"id": door, "reason": "bloat"}))
            .await
            .unwrap(),
        json!({"pending": true})
    );
    asked(model).await;
    as_door(&project, &door)
        .await
        .request(
            "workstream.handoff",
            json!({"id": door, "summary": "Build the login page.", "keep_todos": [], "keep_pads": []}),
        )
        .await
        .unwrap();
    let failed = next(&mut client, |event| match event {
        EventData::WorkstreamClearFailed(failed) if failed.id == door => Some(failed),
        _ => None,
    })
    .await;
    assert_eq!(
        failed.code,
        rpc::code::CONFLICT as i32,
        "{}",
        failed.message
    );

    let tree = rail_tree(&client).await;
    let after = tree.iter().find(|n| n.id == door).unwrap();
    assert_eq!(after.iteration, Some(1), "the Iteration stays");
    assert_eq!(after.terminal_id, None, "the Door stays stopped");
    assert_eq!(after.name, before.name);
    assert!(tree.iter().all(|n| n.id != a && n.id != b));

    std::fs::write(&gate.hold, "").unwrap();
    client
        .request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let resumed = rail_tree(&client)
        .await
        .into_iter()
        .find(|n| n.id == door)
        .unwrap();
    assert!(resumed.terminal_id.is_some());
    assert_eq!(resumed.iteration, Some(1));
    idle(&client, &door).await;
    model.assert_matched();
}
