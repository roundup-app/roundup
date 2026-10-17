//! I1–I7: the built `rup` as a command line, against an in-process Daemon or a stand-in on a temp socket.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::{Duration, Instant};

use rmcp::ServiceExt;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
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

/// A stand-in Daemon: `rail.tree` shows a Door `a1` when `door`, `replies` answer by method and
/// every other method answers `null`. Every request is sent on the returned channel. With `mute`,
/// the methods named never answer.
fn stand_in(
    socket: &Path,
    door: bool,
    replies: Vec<(&'static str, Value)>,
    mute: &'static [&'static str],
) -> mpsc::UnboundedReceiver<Value> {
    let listener = UnixListener::bind(socket).unwrap();
    let (seen, requests) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let (seen, replies) = (seen.clone(), replies.clone());
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Some(line) = lines.next_line().await.unwrap() {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    let method = request["method"].as_str().unwrap().to_owned();
                    let _ = seen.send(request.clone());
                    if mute.contains(&method.as_str()) {
                        continue;
                    }
                    let result = match method.as_str() {
                        "rail.tree" if door => {
                            json!([{"id":"a1","kind":"workstream","name":"Door","parent":null,"order":0,"can_resume":false,"stray":[]}])
                        }
                        "rail.tree" => json!([]),
                        other => replies
                            .iter()
                            .find(|(name, _)| *name == other)
                            .map_or(Value::Null, |(_, reply)| reply.clone()),
                    };
                    let reply = json!({"jsonrpc":"2.0","id":request["id"],"result":result});
                    write
                        .write_all(format!("{reply}\n").as_bytes())
                        .await
                        .unwrap();
                }
            });
        }
    });
    requests
}

async fn request_of(requests: &mut mpsc::UnboundedReceiver<Value>, method: &str) -> Value {
    loop {
        let request = requests.recv().await.expect("the stand-in saw the call");
        if request["method"] == method {
            return request["params"].clone();
        }
    }
}

/// The tools `rup mcp a1` offers: their names and input schemas.
async fn mcp_tools(socket: &Path) -> Vec<(String, Value)> {
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["mcp", "a1"])
        .env("RUPD_SOCKET", socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = tokio::time::timeout(BOUND, ().serve(transport))
        .await
        .unwrap()
        .unwrap();
    let tools = client.list_all_tools().await.unwrap();
    tools
        .into_iter()
        .map(|tool| {
            (
                tool.name.to_string(),
                Value::Object((*tool.input_schema).clone()),
            )
        })
        .collect()
}

fn squash(name: &str) -> String {
    name.chars()
        .filter(|ch| !matches!(ch, '_' | '-' | ' '))
        .collect::<String>()
        .to_lowercase()
}

/// The commands `rup help` lists under the nouns, as `(usage, Door only)`.
fn listed_commands(help: &str) -> Vec<(String, bool)> {
    let commands = help.split("Commands:").nth(1).unwrap();
    // I9: the streams are listed apart, and `rup mcp` does not offer them.
    let commands = commands.split("\n  streams\n").next().unwrap();
    let lines: Vec<&str> = commands.lines().collect();
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.starts_with("    rup "))
        .map(|(at, line)| {
            (
                line.trim().to_owned(),
                lines[at + 1].trim_end().ends_with("[Door only]"),
            )
        })
        .collect()
}

fn command_key(usage: &str) -> String {
    let mut words = usage.split_whitespace().skip(1).take(2);
    squash(&format!(
        "{}{}",
        words.next().unwrap(),
        words.next().unwrap()
    ))
}

fn tool_key(name: &str) -> String {
    if name == "ask_user" {
        "agentask".to_owned()
    } else {
        squash(name)
    }
}

