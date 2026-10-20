#[path = "common/served.rs"]
mod common;

use std::path::Path;
use std::process::{Output, Stdio};
use std::sync::Arc;
use std::time::Duration;

use common::Served;
use contracts::{Actor, ActorKind, IdentifyParams, Touch, Verb, message, pad, todo};
use rmcp::ServiceExt;
use rmcp::model::{CallToolRequestParams, CallToolResult, ProtocolVersion};
use rmcp::service::{RoleClient, RunningService};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::process::Child;
use tokio::sync::mpsc;

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
    let daemon = Arc::new(rupd::Daemon::open(&dir.path().join(".roundup")).unwrap());
    let daemon = tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
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

/// M5: the methods with a tool for every Agent, each named after its method with the dot replaced
/// by `_`, bar `agent.setOrder` (O4), whose tool is `agent_set_order`.
const TOOL_METHODS: [&str; 70] = [
    "agent.wake",
    "deliverable.publish",
    "deliverable.list",
    "deliverable.get",
    "deliverable.resolve",
    "deliverable.move",
    "deliverable.remove",
    "todo.create",
    "todo.get",
    "todo.list",
    "todo.update",
    "todo.complete",
    "todo.setBlockers",
    "todo.move",
    "todo.reorder",
    "todo.delete",
    "pad.create",
    "pad.read",
    "link.read",
    "pad.list",
    "pad.write",
    "pad.append",
    "pad.appendSection",
    "pad.setOwner",
    "pad.delete",
    "pad.export",
    "pad.setStorage",
    // B12
    "message.send",
    "message.get",
    "message.list",
    "message.pass",
    "route.list",
    // M10
    "checkpoint.list",
    // E2, O4, F3
    "agent.context",
    "agent.actionHistory",
    "agent.setOrder",
    "agent.run",
    "agent.spawn",
    // H21
    "decision.list",
    "decision.answer",
    // M6, M7
    "rail.tree",
    "rail.createWorkstream",
    "rail.startDoor",
    "rail.rename",
    "rail.move",
    "rail.remove",
    "agent.stop",
    "agent.interrupt",
    "agent.prompt",
    "agent.resume",
    "agent.discard",
    "agent.land",
    "agent.worktreeState",
    "project.get",
    "project.setWorktrees",
    "provenance.history",
    "provenance.touched",
    // M8: the App commands `open_project` and `rename_project`
    "project.open",
    "project.rename",
    // M13: reading a Terminal
    "terminal.screen",
    "terminal.read",
    "terminal.search",
    // M14: Routes and running Terminals
    "route.set",
    "terminal.spawn",
    "terminal.open",
    "terminal.close",
    "terminal.write",
    "terminal.resize",
    "terminal.resizeHistory",
    "terminal.kill",
];

/// M5: offered to a Door only (B20, M10).
const DOOR_METHODS: [&str; 8] = [
    "agent.digest",
    // LC7, LC8
    "agent.extras",
    "agent.extras_add",
    // B53
    "terminal.show",
    "checkpoint.write",
    "workstream.handoff",
    "workstream.rewindPlan",
    "workstream.rewind",
];

