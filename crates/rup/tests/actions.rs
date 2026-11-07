//! NA11–NA13: `rup actions` lists the App's named actions and `rup do` runs one.

use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

#[path = "common/served.rs"]
mod common;

use common::Served;

const BOUND: Duration = Duration::from_secs(30);

struct Run {
    socket: PathBuf,
    agent: Option<String>,
    stdin: Option<Vec<u8>>,
}

fn on(socket: &Path) -> Run {
    Run {
        socket: socket.to_owned(),
        agent: Some("a1".into()),
        stdin: None,
    }
}

impl Run {
    fn acting_as(self, agent: Option<&str>) -> Self {
        Run {
            agent: agent.map(str::to_owned),
            ..self
        }
    }

    fn with_stdin(self, stdin: &[u8]) -> Self {
        Run {
            stdin: Some(stdin.to_vec()),
            ..self
        }
    }

    async fn rup(&self, args: &[&str]) -> Output {
        let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"));
        command
            .args(args)
            .env("RUPD_SOCKET", &self.socket)
            .env_remove("ROUNDUP_AGENT")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(agent) = &self.agent {
            command.env("ROUNDUP_AGENT", agent);
        }
        let mut child = command.spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        if let Some(bytes) = &self.stdin {
            stdin.write_all(bytes).await.unwrap();
        }
        drop(stdin);
        tokio::time::timeout(BOUND, child.wait_with_output())
            .await
            .expect("rup ended")
            .unwrap()
    }
}

fn out(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).unwrap()
}

fn err(output: &Output) -> String {
    String::from_utf8(output.stderr.clone()).unwrap()
}

fn code(output: &Output) -> i32 {
    output.status.code().unwrap()
}

struct Project {
    _served: Served,
    socket: PathBuf,
}

async fn start_daemon() -> Project {
    let served = Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let socket = served.socket();
    Project {
        _served: served,
        socket,
    }
}

/// A fake App on `socket`: it registers with `action.serve`, answers `action.list` with `rows` and
/// every `action.run` as `run` says. The received `action.run` params arrive on the channel.
async fn fake_app(
    socket: &Path,
    rows: Value,
    run: Value,
) -> (std::sync::Arc<rpc::Client>, mpsc::UnboundedReceiver<Value>) {
    let mut app = rpc::Client::connect(socket).await.unwrap();
    let mut asked = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    let (seen, runs) = mpsc::unbounded_channel();
    let app = std::sync::Arc::new(app);
    let answering = std::sync::Arc::clone(&app);
    tokio::spawn(async move {
        while let Some(request) = asked.recv().await {
            let result = match request["method"].as_str() {
                Some("action.list") => rows.clone(),
                _ => {
                    let _ = seen.send(request["params"].clone());
                    run.clone()
                }
            };
            let line = json!({"jsonrpc":"2.0","id":request["id"],"result":result});
            answering.reply(&line).await.unwrap();
        }
    });
    (app, runs)
}

fn action_rows() -> Value {
    json!([
        {"name":"agent.new-with-prompt","label":"New agent with prompt","keys":"⇧⌘N","args":[{"key":"prompt","type":"string"}],"available":true},
        {"name":"agent.new","label":"New agent","keys":"⌘N","args":[],"available":true},
        {"name":"todo.assign-slot","label":"Assign slot","keys":"1-9","args":[{"key":"slot","type":"integer","required":true,"min":1,"max":9}],"available":true},
        {"name":"rail.remove","label":"Remove","keys":"⌫","args":[],"available":false,"cause":"needs a Rail row"}
    ])
}

#[tokio::test]
async fn na11_actions_prints_one_line_per_action() {
    let project = start_daemon().await;
    let _app = fake_app(&project.socket, action_rows(), json!({"status":"done"})).await;
    let output = on(&project.socket).acting_as(None).rup(&["actions"]).await;
    assert_eq!(code(&output), 0, "{}", err(&output));
    let lines: Vec<String> = out(&output).lines().map(str::to_owned).collect();
    assert_eq!(
        lines,
        [
            "agent.new-with-prompt [prompt=<string>]  ⇧⌘N",
            "agent.new  ⌘N",
            "todo.assign-slot slot=<integer>  1-9",
            "rail.remove  ⌫  unavailable: needs a Rail row",
        ]
    );
}

#[tokio::test]
async fn na11_actions_json_is_the_result_alone() {
    let project = start_daemon().await;
    let _app = fake_app(&project.socket, action_rows(), json!({"status":"done"})).await;
    let output = on(&project.socket)
        .acting_as(None)
        .rup(&["actions", "--json"])
        .await;
    assert_eq!(code(&output), 0);
    assert_eq!(
        serde_json::from_str::<Value>(&out(&output)).unwrap(),
        action_rows()
    );
}

const APP_CLOSED_TEXT: &str = "rup: the roundup App is not open (APP_CLOSED)\nopen the roundup App and run `rup actions` again\n";

#[tokio::test]
async fn na11_actions_with_no_app_names_cause_and_fix() {
    let project = start_daemon().await;
    let output = on(&project.socket).acting_as(None).rup(&["actions"]).await;
    assert_eq!(code(&output), 1);
    assert!(out(&output).is_empty());
    assert_eq!(err(&output), APP_CLOSED_TEXT);
}

