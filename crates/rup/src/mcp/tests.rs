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
    transport_as(socket, "a1", false)
}

fn transport_as(socket: &Path, id: &str, door: bool) -> tokio::io::DuplexStream {
    let (client, server) = tokio::io::duplex(65536);
    let (gone, _errors) = mpsc::channel(1);
    let shim = Shim {
        socket: socket.to_owned(),
        actor: Actor {
            kind: ActorKind::Agent,
            id: id.into(),
            parent: None,
        },
        tools: if door { door_tools() } else { tools(false) },
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
    // M5: one tool for each method of its first list.
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

// Production SDK -> RPC -> Daemon -> real Todo and Message stores. Only lifecycle
// observations are controlled: this fixture creates no program, PTY or vendor.
#[tokio::test(start_paused = true)]
async fn u4593_mcp_assignment_connects_context_owner_and_comment() {
    for (kind, parent_kind, door) in [
        ("agent", Some("workstream"), false),
        ("workstream", None, true),
        ("agent", Some("agent"), false),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path());
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute_batch("INSERT INTO nodes(id,kind,name,ord,attempt,terminal_id) VALUES(3,'workstream','Home',0,0,null),(2,'agent','Peer',1,1,'peer-terminal');").unwrap();
        let parent = parent_kind.map(|_| 3);
        if let Some(parent_kind) = parent_kind {
            db.execute("UPDATE nodes SET kind=?1 WHERE id=3", [parent_kind])
                .unwrap();
        }
        db.execute("INSERT INTO nodes(id,kind,name,parent,ord,attempt,terminal_id) VALUES(1,?1,'Caller',?2,0,1,'caller-terminal')", rusqlite::params![kind, parent]).unwrap();
        db.execute(
            "UPDATE nodes SET parent=?1 WHERE id=2",
            rusqlite::params![parent],
        )
        .unwrap();
        daemon.set_agent_status_for_test("1", contracts::Kind::Working);
        let socket = dir.path().join("daemon.sock");
        let serving = crate::serve_test_daemon(&socket, daemon.clone());
        let shim = TestShim {
            client: ().serve(transport_as(&socket, "1", door)).await.unwrap(),
        };
        let user = rpc::Client::connect(&socket).await.unwrap();
        let context = tool_value(shim.call("agent_context", json!({})).await);
        let peer = context["peers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|peer| peer["name"] == "Peer")
            .unwrap_or_else(|| panic!("{context}"))["name"]
            .clone();
        let offered = shim.client.list_all_tools().await.unwrap();
        let assign = offered
            .iter()
            .find(|tool| tool.name == "todo_assign")
            .unwrap();
        assert!(
            serde_json::to_string(&assign.input_schema)
                .unwrap()
                .contains("Owner")
        );
        let todo = user
            .request("todo.create", json!({"title":"Take the work"}))
            .await
            .unwrap();
        let assigned = tool_value(
            shim.call("todo_assign", json!({"id":todo["id"],"owner":"me"}))
                .await,
        );
        assert_eq!(assigned["owner"]["id"], "1");
        let (mut events, _) = daemon.subscribe();
        user.request(
            "todo.comment",
            json!({"id":todo["id"],"body":"Please include the regression"}),
        )
        .await
        .unwrap();
        let notes = user
            .request("message.list", json!({"to":"1"}))
            .await
            .unwrap();
        assert!(!notes.as_array().unwrap().iter().any(|note| {
            note["body"]
                .as_str()
                .unwrap()
                .contains("Please include the regression")
        }));
        daemon.set_agent_status_for_test("1", contracts::Kind::Idle);
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let event = events.recv().await.unwrap();
                let event = serde_json::to_value(event).unwrap();
                if event.to_string().contains("Please include the regression") {
                    break;
                }
            }
        })
        .await
        .expect("T22 creates the comment note at idle");
        let notes = user
            .request("message.list", json!({"to":"1"}))
            .await
            .unwrap();
        let comment_notes: Vec<_> = notes
            .as_array()
            .unwrap()
            .iter()
            .filter(|note| {
                note["body"]
                    .as_str()
                    .unwrap()
                    .contains("Please include the regression")
            })
            .collect();
        assert_eq!(comment_notes.len(), 1);
        assert_eq!(comment_notes[0]["to"], "1");
        let delegated = tool_value(
            shim.call("todo_assign", json!({"id":todo["id"],"owner":peer}))
                .await,
        );
        assert_eq!(delegated["owner"]["id"], "2");
        let read = tool_value(shim.call("todo_get", json!({"id":todo["id"]})).await);
        assert_eq!(read["owner"]["id"], "2");
        shim.client.cancel().await.unwrap();
        serving.abort();
    }
}

