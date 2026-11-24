//! A4452c: saved Mode prompts through the existing Agent test harness.
use super::{child_run::Run, door_terminals::recorded_bytes, idle::idle};
use base64::{Engine, engine::general_purpose::STANDARD};
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

/// U7191a: a Mode's Restart is `agent.resume`: it starts a new run on the conversation and types no saved prompt.
#[tokio::test]
async fn a7498a_an_extra_enter_cannot_repeat_a_landed_prompt() {
    let run = mode("Only once").await;
    assert_eq!(recorded_bytes(&run).await, typed("Only once"));
    // The fake submits nothing when Enter reaches an empty input line.
    run.user
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"\r")}),
        )
        .await
        .unwrap();
    let screen = run.recorded_input().await;
    assert_eq!(screen.matches("SUBMITTED").count(), 1, "{screen}");
    assert_eq!(screen.matches("EMPTY-ENTER").count(), 1, "{screen}");
    run.finish().await;
}

#[tokio::test]
async fn u7191a_a_mode_restart_types_no_saved_prompt() {
    let prompt = "Saved words";
    let mut run = mode(prompt).await;
    let expected = format!("\x1b[200~{prompt}\x1b[201~\r").into_bytes();
    assert_eq!(recorded_bytes(&run).await, expected);
    let before = run.attempt.clone();
    let node = run
        .user
        .request("agent.resume", json!({"id":run.child,"mode":"normal"}))
        .await
        .unwrap();
    assert_ne!(node["attempt"], before);
    assert_eq!(node["id"], run.child);
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(&run).await;
    assert_eq!(recorded_bytes(&run).await, Vec::<u8>::new());
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
async fn a4452c_agent_cannot_restart_a_mode() {
    let run = mode("User's saved text").await;
    let agent = rpc::Client::connect(&run.daemon.socket).await.unwrap();
    agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    for (method, params) in [(
        "agent.restartMode",
        json!({"id":run.child,"request":"agent-1"}),
    )] {
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

/// A7494a: the root Mode `run.child` starts a nested Mode; `run` then points at the nested Mode.
/// Returns the starter's id and its connection.
async fn nested(run: &mut Run, prompt: &str) -> (String, rpc::Client) {
    let starter = run.child.clone();
    let agent = rpc::Client::connect(&run.daemon.socket).await.unwrap();
    agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":starter,"parent":null}}),
        )
        .await
        .unwrap();
    let node = agent
        .request(
            "agent.spawn",
            json!({"name":"Shape pad naming","cwd":run.dir.path(),"role":"mode","prompt":prompt}),
        )
        .await
        .unwrap();
    assert_eq!(node["parent"], starter);
    run.child = node["id"].as_str().unwrap().to_owned();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(run).await;
    (starter, agent)
}

async fn row(run: &Run, id: &str) -> Value {
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    tree.as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == id)
        .cloned()
        .unwrap()
}

fn typed(prompt: &str) -> Vec<u8> {
    format!("\x1b[200~{prompt}\x1b[201~\r").into_bytes()
}

#[tokio::test]
async fn a7494a_a_nested_mode_keeps_parent_and_prompt_across_reopen() {
    let prompt = "  /compose /intent naming\nKeep spacing  ";
    let mut run = mode("Planner words").await;
    let (starter, _agent) = nested(&mut run, prompt).await;
    let saved = row(&run, &run.child).await;
    assert_eq!(saved["parent"], starter);
    assert_eq!(saved["mode_prompt"], prompt);
    drop(run.daemon.stdin.take());
    run.daemon.child.wait().unwrap();
    run.daemon = super::child_run::launch(run.dir.path(), run.data.path());
    run.user = std::sync::Arc::new(rpc::Client::connect(&run.daemon.socket).await.unwrap());
    let reopened = row(&run, &run.child).await;
    assert_eq!(reopened["parent"], starter);
    assert_eq!(reopened["mode_prompt"], prompt);
}

#[tokio::test]
async fn a7494a_its_first_prompt_is_typed_once() {
    let prompt = "/compose /intent shape the pad naming";
    let mut run = mode("Planner words").await;
    nested(&mut run, prompt).await;
    assert_eq!(recorded_bytes(&run).await, typed(prompt));
    let notes = run
        .user
        .request("message.list", json!({"to":run.child}))
        .await
        .unwrap();
    let typed_notes = notes
        .as_array()
        .unwrap()
        .iter()
        .filter(|note| note["kind"] == "note" && note["body"] == prompt)
        .count();
    assert_eq!(typed_notes, 1, "{notes}");
}

#[tokio::test]
async fn a7494a_a_nested_mode_is_refused_where_a_mode_may_not_nest() {
    let mut run = mode("Planner words").await;
    let (starter, agent) = nested(&mut run, "First").await;
    let nested_id = run.child.clone();
    // What a refusal could add: each row's identity and saved Mode record, not live Agent status.
    let rows = || async {
        let tree = run.user.request("rail.tree", ()).await.unwrap();
        tree.as_array()
            .unwrap()
            .iter()
            .map(|n| {
                ["id", "name", "parent", "kind", "mode_prompt"]
                    .map(|field| n.get(field).cloned().unwrap_or(Value::Null))
            })
            .collect::<Vec<_>>()
    };
    let cwd = run.dir.path();
    // A nested Mode, a Subagent under the starter and a Workstream's Door each call `mode`.
    let subagent = agent
        .request(
            "agent.spawn",
            json!({"name":"Explore","cwd":cwd,"role":"consult"}),
        )
        .await
        .unwrap();
    let workstream = run
        .user
        .request(
            "rail.createWorkstream",
            json!({"name":"team","parent":null}),
        )
        .await
        .unwrap();
    let before = rows().await;
    for caller in [
        &nested_id,
        subagent["id"].as_str().unwrap(),
        workstream["id"].as_str().unwrap(),
    ] {
        let client = rpc::Client::connect(&run.daemon.socket).await.unwrap();
        client
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":caller}}),
            )
            .await
            .unwrap();
        let refused = client
            .request(
                "agent.spawn",
                json!({"name":"Deeper","cwd":cwd,"role":"mode","prompt":"Words"}),
            )
            .await;
        assert!(refused.is_err(), "{caller} may not start a Mode");
    }
    for params in [
        json!({"name":"","cwd":cwd,"role":"mode","prompt":"Words"}),
        json!({"cwd":cwd,"role":"mode","prompt":"Words"}),
        json!({"name":"Blank","cwd":cwd,"role":"mode","prompt":"  \n"}),
        json!({"name":"Blank","cwd":cwd,"role":"mode"}),
        json!({"name":"Both","cwd":cwd,"role":"mode","prompt":"Words","order":
            {"kind":"work","ask":"Do it","done":"Done","limits":[]}}),
    ] {
        let refused = agent.request("agent.spawn", params.clone()).await;
        assert!(refused.is_err(), "{params}");
    }
    assert_eq!(
        rows().await,
        before,
        "a refusal starts and saves nothing of {starter}"
    );
}