#[tokio::test]
async fn na12_do_sends_name_and_pairs_and_prints_the_result() {
    let project = start_daemon().await;
    let (_app, mut runs) = fake_app(&project.socket, action_rows(), json!({"status":"done"})).await;
    let run = on(&project.socket).acting_as(None);
    let output = run
        .rup(&["do", "agent.new-with-prompt", "prompt=a=b c"])
        .await;
    assert_eq!((code(&output), out(&output)), (0, "done\n".to_owned()));
    assert_eq!(
        runs.recv().await.unwrap(),
        json!({"name":"agent.new-with-prompt","args":[{"key":"prompt","value":"a=b c"}]})
    );
    let piped = run
        .with_stdin(b"from stdin")
        .rup(&["do", "agent.new-with-prompt", "prompt=-"])
        .await;
    assert_eq!(code(&piped), 0, "{}", err(&piped));
    assert_eq!(runs.recv().await.unwrap()["args"][0]["value"], "from stdin");
}

#[tokio::test]
async fn na12_awaiting_is_printed() {
    let project = start_daemon().await;
    let _app = fake_app(&project.socket, action_rows(), json!({"status":"awaiting"})).await;
    let output = on(&project.socket)
        .acting_as(None)
        .rup(&["do", "agent.new"])
        .await;
    assert_eq!(code(&output), 0);
    assert!(out(&output).starts_with("awaiting: "), "{}", out(&output));
}

#[tokio::test]
async fn na12_unknown_name_suggests_the_closest() {
    let project = start_daemon().await;
    let (_app, mut runs) = fake_app(&project.socket, action_rows(), json!({"status":"done"})).await;
    let output = on(&project.socket)
        .acting_as(None)
        .rup(&["do", "agent.nw"])
        .await;
    assert_eq!(code(&output), 1);
    assert_eq!(
        err(&output),
        "rup: unknown action \"agent.nw\"\ndid you mean \"agent.new\"?\nrun \"rup actions\"\n"
    );
    assert!(runs.try_recv().is_err());
}

#[tokio::test]
async fn na12_unknown_or_bad_argument_exits_1_naming_it() {
    let project = start_daemon().await;
    let (_app, mut runs) = fake_app(&project.socket, action_rows(), json!({"status":"done"})).await;
    let run = on(&project.socket).acting_as(None);
    for (args, needle) in [
        (
            &["do", "agent.new", "colour=red"][..],
            "unknown argument \"colour\"",
        ),
        (&["do", "todo.assign-slot"], "missing argument \"slot\""),
        (&["do", "todo.assign-slot", "slot=x"], "argument \"slot\""),
        (&["do", "todo.assign-slot", "slot=12"], "from 1 to 9"),
    ] {
        let output = run.rup(args).await;
        assert_eq!(code(&output), 1, "{args:?}");
        assert!(err(&output).contains(needle), "{}", err(&output));
    }
    assert!(runs.try_recv().is_err());
}

#[tokio::test]
async fn na12_malformed_pairs_exit_2_before_any_call() {
    let dir = tempfile::tempdir().unwrap();
    let run = on(&dir.path().join("no-daemon")).acting_as(None);
    for args in [
        &["do", "agent.new", "prompt"][..],
        &["do", "agent.new", "=x"],
        &["do", "agent.new", "a=1", "a=2"],
        &["do"],
    ] {
        let output = run.rup(args).await;
        assert_eq!(code(&output), 2, "{args:?}: {}", err(&output));
        assert!(out(&output).is_empty());
    }
}

#[tokio::test]
async fn na12_do_with_no_app_names_cause_and_fix() {
    let project = start_daemon().await;
    let output = on(&project.socket)
        .acting_as(None)
        .rup(&["do", "agent.new"])
        .await;
    assert_eq!(code(&output), 1);
    assert!(out(&output).is_empty());
    assert_eq!(err(&output), APP_CLOSED_TEXT);
}

#[tokio::test]
async fn na12_an_agent_shell_is_refused() {
    let project = start_daemon().await;
    let (_app, mut runs) = fake_app(&project.socket, action_rows(), json!({"status":"done"})).await;
    let output = on(&project.socket).rup(&["do", "agent.new"]).await;
    assert_eq!(code(&output), 1);
    assert!(err(&output).contains("(FORBIDDEN)"), "{}", err(&output));
    assert!(runs.try_recv().is_err());
}

#[tokio::test]
async fn na13_help_lists_actions_and_do_with_examples() {
    let dir = tempfile::tempdir().unwrap();
    let run = on(&dir.path().join("none"));
    let help = out(&run.rup(&["help"]).await);
    assert!(help.contains("rup actions [--json]") && help.contains("rup do <name> [key=value]..."));
    for args in [
        &["help", "actions"][..],
        &["actions", "--help"],
        &["help", "do"],
        &["do", "--help"],
    ] {
        let output = run.rup(args).await;
        let text = out(&output);
        assert_eq!(code(&output), 0, "{args:?}");
        assert!(
            text.contains("Usage: rup ") && text.contains("Example:\n  rup "),
            "{text}"
        );
    }
}