#[tokio::test]
async fn i1_every_mcp_tool_is_a_command_and_no_command_is_extra() {
    let dir = tempfile::tempdir().unwrap();
    let help = out(&on(&dir.path().join("none")).rup(&["help"]).await);
    let commands = listed_commands(&help);
    for door in [false, true] {
        let socket = dir.path().join(format!("{door}.sock"));
        let _requests = stand_in(&socket, door, Vec::new(), &[]);
        let tools: BTreeSet<String> = mcp_tools(&socket)
            .await
            .iter()
            .map(|(name, _)| tool_key(name))
            .collect();
        let cli: BTreeSet<String> = commands
            .iter()
            .filter(|(_, door_only)| door || !door_only)
            .map(|(usage, _)| command_key(usage))
            .collect();
        assert_eq!(cli, tools, "door: {door}");
    }
    let streams = help
        .split("\n  streams\n")
        .nth(1)
        .and_then(|rest| rest.split("\n  other\n").next())
        .unwrap();
    assert!(
        streams.contains("rup events [--after <after>] [--follow]")
            && streams.contains("Example: rup events --after 12 --follow --json"),
        "{streams}"
    );
    let other = help.split("\n  other\n").nth(1).unwrap();
    let other: Vec<&str> = other
        .lines()
        .filter(|line| line.starts_with("    rup "))
        .map(|line| line.split_whitespace().nth(1).unwrap())
        .collect();
    assert_eq!(
        other,
        ["help", "ping", "mcp", "signal", "context", "permission"]
    );
}

#[tokio::test]
async fn i1_a_commands_flags_are_its_schemas_fields() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let _requests = stand_in(&socket, false, Vec::new(), &[]);
    let tools = mcp_tools(&socket).await;
    let schema = |name: &str| tools.iter().find(|(n, _)| n == name).unwrap().1.clone();
    let run = on(&socket);
    let create = out(&run.rup(&["help", "todo", "create"]).await);
    let schema = schema("todo_create");
    let required: Vec<&str> = schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    assert_eq!(required, ["title"]);
    assert!(
        create.contains("Usage: rup todo create [OPTIONS] <title>"),
        "{create}"
    );
    for field in schema["properties"].as_object().unwrap().keys() {
        if !required.contains(&field.as_str()) {
            assert!(create.contains(&format!("--{field}")), "{field}\n{create}");
        }
    }
    let read = out(&run.rup(&["help", "terminal", "read"]).await);
    assert!(read.contains("<id>") && read.contains("--after"), "{read}");
    let blockers = out(&run.rup(&["help", "todo", "set-blockers"]).await);
    assert!(blockers.contains("--blockers"), "{blockers}");
}

#[tokio::test]
async fn i1_a_door_only_command_is_refused_to_an_agent() {
    let dir = tempfile::tempdir().unwrap();
    let agent = dir.path().join("agent.sock");
    let _a = stand_in(&agent, false, Vec::new(), &[]);
    let refused = on(&agent).rup(&["agent", "digest"]).await;
    assert_eq!(code(&refused), 2);
    assert!(
        err(&refused).contains("only a Door has"),
        "{}",
        err(&refused)
    );
    let door = dir.path().join("door.sock");
    let _d = stand_in(&door, true, Vec::new(), &[]);
    assert_eq!(code(&on(&door).rup(&["agent", "digest"]).await), 0);
}

#[tokio::test]
async fn i2_every_spelling_of_help_prints_the_same_text_on_stdout_and_exits_0() {
    let dir = tempfile::tempdir().unwrap();
    let run = on(&dir.path().join("none"));
    let first = run.rup(&[]).await;
    assert_eq!(code(&first), 0);
    assert!(err(&first).is_empty());
    for spelling in [&["help"][..], &["-h"], &["--help"]] {
        let output = run.rup(spelling).await;
        assert_eq!(
            (code(&output), out(&output), err(&output)),
            (0, out(&first), String::new())
        );
    }
}

#[tokio::test]
async fn i2_help_has_the_four_parts_in_order() {
    let dir = tempfile::tempdir().unwrap();
    let help = out(&on(&dir.path().join("none")).rup(&["help"]).await);
    let at = |needle: &str| help.find(needle).unwrap_or_else(|| panic!("{needle}"));
    assert!(at("roundup") < at("Examples:"));
    assert!(at("Examples:") < at("Commands:"));
    assert!(at("Commands:") < at("Exit codes:"));
    for line in ["0  done", "1  failed", "2  bad usage"] {
        assert!(help[at("Exit codes:")..].contains(line), "{line}");
    }
}