/// M5: the methods and App commands with no tool; the reasons are in `scenarios/mcp.md`.
const NO_TOOL: [&str; 52] = [
    // U2539b, U2540a: the App's Worktree comparison; an Agent reads its own diff with git.
    "agent.changedFiles",
    "agent.compareFile",
    // A40, P9: each carries a Steer from the user.
    "ask.send",
    "ask.list",
    "ask.pick",
    // U462: only the open Drawer fetches and acknowledges the user's Todo history.
    "todo.getHistory",
    "todo.readHistory",
    "message.deliver",
    "message.drop",
    "takeover.begin",
    "takeover.end",
    "terminal.list",
    "terminal.snapshot",
    // X14: the App's per-Terminal byte stream; an Agent reads text with `terminal_read`.
    "terminal.output",
    "terminal.outputStop",
    // X17: the App tells the Daemon its colour scheme; no Agent sets it.
    "terminal.scheme",
    "daemon.ping",
    "daemon.identify",
    "events.subscribe",
    "agent.brief",
    "agent.channelUp",
    "agent.signal",
    "agent.permission",
    // B6: the Daemon captures an original prompt when it holds an action.
    "decision.capture",
    // U468: the App reads retained answers for display; Agents act on open Decisions.
    "decision.answers",
    "agent.ask",
    "agent.skills",
    // O8: the App's Drawer reads the prompt an Agent's spawn gave; the spawning Agent wrote it
    "agent.spawnPrompt",
    "pad.move",
    // U419: the bytes of an image the user pasted
    "attachment.save",
    // A36, A37: the user's own settings, which spend the user's usage (P8)
    "models.list",
    "project.setModels",
    // M2219: the user's setting for whether Agents get these tools at all
    "project.setMcp",
    // G2542: enrolling a directory and running its commands is the user's explicit consent
    "project.setPrepared",
    "project.getPrepared",
    "project.prepareDirectory",
    "agent.setModel",
    // D8: the App's Resource strip
    "project.resources",
    // A32: the user's act of clearing; a Door answers it with `workstream_handoff`
    "workstream.clear",
    "close_project",
    "projects",
    "daemon_proof",
    "open_target",
    "open_in_editor",
    "save_pasted_image",
    // U2694a: the native menu of the user's right-click
    "show_context_menu",
    // U449–U451: the user's native window, which an Agent cannot move or rename.
    "plugin:window-bar|set_window_title",
    "plugin:window-bar|drag_window",
    "plugin:window-bar|zoom_window",
    "rpc",
    "subscribe",
    "terminal_output",
    "terminal_output_stop",
];

fn tool_name(method: &str) -> String {
    match method {
        "agent.setOrder" => "agent_set_order".into(),
        other => other.replace('.', "_"),
    }
}

/// The names of the strings inside the first `[...]` after `marker` in `file`.
fn quoted_after(file: &str, marker: &str) -> Vec<String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let text = std::fs::read_to_string(root.join(file)).unwrap();
    let start = text
        .find(marker)
        .unwrap_or_else(|| panic!("{marker} in {file}"));
    let open = start + text[start..].find(['[', '{']).unwrap();
    let close = open + text[open..].find([']', '}']).unwrap();
    text[open + 1..close]
        .split(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | ':' | '|' | '-')))
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The seam commands of `apps/desktop/src/app/seam.ts`, and whether `crates/desktop` registers the same.
fn seam_commands() -> Vec<String> {
    let table = quoted_after("apps/desktop/src/app/seam.ts", "SEAM_COMMANDS = [");
    let mut registered = quoted_after("crates/desktop/src/lib.rs", "generate_handler![");
    registered.extend(
        quoted_after("crates/desktop/src/window.rs", "generate_handler![")
            .into_iter()
            .map(|command| format!("plugin:window-bar|{command}")),
    );
    let mut declared = table.clone();
    registered.sort();
    declared.sort();
    assert_eq!(
        registered, declared,
        "seam.ts and the Tauri handler list differ"
    );
    table
}

/// M5, M6: the tools a non-Door Agent is offered.
fn expected_tools() -> Vec<String> {
    let mut expected: Vec<_> = TOOL_METHODS.iter().map(|m| tool_name(m)).collect();
    // H14: `ask_user` is the one tool that is not a method's name.
    expected.push("ask_user".into());
    expected
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
async fn m1_the_server_is_named_roundup() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    let info = shim.client.peer_info().expect("initialized");

    assert_eq!(
        info.server_info.as_ref().expect("server info").name,
        "roundup"
    );
}

