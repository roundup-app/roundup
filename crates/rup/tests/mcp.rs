#[path = "common/served.rs"]
mod common;

use std::path::Path;
use std::process::{Output, Stdio};
use std::time::Duration;

use common::Served;
use contracts::pad::DeleteParams;
use contracts::{Actor, ActorKind, IdentifyParams, Touch, Verb, message, pad, todo};
use rmcp::ServiceExt;
use rmcp::model::{CallToolRequestParams, CallToolResult, ProtocolVersion};
use rmcp::service::{RoleClient, RunningService};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::process::Child;
use tokio::sync::mpsc;

#[path = "mcp/removed_questions.rs"]
mod removed_questions;
#[path = "mcp/tool_lists.rs"]
mod tool_lists;
use tool_lists::{DOOR_METHODS, NO_TOOL, TOOL_METHODS, expected_tools, seam_commands};

const BOUND: Duration = Duration::from_secs(20);

struct Shim {
    client: RunningService<RoleClient, ()>,
    child: Child,
}

fn start_rup_mcp(socket: &Path, agent: &str) -> Child {
    tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(if agent.is_empty() {
            vec!["mcp"]
        } else {
            vec!["mcp", agent]
        })
        .env("RUPD_SOCKET", socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap()
}

async fn spawn_shim(socket: &Path, agent: &str) -> Shim {
    let mut child = start_rup_mcp(socket, agent);
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = tokio::time::timeout(BOUND, ().serve(transport))
        .await
        .expect("the shim answered initialize")
        .unwrap();
    Shim { client, child }
}

impl Shim {
    async fn call(&self, tool: &str, arguments: Value) -> CallToolResult {
        let mut request = CallToolRequestParams::new(tool.to_owned());
        if let Value::Object(map) = arguments {
            request = request.with_arguments(map);
        }
        tokio::time::timeout(BOUND, self.client.call_tool(request))
            .await
            .expect("the shim answered the call")
            .unwrap()
    }
}

fn text(result: &CallToolResult) -> Value {
    let raw = result.content[0]
        .as_text()
        .expect("a text result")
        .text
        .clone();
    serde_json::from_str(&raw).unwrap()
}

struct Project {
    _dir: tempfile::TempDir,
    socket: std::path::PathBuf,
    daemon: tokio::task::JoinHandle<std::io::Result<()>>,
}

fn start_daemon() -> Project {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let daemon = common::serve(dir.path(), &socket);
    Project {
        _dir: dir,
        socket,
        daemon,
    }
}

fn agent(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    }
}

async fn client_as(socket: &Path, actor: Actor) -> rpc::Client {
    let client = rpc::Client::connect(socket).await.unwrap();
    client
        .request("daemon.identify", IdentifyParams { actor })
        .await
        .unwrap();
    client
}

async fn write_line(to: &mut (impl AsyncWrite + Unpin), message: &Value) {
    to.write_all(format!("{message}\n").as_bytes())
        .await
        .unwrap();
}

/// A stand-in Daemon that answers `null` to the `answered` methods and never to any other.
/// It holds every connection open: a close would fail the shim's request at once instead of leaving it unanswered.
fn fake_daemon(socket: &Path, answered: &'static [&'static str]) -> mpsc::UnboundedReceiver<Value> {
    let listener = UnixListener::bind(socket).unwrap();
    let (seen, requests) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let seen = seen.clone();
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    let reply = answered
                        .iter()
                        .any(|method| request["method"] == *method)
                        .then(|| json!({ "jsonrpc": "2.0", "id": request["id"], "result": null }));
                    let _ = seen.send(request);
                    if let Some(reply) = reply {
                        write_line(&mut write, &reply).await;
                    }
                }
            });
        }
    });
    requests
}

#[tokio::test]
async fn a40_an_agent_cannot_call_the_ask_methods() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let mut requests = fake_daemon(
        &socket,
        &[
            "daemon.identify",
            "agent.channelUp",
            "rail.tree",
            "todo.list",
        ],
    );
    let shim = spawn_shim(&socket, "a1").await;
    let tools = shim.client.list_all_tools().await.unwrap();

    for name in ["ask_send", "ask_list", "ask_pick"] {
        assert!(!tools.iter().any(|tool| tool.name == name), "{name}");
        let error = tokio::time::timeout(
            BOUND,
            shim.client.call_tool(CallToolRequestParams::new(name)),
        )
        .await
        .expect("the shim refused the call")
        .unwrap_err();
        let rmcp::service::ServiceError::McpError(error) = error else {
            panic!("expected a protocol permission error for {name}: {error:?}");
        };
        assert_eq!(error.code.0, -32002, "{name}: {error:?}");
    }

    // A completed Daemon round trip fences all preceding shim calls without a sleep.
    shim.call("todo_list", json!({})).await;
    loop {
        let request = tokio::time::timeout(BOUND, requests.recv())
            .await
            .unwrap()
            .unwrap();
        match request["method"].as_str().unwrap() {
            "daemon.identify" | "agent.channelUp" | "rail.tree" => {}
            "todo.list" => break,
            other => panic!("refused call reached the Daemon: {other}"),
        }
    }
    assert!(requests.try_recv().is_err());
}