#[tokio::test]
async fn i2_a_commands_help_names_its_arguments_flags_and_an_example() {
    let dir = tempfile::tempdir().unwrap();
    let run = on(&dir.path().join("none"));
    let by_help = run.rup(&["help", "pad", "read"]).await;
    let by_flag = run.rup(&["pad", "read", "--help"]).await;
    assert_eq!((code(&by_help), code(&by_flag)), (0, 0));
    assert_eq!(out(&by_help), out(&by_flag));
    let text = out(&by_help);
    assert!(text.starts_with("Read one Pad."), "{text}");
    assert!(text.contains("Usage: rup pad read"), "{text}");
    assert!(text.contains("<name>") && text.contains("--json"), "{text}");
    assert!(text.contains("Example:\n  rup pad read notes"), "{text}");
    let noun = out(&run.rup(&["help", "pad"]).await);
    assert!(noun.contains("read") && noun.contains("append"), "{noun}");
}

#[tokio::test]
async fn i2_a_mistyped_command_suggests_the_closest_and_exits_2() {
    let dir = tempfile::tempdir().unwrap();
    let run = on(&dir.path().join("none"));
    let typo = run.rup(&["padd"]).await;
    assert_eq!(code(&typo), 2);
    assert!(out(&typo).is_empty());
    let text = err(&typo);
    assert!(text.contains("rup: unknown command \"padd\""), "{text}");
    assert!(text.contains("did you mean \"pad\"?"), "{text}");
    assert!(text.contains("run \"rup help\""), "{text}");
    let verb = err(&run.rup(&["pad", "raed"]).await);
    assert!(verb.contains("did you mean \"pad read\"?"), "{verb}");
}

#[tokio::test]
async fn i2_help_alone_teaches_every_command() {
    let dir = tempfile::tempdir().unwrap();
    let run = on(&dir.path().join("none"));
    let help = out(&run.rup(&["help"]).await);
    for (usage, _) in listed_commands(&help) {
        let words: Vec<&str> = usage.split_whitespace().collect();
        let noun = out(&run.rup(&["help", words[1]]).await);
        assert!(noun.contains(words[2]), "{usage}");
        let one = run.rup(&["help", words[1], words[2]]).await;
        assert_eq!(code(&one), 0, "{usage}");
        assert!(
            out(&one).contains(&format!("Usage: rup {} {}", words[1], words[2])),
            "{usage}"
        );
    }
    let events = out(&run.rup(&["help", "events"]).await);
    assert!(
        events.contains("Usage: rup events") && events.contains("--follow"),
        "{events}"
    );
}

#[tokio::test]
async fn i3_stdout_is_the_text_the_mcp_tool_returns() {
    let project = start_daemon().await;
    let run = on(&project.socket);
    assert_eq!(
        code(
            &run.rup(&["pad", "create", "notes", "--text", "hi there"])
                .await
        ),
        0
    );
    let shown = out(&run.rup(&["pad", "read", "notes"]).await);
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["mcp", "a1"])
        .env("RUPD_SOCKET", &project.socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = ().serve(transport).await.unwrap();
    let request = rmcp::model::CallToolRequestParams::new("pad_read")
        .with_arguments(json!({"name": "notes"}).as_object().unwrap().clone());
    let result = client.call_tool(request).await.unwrap();
    let mcp = &result.content[0].as_text().unwrap().text;
    assert_eq!(shown, format!("{mcp}\n"));
    let listed = out(&run.rup(&["pad", "list"]).await);
    assert_eq!(listed.lines().count(), 1, "one line per item: {listed}");
}