#[tokio::test]
async fn m1_offers_one_tool_per_method_and_ask_user_and_no_others() {
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
async fn b45_agent_wake_is_offered_to_every_agent() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    let tools = shim.client.list_all_tools().await.unwrap();

    let tool = tools.iter().find(|t| t.name == "agent_wake").unwrap();
    assert_eq!(
        Value::Object((*tool.input_schema).clone()),
        serde_json::to_value(schemars::schema_for!(contracts::agent::WakeParams)).unwrap()
    );
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
            "todo_create",
            derived(schemars::schema_for!(todo::CreateParams)),
        ),
        ("todo_get", derived(schemars::schema_for!(todo::TodoId))),
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
        (
            "pad_setOwner",
            derived(schemars::schema_for!(pad::SetOwnerParams)),
        ),
        ("pad_delete", derived(schemars::schema_for!(pad::PadName))),
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
        (
            "message_pass",
            derived(schemars::schema_for!(message::MessageId)),
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
async fn m1_list_tools_send_null_params_to_the_daemon() {
    for (tool, method) in [("todo_list", "todo.list"), ("pad_list", "pad.list")] {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("fake.sock");
        let mut requests = fake_daemon(&socket, &["daemon.identify", "todo.list", "pad.list"]);
        let shim = spawn_shim(&socket, "a1").await;

        shim.call(tool, json!({})).await;

        let sent = loop {
            let request = requests.recv().await.unwrap();
            if request["method"] == method {
                break request;
            }
        };
        assert_eq!(sent["params"], Value::Null, "{tool}");
    }
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
    let pass = shim.call("message_pass", json!({"id": 1})).await;
    assert_eq!(text(&pass)["code"], rpc::code::FORBIDDEN);
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
    let owner = client_as(&project.socket, agent("owner")).await;
    owner
        .request("pad.create", json!({ "name": "notes" }))
        .await
        .unwrap();
    let shim = spawn_shim(&project.socket, "a1").await;

    let result = shim
        .call("pad_write", json!({ "name": "notes", "text": "mine" }))
        .await;

    assert_eq!(result.is_error, Some(true));
    let error = text(&result);
    assert_eq!(error["code"], rpc::code::FORBIDDEN);
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
    let _requests = fake_daemon(&socket, &["daemon.identify"]);
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

/// Raw `tools/list` over stdio, against a Daemon that only answers `daemon.identify`: listing
/// tools never touches the Daemon, so this stand-in is enough. Returns the reply's `result`.
async fn raw_tools_list(socket: &Path, cursor: Option<&str>) -> Value {
    let mut child = start_rup_mcp(socket, "a1");
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut params = json!({});
    if let Some(cursor) = cursor {
        params = json!({ "cursor": cursor });
    }
    for message in [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": ProtocolVersion::LATEST_WITH_INITIALIZE.as_str(),
            "capabilities": {},
            "clientInfo": { "name": "test", "version": "0" },
        }}),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": params }),
    ] {
        write_line(&mut stdin, &message).await;
    }
    loop {
        let line = tokio::time::timeout(BOUND, stdout.next_line())
            .await
            .expect("the shim answered tools/list")
            .unwrap()
            .expect("stdout is open until the shim answers tools/list");
        let message: Value = serde_json::from_str(&line).unwrap();
        if message["id"] == 2 {
            return message["result"].clone();
        }
    }
}