#[tokio::test]
async fn m1_an_unknown_tool_keeps_its_invalid_params_error() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let _requests = fake_daemon(
        &socket,
        &["daemon.identify", "agent.channelUp", "rail.tree"],
    );
    let shim = spawn_shim(&socket, "a1").await;
    let error = shim
        .client
        .call_tool(CallToolRequestParams::new("unknown_tool"))
        .await
        .unwrap_err();
    let rmcp::service::ServiceError::McpError(error) = error else {
        panic!("expected a protocol error: {error:?}");
    };
    assert_eq!(error.code.0, -32602);
    assert_eq!(error.message, "no tool named unknown_tool");
}

async fn run_without_client(socket: &Path) -> Output {
    let mut child = start_rup_mcp(socket, "a1");
    drop(child.stdin.take());
    tokio::time::timeout(BOUND, child.wait_with_output())
        .await
        .expect("rup mcp exited")
        .unwrap()
}

fn assert_exit_1_with_one_line_naming(output: &Output, socket: &Path) {
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert_eq!(stderr.lines().count(), 1, "{stderr}");
    assert!(stderr.contains(socket.to_str().unwrap()), "{stderr}");
}

#[test]
fn m5_every_app_action_has_a_tool_or_a_reason() {
    let mut registry: Vec<String> = contracts::methods::METHODS
        .iter()
        .map(|m| m.name.to_owned())
        .collect();
    for command in seam_commands() {
        // M8: the two commands an Agent reaches are the Daemon's methods `project.open` and `project.rename`.
        match command.as_str() {
            "open_project" => assert!(registry.iter().any(|m| m == "project.open")),
            "rename_project" => assert!(registry.iter().any(|m| m == "project.rename")),
            _ => registry.push(command),
        }
    }
    let tools: Vec<&str> = TOOL_METHODS.iter().chain(&DOOR_METHODS).copied().collect();
    let no_tool = NO_TOOL;

    for name in &registry {
        let in_tools = tools.contains(&name.as_str());
        let in_no_tool = no_tool.contains(&name.as_str());
        assert!(
            in_tools || in_no_tool,
            "{name} has neither a tool nor a reason"
        );
        assert!(!(in_tools && in_no_tool), "{name} is in both lists");
    }
    for listed in tools.iter().chain(&no_tool) {
        assert!(
            registry.iter().any(|name| name == listed),
            "{listed} is listed but gone from the registry"
        );
    }
}

#[tokio::test]
async fn m1_offers_one_tool_per_method_and_no_others() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    let tools = shim.client.list_all_tools().await.unwrap();

    let mut names: Vec<_> = tools.iter().map(|t| t.name.to_string()).collect();
    let mut expected = expected_tools();
    names.sort();
    expected.sort();
    assert_eq!(names, expected);
}

#[tokio::test]
async fn m1_input_schemas_are_the_contract_schemas() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    let tools = shim.client.list_all_tools().await.unwrap();
    let schema = |name: &str| {
        let tool = tools.iter().find(|t| t.name == name).unwrap();
        Value::Object((*tool.input_schema).clone())
    };

    let derived = |schema| serde_json::to_value(schema).unwrap();
    let expected = [
        (
            "agent_wake",
            derived(schemars::schema_for!(contracts::agent::WakeParams)),
        ),
        (
            "message_progress",
            derived(schemars::schema_for!(message::ProgressParams)),
        ),
        (
            "message_report",
            derived(schemars::schema_for!(message::ReportParams)),
        ),
        (
            "message_acceptResult",
            derived(schemars::schema_for!(message::AcceptResultParams)),
        ),
        (
            "message_verifyResult",
            derived(schemars::schema_for!(message::ResultId)),
        ),
        (
            "message_resolveResult",
            derived(schemars::schema_for!(message::ResolveResultParams)),
        ),
        (
            "todo_create",
            derived(schemars::schema_for!(todo::CreateParams)),
        ),
        ("todo_get", derived(schemars::schema_for!(todo::TodoId))),
        ("todo_reopen", derived(schemars::schema_for!(todo::TodoId))),
        (
            "todo_update",
            derived(schemars::schema_for!(todo::UpdateParams)),
        ),
        (
            "todo_complete",
            derived(schemars::schema_for!(todo::TodoId)),
        ),
        (
            "todo_setBlockers",
            derived(schemars::schema_for!(todo::SetBlockersParams)),
        ),
        (
            "pad_create",
            derived(schemars::schema_for!(pad::CreateParams)),
        ),
        ("pad_read", derived(schemars::schema_for!(pad::PadName))),
        (
            "pad_write",
            derived(schemars::schema_for!(pad::WriteParams)),
        ),
        (
            "pad_append",
            derived(schemars::schema_for!(pad::AppendParams)),
        ),
        (
            "pad_appendSection",
            derived(schemars::schema_for!(pad::AppendSectionParams)),
        ),
        ("pad_delete", derived(schemars::schema_for!(DeleteParams))),
        (
            "message_send",
            derived(schemars::schema_for!(message::SendParams)),
        ),
        (
            "message_get",
            derived(schemars::schema_for!(message::MessageId)),
        ),
        (
            "message_list",
            derived(schemars::schema_for!(message::ListParams)),
        ),
    ];
    for (name, contract_schema) in expected {
        assert_eq!(schema(name), contract_schema, "{name}");
    }
    assert_eq!(schema("todo_list"), json!({ "type": "object" }));
    assert_eq!(schema("pad_list"), json!({ "type": "object" }));
    // E4: the shim fills the id, so the tool takes no input.
    assert_eq!(schema("agent_context"), json!({ "type": "object" }));
}