fn tool_value(reply: CallToolResult) -> Value {
    assert_ne!(reply.is_error, Some(true), "{reply:?}");
    let text = reply
        .content
        .iter()
        .find_map(|item| item.as_text())
        .unwrap();
    serde_json::from_str(&text.text).unwrap()
}

#[tokio::test(start_paused = true)]
async fn u4593_auto_prompt_supplies_the_self_assignment_call() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path());
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch("INSERT INTO nodes(id,kind,name,ord,attempt,terminal_id) VALUES(1,'workstream','Door',0,1,'terminal');").unwrap();
    daemon.set_agent_status_for_test("1", contracts::Kind::Working);
    let socket = dir.path().join("daemon.sock");
    let serving = crate::serve_test_daemon(&socket, daemon.clone());
    let user = rpc::Client::connect(&socket).await.unwrap();
    user.request("workstream.setAuto", json!({"id":"1","auto":true}))
        .await
        .unwrap();
    let todo = user
        .request("todo.create", json!({"title":"Auto work"}))
        .await
        .unwrap();
    user.request("todo.move", json!({"id":todo["id"],"home":"1"}))
        .await
        .unwrap();
    let notes = user
        .request("message.list", json!({"to":"1"}))
        .await
        .unwrap();
    let body = notes
        .as_array()
        .unwrap()
        .iter()
        .find_map(|note| {
            note["body"]
                .as_str()
                .filter(|body| body.contains("todo_assign "))
        })
        .unwrap();
    let call = body
        .split_once("todo_assign ")
        .unwrap()
        .1
        .split_once('}')
        .unwrap()
        .0
        .to_owned()
        + "}";
    let arguments: Value = serde_json::from_str(&call).unwrap();
    let shim = TestShim {
        client: ().serve(transport_as(&socket, "1", true)).await.unwrap(),
    };
    let owner = tool_value(shim.call("todo_assign", arguments).await);
    assert_eq!(owner["owner"]["id"], "1");
    let read = user
        .request("todo.get", json!({"id":todo["id"]}))
        .await
        .unwrap();
    assert_eq!(read["owner"]["id"], "1");
    shim.client.cancel().await.unwrap();
    serving.abort();
}

async fn reply_fixture(
    door: bool,
) -> (
    tempfile::TempDir,
    TestShim,
    rpc::Client,
    std::sync::Arc<crate::ReplyState>,
) {
    let (dir, socket, user, state) = crate::reply_project(door).await;
    let (client, server) = tokio::io::duplex(65536);
    let (gone, _) = mpsc::channel(1);
    let shim = Shim {
        socket: socket.clone(),
        actor: Actor {
            kind: ActorKind::Agent,
            id: "1".into(),
            parent: None,
        },
        tools: if door { door_tools() } else { tools(false) },
        gone,
    };
    tokio::spawn(async move { shim.serve(server).await.unwrap().waiting().await });
    let shim = TestShim {
        client: ().serve(client).await.unwrap(),
    };
    (dir, shim, user, state)
}

impl TestShim {
    async fn value(&self, tool: &str, arguments: Value) -> Value {
        let result = self.call(tool, arguments).await;
        assert_ne!(result.is_error, Some(true), "{tool}: {result:?}");
        let text = result.content[0].as_text().unwrap();
        serde_json::from_str(&text.text).unwrap_or_else(|_| panic!("{tool}: {}", text.text))
    }
}