#[tokio::test]
async fn i3_json_prints_the_result_alone() {
    let project = start_daemon().await;
    let run = on(&project.socket);
    run.rup(&["pad", "create", "notes", "--text", "hi"]).await;
    let output = run.rup(&["pad", "read", "notes", "--json"]).await;
    let parsed: Value = serde_json::from_str(&out(&output)).unwrap();
    assert_eq!(parsed["text"], "hi");
    assert!(err(&output).is_empty());
    let list = out(&run.rup(&["--json", "pad", "list"]).await);
    assert!(serde_json::from_str::<Value>(&list).unwrap().is_array());
    let failed = run.rup(&["pad", "read", "missing", "--json"]).await;
    assert!(out(&failed).is_empty() && err(&failed).starts_with("rup: "));
}

#[tokio::test]
async fn i3_a_daemon_error_is_on_stderr_with_what_to_do_next_and_exits_1() {
    let project = start_daemon().await;
    let failed = on(&project.socket).rup(&["pad", "read", "missing"]).await;
    assert_eq!(code(&failed), 1);
    assert!(out(&failed).is_empty());
    let lines: Vec<String> = err(&failed).lines().map(str::to_owned).collect();
    assert!(
        lines[0].starts_with("rup: ") && lines[0].ends_with("(NOT_FOUND)"),
        "{lines:?}"
    );
    assert_eq!(lines[1], "list them with `rup pad list`");
}

#[tokio::test]
async fn i3_no_daemon_names_the_socket_and_exits_1() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("absent.sock");
    let failed = on(&socket).rup(&["pad", "list"]).await;
    assert_eq!(code(&failed), 1);
    assert!(out(&failed).is_empty());
    assert!(
        err(&failed).contains(&socket.display().to_string()),
        "{}",
        err(&failed)
    );
}

#[tokio::test]
async fn i4_exit_codes_are_0_1_and_2_as_the_help_lists() {
    let project = start_daemon().await;
    let run = on(&project.socket);
    assert_eq!(code(&run.rup(&["pad", "list"]).await), 0);
    assert_eq!(code(&run.rup(&["pad", "read", "missing"]).await), 1);
    assert_eq!(code(&run.rup(&["pad", "read"]).await), 2);
    assert_eq!(
        code(&run.rup(&["terminal", "read", "3", "--after", "x"]).await),
        2
    );
    assert_eq!(code(&run.rup(&["pad", "list", "--bogus"]).await), 2);
}

#[tokio::test]
async fn i4_a_hook_command_with_bad_usage_exits_1_not_2() {
    let dir = tempfile::tempdir().unwrap();
    let run = on(&dir.path().join("none"));
    for hook in ["signal", "context", "permission"] {
        for extra in [&[][..], &["a1", "b2"], &["--bogus"]] {
            let args: Vec<&str> = std::iter::once(hook).chain(extra.iter().copied()).collect();
            let output = run.rup(&args).await;
            assert_ne!(code(&output), 2, "{args:?}");
            if hook != "context" {
                assert_eq!(code(&output), 1, "{args:?}");
            }
        }
    }
}

#[tokio::test]
async fn i5_a_call_is_the_touch_of_the_agent_named() {
    let project = start_daemon().await;
    let by = on(&project.socket).acting_as(Some("a7"));
    assert_eq!(code(&by.rup(&["pad", "create", "notes"]).await), 0);
    let history = out(&by
        .rup(&["provenance", "history", "pad:notes", "--json"])
        .await);
    let touches: Value = serde_json::from_str(&history).unwrap();
    assert_eq!(touches[0]["actor"]["id"], "a7", "{touches}");
}

#[tokio::test]
async fn i5_the_agent_flag_overrides_the_variable() {
    let project = start_daemon().await;
    let run = on(&project.socket).acting_as(Some("a8"));
    run.rup(&["pad", "create", "notes", "--agent", "a9"]).await;
    let history = out(&run
        .rup(&["--json", "provenance", "history", "pad:notes"])
        .await);
    let touches: Value = serde_json::from_str(&history).unwrap();
    assert_eq!(touches[0]["actor"]["id"], "a9", "{touches}");
}

#[tokio::test]
async fn i5_no_agent_id_says_so_and_exits_2() {
    let project = start_daemon().await;
    let output = on(&project.socket)
        .acting_as(None)
        .rup(&["pad", "list"])
        .await;
    assert_eq!(code(&output), 2);
    assert!(
        err(&output).contains("rup: no Agent id: run it in an Agent's shell, or pass --agent <id>"),
        "{}",
        err(&output)
    );
}