#[tokio::test]
async fn m2_a_created_todo_is_a_touch_by_the_calling_agent() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    let result = shim.call("todo_create", json!({ "title": "x" })).await;

    assert_eq!(result.is_error, Some(false));
    let created = text(&result);
    assert_eq!(created["title"], "x");
    let user = client_as(&project.socket, Actor::user()).await;
    let history = user
        .request("provenance.history", json!({ "item": "todo:1" }))
        .await
        .unwrap();
    let touches: Vec<Touch> = serde_json::from_value(history).unwrap();
    assert!(
        touches
            .iter()
            .any(|t| t.verb == Verb::Wrote && t.actor == agent("a1"))
    );
}

#[tokio::test]
async fn b12_a_call_is_made_as_the_agent_and_returns_the_daemons_result() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    // `from` is never a parameter: a forged one is ignored.
    let sent = shim
        .call(
            "message_send",
            json!({"to": "you", "kind": "note", "body": "hi", "from": {"kind": "user", "id": "you"}}),
        )
        .await;

    assert_eq!(sent.is_error, Some(false));
    let message = text(&sent);
    assert_eq!(message["id"], 1);
    assert_eq!(message["from"]["id"], "a1");
    assert_eq!(message["from"]["kind"], "agent");
    assert_eq!(message["status"], "delivered");
    assert_eq!(
        text(&shim.call("message_get", json!({"id": 1})).await),
        message
    );
    assert_eq!(
        text(&shim.call("message_list", json!({})).await),
        json!([message])
    );
    let other = spawn_shim(&project.socket, "a2").await;
    let refused = other.call("message_get", json!({"id": 1})).await;
    assert_eq!(refused.is_error, Some(true));
    assert_eq!(text(&refused)["code"], rpc::code::FORBIDDEN);
}

#[tokio::test]
async fn p15_tool_offered_and_touch_by_agent() {
    let project = start_daemon();
    let owner = client_as(&project.socket, agent("owner")).await;
    owner
        .request(
            "pad.create",
            json!({ "name": "notes", "text": "# Notes\n## Plan\n- one\n" }),
        )
        .await
        .unwrap();
    let shim = spawn_shim(&project.socket, "a1").await;

    let tools = shim.client.list_all_tools().await.unwrap();
    let appended = shim
        .call(
            "pad_appendSection",
            json!({ "name": "notes", "heading": "plan", "text": "- two", "expectedRevision": 1 }),
        )
        .await;
    let stale = shim
        .call(
            "pad_appendSection",
            json!({ "name": "notes", "heading": "plan", "text": "- three", "expectedRevision": 1 }),
        )
        .await;

    assert!(tools.iter().any(|t| t.name == "pad_appendSection"));
    assert_eq!(appended.is_error, Some(false));
    assert_eq!(text(&appended)["text"], "# Notes\n## Plan\n- one\n- two\n");
    assert_eq!(text(&appended)["revision"], 2);
    assert_eq!(stale.is_error, Some(true));
    assert_eq!(text(&stale)["code"], rpc::code::CONFLICT);
    let history = owner
        .request("provenance.history", json!({ "item": "pad:notes" }))
        .await
        .unwrap();
    let touches: Vec<Touch> = serde_json::from_value(history).unwrap();
    assert!(
        touches
            .iter()
            .any(|t| t.verb == Verb::Wrote && t.actor == agent("a1"))
    );
}

#[tokio::test]
async fn m2_a_daemon_error_is_a_tool_error_carrying_code_and_message() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    let result = shim
        .call("pad_write", json!({ "name": "missing", "text": "mine" }))
        .await;

    assert_eq!(result.is_error, Some(true));
    let error = text(&result);
    assert_eq!(error["code"], rpc::code::NOT_FOUND);
    assert!(error["message"].is_string());
}

#[tokio::test]
async fn m2_the_server_keeps_serving_after_a_daemon_error() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    let refused = shim.call("todo_get", json!({ "id": 99 })).await;
    assert_eq!(refused.is_error, Some(true));

    let result = shim.call("todo_create", json!({ "title": "after" })).await;

    assert_eq!(result.is_error, Some(false));
}

#[tokio::test]
async fn m3_no_daemon_exits_nonzero_with_one_line_naming_the_socket() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("absent.sock");

    let output = run_without_client(&socket).await;

    assert_exit_1_with_one_line_naming(&output, &socket);
}

#[tokio::test]
async fn m3_a_daemon_that_never_answers_exits_nonzero_with_one_line_naming_the_socket() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("mute.sock");
    let _requests = fake_daemon(&socket, &[]);

    let output = run_without_client(&socket).await;

    assert_exit_1_with_one_line_naming(&output, &socket);
}