/// The `tools/list` result schema the interactive Claude Code 2.1.288 validates a reply against,
/// read from its own (minified) source: `ttlMs` a non-negative integer, `cacheScope` the enum
/// `public`/`private`, `tools` an array, `nextCursor` an optional string. Extracted with:
///
///   strings -n 4 ~/.local/share/claude/versions/2.1.288 \
///     | grep -o '"tools/list":Re({[^}]*}[^)]*)'
///
/// which prints (`claude --version` there is `2.1.288 (Claude Code)`):
///
///   "tools/list":Re({ttlMs:k().int().min(0),cacheScope:j(["public","private"]),tools:C(Ge),nextCursor:s.optional()})
///
/// (`k()` is a bound `z.number()`, `j([...])` is `z.enum([...])`, `C()` is `z.array()`, `s` is a
/// bound `z.string()`.) The same command against `~/.local/share/claude/versions/2.1.283`
/// (`claude --version` there is `2.1.283 (Claude Code)`, the headless build M4 says accepts the
/// older reply) extracts the same schema under other minified names (`cacheScope:G([...])`,
/// `tools:A(Ge)`), so the two builds differ in what they tolerate, not in what they validate
/// against. A later `claude` that adds a new required field, narrows `cacheScope`'s enum so it
/// excludes `public`, or tightens `ttlMs` (a minimum above 0 or a maximum) makes this reply
/// invalid: `/mcp` reconnecting against the real client (M4's laptop check) would fail while every
/// test here stayed green, so re-extract the schema and update the copy when `claude` is upgraded.
fn assert_matches_tools_list_schema(reply: &Value) {
    let ttl_ms = reply
        .get("ttlMs")
        .unwrap_or_else(|| panic!("no ttlMs: {reply}"));
    assert!(
        ttl_ms.is_u64(),
        "ttlMs must be an integer >= 0 (zod `k().int().min(0)`): {reply}"
    );
    let cache_scope = reply
        .get("cacheScope")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("no string cacheScope: {reply}"));
    assert!(
        matches!(cache_scope, "public" | "private"),
        "cacheScope must be \"public\" or \"private\" (zod `j([\"public\",\"private\"])`): {reply}"
    );
    assert!(
        reply.get("tools").is_some_and(Value::is_array),
        "no tools array: {reply}"
    );
    if let Some(next_cursor) = reply.get("nextCursor") {
        assert!(
            next_cursor.is_string(),
            "nextCursor must be a string when present: {reply}"
        );
    }
}

#[tokio::test]
async fn m4_the_full_tools_list_carries_a_numeric_ttl_ms_and_cache_scope() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let _requests = fake_daemon(&socket, &["daemon.identify"]);

    let result = raw_tools_list(&socket, None).await;

    assert_matches_tools_list_schema(&result);
    // M5: one tool for each method of its first list, and `ask_user` (H14).
    assert_eq!(
        result["tools"].as_array().unwrap().len(),
        TOOL_METHODS.len() + 1
    );
    assert_eq!(result["cacheScope"], "public", "{result}");
}

#[tokio::test]
async fn m4_the_empty_list_a_cursor_gets_carries_a_numeric_ttl_ms_and_cache_scope() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let _requests = fake_daemon(&socket, &["daemon.identify"]);

    let result = raw_tools_list(&socket, Some("past-the-end")).await;

    assert_matches_tools_list_schema(&result);
    assert_eq!(result["tools"].as_array().unwrap().len(), 0);
    assert_eq!(result["cacheScope"], "public", "{result}");
}

/// A stand-in Daemon that answers `agent.ask` with `{"answer": "dogs"}` after `delay` and `null` to `daemon.identify`.
fn asking_daemon(socket: &Path, delay: Duration) -> mpsc::UnboundedReceiver<Value> {
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
                    let result = match request["method"].as_str() {
                        Some("agent.ask") => {
                            tokio::time::sleep(delay).await;
                            json!({ "answer": "dogs", "note": "walks" })
                        }
                        _ => Value::Null,
                    };
                    let reply = json!({ "jsonrpc": "2.0", "id": request["id"], "result": result });
                    let _ = seen.send(request);
                    write_line(&mut write, &reply).await;
                }
            });
        }
    });
    requests
}

fn asked() -> Value {
    json!({"question": "Cats or dogs?", "answers": [
        {"label": "cats", "description": "quiet"},
        {"label": "dogs", "description": "loyal", "preview": "```text\nwoof\n```"},
    ]})
}

/// The call outlasts the ten seconds every other tool call is bound by (the user may take minutes) and returns `{answer, note}` as JSON.
#[tokio::test]
async fn h14_ask_user_waits_past_the_call_bound_and_returns_the_answer_and_the_note() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let mut requests = asking_daemon(&socket, Duration::from_secs(11));
    let shim = spawn_shim(&socket, "a1").await;

    let result = shim.call("ask_user", asked()).await;

    assert_eq!(result.is_error, Some(false));
    assert_eq!(
        result.content[0]
            .as_text()
            .unwrap()
            .text
            .parse::<Value>()
            .unwrap(),
        json!({"answer": "dogs", "note": "walks"})
    );
    let sent = loop {
        let request = requests.recv().await.unwrap();
        if request["method"] == "agent.ask" {
            break request;
        }
    };
    assert_eq!(sent["params"], asked());
}

