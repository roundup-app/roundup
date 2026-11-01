//! A4452c: saved Opening prompts through the existing Door test harness.
use super::{
    child_run::{BOUND, Run},
    door_terminals::recorded_bytes,
    idle::idle,
};
use serde_json::{Value, json};

async fn door(prompt: Option<&str>) -> Run {
    let mut run = Run::start().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let node = run
        .user
        .request(
            "rail.createWorkstream",
            json!({"name":"team","parent":null}),
        )
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().to_owned();
    run.user
        .request(
            "workstream.setOpeningPrompt",
            json!({"id":run.child,"prompt":prompt}),
        )
        .await
        .unwrap();
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    let node = run
        .user
        .request("rail.startDoor", json!({"id":run.child}))
        .await
        .unwrap();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(&run).await;
    run
}

async fn restart(run: &mut Run, request: &str) -> Result<Value, rpc::RpcError> {
    let node = run
        .user
        .request(
            "workstream.restart",
            json!({"id":run.child,"request":request}),
        )
        .await?;
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(run).await;
    Ok(node)
}

#[tokio::test]
async fn u4547d_restart_uses_the_saved_prompt_and_preserves_contents() {
    let prompt = "  /compose exact words\nKeep spacing  ";
    let mut run = door(Some(prompt)).await;
    let child = run
        .user
        .request(
            "agent.spawn",
            json!({"name":"retained child","cwd":run.dir.path(),"parent":run.child}),
        )
        .await
        .unwrap();
    let todo = run
        .user
        .request("todo.create", json!({"title":"retained task"}))
        .await
        .unwrap();
    let todo = run
        .user
        .request("todo.move", json!({"id":todo["id"],"home":run.child}))
        .await
        .unwrap();
    let pad = run
        .user
        .request(
            "pad.create",
            json!({"name":"retained pad","text":"unchanged"}),
        )
        .await
        .unwrap();
    run.user
        .request("pad.move", json!({"name":"retained pad","home":run.child}))
        .await
        .unwrap();
    run.user
        .request("rail.rename", json!({"id":run.child,"name":"Fresh team"}))
        .await
        .unwrap();
    let before = run.attempt.clone();
    let node = restart(&mut run, "fresh-1").await.unwrap();
    assert_ne!(node["attempt"], before);
    assert_eq!(node["opening_prompt"], prompt);
    assert_eq!(node["id"], run.child);
    assert_eq!(node["name"], "Fresh team");
    tokio::time::timeout(BOUND, async {
        let inbox = run.dir.path().join(format!("received-{}.jsonl", run.child));
        loop {
            if std::fs::read_to_string(&inbox).is_ok_and(|text| {
                text.lines().any(|line| {
                    line.contains("roundup-context")
                        && line.contains("Your Rail name is Fresh team")
                })
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("fresh Context reaches the Claude inbox");
    let expected = format!("\x1b[200~{prompt}\x1b[201~\r").into_bytes();
    assert_eq!(recorded_bytes(&run).await, expected);
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == child["id"]
                && n["terminal_id"] == child["terminal_id"]
                && n["parent"] == run.child)
    );
    let todos = run.user.request("todo.list", ()).await.unwrap();
    assert!(todos.as_array().unwrap().contains(&todo));
    let pads = run.user.request("pad.list", ()).await.unwrap();
    assert!(
        pads.as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == pad["name"]
                && p["text"] == "unchanged"
                && p["home"] == run.child)
    );
    let retried = restart(&mut run, "fresh-1").await.unwrap();
    assert_eq!(retried["attempt"], node["attempt"]);
    assert_eq!(recorded_bytes(&run).await, expected);
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let stopped = run.attempt.clone();
    let node = restart(&mut run, "stopped-1").await.unwrap();
    assert_ne!(node["attempt"], stopped);
    assert_eq!(node["id"], run.child);
    assert_eq!(node["name"], "Fresh team");
    assert_eq!(node["opening_prompt"], prompt);
    assert_eq!(recorded_bytes(&run).await, expected);
    run.user
        .request(
            "workstream.setOpeningPrompt",
            json!({"id":run.child,"prompt":" changed for the next session\n "}),
        )
        .await
        .unwrap();
    assert_eq!(recorded_bytes(&run).await, expected);
    run.finish().await;
}

#[tokio::test]
async fn a4452c_no_saved_prompt_starts_idle() {
    let mut run = door(None).await;
    restart(&mut run, "empty-1").await.unwrap();
    assert!(recorded_bytes(&run).await.is_empty());
    run.finish().await;
}

#[tokio::test]
async fn a4452c_failed_recording_retries_without_another_physical_write() {
    let mut run = door(Some("Keep this exact prompt")).await;
    std::fs::write(
        run.dir.path().join("messages-fault"),
        "record_restart_prompt",
    )
    .unwrap();
    assert!(restart(&mut run, "record-1").await.is_err());
    std::fs::remove_file(run.dir.path().join("messages-fault")).unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let failed = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap();
    run.terminal = failed["terminal_id"].clone();
    let written = recorded_bytes(&run).await;
    let retried = restart(&mut run, "record-1").await.unwrap();
    assert_eq!(retried["attempt"], failed["attempt"]);
    assert_eq!(recorded_bytes(&run).await, written);
    assert_eq!(
        recorded_bytes(&run).await,
        b"\x1b[200~Keep this exact prompt\x1b[201~\r"
    );
    run.finish().await;
}

#[tokio::test]
async fn a4452c_agent_cannot_restart_or_edit_the_opening_prompt() {
    let run = door(Some("User's saved text")).await;
    let agent = rpc::Client::connect(&run.daemon.socket).await.unwrap();
    agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    for (method, params) in [
        (
            "workstream.restart",
            json!({"id":run.child,"request":"agent-1"}),
        ),
        (
            "workstream.setOpeningPrompt",
            json!({"id":run.child,"prompt":"Agent text"}),
        ),
    ] {
        let error = agent.request(method, params).await.unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN, "{error}");
    }
    run.finish().await;
}

#[tokio::test]
async fn a4452c_unknown_input_outcome_never_retypes_on_retry() {
    let mut run = door(Some("Only once")).await;
    std::fs::write(run.dir.path().join("input-gate"), "flush").unwrap();
    assert!(restart(&mut run, "unknown-1").await.is_err());
    std::fs::remove_file(run.dir.path().join("input-gate")).unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    let node = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == run.child)
        .unwrap();
    run.terminal = node["terminal_id"].clone();
    let written = recorded_bytes(&run).await;
    assert!(restart(&mut run, "unknown-1").await.is_err());
    assert_eq!(recorded_bytes(&run).await, written);
    assert_eq!(written, b"\x1b[200~Only once\x1b[201~");
    run.finish().await;
}

