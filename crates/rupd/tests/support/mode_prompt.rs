//! A4452c: saved Mode prompts through the existing Agent test harness.
use super::{child_run::Run, door_terminals::recorded_bytes, idle::idle};
use serde_json::{Value, json};

async fn mode(prompt: &str) -> Run {
    let mut run = Run::start().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let node = run
        .user
        .request("agent.createMode", json!({"name":"team","prompt":prompt}))
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().to_owned();
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    restart(&mut run, "initial").await.unwrap();
    run
}

async fn restart(run: &mut Run, request: &str) -> Result<Value, rpc::RpcError> {
    let node = run
        .user
        .request(
            "agent.restartMode",
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
    let mut run = mode(prompt).await;
    // A Mode's children are the Agents it starts itself (U4547a); the user nests none under it.
    let mode_agent = rpc::Client::connect(&run.daemon.socket).await.unwrap();
    mode_agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child,"parent":null}}),
        )
        .await
        .unwrap();
    let child = mode_agent
        .request(
            "agent.spawn",
            json!({"name":"retained child","cwd":run.dir.path(),"parent":run.child,"role":"job"}),
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
        .request(
            "todo.assign",
            json!({"id":todo["id"],"owner":{"kind":"agent","id":run.child}}),
        )
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
        .request("rail.rename", json!({"id":run.child,"name":"Fresh team"}))
        .await
        .unwrap();
    let before = run.attempt.clone();
    let node = restart(&mut run, "fresh-1").await.unwrap();
    assert_ne!(node["attempt"], before);
    assert_eq!(node["mode_prompt"], prompt);
    assert_eq!(node["id"], run.child);
    assert_eq!(node["name"], "Fresh team");
    let brief = run
        .user
        .request("agent.brief", json!({"id":run.child}))
        .await
        .unwrap();
    assert!(
        brief["stdout"]
            .as_str()
            .unwrap()
            .contains("Your Rail name is Fresh team")
    );
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
            .any(|p| p["name"] == pad["name"] && p["text"] == "unchanged")
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
    assert_eq!(node["mode_prompt"], prompt);
    assert_eq!(recorded_bytes(&run).await, expected);
    run.user
        .request(
            "agent.setModePrompt",
            json!({"id":run.child,"prompt":" changed for the next session\n "}),
        )
        .await
        .unwrap();
    assert_eq!(recorded_bytes(&run).await, expected);
    run.finish().await;
}

#[tokio::test]
async fn a4452c_failed_recording_retries_without_another_physical_write() {
    let mut run = mode("Keep this exact prompt").await;
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
async fn a4452c_agent_cannot_restart_or_edit_the_mode_prompt() {
    let run = mode("User's saved text").await;
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
            "agent.restartMode",
            json!({"id":run.child,"request":"agent-1"}),
        ),
        (
            "agent.setModePrompt",
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
    let mut run = mode("Only once").await;
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
        let prompt = "  /compose original\nKeep spacing  ";
        let mut run = mode(prompt).await;
        let launches = run.dir.path().join(format!("launches-{}.jsonl", run.child));
        let launched = || -> Vec<Value> {
            std::fs::read_to_string(&launches)
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        };
        let initial_launches = launched().len();
        let before_terminals = run.user.request("terminal.list", ()).await.unwrap();
        let before_terminal_ids: Vec<Value> = before_terminals
            .as_array()
            .unwrap()
            .iter()
            .map(|terminal| terminal["id"].clone())
            .collect();
        let before_notes = run
            .user
            .request("message.list", json!({"to":run.child}))
            .await
            .unwrap();
        let prior_user_notes: Vec<Value> = before_notes
            .as_array()
            .unwrap()
            .iter()
            .filter(|note| note["kind"] == "note" && note["from"]["kind"] == "user")
            .cloned()
            .collect();
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
                error
                    .message
                    .contains("Mode Agent did not start a session within 15s"),
                "{error}"
            );
        } else {
            assert_ne!(error.code, rpc::code::UNKNOWN_OUTCOME, "{error}");
            assert!(error.message.contains("claude"), "{error}");
        }
        let failed_launches = launched();
        assert_eq!(
            failed_launches.len(),
            initial_launches + usize::from(missing_start)
        );
        let terminals = run.user.request("terminal.list", ()).await.unwrap();
        assert!(
            terminals
                .as_array()
                .unwrap()
                .iter()
                .all(|t| t["running"] == false)
        );
        for terminal in terminals
            .as_array()
            .unwrap()
            .iter()
            .filter(|terminal| !before_terminal_ids.contains(&terminal["id"]))
        {
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
        let failed_user_notes: Vec<Value> = notes
            .as_array()
            .unwrap()
            .iter()
            .filter(|note| note["kind"] == "note" && note["from"]["kind"] == "user")
            .cloned()
            .collect();
        assert_eq!(failed_user_notes, prior_user_notes, "{notes}");
        run.user
            .request(
                "agent.setModePrompt",
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
        let expected = format!("\x1b[200~{prompt}\x1b[201~\r").into_bytes();
        assert_eq!(recorded_bytes(&run).await, expected);
        let notes = run
            .user
            .request("message.list", json!({"to":run.child}))
            .await
            .unwrap();
        let saved_notes: Vec<Value> = notes
            .as_array()
            .unwrap()
            .iter()
            .filter(|note| note["kind"] == "note" && note["from"]["kind"] == "user")
            .cloned()
            .collect();
        assert_eq!(saved_notes.len(), prior_user_notes.len() + 1, "{notes}");
        assert_eq!(
            &saved_notes[..prior_user_notes.len()],
            prior_user_notes.as_slice()
        );
        assert_eq!(saved_notes.last().unwrap()["body"], prompt);
        assert_eq!(saved_notes.last().unwrap()["status"], "delivered");
        let retried = restart(&mut run, "retry-failed-start").await.unwrap();
        assert_eq!(retried["attempt"], node["attempt"]);
        assert_eq!(recorded_bytes(&run).await, expected);
        let replayed_notes = run
            .user
            .request("message.list", json!({"to":run.child}))
            .await
            .unwrap();
        let replayed_notes: Vec<Value> = replayed_notes
            .as_array()
            .unwrap()
            .iter()
            .filter(|note| note["kind"] == "note" && note["from"]["kind"] == "user")
            .cloned()
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
