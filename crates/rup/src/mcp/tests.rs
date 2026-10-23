use super::*;

#[test]
fn o9_the_brief_and_the_tool_description_name_order_and_prompt() {
    let description = agent_spawn()
        .tool
        .description
        .unwrap_or_default()
        .to_string();
    assert!(
        description.contains("`order`") && description.contains("`prompt`"),
        "{description}"
    );
}

use rmcp::model::ProtocolVersion;
use rmcp::service::{RoleClient, RunningService};
use serde_json::json;
use std::path::Path;
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;

const BOUND: Duration = Duration::from_secs(20);

// Exercise the production ServerHandler and SDK serialization, without a child,
// Daemon or PTY. The socket fixture only records the outgoing RPC envelope.
fn transport(socket: &Path) -> tokio::io::DuplexStream {
    let (client, server) = tokio::io::duplex(65536);
    let (gone, _errors) = mpsc::channel(1);
    let shim = Shim {
        socket: socket.to_owned(),
        actor: Actor {
            kind: ActorKind::Agent,
            id: "a1".into(),
            parent: None,
        },
        tools: tools(false),
        gone,
    };
    tokio::spawn(async move { shim.serve(server).await.unwrap().waiting().await });
    client
}

struct TestShim {
    client: RunningService<RoleClient, ()>,
}

async fn spawn_shim(socket: &Path) -> TestShim {
    TestShim {
        client: ().serve(transport(socket)).await.unwrap(),
    }
}

impl TestShim {
    async fn call(&self, tool: &str, arguments: Value) -> CallToolResult {
        let mut request = CallToolRequestParams::new(tool.to_owned());
        if let Value::Object(map) = arguments {
            request = request.with_arguments(map);
        }
        tokio::time::timeout(BOUND, self.client.call_tool(request))
            .await
            .unwrap()
            .unwrap()
    }
}

async fn write_line(to: &mut (impl AsyncWrite + Unpin), message: &Value) {
    to.write_all(format!("{message}\n").as_bytes())
        .await
        .unwrap();
}

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

fn asked() -> Value {
    json!({"question": "Cats or dogs?", "answers": [
        {"label": "cats", "description": "quiet"},
        {"label": "dogs", "description": "loyal", "preview": "```text\nwoof\n```"},
    ]})
}

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
                    let _ = seen.send(request.clone());
                    let result = match request["method"].as_str() {
                        Some("agent.ask") => {
                            tokio::time::sleep(delay).await;
                            json!({ "answer": "dogs", "note": "walks" })
                        }
                        _ => Value::Null,
                    };
                    let reply = json!({ "jsonrpc": "2.0", "id": request["id"], "result": result });
                    write_line(&mut write, &reply).await;
                }
            });
        }
    });
    requests
}

async fn raw_tools_list(socket: &Path, cursor: Option<&str>) -> Value {
    let transport = transport(socket);
    let (read, mut stdin) = tokio::io::split(transport);
    let mut stdout = BufReader::new(read).lines();
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

#[tokio::test]
async fn m1_list_tools_send_null_params_to_the_daemon() {
    for (tool, method) in [("todo_list", "todo.list"), ("pad_list", "pad.list")] {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("fake.sock");
        let mut requests = fake_daemon(&socket, &["daemon.identify", "todo.list", "pad.list"]);
        let shim = spawn_shim(&socket).await;

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
async fn m4_the_full_tools_list_carries_a_numeric_ttl_ms_and_cache_scope() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");

    let result = raw_tools_list(&socket, None).await;

    assert_matches_tools_list_schema(&result);
    // M5: one tool for each method of its first list, and `ask_user` (H14).
    assert_eq!(
        result["tools"].as_array().unwrap().len(),
        tools(false).len()
    );
    assert_eq!(result["cacheScope"], "public", "{result}");
}

#[tokio::test]
async fn m4_the_empty_list_a_cursor_gets_carries_a_numeric_ttl_ms_and_cache_scope() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");

    let result = raw_tools_list(&socket, Some("past-the-end")).await;

    assert_matches_tools_list_schema(&result);
    assert_eq!(result["tools"].as_array().unwrap().len(), 0);
    assert_eq!(result["cacheScope"], "public", "{result}");
}

#[tokio::test]
async fn o4_agent_set_order_fills_its_own_id_and_retains_the_captured_order() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let mut requests = fake_daemon(
        &socket,
        &["daemon.identify", "agent.channelUp", "agent.setOrder"],
    );
    let shim = spawn_shim(&socket).await;

    let tools = shim.client.list_all_tools().await.unwrap();
    let tool = tools.iter().find(|t| t.name == "agent_set_order").unwrap();
    let schema = Value::Object((*tool.input_schema).clone());
    assert!(schema["properties"].get("id").is_none(), "{schema}");
    assert!(schema["properties"].get("order").is_some(), "{schema}");

    let order = json!({"kind": "work", "ask": "fix it", "limits": ["push"], "id": "other"});
    let captured = json!({"order":null});
    shim.call(
        "agent_set_order",
        json!({ "id": "other", "order": order, "captured": captured }),
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
    let shim = spawn_shim(&socket).await;

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

#[tokio::test]
async fn h14_ask_user_waits_past_the_call_bound_and_returns_the_answer_and_the_note() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("fake.sock");
    let mut requests = asking_daemon(&socket, CALL_TIMEOUT + Duration::from_secs(1));
    let shim = spawn_shim(&socket).await;

    let call = tokio::spawn(async move { shim.call("ask_user", asked()).await });
    let sent = loop {
        let request = requests.recv().await.unwrap();
        if request["method"] == "agent.ask" {
            break request;
        }
    };
    tokio::time::pause();
    tokio::time::advance(CALL_TIMEOUT + Duration::from_secs(1)).await;
    tokio::time::resume();
    let result = call.await.unwrap();

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
    assert_eq!(sent["params"], asked());
}