#[tokio::test]
async fn i5_a_door_gets_the_door_only_commands() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("door.sock");
    let mut seen = stand_in(&socket, true, Vec::new(), &[]);
    let run = on(&socket);
    assert_eq!(code(&run.rup(&["agent", "digest"]).await), 0);
    assert_eq!(
        request_of(&mut seen, "agent.digest").await,
        json!({"id": "a1"})
    );
    let handoff = run
        .rup(&[
            "workstream",
            "handoff",
            "done",
            "--keep-todos",
            "1",
            "--keep-pads",
            "notes",
        ])
        .await;
    assert_eq!(code(&handoff), 0, "{}", err(&handoff));
    assert_eq!(out(&handoff), "handed off Workstream a1\n");
}

#[tokio::test]
async fn i6_terminal_write_types_the_text_and_presses_enter() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let mut seen = stand_in(&socket, false, Vec::new(), &[]);
    let output = on(&socket).rup(&["terminal", "write", "3", "héllo"]).await;
    assert_eq!(code(&output), 0, "{}", err(&output));
    let params = request_of(&mut seen, "terminal.write").await;
    assert_eq!(params["id"], "3");
    assert_eq!(decode(&params), "héllo\r".as_bytes());
    assert_eq!(out(&output), "null\n");
}

fn decode(params: &Value) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(params["data"].as_str().unwrap())
        .unwrap()
}

#[tokio::test]
async fn i6_no_enter_leaves_enter_out_and_base64_sends_the_raw_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let mut seen = stand_in(&socket, false, Vec::new(), &[]);
    let run = on(&socket);
    run.rup(&["terminal", "write", "3", "hi", "--no-enter"])
        .await;
    assert_eq!(
        decode(&request_of(&mut seen, "terminal.write").await),
        b"hi"
    );
    run.rup(&["terminal", "write", "3", "--base64", "AAEC"])
        .await;
    assert_eq!(
        decode(&request_of(&mut seen, "terminal.write").await),
        [0, 1, 2]
    );
}

#[tokio::test]
async fn i6_base64_and_no_enter_together_are_bad_usage() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let _seen = stand_in(&socket, false, Vec::new(), &[]);
    let output = on(&socket)
        .rup(&["terminal", "write", "3", "--base64", "AAEC", "--no-enter"])
        .await;
    assert_eq!(code(&output), 2);
}

#[tokio::test]
async fn i6_agent_prompt_sends_text_and_enter() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let mut seen = stand_in(&socket, false, Vec::new(), &[]);
    let output = on(&socket)
        .rup(&["agent", "prompt", "child", "do it"])
        .await;
    assert_eq!(code(&output), 0, "{}", err(&output));
    assert_eq!(
        request_of(&mut seen, "agent.prompt").await,
        json!({"id": "child", "text": "do it"})
    );
}

#[tokio::test]
async fn i6_a_dash_reads_the_text_from_stdin() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let mut seen = stand_in(&socket, false, Vec::new(), &[]);
    let body = "line one\nline \"two\" $HOME\n";
    let run = on(&socket).with_stdin(body.as_bytes());
    for (args, method, field) in [
        (&["pad", "write", "notes", "-"][..], "pad.write", "text"),
        (&["pad", "append", "notes", "-"], "pad.append", "text"),
        (
            &["message", "send", "child", "note", "-"],
            "message.send",
            "body",
        ),
        (&["agent", "prompt", "child", "-"], "agent.prompt", "text"),
        (
            &[
                "agent",
                "spawn",
                "/tmp",
                "--order",
                r#"{"kind":"clarification","question":"q"}"#,
                "--prompt",
                "-",
            ],
            "agent.spawn",
            "prompt",
        ),
    ] {
        let output = run.rup(args).await;
        assert_eq!(code(&output), 0, "{args:?}: {}", err(&output));
        let params = request_of(&mut seen, method).await;
        assert_eq!(params[field], body, "{args:?}: {params}");
    }
    let order = r#"{"kind":"clarification","question":"long question"}"#;
    let output = on(&socket)
        .with_stdin(order.as_bytes())
        .rup(&["agent", "spawn", "/tmp", "--order", "-"])
        .await;
    assert_eq!(code(&output), 0, "{}", err(&output));
    let params = request_of(&mut seen, "agent.spawn").await;
    assert_eq!(
        params["order"],
        serde_json::from_str::<Value>(order).unwrap()
    );
    let output = run.rup(&["terminal", "write", "3", "-"]).await;
    assert_eq!(
        decode(&request_of(&mut seen, "terminal.write").await),
        format!("{body}\r").as_bytes()
    );
    assert_eq!(code(&output), 0);
}