#[tokio::test]
async fn a4665_failed_start_retries_same_request() {
    for missing_start in [false, true] {
        for prompt in [Some("  /compose original\nKeep spacing  "), None] {
            let mut run = door(prompt).await;
            let launches = run.dir.path().join(format!("launches-{}.jsonl", run.child));
            let launched = || -> Vec<Value> {
                std::fs::read_to_string(&launches)
                    .unwrap()
                    .lines()
                    .map(|line| serde_json::from_str(line).unwrap())
                    .collect()
            };
            let fake = run.dir.path().join("claude");
            let fault = run.dir.path().join("missing-session-start");
            if missing_start {
                std::fs::write(&fault, "hold").unwrap();
            } else {
                std::fs::rename(&fake, fake.with_extension("disabled")).unwrap();
            }
            let error = restart(&mut run, "retry-failed-start").await.unwrap_err();
            if missing_start {
                assert!(
                    error.message.contains("no SessionStart within 15s"),
                    "{error}"
                );
            } else {
                assert_ne!(error.code, rpc::code::UNKNOWN_OUTCOME, "{error}");
                assert!(error.message.contains("claude"), "{error}");
            }
            let failed_launches = launched();
            assert_eq!(failed_launches.len(), if missing_start { 2 } else { 1 });
            let terminals = run.user.request("terminal.list", ()).await.unwrap();
            assert!(
                terminals
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|t| t["running"] == false)
            );
            for terminal in terminals.as_array().unwrap() {
                let output = run
                    .user
                    .request("terminal.read", json!({"id":terminal["id"],"after":0}))
                    .await
                    .unwrap();
                assert!(!output["text"].as_str().unwrap().contains("BYTE:"));
            }
            let notes = run
                .user
                .request("message.list", json!({"to":run.child}))
                .await
                .unwrap();
            assert!(
                notes
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|note| note["from"]["kind"] != "user"),
                "{notes}"
            );
            run.user
                .request(
                    "workstream.setOpeningPrompt",
                    json!({"id":run.child,"prompt":"Replacement setting"}),
                )
                .await
                .unwrap();
            if missing_start {
                std::fs::remove_file(&fault).unwrap();
            } else {
                std::fs::rename(fake.with_extension("disabled"), &fake).unwrap();
            }
            let node = restart(&mut run, "retry-failed-start").await.unwrap();
            let expected = prompt
                .map(|text| format!("\x1b[200~{text}\x1b[201~\r").into_bytes())
                .unwrap_or_default();
            assert_eq!(recorded_bytes(&run).await, expected);
            let notes = run
                .user
                .request("message.list", json!({"to":run.child}))
                .await
                .unwrap();
            let saved_notes: Vec<_> = notes
                .as_array()
                .unwrap()
                .iter()
                .filter(|note| note["kind"] == "note" && note["from"]["kind"] == "user")
                .collect();
            assert_eq!(saved_notes.len(), usize::from(prompt.is_some()), "{notes}");
            if let Some(prompt) = prompt {
                assert_eq!(saved_notes[0]["body"], prompt);
                assert_eq!(saved_notes[0]["status"], "delivered");
            }
            let retried = restart(&mut run, "retry-failed-start").await.unwrap();
            assert_eq!(retried["attempt"], node["attempt"]);
            assert_eq!(recorded_bytes(&run).await, expected);
            let replayed_notes = run
                .user
                .request("message.list", json!({"to":run.child}))
                .await
                .unwrap();
            let replayed_notes: Vec<_> = replayed_notes
                .as_array()
                .unwrap()
                .iter()
                .filter(|note| note["kind"] == "note" && note["from"]["kind"] == "user")
                .collect();
            assert_eq!(replayed_notes, saved_notes);
            let all_launches = launched();
            assert_eq!(all_launches.len(), failed_launches.len() + 1);
            assert!(
                all_launches
                    .iter()
                    .all(|launch| launch["live"].as_array().unwrap().is_empty()),
                "{all_launches:?}"
            );
            run.finish().await;
        }
    }
}