#[tokio::test]
async fn h14_ask_user_schema_is_the_contract_schema() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    let tools = shim.client.list_all_tools().await.unwrap();

    let tool = tools.iter().find(|t| t.name == "ask_user").unwrap();
    assert_eq!(
        Value::Object((*tool.input_schema).clone()),
        serde_json::to_value(schemars::schema_for!(contracts::decision::AskParams)).unwrap()
    );
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

#[tokio::test]
async fn o4_agent_set_order_fills_its_own_id_and_retains_the_captured_order() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let mut requests = fake_daemon(
        &socket,
        &["daemon.identify", "agent.channelUp", "agent.setOrder"],
    );
    let shim = spawn_shim(&socket, "a1").await;

    let tools = shim.client.list_all_tools().await.unwrap();
    let tool = tools.iter().find(|t| t.name == "agent_set_order").unwrap();
    let schema = Value::Object((*tool.input_schema).clone());
    assert!(schema["properties"].get("id").is_none(), "{schema}");
    assert!(schema["properties"].get("order").is_some(), "{schema}");

    let order = json!({"kind": "work", "ask": "fix it", "limits": ["push"], "id": "other"});
    let captured = json!({"order":null});
    shim.call(
        "agent_set_order",
        json!({ "order": order, "captured": captured }),
    )
    .await;

    while let Some(request) = requests.recv().await {
        if request["method"] == "agent.setOrder" {
            assert_eq!(request["params"]["id"], "a1");
            assert_eq!(request["params"]["order"]["ask"], "fix it");
            assert_eq!(request["params"]["captured"], captured);
            return;
        }
    }
    panic!("agent.setOrder was never sent");
}