#[tokio::test]
async fn i6_invalid_utf8_on_stdin_exits_2() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let _seen = stand_in(&socket, false, Vec::new(), &[]);
    let output = on(&socket)
        .with_stdin(&[0xff, 0xfe])
        .rup(&["pad", "write", "notes", "-"])
        .await;
    assert_eq!(code(&output), 2);
}

fn terminal_reply() -> Value {
    json!({"from": 0, "next": 5, "text": "hello", "truncated": true})
}

#[tokio::test]
async fn i7_read_prints_text_on_stdout_and_next_on_stderr() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let mut seen = stand_in(
        &socket,
        false,
        vec![("terminal.read", terminal_reply())],
        &[],
    );
    let output = on(&socket)
        .rup(&["terminal", "read", "3", "--after", "120"])
        .await;
    assert_eq!((out(&output).as_str(), code(&output)), ("hello", 0));
    assert_eq!(err(&output), "next: 5\ntruncated\n");
    assert_eq!(
        request_of(&mut seen, "terminal.read").await,
        json!({"id": "3", "after": 120})
    );
}

#[tokio::test]
async fn i7_read_json_has_next_in_the_result() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let _seen = stand_in(
        &socket,
        false,
        vec![("terminal.read", terminal_reply())],
        &[],
    );
    let output = on(&socket).rup(&["terminal", "read", "3", "--json"]).await;
    assert_eq!(
        serde_json::from_str::<Value>(&out(&output)).unwrap(),
        terminal_reply()
    );
    assert!(err(&output).is_empty());
}