#[tokio::test(start_paused = true)]
async fn t4597_an_unowned_reply_is_readable_and_waits_for_idle() {
    for door in [false, true] {
        let (_dir, shim, user, state) = reply_fixture(door).await;
        let offered = shim.client.list_all_tools().await.unwrap();
        let tool = offered.iter().find(|t| t.name == "todo_comments").unwrap();
        assert_eq!(
            Value::Object((*tool.input_schema).clone()),
            serde_json::to_value(schemars::schema_for!(contracts::todo::TodoId)).unwrap()
        );
        let todo = user
            .request("todo.create", json!({"title":"Question"}))
            .await
            .unwrap();
        let id = todo["id"].clone();
        shim.value("todo_comment", json!({"id":id,"body":"Which branch?"}))
            .await;
        user.request("todo.comment", json!({"id":id,"body":"Use main exactly."}))
            .await
            .unwrap();
        let before = user
            .request("todo.comments", json!({"id":id}))
            .await
            .unwrap();
        let thread = shim.value("todo_comments", json!({"id":id})).await;
        assert_eq!(thread, before, "tool reads preserve read state");
        assert_eq!(
            thread[0]["author"],
            json!({"kind":"agent","id":"1","parent":null})
        );
        assert_eq!(thread[0]["body"], "Which branch?");
        assert_eq!(
            thread[1]["author"],
            serde_json::to_value(Actor::user()).unwrap()
        );
        assert_eq!(thread[1]["body"], "Use main exactly.");
        assert_eq!(thread.as_array().unwrap().len(), 2);
        let again = user
            .request("todo.comments", json!({"id":id}))
            .await
            .unwrap();
        assert_eq!(thread, again, "tool reads preserve read state");
        // owner_told::SETTLE is 40 ms. This window also proves working Agents get none.
        tokio::time::advance(Duration::from_millis(80)).await;
        assert!(state.entries.lock().unwrap().is_empty());
        assert!(
            user.request("message.list", json!({}))
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .is_empty()
        );
        let delivered = state.written.notified();
        state.status("1", contracts::Kind::Idle);
        tokio::time::advance(Duration::from_millis(80)).await;
        tokio::time::timeout(Duration::from_secs(1), delivered)
            .await
            .unwrap();
        let note_id = {
            let entries = state.entries.lock().unwrap();
            assert_eq!(entries.len(), 1, "{entries:?}");
            assert_eq!(entries[0].0, "1");
            assert_eq!(entries[0].2, Actor::daemon().id);
            assert_eq!(
                entries[0].3,
                "[todos]\n- Question: new comment from you: Use main exactly. (rup todo get 1)"
            );
            entries[0].1
        };
        let note = shim.value("message_get", json!({"id":note_id})).await;
        assert_eq!(note["kind"], "note");
        assert_eq!(note["to"], "1");
        assert_eq!(*state.terminal_writes.lock().unwrap(), 0);
    }
}

#[tokio::test]
async fn t4597_both_roles_read_the_surfaces_they_write() {
    for door in [false, true] {
        for surface in ["pad", "message", "deliverable"] {
            let (_dir, shim, user, _state) = reply_fixture(door).await;
            match surface {
                "pad" => {
                    shim.value("pad_create", json!({"name":"notes","text":"question"}))
                        .await;
                    user.request("pad.append", json!({"name":"notes","text":"answer"}))
                        .await
                        .unwrap();
                    let pad = shim.value("pad_read", json!({"name":"notes"})).await;
                    assert_eq!(pad["text"], "questionanswer");
                    assert_eq!(pad["revision"], 2);
                }
                "message" => {
                    let sent = shim
                        .value(
                            "message_send",
                            json!({"to":"you","body":"question","kind":"note"}),
                        )
                        .await;
                    let reply = user
                        .request(
                            "message.send",
                            json!({"to":"1","body":"answer","kind":"note"}),
                        )
                        .await
                        .unwrap();
                    assert_eq!(
                        shim.value("message_get", json!({"id":sent["id"]})).await["body"],
                        "question"
                    );
                    assert_eq!(
                        shim.value("message_get", json!({"id":reply["id"]})).await["body"],
                        "answer"
                    );
                    assert_eq!(
                        shim.value("message_list", json!({}))
                            .await
                            .as_array()
                            .unwrap()
                            .len(),
                        2
                    );
                    let private = user
                        .request(
                            "message.send",
                            json!({"to":"2","body":"private","kind":"note"}),
                        )
                        .await
                        .unwrap();
                    assert_eq!(
                        shim.call("message_get", json!({"id":private["id"]}))
                            .await
                            .is_error,
                        Some(true)
                    );
                }
                _ => {
                    let pad = shim
                        .value("pad_create", json!({"name":"notes","text":"published"}))
                        .await;
                    let record = shim.value("deliverable_publish", json!({"key":"result","title":"Result","target":{"kind":"pad","name":"notes","incarnation":pad["incarnation"],"revision":1}})).await;
                    user.request("pad.append", json!({"name":"notes","text":"later"}))
                        .await
                        .unwrap();
                    let id = json!({"project":record["project"],"id":record["id"]});
                    assert_eq!(shim.value("deliverable_get", id.clone()).await, record);
                    assert_eq!(
                        shim.value("deliverable_list", json!({})).await,
                        json!([record])
                    );
                    let resolved = shim.value("deliverable_resolve", id).await;
                    assert_eq!(resolved["kind"], "retained");
                    assert_eq!(
                        std::fs::read_to_string(resolved["path"].as_str().unwrap()).unwrap(),
                        "published"
                    );
                }
            }
        }
    }
}