#[tokio::test]
async fn x11_agent_run_over_mcp_runs_under_the_caller() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let mut requests = fake_daemon(
        &socket,
        &["daemon.identify", "agent.channelUp", "agent.run"],
    );
    let shim = spawn_shim(&socket, "a1").await;

    let tools = shim.client.list_all_tools().await.unwrap();
    let tool = tools.iter().find(|t| t.name == "agent_run").unwrap();
    let schema = Value::Object((*tool.input_schema).clone());
    assert!(schema["properties"].get("id").is_none(), "{schema}");
    assert!(schema["properties"].get("command").is_some(), "{schema}");

    shim.call(
        "agent_run",
        json!({"id": "other", "command": ["/bin/sh", "-c", "echo hi"]}),
    )
    .await;

    while let Some(request) = requests.recv().await {
        if request["method"] == "agent.run" {
            assert_eq!(request["params"]["id"], "a1");
            assert_eq!(request["params"]["command"][2], "echo hi");
            return;
        }
    }
    panic!("agent.run was never sent");
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
        tools.iter().any(|tool| tool.name == "workstream_handoff"),
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
            "todo.delete" => (json!({"id":42}), "deleted Todo 42"),
            "deliverable.remove" => (
                json!({"project":"project-a","id":"published-42"}),
                "removed publication published-42",
            ),
            "pad.delete" => (json!({"name":"notes"}), "deleted Pad notes"),
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
            "decision.answer" => (
                json!({"id":"d1","answer":"allow"}),
                "answered Decision d1: allow",
            ),
            "workstream.handoff" => (
                json!({"summary":"done","keep_todos":[],"keep_pads":[]}),
                "handed off Workstream Door",
            ),
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
    // A refusal, a chosen option and a note alone each name what was submitted.
    for (args, expected) in [
        (
            json!({"id":"d1","answer":"deny"}),
            "answered Decision d1: deny",
        ),
        (
            json!({"id":"d1","answer":"Yes","note":""}),
            "answered Decision d1: Yes",
        ),
        (
            json!({"id":"d1","answer":null,"note":"Use the other option"}),
            "answered Decision d1: Use the other option",
        ),
    ] {
        let result = shim.call("decision_answer", args).await;
        assert_eq!(result.content[0].as_text().unwrap().text, expected);
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

#[tokio::test]
async fn b6_mcp_held_action_receipts_and_history_keep_their_waiting_or_completed_data() {
    for (name, args, value) in [
        (
            "agent_stop",
            json!({"id":"child"}),
            json!({"id":"3","agent":"child","method":"agent.stop","params":{"id":"child"},"outcome":{"status":"waiting","reason":"takeover"}}),
        ),
        ("agent_stop", json!({"id":"child"}), Value::Null),
        (
            "agent_interrupt",
            json!({"id":"child"}),
            json!({"id":"4","agent":"child","method":"agent.interrupt","params":{"id":"child"},"outcome":{"status":"waiting","reason":"takeover"}}),
        ),
        ("agent_interrupt", json!({"id":"child"}), Value::Null),
        (
            "agent_prompt",
            json!({"id":"child","text":"hello"}),
            json!({"id":"5","agent":"child","method":"agent.prompt","params":{"id":"child","text":"hello"},"outcome":{"status":"waiting","reason":"takeover"}}),
        ),
        (
            "agent_prompt",
            json!({"id":"child","text":"hello"}),
            Value::Null,
        ),
        (
            "terminal_close",
            json!({"id":"t1"}),
            json!({"id":"6","agent":"child","method":"terminal.close","params":{"id":"t1"},"outcome":{"status":"waiting","reason":"takeover"}}),
        ),
        ("terminal_close", json!({"id":"t1"}), Value::Null),
        (
            "terminal_kill",
            json!({"id":"t1"}),
            json!({"id":"7","agent":"child","method":"terminal.kill","params":{"id":"t1"},"outcome":{"status":"waiting","reason":"takeover"}}),
        ),
        ("terminal_kill", json!({"id":"t1"}), Value::Null),
        (
            "terminal_write",
            json!({"id":"t1","data":"aGk="}),
            json!({"id":"8","agent":"child","method":"terminal.write","params":{"id":"t1","data":"aGk="},"outcome":{"status":"waiting","reason":"takeover"}}),
        ),
        (
            "terminal_write",
            json!({"id":"t1","data":"aGk="}),
            Value::Null,
        ),
        (
            "rail_rename",
            json!({"id":"child","name":"waiting rename"}),
            json!({"id":"2","agent":"child","method":"rail.rename","params":{"id":"child","name":"waiting rename"},"outcome":{"status":"waiting","reason":"takeover"}}),
        ),
        (
            "agent_actionHistory",
            json!({"id":"child"}),
            json!([{"id":"2","agent":"child","method":"rail.rename","params":{"id":"child","name":"waiting rename"},"outcome":{"status":"completed"}}]),
        ),
        (
            "terminal_resize",
            json!({"id":"t1","cols":80,"rows":24}),
            Value::Null,
        ),
        (
            "terminal_resize",
            json!({"id":"t1","cols":80,"rows":24}),
            json!({"id":"1","agent":"child","terminal":"t1","cols":80,"rows":24,"outcome":{"status":"waiting","reason":"takeover"}}),
        ),
        (
            "terminal_resizeHistory",
            json!({"id":"t1"}),
            json!([{ "id":"1","agent":"child","terminal":"t1","cols":80,"rows":24,"outcome":{"status":"dropped","reason":"original Terminal did not survive Daemon restart"}}]),
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("resize.sock");
        let server = m17_daemon(&socket, value.clone());
        let shim = spawn_shim(&socket, "a1").await;
        let result = shim.call(name, args).await;
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
async fn b53_the_send_schema_requires_kind() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;

    let tools = shim.client.list_all_tools().await.unwrap();

    let send = tools.iter().find(|t| t.name == "message_send").unwrap();
    let schema = Value::Object((*send.input_schema).clone());
    assert!(
        schema["required"]
            .as_array()
            .unwrap()
            .contains(&json!("kind")),
        "{schema}"
    );
    let values = serde_json::to_string(&schema).unwrap();
    assert!(
        values.contains("note") && values.contains("question"),
        "{values}"
    );
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

#[tokio::test]
async fn m2706a_actions_name_rail_nodes() {
    named_actions(false).await;
}

#[tokio::test]
async fn m2706a_actions_use_names_after_rename() {
    named_actions(true).await;
}

async fn named_actions(rename: bool) {
    let mut fx = common::NamedRail::start().await;
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;
    let user = spawn_shim(&fx.served.socket(), "").await;
    if rename {
        let discarded = door.call("agent_discard", json!({"id":fx.child})).await;
        assert_eq!(discarded.is_error, Some(false), "{discarded:?}");
        // Discard removes the identity permanently; recreate its precondition before renaming.
        fx.child = fx.spawn("Writer").await;
    }
    for phase in 0..=usize::from(rename) {
        if phase == 1 {
            fx.rename().await;
        }
        let (door_name, child_name) = if phase == 0 {
            ("Research", "Writer")
        } else {
            ("Planning", "Author")
        };
        let moved = door
            .call(
                "rail_move",
                json!({"id":fx.child,"parent":fx.door,"index":0}),
            )
            .await;
        assert_eq!(moved.is_error, Some(false), "{moved:?}");
        assert_eq!(
            moved.content[0].as_text().unwrap().text,
            format!("moved {child_name} to {door_name}")
        );
        let tree = fx.user.request("rail.tree", ()).await.unwrap();
        let child = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == fx.child)
            .unwrap();
        assert_eq!(child["parent"], fx.door);
        assert_eq!(child["order"], 0);
        let moved = user
            .call("rail_move", json!({"id":fx.door,"parent":null,"index":0}))
            .await;
        assert_eq!(
            moved.content[0].as_text().unwrap().text,
            format!("moved {door_name} to Project root")
        );
    }
    // Discard deletes its node; names must have been resolved before the call.
    let name = if rename { "Author" } else { "Writer" };
    let tree = fx.user.request("rail.tree", ()).await.unwrap();
    let path = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == fx.child)
        .unwrap()["worktree"]["path"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(Path::new(&path).exists());
    let discarded = door.call("agent_discard", json!({"id":fx.child})).await;
    assert_eq!(discarded.is_error, Some(false), "{discarded:?}");
    assert_eq!(
        discarded.content[0].as_text().unwrap().text,
        format!("discarded Worktree of Agent {name}")
    );
    assert!(!Path::new(&path).exists());
    let tree = fx.user.request("rail.tree", ()).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .all(|node| node["id"] != fx.child)
    );
    for phase in 0..=usize::from(rename) {
        let name = if phase == 0 { "Research" } else { "Planning" };
        fx.user
            .request("rail.rename", json!({"id":fx.door,"name":name}))
            .await
            .unwrap();
        let mut events = fx.begin_clear().await;
        let handed = door
            .call(
                "workstream_handoff",
                json!({"summary":"Reviewed the work","keep_todos":[],"keep_pads":[]}),
            )
            .await;
        assert_eq!(handed.is_error, Some(false), "{handed:?}");
        assert_eq!(
            handed.content[0].as_text().unwrap().text,
            format!("handed off Workstream {name}")
        );
        assert_eq!(
            fx.cleared(&mut events).await,
            u32::try_from(phase).unwrap() + 2
        );
    }
}

#[tokio::test]
async fn m2706a_data_names_every_referenced_agent() {
    let fx = common::NamedRail::start().await;
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;
    let child = spawn_shim(&fx.served.socket(), &fx.child).await;
    let (_id, pending) = fx.decision().await;
    for renamed in [false, true] {
        if renamed {
            fx.rename().await;
        }
        let (parent, name, peer) = if renamed {
            ("Planning", "Author", "Editor")
        } else {
            ("Research", "Writer", "Reviewer")
        };
        let tree = text(&door.call("rail_tree", json!({})).await);
        let node = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == fx.child)
            .unwrap();
        assert_eq!(node["name"], name);
        assert_eq!(node["parent_name"], parent);
        let context = text(&child.call("agent_context", json!({})).await);
        assert_eq!(context["self"]["name"], name);
        assert_eq!(context["parent"]["name"], parent);
        assert_eq!(context["ask"]["name"], parent);
        assert_eq!(context["peers"][0]["name"], peer);
        let digest = text(&door.call("agent_digest", json!({})).await);
        assert!(
            digest["children"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["name"] == name)
        );
        let decisions = text(&door.call("decision_list", json!({})).await);
        assert_eq!(decisions[0]["agent"], fx.child);
        assert_eq!(decisions[0]["agent_name"], name);
        assert!(decisions[0].get("failure").is_none());
        assert_eq!(
            serde_json::from_str::<Value>(decisions[0]["args"].as_str().unwrap()).unwrap()["question"],
            "Choose"
        );
    }
    pending.abort();
}

#[tokio::test]
async fn m2706a_non_agent_identifiers_keep_their_meaning() {
    let fx = common::NamedRail::start().await;
    let door = spawn_shim(&fx.served.socket(), &fx.door).await;
    let (id, pending) = fx.decision().await;
    let answered = door
        .call(
            "decision_answer",
            json!({"id":id,"answer":"Yes","proof":"test-proof"}),
        )
        .await;
    assert_eq!(
        answered.content[0].as_text().unwrap().text,
        format!("answered Decision {id}: Yes")
    );
    assert_eq!(pending.await.unwrap().unwrap()["answer"], "Yes");
    let todo = fx
        .user
        .request("todo.create", json!({"title":"Notes"}))
        .await
        .unwrap();
    let deleted = door.call("todo_delete", json!({"id":todo["id"]})).await;
    assert_eq!(
        deleted.content[0].as_text().unwrap().text,
        format!("deleted Todo {}", todo["id"])
    );
    let terminal = fx
        .user
        .request("terminal.open", json!({"workstream":fx.door}))
        .await
        .unwrap()["terminal_id"]
        .clone();
    assert_ne!(
        terminal, fx.door,
        "Terminal and owner identities must differ in this fixture"
    );
    let shown = door.call("terminal_show", json!({"id":terminal})).await;
    assert_eq!(
        shown.content[0].as_text().unwrap().text,
        format!("showing Terminal {}", terminal.as_str().unwrap())
    );
}

#[tokio::test]
async fn m2706a_a_failed_name_lookup_sends_no_action() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("invalid-rail.sock");
    let mut seen = fake_daemon(
        &socket,
        &[
            "daemon.identify",
            "agent.channelUp",
            "rail.tree",
            "agent.discard",
        ],
    );
    let shim = spawn_shim(&socket, "7013").await;
    let reply = shim.call("agent_discard", json!({"id":"7014"})).await;
    assert_eq!(reply.is_error, Some(true));
    let raw = reply.content[0].as_text().unwrap().text.as_str();
    assert!(!raw.contains("7013") && !raw.contains("7014"), "{raw}");
    let mut reads = 0;
    while let Ok(request) = seen.try_recv() {
        assert_ne!(request["method"], "agent.discard");
        reads += usize::from(request["method"] == "rail.tree");
    }
    assert_eq!(reads, 2, "startup and the action each read the Rail");
}

#[tokio::test]
async fn m2706a_failed_answer_authors_have_names() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("answer-author.sock");
    let server = m17_daemon(
        &socket,
        json!([{
            "id":"d1", "agent":"missing", "args":"authored content: missing",
            "failure":{"answered_by":{"kind":"agent","id":"a1","parent":"a1"}}
        }]),
    );
    let shim = spawn_shim(&socket, "a1").await;
    let decisions = text(&shim.call("decision_list", json!({})).await);
    assert_eq!(decisions[0]["agent_name"], "an Agent that is gone");
    assert_eq!(decisions[0]["failure"]["answered_by"]["name"], "Door");
    assert_eq!(
        decisions[0]["failure"]["answered_by"]["parent_name"],
        "Door"
    );
    assert_eq!(decisions[0]["args"], "authored content: missing");
    server.abort();
}