#[tokio::test]
async fn m3_a_call_the_daemon_never_answers_exits_1_saying_it_may_have_been_applied() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let _requests = fake_daemon(
        &socket,
        &["daemon.identify", "agent.channelUp", "rail.tree"],
    );
    let mut shim = spawn_shim(&socket, "a1").await;
    let peer = shim.client.peer().clone();

    tokio::spawn(async move {
        peer.call_tool_once(CallToolRequestParams::new("todo_list"))
            .await
    });

    let status = tokio::time::timeout(BOUND, shim.child.wait())
        .await
        .expect("the shim exited")
        .unwrap();
    assert_eq!(status.code(), Some(1));
    let mut stderr = String::new();
    shim.child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .await
        .unwrap();
    assert!(stderr.contains("may have been applied"), "{stderr}");
}

#[tokio::test]
async fn m3_stdout_carries_only_protocol_messages_up_to_the_exit() {
    let project = start_daemon();
    let mut child = start_rup_mcp(&project.socket, "a1");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
    for message in [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": ProtocolVersion::LATEST_WITH_INITIALIZE.as_str(),
            "capabilities": {},
            "clientInfo": { "name": "test", "version": "0" },
        }}),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": "todo_create", "arguments": { "title": "x" } } }),
    ] {
        write_line(&mut stdin, &message).await;
    }
    let mut lines = Vec::new();
    loop {
        let line = tokio::time::timeout(BOUND, stdout.next_line())
            .await
            .expect("the shim answered todo_create")
            .unwrap()
            .expect("stdout is open until the shim answers todo_create");
        let answers_create = serde_json::from_str::<Value>(&line).is_ok_and(|m| m["id"] == 2);
        lines.push(line);
        if answers_create {
            break;
        }
    }
    project.daemon.abort();
    let _ = project.daemon.await;

    write_line(
        &mut stdin,
        &json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "todo_list" } }),
    )
    .await;

    while let Some(line) = tokio::time::timeout(BOUND, stdout.next_line())
        .await
        .expect("the shim closed stdout")
        .unwrap()
    {
        lines.push(line);
    }
    let status = tokio::time::timeout(BOUND, child.wait())
        .await
        .expect("the shim exited")
        .unwrap();
    assert_eq!(status.code(), Some(1));
    for line in &lines {
        let message: Value = serde_json::from_str(line).unwrap_or_else(|_| panic!("{line}"));
        assert_eq!(message["jsonrpc"], "2.0", "{line}");
    }
}

#[tokio::test]
async fn u148_a_block_written_through_the_tools_is_stored_byte_exact() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    let block = "```mermaid\ngraph TD\n  A[\"<b>x</b>\"] --> B\n```\n";
    let drawing = "```excalidraw\n{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}\n```\n";
    let user = client_as(&project.socket, Actor::user()).await;
    let stored = |name: &'static str| {
        let user = &user;
        async move {
            user.request("pad.read", json!({ "name": name }))
                .await
                .unwrap()["text"]
                .as_str()
                .unwrap()
                .to_string()
        }
    };

    let created = shim
        .call("pad_create", json!({ "name": "notes", "text": block }))
        .await;
    assert_eq!(created.is_error, Some(false));
    assert_eq!(stored("notes").await, block);

    let written = shim
        .call("pad_write", json!({ "name": "notes", "text": drawing }))
        .await;
    assert_eq!(written.is_error, Some(false));
    assert_eq!(stored("notes").await, drawing);

    let appended = shim
        .call("pad_append", json!({ "name": "notes", "text": block }))
        .await;
    assert_eq!(appended.is_error, Some(false));
    assert_eq!(stored("notes").await, format!("{drawing}{block}"));

    let out = tempfile::tempdir().unwrap();
    let target = out.path().join("notes.md");
    user.request("pad.export", json!({ "name": "notes", "path": target }))
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        format!("{drawing}{block}")
    );
}

#[tokio::test]
async fn u149_a_drawing_written_through_the_tools_is_stored_byte_exact() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    let block = "```excalidraw\n{\"type\":\"excalidraw\",\"version\":2,\"elements\":[{\"type\":\"rectangle\",\"id\":\"a\",\"x\":0,\"y\":0,\"width\":160,\"height\":80,\"label\":{\"text\":\"plan\"}},{\"type\":\"text\",\"id\":\"t\",\"x\":220,\"y\":28,\"text\":\"ship\"},{\"type\":\"arrow\",\"x\":160,\"y\":40,\"width\":60,\"height\":0,\"start\":{\"id\":\"a\"},\"end\":{\"id\":\"t\"}}]}\n```\n";
    let drawing = "```excalidraw\n{\"type\":\"excalidraw\",\"version\":2,\"elements\":[]}\n```\n";
    let user = client_as(&project.socket, Actor::user()).await;
    let stored = |name: &'static str| {
        let user = &user;
        async move {
            user.request("pad.read", json!({ "name": name }))
                .await
                .unwrap()["text"]
                .as_str()
                .unwrap()
                .to_string()
        }
    };

    let created = shim
        .call("pad_create", json!({ "name": "notes", "text": block }))
        .await;
    assert_eq!(created.is_error, Some(false));
    assert_eq!(stored("notes").await, block);

    let written = shim
        .call("pad_write", json!({ "name": "notes", "text": drawing }))
        .await;
    assert_eq!(written.is_error, Some(false));
    assert_eq!(stored("notes").await, drawing);

    let appended = shim
        .call("pad_append", json!({ "name": "notes", "text": block }))
        .await;
    assert_eq!(appended.is_error, Some(false));
    assert_eq!(stored("notes").await, format!("{drawing}{block}"));

    let out = tempfile::tempdir().unwrap();
    let target = out.path().join("notes.md");
    user.request("pad.export", json!({ "name": "notes", "path": target }))
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(&target).unwrap(),
        format!("{drawing}{block}")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a28_an_mcp_spawn_with_a_name_shows_it_on_the_rail() {
    let served = Served::start("#!/bin/sh\nsleep 30\n", &[]).await;
    let client = rpc::Client::connect(&served.socket()).await.unwrap();
    let cwd = served.dir.path().to_string_lossy().into_owned();
    let caller = client
        .request(
            "agent.spawn",
            json!({"cwd": cwd, "prompt": null, "parent": null}),
        )
        .await
        .unwrap();
    let caller = caller["id"].as_str().unwrap().to_owned();
    let shim = spawn_shim(&served.socket(), &caller).await;

    let spawned = shim
        .call(
            "agent_spawn",
            json!({"cwd": cwd, "order": {"kind": "work", "ask": "fix the build", "limits": []}, "name": "fix refresh race"}),
        )
        .await;
    assert_eq!(spawned.is_error, Some(false), "{spawned:?}");

    let tree = client.request("rail.tree", Value::Null).await.unwrap();
    let child = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["parent"] == caller.as_str())
        .expect("a child under the caller");
    assert_eq!(child["name"], "fix refresh race");
}