/// A real Terminal that prints 40 000 bytes: each read is cut at the 16 384-byte cap as over MCP, and a loop from `next` misses and repeats nothing.
#[tokio::test(flavor = "multi_thread")]
async fn i7_a_loop_of_reads_from_next_misses_and_repeats_nothing() {
    let project = start_daemon().await;
    let run = on(&project.socket);
    let spawned = run
        .rup(&[
            "terminal",
            "spawn",
            "/",
            "80",
            "24",
            "--env",
            "{}",
            "--command",
            "/bin/sh",
            "--command",
            "-c",
            "--command",
            "head -c 40000 /dev/zero | tr '\\0' x; sleep 30",
            "--json",
        ])
        .await;
    assert_eq!(code(&spawned), 0, "{}", err(&spawned));
    let id = serde_json::from_str::<Value>(&out(&spawned)).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (mut after, mut got, mut longest) = (0u64, 0usize, 0usize);
    let started = Instant::now();
    while got < 40_000 && started.elapsed() < Duration::from_secs(20) {
        let output = run
            .rup(&["terminal", "read", &id, "--after", &after.to_string()])
            .await;
        assert_eq!(code(&output), 0, "{}", err(&output));
        let text = out(&output);
        longest = longest.max(text.len());
        got += text.len();
        let next = err(&output)
            .lines()
            .find_map(|line| line.strip_prefix("next: ").map(str::to_owned))
            .unwrap();
        after = next.parse().unwrap();
        assert!(
            text.chars().all(|ch| ch == 'x' || ch == '\r' || ch == '\n'),
            "{text:?}"
        );
        if text.is_empty() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
    assert!(longest <= 16_384, "{longest}");
    assert!(got >= 40_000, "{got}");
}

#[tokio::test]
async fn i7_a_reply_over_the_cap_is_cut_as_over_mcp() {
    let project = start_daemon().await;
    let run = on(&project.socket);
    let spawned = run
        .rup(&[
            "terminal",
            "spawn",
            "/",
            "80",
            "24",
            "--env",
            "{}",
            "--command",
            "/bin/sh",
            "--command",
            "-c",
            "--command",
            "head -c 40000 /dev/zero | tr '\\0' x; sleep 30",
            "--json",
        ])
        .await;
    let id = serde_json::from_str::<Value>(&out(&spawned)).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let started = Instant::now();
    loop {
        let output = run.rup(&["terminal", "read", &id]).await;
        if err(&output).contains("truncated") {
            assert_eq!(out(&output).len(), 16_384);
            break;
        }
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "never truncated"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tokio::test]
async fn i7_a_daemon_that_never_answers_exits_1_in_ten_seconds() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("s.sock");
    let _seen = stand_in(&socket, false, Vec::new(), &["terminal.read"]);
    let started = Instant::now();
    let output = on(&socket).rup(&["terminal", "read", "3"]).await;
    assert_eq!(code(&output), 1);
    assert!(
        err(&output).contains("no answer within 10 s"),
        "{}",
        err(&output)
    );
    assert!(started.elapsed() >= Duration::from_secs(10));
    assert!(started.elapsed() < Duration::from_secs(14));
}

#[tokio::test]
async fn m2219_a_rup_command_is_judged_and_touched_like_the_tool() {
    let project = start_daemon().await;
    let maker = on(&project.socket).acting_as(Some("a7"));
    let made = maker
        .rup(&["rail", "create-workstream", "w", "--json"])
        .await;
    assert_eq!(code(&made), 0, "{}", err(&made));
    let id = serde_json::from_str::<Value>(&out(&made)).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // Reach (M7): the maker changes what it made; another Agent is refused, as over MCP.
    assert_eq!(code(&maker.rup(&["rail", "rename", &id, "w2"]).await), 0);
    let other = on(&project.socket).acting_as(Some("a8"));
    let refused = other.rup(&["rail", "rename", &id, "w3"]).await;
    assert_eq!(code(&refused), 1);
    assert!(err(&refused).contains("FORBIDDEN"), "{}", err(&refused));
    // The Touch names the calling Agent.
    let touched = out(&maker.rup(&["provenance", "touched", "a7", "--json"]).await);
    assert!(touched.contains(&format!("rail:{id}")), "{touched}");
}

#[tokio::test]
async fn m2219_every_command_the_off_brief_names_is_in_rup_help() {
    use agents::claude_code::{Folders, Launcher, Pair, Role};
    let root = tempfile::tempdir().unwrap();
    let project = root.path().join("proj");
    let data = project.join(".roundup");
    std::fs::create_dir_all(&data).unwrap();
    let rup = PathBuf::from(env!("CARGO_BIN_EXE_rup"));
    let launcher = Launcher::new("claude", root.path().join("claude.json"), rup, None);
    let pair = Pair {
        mcp_off: true,
        ..Default::default()
    };
    let help = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .arg("help")
        .output()
        .await
        .unwrap();
    let help = out(&help);
    let lines: Vec<&str> = help.lines().map(str::trim).collect();
    for role in [Role::Agent, Role::Door] {
        let argv = launcher
            .prepare_on(
                Folders {
                    project: &project,
                    data: &data,
                },
                "7",
                "1",
                &project,
                None,
                role,
                &pair,
            )
            .unwrap();
        let at = argv
            .iter()
            .position(|arg| arg == "--append-system-prompt-file")
            .unwrap();
        let brief = std::fs::read_to_string(&argv[at + 1]).unwrap();
        let named: BTreeSet<&str> = brief
            .split('`')
            .filter(|span| span.starts_with("rup "))
            .collect();
        assert!(named.len() > 50, "{named:?}");
        for command in named {
            assert!(
                lines.iter().any(|line| line
                    .strip_prefix(command)
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))),
                "{role:?} names `{command}`, which rup help lacks"
            );
        }
    }
}