#[tokio::test]
async fn a7494a_move_still_refuses_to_nest_a_mode() {
    let mut run = mode("Planner words").await;
    let other = run
        .user
        .request("agent.createMode", json!({"name":"other","prompt":"Words"}))
        .await
        .unwrap();
    let (starter, _agent) = nested(&mut run, "First").await;
    for (id, parent) in [
        (run.child.clone(), Value::Null),
        (run.child.clone(), other["id"].clone()),
        (other["id"].as_str().unwrap().to_owned(), json!(starter)),
    ] {
        let refused = run
            .user
            .request("rail.move", json!({"id":id,"parent":parent,"index":0}))
            .await;
        assert!(refused.is_err(), "{id} under {parent}");
    }
    assert_eq!(row(&run, &run.child).await["parent"], starter);
}

#[tokio::test]
async fn a7494b_a_nested_modes_context_asks_the_user() {
    let mut run = mode("Planner words").await;
    let (starter, _agent) = nested(&mut run, "First").await;
    let context = run
        .user
        .request("agent.context", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(context["parent"]["id"], starter);
    assert_eq!(context["ask"]["to"], "you");
}

#[tokio::test]
async fn a7494b_its_parent_gets_no_question_or_digest_push_from_it() {
    let mut run = mode("Planner words").await;
    let (starter, _agent) = nested(&mut run, "First").await;
    let before = run
        .user
        .request("message.list", json!({"to":starter}))
        .await
        .unwrap();
    // The nested Mode asks through its own prompt; its Status turns `needs-you`.
    run.user
        .request(
            "agent.signal",
            json!({"id":run.child,"attempt":run.attempt,"payload":{
                "hook_event_name":"PermissionRequest","tool_name":"AskUserQuestion"}}),
        )
        .await
        .unwrap();
    assert_eq!(
        row(&run, &run.child).await["status"]["kind"],
        "needs-you",
        "the child never needed the user"
    );
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let inbox = run
        .user
        .request("message.list", json!({"to":starter}))
        .await
        .unwrap();
    // B43's attention note would add an entry from the Daemon.
    assert_eq!(inbox, before);
}

#[tokio::test]
async fn a7494b_a_subagent_under_a_nested_mode_asks_its_parent() {
    let mut run = mode("Planner words").await;
    let (_starter, _agent) = nested(&mut run, "First").await;
    let mode_agent = rpc::Client::connect(&run.daemon.socket).await.unwrap();
    mode_agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let explore = mode_agent
        .request(
            "agent.spawn",
            json!({"name":"Explore","cwd":run.dir.path(),"role":"consult"}),
        )
        .await
        .unwrap();
    let context = run
        .user
        .request("agent.context", json!({"id":explore["id"]}))
        .await
        .unwrap();
    assert_eq!(context["ask"]["to"], run.child);
}

#[tokio::test]
async fn a7494c_restart_without_a_conversation_types_the_saved_prompt_once() {
    let prompt = "Saved words";
    let mut run = mode("Planner words").await;
    nested(&mut run, prompt).await;
    let before = run.attempt.clone();
    let node = restart(&mut run, "nested-1").await.unwrap();
    assert_ne!(node["attempt"], before);
    assert_eq!(node["mode_prompt"], prompt);
    assert_eq!(recorded_bytes(&run).await, typed(prompt));
    restart(&mut run, "nested-1").await.unwrap();
    assert_eq!(recorded_bytes(&run).await, typed(prompt));
}

#[tokio::test]
async fn a7494c_restart_with_a_conversation_resumes_it() {
    let mut run = mode("Planner words").await;
    let (starter, _agent) = nested(&mut run, "Saved words").await;
    let before = run.attempt.clone();
    let node = run
        .user
        .request("agent.resume", json!({"id":run.child,"mode":"normal"}))
        .await
        .unwrap();
    assert_ne!(node["attempt"], before);
    assert_eq!(node["id"], run.child);
    assert_eq!(node["parent"], starter);
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    idle(&run).await;
    assert_eq!(recorded_bytes(&run).await, Vec::<u8>::new());
}

#[tokio::test]
async fn a7494c_clearing_the_prompt_makes_it_a_subagent_asking_its_parent() {
    let mut run = mode("Planner words").await;
    let (starter, _agent) = nested(&mut run, "Saved words").await;
    let before = row(&run, &run.child).await;
    run.user
        .request("agent.setModePrompt", json!({"id":run.child,"prompt":null}))
        .await
        .unwrap();
    let after = row(&run, &run.child).await;
    assert_eq!(after["parent"], starter);
    assert_eq!(after["attempt"], before["attempt"]);
    assert!(after["mode_prompt"].is_null(), "{after}");
    let context = run
        .user
        .request("agent.context", json!({"id":run.child}))
        .await
        .unwrap();
    assert_eq!(context["ask"]["to"], starter);
}

#[tokio::test]
async fn a7494d_a_nested_mode_launches_as_a_root_mode_does() {
    let mut run = mode("Planner words").await;
    let root = run.child.clone();
    let user = run.user.clone();
    let brief = |id: String| {
        let user = user.clone();
        async move {
            user.request("agent.brief", json!({"id":id})).await.unwrap()["stdout"]
                .as_str()
                .unwrap()
                .to_owned()
        }
    };
    let root_brief = brief(root).await;
    nested(&mut run, "First").await;
    let nested_brief = brief(run.child.clone()).await;
    let words = |brief: &str| {
        brief
            .lines()
            .filter(|line| !line.contains("Rail name"))
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    assert_eq!(words(&nested_brief), words(&root_brief));
}

fn project_db(run: &Run) -> std::path::PathBuf {
    fn find(dir: &std::path::Path) -> Option<std::path::PathBuf> {
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let path = entry.path();
            if path.file_name().is_some_and(|name| name == "project.db") {
                return Some(path);
            }
            if path.is_dir()
                && let Some(found) = find(&path)
            {
                return Some(found);
            }
        }
        None
    }
    find(run.data.path())
        .or_else(|| run.daemon.data.as_ref().and_then(|data| find(data.path())))
        .expect("the Project database")
}

/// Fail one Restart on the missing program.
async fn fail_start(run: &mut Run, key: &str) {
    let fake = run.dir.path().join("claude");
    std::fs::rename(&fake, fake.with_extension("disabled")).unwrap();
    assert!(restart(run, key).await.is_err());
    std::fs::rename(fake.with_extension("disabled"), &fake).unwrap();
}

fn open_holds(run: &Run) -> i64 {
    rusqlite::Connection::open(project_db(run))
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM message_restarts WHERE released IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

/// Leave a hold under `killed-1` by a typing failure whose outcome is unknown.
async fn leave_hold(run: &mut Run) {
    std::fs::write(run.dir.path().join("input-gate"), "flush").unwrap();
    assert!(restart(run, "killed-1").await.is_err());
    std::fs::remove_file(run.dir.path().join("input-gate")).unwrap();
    assert_eq!(open_holds(run), 1);
}

#[tokio::test]
async fn u7191d_a_restart_after_a_core_kill_takes_over_a_starting_hold() {
    let mut run = mode("Once").await;
    leave_hold(&mut run).await;
    let db = rusqlite::Connection::open(project_db(&run)).unwrap();
    let updated = db
        .execute(
            "UPDATE message_restarts SET session='\"Starting\"' WHERE released IS NULL",
            [],
        )
        .unwrap();
    assert_eq!(updated, 1);
    restart(&mut run, "after-reload").await.unwrap();
    assert_eq!(open_holds(&run), 0);
    run.finish().await;
}

#[tokio::test]
async fn u7191d_a_restart_after_a_core_kill_takes_over_a_typing_hold() {
    let mut run = mode("Once").await;
    leave_hold(&mut run).await;
    restart(&mut run, "after-reload").await.unwrap();
    assert_eq!(open_holds(&run), 0);
    run.finish().await;
}

#[tokio::test]
async fn u7191d_a_start_failure_that_typed_nothing_frees_the_hold() {
    let mut run = mode("Once").await;
    fail_start(&mut run, "failed-1").await;
    assert_eq!(open_holds(&run), 0);
    run.finish().await;
}

#[tokio::test]
async fn u7191g_an_unknown_outcome_is_refused_naming_agent_attempt_and_terminal() {
    let mut run = mode("Once").await;
    std::fs::write(run.dir.path().join("input-gate"), "flush").unwrap();
    assert!(restart(&mut run, "unknown-1").await.is_err());
    std::fs::remove_file(run.dir.path().join("input-gate")).unwrap();
    let refused = restart(&mut run, "unknown-1").await.unwrap_err();
    assert!(refused.message.contains(&run.child), "{refused}");
    assert!(refused.message.contains("Attempt"), "{refused}");
    assert!(refused.message.contains("Terminal"), "{refused}");
    run.finish().await;
}

#[tokio::test]
async fn u7191g_a_prompt_is_typed_once_per_program() {
    let mut run = mode("Once").await;
    std::fs::write(run.dir.path().join("input-gate"), "flush").unwrap();
    assert!(restart(&mut run, "unknown-1").await.is_err());
    std::fs::remove_file(run.dir.path().join("input-gate")).unwrap();
    restart(&mut run, "fresh-2").await.unwrap();
    assert_eq!(
        recorded_bytes(&run).await,
        b"\x1b[200~Once\x1b[201~\r".to_vec()
    );
    run.finish().await;
}

#[tokio::test]
async fn u7191f_a_failed_start_logs_one_line_naming_agent_core_id_and_code() {
    let mut run = mode("Once").await;
    let fake = run.dir.path().join("claude");
    std::fs::rename(&fake, fake.with_extension("disabled")).unwrap();
    let error = restart(&mut run, "named-1").await.unwrap_err();
    std::fs::rename(fake.with_extension("disabled"), &fake).unwrap();
    assert!(error.message.contains(&run.child), "{error}");
    assert!(error.message.contains("Terminal "), "{error}");
    assert!(error.message.contains("core code"), "{error}");
    run.finish().await;
}