#[tokio::test(flavor = "multi_thread")]
async fn m6_over_stdio_an_agents_workstream_shows_in_the_tree_with_its_door_started() {
    let served = Served::start("#!/bin/sh\nsleep 30\n", &[]).await;
    let client = rpc::Client::connect(&served.socket()).await.unwrap();
    let cwd = served.dir.path().to_string_lossy().into_owned();
    let caller = client
        .request(
            "agent.spawn",
            json!({"cwd": cwd, "prompt": null, "parent": null}),
        )
        .await
        .unwrap();
    let caller = caller["id"].as_str().unwrap().to_owned();
    let shim = spawn_shim(&served.socket(), &caller).await;

    let made = shim
        .call(
            "rail_createWorkstream",
            json!({"name": "x", "parent": null}),
        )
        .await;
    assert_eq!(made.is_error, Some(false), "{made:?}");
    let node = text(&made);
    let id = node["id"].as_str().unwrap().to_owned();
    let started = shim.call("rail_startDoor", json!({"id": id})).await;
    assert_eq!(started.is_error, Some(false), "{started:?}");
    let nested = shim
        .call(
            "rail_createWorkstream",
            json!({"name": "y", "parent": caller}),
        )
        .await;

    assert_eq!(nested.is_error, Some(true));
    assert_eq!(text(&nested)["code"], rpc::code::CONFLICT);
    let tree = client.request("rail.tree", Value::Null).await.unwrap();
    let nodes = tree.as_array().unwrap();
    let workstream = nodes.iter().find(|n| n["id"] == id.as_str()).unwrap();
    assert_eq!(workstream["name"], "x");
    assert!(workstream["parent"].is_null());
    assert!(!workstream["attempt"].is_null(), "its Door is started");
    assert!(nodes.iter().all(|n| n["name"] != "y"));
    let touches = client
        .request("provenance.history", json!({"item": format!("rail:{id}")}))
        .await
        .unwrap();
    assert_eq!(touches[0]["actor"]["id"], caller.as_str());
    assert_eq!(touches[0]["actor"]["kind"], "agent");
}

fn m17_daemon(socket: &Path, reply: Value) -> tokio::task::JoinHandle<()> {
    let listener = UnixListener::bind(socket).unwrap();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let reply = reply.clone();
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Some(line) = lines.next_line().await.unwrap() {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    let result = if request["method"] == "rail.tree" {
                        json!([
                            {"id":"a1", "kind":"workstream", "name":"Door", "parent":null, "order":0, "can_resume":false, "stray":[]},
                            {"id":"door", "kind":"workstream", "name":"Research", "parent":null, "order":1, "can_resume":false, "stray":[]},
                            {"id":"child", "kind":"agent", "name":"Writer", "parent":"door", "order":0, "can_resume":false, "stray":[]}
                        ])
                    } else {
                        reply.clone()
                    };
                    write_line(
                        &mut write,
                        &json!({"jsonrpc":"2.0", "id":request["id"], "result":result}),
                    )
                    .await;
                }
            });
        }
    })
}

