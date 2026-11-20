//! RLH1-RLH3: resume and a live outside holder of the conversation.

use std::sync::Arc;

use serde_json::{Value, json};

use super::{CONVERSATION, exited_with_conversation};
use crate::common::Fixture;

/// A live process outside the Daemon's Terminals that names `settings`, as a Claude Code
/// background session's host does. `trap` is the shell's reaction to the stop signal.
fn outside_process(settings: &std::path::Path, trap: &str) -> tokio::process::Child {
    tokio::process::Command::new("sh")
        .arg("-c")
        .arg(format!("{trap}; while :; do sleep 1; done"))
        .arg("sh")
        .arg(settings)
        .kill_on_drop(true)
        .spawn()
        .unwrap()
}

/// A background-session job of Claude Code whose state names `settings`.
fn job_naming(f: &Fixture, settings: &std::path::Path) {
    let job = f.dir.path().join("jobs/d1459939aa");
    std::fs::create_dir_all(&job).unwrap();
    std::fs::write(
        job.join("state.json"),
        json!({"backend": "daemon", "template": "bg", "argv": ["--settings", settings]})
            .to_string(),
    )
    .unwrap();
}

fn settings_of(f: &Fixture, id: &str) -> std::path::PathBuf {
    agents::claude_code::settings_marker(f.dir.path(), id).unwrap()
}

#[tokio::test]
async fn rlh1_resume_stops_an_outside_holder_then_starts() {
    let f = Fixture::running("sleep 30");
    let node = exited_with_conversation(&f, CONVERSATION).await;
    let settings = settings_of(&f, &node.id);
    job_naming(&f, &settings);
    let mut holder = outside_process(&settings, ":");
    // Reaped as it exits, as a process that is no child of the Daemon is.
    let exited = tokio::spawn(async move { holder.wait().await });
    let mut other = outside_process(&settings.with_file_name("99.settings.json"), ":");
    let f = Arc::new(f);
    let old_attempt = node.attempt().unwrap();

    let resuming = {
        let f = Arc::clone(&f);
        let id = node.id.clone();
        tokio::spawn(async move { f.resume(&id).await })
    };
    f.until_attempt_changed(&node.id, &old_attempt).await;
    f.session_start(&node.id, CONVERSATION, "resume")
        .await
        .unwrap();
    let resumed = resuming.await.unwrap().unwrap();

    assert!(resumed.terminal_id().is_some());
    assert!(
        exited.is_finished(),
        "the outside holder was stopped before the new run started"
    );
    assert!(
        other.try_wait().unwrap().is_none(),
        "a process that is no holder of this Agent is left alone"
    );
}

#[tokio::test]
async fn rlh2_launch_keeps_the_agent_out_of_the_background_service() {
    let f = Fixture::running("sleep 30");
    let node = exited_with_conversation(&f, CONVERSATION).await;
    let settings: Value =
        serde_json::from_slice(&std::fs::read(settings_of(&f, &node.id)).unwrap()).unwrap();

    assert_eq!(settings["env"]["CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF"], "1");
}

#[tokio::test]
async fn rlh3_resume_failure_names_the_step_and_cause() {
    let f = Fixture::running("sleep 30");
    let node = exited_with_conversation(&f, CONVERSATION).await;
    let settings = settings_of(&f, &node.id);
    job_naming(&f, &settings);
    let mut holder = outside_process(&settings, "trap '' TERM");
    // The bounds run on the paused clock; the process work around them needs the real one.
    tokio::time::pause();
    let err = f.resume(&node.id).await.unwrap_err();

    assert!(
        err.message.contains("stop outside holder failed") && err.message.contains("still runs"),
        "{}",
        err.message
    );
    assert!(settings.exists());
    assert!(f.can_resume(&f.tree().await, &node.id));
    holder.kill().await.unwrap();
}