#[tokio::test(start_paused = true)]
async fn u4698c_mcp_sets_priority_as_the_authenticated_actor() {
    for door in [false, true] {
        let (_dir, shim, user, state) = reply_fixture(door).await;
        let offered = shim.client.list_all_tools().await.unwrap();
        for name in ["todo_create", "todo_update"] {
            let schema = &offered
                .iter()
                .find(|t| t.name == name)
                .unwrap()
                .input_schema;
            assert!(
                !schema["required"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("priority"))
            );
            let defs = &schema["$defs"]["Priority"]["enum"];
            assert_eq!(defs, &json!(["low", "medium", "high", "urgent"]));
            assert!(
                schema["properties"]["priority"]
                    .to_string()
                    .contains("null")
            );
        }
        let old = shim
            .value("todo_create", json!({"title":"old caller"}))
            .await;
        assert_eq!(old["priority"], Value::Null);
        for priority in [
            json!(null),
            json!("low"),
            json!("medium"),
            json!("high"),
            json!("urgent"),
        ] {
            let todo = shim.value("todo_create", json!({"title":"Agent priority","priority":priority,"actor":{"kind":"user","id":"you"}})).await;
            let id = todo["id"].clone();
            assert_eq!(todo["priority"], priority);
            shim.value("todo_update", json!({"id":id,"title":"kept"}))
                .await;
            assert_eq!(
                shim.value("todo_get", json!({"id":id})).await["priority"],
                priority
            );
            assert_eq!(
                shim.value("todo_list", json!({}))
                    .await
                    .as_array()
                    .unwrap()
                    .last()
                    .unwrap()["priority"],
                priority
            );
            for patch in [json!("urgent"), json!(null), priority] {
                assert_eq!(
                    shim.value("todo_update", json!({"id":id,"priority":patch}))
                        .await["priority"],
                    patch
                );
            }
            let history = user
                .request("todo.getHistory", json!({"id":id}))
                .await
                .unwrap();
            for change in history["changes"].as_array().unwrap() {
                assert_eq!(
                    change["actor"],
                    json!({"kind":"agent","id":"1","parent":null})
                );
            }
            let before = shim.value("todo_list", json!({})).await;
            for bad in [
                json!(""),
                json!("Low"),
                json!("critical"),
                json!(0),
                json!(5),
                json!(1.5),
                json!(true),
                json!([]),
                json!({}),
            ] {
                for (tool, params) in [
                    ("todo_create", json!({"title":"bad","priority":bad})),
                    ("todo_update", json!({"id":id,"title":"bad","priority":bad})),
                ] {
                    assert_eq!(shim.call(tool, params).await.is_error, Some(true));
                }
            }
            assert_eq!(shim.value("todo_list", json!({})).await, before);
            assert_eq!(
                user.request("todo.getHistory", json!({"id":id}))
                    .await
                    .unwrap(),
                history
            );
        }
        assert_eq!(*state.terminal_writes.lock().unwrap(), 0);
        assert_eq!(
            serde_json::to_value(shim.client.list_all_tools().await.unwrap()).unwrap(),
            serde_json::to_value(offered).unwrap()
        );
    }
}