#[tokio::test]
async fn m17_every_offered_unit_method_acknowledges_its_action() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("unit.sock");
    let server = m17_daemon(&socket, Value::Null);
    let shim = spawn_shim(&socket, "a1").await;
    let tools = shim.client.list_all_tools().await.unwrap();
    assert!(
        tools.iter().any(|tool| tool.name == "checkpoint_write"),
        "the fixture must be a Door to cover its unit methods"
    );
    for method in contracts::methods::METHODS
        .iter()
        .filter(|m| m.result == "null")
    {
        let name = method.name.replace('.', "_");
        if !tools.iter().any(|t| t.name == name) {
            continue;
        }
        let (args, expected) = match method.name {
            "deliverable.remove" => (
                json!({"project":"project-a","id":"published-42"}),
                "removed publication published-42",
            ),
            "pad.export" => (
                json!({"name":"notes","path":"/tmp/notes.md"}),
                "exported Pad notes to /tmp/notes.md",
            ),
            "pad.setStorage" => (json!({"files":true}), "enabled Pad files"),
            "agent.discard" => (json!({"id":"child"}), "discarded Worktree of Agent Writer"),
            "rail.move" => (
                json!({"id":"child","parent":"door"}),
                "moved Writer to Research",
            ),
            "project.setWorktrees" => (json!({"on":false}), "disabled Worktrees"),
            "project.open" => (
                json!({"path":"/tmp/project"}),
                "requested opening Project /tmp/project",
            ),
            "project.rename" => (
                json!({"name":"New name"}),
                "requested renaming Project to New name",
            ),
            "terminal.show" => (json!({"id":"t1"}), "showing Terminal t1"),
            "terminal.close" => (json!({"id":"t1"}), "accepted terminal close"),
            "agent.interrupt" => (json!({"id":"t1"}), "accepted agent interrupt"),
            "agent.prompt" => (json!({"id":"t1"}), "accepted agent prompt"),
            "agent.stop" => (json!({"id":"t1"}), "accepted agent stop"),
            "terminal.kill" => (json!({"id":"t1"}), "accepted terminal kill"),
            "terminal.resize" => (json!({"id":"t1"}), "accepted terminal resize"),
            "terminal.write" => (json!({"id":"t1"}), "accepted terminal write"),
            other => panic!("add an acknowledgement fixture for offered unit method {other}"),
        };
        let result = shim.call(&name, args).await;
        assert_eq!(result.is_error, Some(false), "{name}");
        assert_eq!(
            result.content[0].as_text().unwrap().text,
            expected,
            "{name}"
        );
    }
    server.abort();
}

#[tokio::test]
async fn m17_project_actions_acknowledge_requests_not_completion() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    for (name, args, expected) in [
        (
            "project_open",
            json!({"path":project._dir.path()}),
            format!(
                "requested opening Project {}",
                project._dir.path().display()
            ),
        ),
        (
            "project_rename",
            json!({"name":"Renamed"}),
            "requested renaming Project to Renamed".into(),
        ),
    ] {
        let result = shim.call(name, args).await;
        assert_eq!(result.is_error, Some(false), "{result:?}");
        assert_eq!(result.content[0].as_text().unwrap().text, expected);
    }
    project.daemon.abort();
}

#[tokio::test]
async fn m17_data_results_keep_their_json_text() {
    for value in [
        json!({"id":1}),
        json!([1, "two"]),
        json!("plain text"),
        json!(42),
        json!(true),
        Value::Null,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("data.sock");
        let server = m17_daemon(&socket, value.clone());
        let shim = spawn_shim(&socket, "a1").await;
        // rail.remove declares nullable data, so even null must retain its JSON encoding.
        let result = shim.call("rail_remove", json!({"id":"child"})).await;
        assert_eq!(result.is_error, Some(false));
        assert_eq!(result.content[0].as_text().unwrap().text, value.to_string());
        server.abort();
    }
}

/// A Workstream `m` with its Door started, and a child `c` under it with a Terminal.
struct B53 {
    served: Served,
    user: rpc::Client,
    door: String,
    child: String,
    terminal: String,
}

async fn b53_fixture() -> B53 {
    let served = Served::start("#!/bin/sh\nsleep 30\n", &[]).await;
    let user = rpc::Client::connect(&served.socket()).await.unwrap();
    let cwd = served.dir.path().to_string_lossy().into_owned();
    let door = user
        .request(
            "rail.createWorkstream",
            json!({"name": "m", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({"id": door}))
        .await
        .unwrap();
    let child = user
        .request(
            "agent.spawn",
            json!({"cwd": cwd, "prompt": null, "parent": door}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let tree = user.request("rail.tree", Value::Null).await.unwrap();
    let terminal = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == child.as_str())
        .and_then(|node| node["terminal_id"].as_str())
        .expect("the child has a Terminal")
        .to_owned();
    B53 {
        served,
        user,
        door,
        child,
        terminal,
    }
}

fn error_text(result: &CallToolResult) -> String {
    assert_eq!(result.is_error, Some(true), "{result:?}");
    result.content[0].as_text().unwrap().text.clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn b53_a_send_without_a_kind_names_the_field_and_its_values() {
    let fx = b53_fixture().await;
    let shim = spawn_shim(&fx.served.socket(), &fx.door).await;
    let before = fx.user.request("message.list", json!({})).await.unwrap();

    let sent = shim
        .call("message_send", json!({"to": fx.child, "body": "hello"}))
        .await;

    let text = error_text(&sent);
    assert!(
        text.contains(&format!("{}", rpc::code::INVALID_PARAMS)),
        "{text}"
    );
    for word in ["kind", "note", "question"] {
        assert!(text.contains(word), "{text}");
    }
    let after = fx.user.request("message.list", json!({})).await.unwrap();
    assert_eq!(before, after);
}

#[tokio::test(flavor = "multi_thread")]
async fn b53_a_show_request_opens_the_terminal_and_reads_nothing() {
    let fx = b53_fixture().await;
    let mut events = rpc::Client::connect(&fx.served.socket()).await.unwrap();
    events
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let shim = spawn_shim(&fx.served.socket(), &fx.door).await;
    let before = fx.user.request("message.list", json!({})).await.unwrap();

    let shown = shim.call("terminal_show", json!({"id": fx.terminal})).await;

    assert_eq!(shown.is_error, Some(false), "{shown:?}");
    let seen = tokio::time::timeout(BOUND, async {
        while let Some(event) = events.next_event().await {
            if let contracts::EventData::TerminalShown(shown) = event.data {
                return shown.id;
            }
        }
        panic!("the connection closed before terminal.shown");
    })
    .await
    .expect("terminal.shown arrived");
    assert_eq!(seen, fx.terminal);
    // Nothing else came of it: no Message, and no byte written to the Terminal.
    assert_eq!(
        before,
        fx.user.request("message.list", json!({})).await.unwrap()
    );
    let screen = fx
        .user
        .request("terminal.screen", json!({"id": fx.terminal}))
        .await
        .unwrap();
    assert_eq!(screen["offset"], 0, "{screen}");
}

#[tokio::test(flavor = "multi_thread")]
async fn b53_show_is_forbidden_outside_reach_and_absent_for_an_agent() {
    let fx = b53_fixture().await;
    let cwd = fx.served.dir.path().to_string_lossy().into_owned();
    let other = fx
        .user
        .request(
            "rail.createWorkstream",
            json!({"name": "other", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    fx.user
        .request("rail.startDoor", json!({"id": other}))
        .await
        .unwrap();
    let stranger = fx
        .user
        .request(
            "agent.spawn",
            json!({"cwd": cwd, "prompt": null, "parent": other}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let tree = fx.user.request("rail.tree", Value::Null).await.unwrap();
    let foreign = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == stranger.as_str())
        .and_then(|node| node["terminal_id"].as_str())
        .unwrap()
        .to_owned();
    let mut events = rpc::Client::connect(&fx.served.socket()).await.unwrap();
    events
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;

    let outside = door.call("terminal_show", json!({"id": foreign})).await;
    let unknown = door.call("terminal_show", json!({"id": "99999"})).await;
    let agent = spawn_shim(&fx.served.socket(), &fx.child).await;
    let offered = agent.client.list_all_tools().await.unwrap();
    let call = agent
        .client
        .call_tool(
            CallToolRequestParams::new("terminal_show")
                .with_arguments(json!({"id": fx.terminal}).as_object().unwrap().clone()),
        )
        .await;

    assert_eq!(
        serde_json::from_str::<Value>(&error_text(&outside)).unwrap()["code"],
        rpc::code::FORBIDDEN
    );
    assert_eq!(
        serde_json::from_str::<Value>(&error_text(&unknown)).unwrap()["code"],
        rpc::code::NOT_FOUND
    );
    assert!(offered.iter().all(|t| t.name != "terminal_show"));
    assert!(
        call.is_err() || call.unwrap().is_error == Some(true),
        "an Agent's terminal_show must fail"
    );
    // A Daemon-side event for any of the three would have been emitted by now.
    let late = tokio::time::timeout(Duration::from_millis(500), async {
        while let Some(event) = events.next_event().await {
            if matches!(event.data, contracts::EventData::TerminalShown(_)) {
                return true;
            }
        }
        false
    })
    .await;
    assert!(
        late.is_err() || late == Ok(false),
        "terminal.shown was emitted"
    );
}

#[tokio::test]
async fn p2544d_mcp_write_preserves_conflict_code() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    shim.call("pad_create", json!({"name": "notes", "text": "original"}))
        .await;
    shim.call(
        "pad_write",
        json!({"name": "notes", "text": "winner", "expectedRevision": 1}),
    )
    .await;
    let stale = shim
        .call(
            "pad_write",
            json!({"name": "notes", "text": "loser", "expectedRevision": 1}),
        )
        .await;
    assert_eq!(stale.is_error, Some(true));
    assert_eq!(text(&stale)["code"], rpc::code::CONFLICT);
    assert!(
        text(&stale)["message"]
            .as_str()
            .unwrap()
            .contains("revision 2")
    );
}

#[path = "mcp/names.rs"]
mod names;

#[tokio::test]
async fn t19_mcp_reopen_uses_agent_identity() {
    let project = start_daemon();
    let user = client_as(&project.socket, Actor::user()).await;
    user.request("todo.create", json!({"title":"ship"}))
        .await
        .unwrap();
    user.request("todo.complete", json!({"id":1}))
        .await
        .unwrap();
    let shim = spawn_shim(&project.socket, "a1").await;
    let result = shim
        .call("todo_reopen", json!({"id":1,"actor":Actor::user()}))
        .await;
    assert_ne!(result.is_error, Some(true));
    assert_eq!(text(&result)["done"], false);
    let history = user
        .request("todo.getHistory", json!({"id":1}))
        .await
        .unwrap();
    assert_eq!(history["changes"][2]["actor"], json!(agent("a1")));
    let touches = user
        .request("provenance.history", json!({"item":"todo:1"}))
        .await
        .unwrap();
    let writes: Vec<_> = touches
        .as_array()
        .unwrap()
        .iter()
        .filter(|touch| touch["verb"] == "wrote")
        .collect();
    assert_eq!(writes.len(), 3);
    assert_eq!(writes[2]["actor"], json!(agent("a1")));
    let list = user.request("todo.list", Value::Null).await.unwrap();
    let result = shim.call("todo_reopen", json!({"id":99})).await;
    assert_eq!(result.is_error, Some(true));
    assert_eq!(user.request("todo.list", Value::Null).await.unwrap(), list);
    let _ = shim.client.cancel().await;
}

#[tokio::test]
async fn t21_the_tool_description_asks_for_one_plain_line_for_the_user() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    let tools = shim.client.list_all_tools().await.unwrap();
    let tool = tools.iter().find(|t| t.name == "todo_comment").unwrap();
    let description = tool.description.as_deref().unwrap();
    for phrase in [
        "only when the user must read it",
        "question",
        "blocker",
        "one short plain line",
    ] {
        assert!(description.contains(phrase), "{phrase}: {description}");
    }
}

#[tokio::test]
async fn t21_an_agent_comment_names_its_author_over_mcp_and_cli() {
    let project = start_daemon();
    let user = client_as(&project.socket, Actor::user()).await;
    user.request("todo.create", json!({"title":"ship"}))
        .await
        .unwrap();
    let shim = spawn_shim(&project.socket, "a1").await;
    let result = shim
        .call(
            "todo_comment",
            json!({"id":1,"body":"which branch?","author":Actor::user()}),
        )
        .await;
    assert_ne!(result.is_error, Some(true));
    let thread = user
        .request("todo.comments", json!({"id":1}))
        .await
        .unwrap();
    assert_eq!(thread[0]["author"], json!(agent("a1")));
    assert_eq!(thread[0]["read"], false);
}

#[tokio::test]
async fn t28_an_agent_adds_and_removes_a_ref_over_mcp_and_cli() {
    let project = start_daemon();
    let user = client_as(&project.socket, Actor::user()).await;
    let key = user.request("daemon.ping", Value::Null).await.unwrap()["projectKey"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("todo.create", json!({"title":"ship"}))
        .await
        .unwrap();
    user.request("pad.create", json!({"name":"notes","text":"## Plan\nx\n"}))
        .await
        .unwrap();
    let url = format!("roundup://pad/notes?project={key}#Plan");
    let shim = spawn_shim(&project.socket, "a1").await;
    let result = shim.call("todo_addRef", json!({"id":1,"url":url})).await;
    assert_ne!(result.is_error, Some(true));
    let todo = user.request("todo.get", json!({"id":1})).await.unwrap();
    assert_eq!(todo["refs"], json!([url]));
    let touches = user
        .request("provenance.history", json!({"item":"todo:1"}))
        .await
        .unwrap();
    assert!(
        touches
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["verb"] == "wrote" && t["actor"] == json!(agent("a1")))
    );
    let result = shim.call("todo_removeRef", json!({"id":1,"url":url})).await;
    assert_ne!(result.is_error, Some(true));
    // The command is the same call.
    let rup = |args: Vec<&str>| {
        tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
            .args(args)
            .env("RUPD_SOCKET", &project.socket)
            .env("ROUNDUP_AGENT", "a1")
            .output()
    };
    let added = rup(vec!["todo", "ref", "add", "1", &url]).await.unwrap();
    assert!(added.status.success(), "{added:?}");
    let todo = user.request("todo.get", json!({"id":1})).await.unwrap();
    assert_eq!(todo["refs"], json!([url]));
    let removed = rup(vec!["todo", "ref", "remove", "1", &url]).await.unwrap();
    assert!(removed.status.success(), "{removed:?}");
    let todo = user.request("todo.get", json!({"id":1})).await.unwrap();
    assert_eq!(todo["refs"], json!([]));
}

#[tokio::test]
async fn t28_the_tool_descriptions_name_the_section_form() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    let tools = shim.client.list_all_tools().await.unwrap();
    let tool = tools.iter().find(|t| t.name == "todo_addRef").unwrap();
    let description = tool.description.as_deref().unwrap();
    for phrase in ["Point the user", "read it", "#<heading>"] {
        assert!(description.contains(phrase), "{phrase}: {description}");
    }
}

#[tokio::test]
async fn t29_mcp_todo_update_sets_the_estimate() {
    let project = start_daemon();
    let user = client_as(&project.socket, Actor::user()).await;
    user.request("todo.create", json!({"title": "ship"}))
        .await
        .unwrap();
    let shim = spawn_shim(&project.socket, "a1").await;

    let result = shim
        .call("todo_update", json!({"id": 1, "estimate_minutes": 45}))
        .await;

    assert_ne!(result.is_error, Some(true));
    assert_eq!(text(&result)["estimate_minutes"], 45);
    let history = user
        .request("todo.getHistory", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(history["changes"][1]["actor"], json!(agent("a1")));
    assert_eq!(history["changes"][1]["after"]["estimate_minutes"], 45);
    let touches = user
        .request("provenance.history", json!({"item": "todo:1"}))
        .await
        .unwrap();
    assert!(
        touches
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["verb"] == "wrote" && t["actor"] == json!(agent("a1")))
    );
}
