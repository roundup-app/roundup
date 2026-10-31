use super::*;
use crate::connection::handle;

pub(crate) async fn ask(daemon: &Daemon, line: &str) -> Value {
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    };
    daemon
        .dispatch(&mut conn, line, None)
        .await
        .unwrap()
        .into_value()
}

pub(super) fn daemon_in(dir: &Path) -> Daemon {
    Daemon::open(dir).unwrap()
}

pub(super) fn daemon_with_launcher(
    project: &Path,
    data: &Path,
    launcher: agents::claude_code::Launcher,
) -> Daemon {
    Daemon::open_stores(project, data, |_| {
        let bus = Bus::new();
        let terminals = Arc::new(terminal::Terminals::open(data, bus.clone()).unwrap());
        agents::Agents::open_in(
            project,
            data,
            bus,
            terminals,
            launcher,
            agents::worktree::Git::from_env(),
        )
        .unwrap()
    })
    .unwrap()
}

fn daemon() -> (tempfile::TempDir, Daemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = daemon_in(dir.path());
    (dir, daemon)
}

// No runtime or listener: opening these stores starts no Daemon tasks or children.
// Exercise the actual subscribe method and its producing Bus without thousands of RPC
// renames, Touch writes and unrelated background observers.
#[test]
fn x14_daemon_observer_capacity_matches_its_receiver() {
    use contracts::EventData;
    use tokio::sync::broadcast::error::TryRecvError;
    let dir = tempfile::tempdir().unwrap();
    let daemon = test_daemon(dir.path()).unwrap();
    let (mut receiver, capacity) = daemon.subscribe();
    assert!(capacity > 0);
    for index in 0..capacity {
        daemon.bus.emit(
            Actor {
                id: index.to_string(),
                ..Actor::user()
            },
            EventData::RailChanged,
        );
    }
    for index in 0..capacity {
        let event = receiver.try_recv().unwrap();
        assert!(matches!(event.data, EventData::RailChanged));
        assert_eq!(event.actor.id, index.to_string());
    }
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    for index in 0..=capacity {
        daemon.bus.emit(
            Actor {
                id: index.to_string(),
                ..Actor::user()
            },
            EventData::RailChanged,
        );
    }
    assert!(matches!(receiver.try_recv(), Err(TryRecvError::Lagged(1))));
    assert_eq!(receiver.try_recv().unwrap().actor.id, "1");
}

struct RailReply(Value);

#[async_trait::async_trait]
impl Module for RailReply {
    fn namespaces(&self) -> &'static [&'static str] {
        &["rail"]
    }

    async fn call(&self, _ctx: &Ctx, _method: &str, _params: Value) -> Result<Value, RpcError> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
async fn r16_rail_reply_preserves_every_field_and_row_order_on_the_socket() {
    let (_dir, mut daemon) = daemon();
    // This fixture is the module's already-presented result, not a replacement for
    // Agents' lifecycle tests: the Daemon must transport every field unchanged.
    let nodes = json!([
        {"id":"door", "kind":"workstream", "name":"日本語\n\"Door\" 🦀",
         "parent":null, "order":0, "status":null, "attempt":null,
         "status_revision":null, "terminal_id":null, "worktree":null,
         "can_resume":false, "channel":null, "work":null, "stray":[],
         "model":null, "effort":null},
        {"id":"child", "kind":"agent", "name":"Child", "parent":"door",
         "order":0, "status":{"kind":"needs-you", "label":"Waiting for approval", "since":123456789, "finished":"0"},
         "attempt":"9223372036854775807", "status_revision":"3",
         "terminal_id":"terminal-1", "worktree":{"path":"/tmp/p", "branch":"b", "base":"main"},
         "can_resume":false, "channel":"missing", "work":{"kind":"work", "ask":"Continue", "limits":["Preserve files"]},
         "stray":[{"pid":123,"command":"claude \t--resume"}], "model":"model", "effort":"high"},
        {"id":"sibling", "kind":"agent", "name":"Exited", "parent":"door",
         "order":1, "status":null, "attempt":"2", "status_revision":null,
         "terminal_id":null, "worktree":null, "can_resume":true, "channel":null,
         "work":null, "stray":[], "model":null, "effort":null}
    ]);
    serde_json::from_value::<Vec<contracts::agent::RailNode>>(nodes.clone()).unwrap();
    daemon.register(Arc::new(RailReply(nodes.clone())));
    let (client, server) = UnixStream::pair().unwrap();
    let handler = tokio::spawn(handle(server, Arc::new(daemon)));
    let (read, mut write) = client.into_split();
    let mut lines = BufReader::new(read).lines();
    write
        .write_all(b"{\"id\":\"request\\n1\",\"method\":\"rail.tree\"}\n")
        .await
        .unwrap();
    let frame: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(
        frame,
        json!({"jsonrpc":"2.0", "id":"request\n1", "result":nodes})
    );
    assert_eq!(
        frame["result"][0]
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        nodes[0].as_object().unwrap().keys().collect::<Vec<_>>()
    );
    drop(write);
    drop(lines);
    handler.await.unwrap().unwrap();
}

#[tokio::test]
async fn r3696c_a_rail_tree_reply_written_directly_equals_the_value_route() {
    let (_dir, daemon) = daemon();
    for name in ["Ship", "日本語 \"Door\""] {
        let line = json!({"id":1,"method":"rail.createWorkstream","params":{"name":name}});
        ask(&daemon, &line.to_string()).await;
    }
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    };
    let routed = daemon
        .route(&mut conn, "rail.tree", Value::Null)
        .await
        .unwrap();
    assert_eq!(routed.as_array().unwrap().len(), 2);
    for method in ["rail.tree", "rail.list"] {
        let reply = ask(&daemon, &json!({"id":"a\nb","method":method}).to_string()).await;
        assert_eq!(
            reply,
            json!({"jsonrpc":"2.0", "id":"a\nb", "result":routed})
        );
    }
}

#[tokio::test]
async fn r3696c_a_ping_written_directly_equals_the_value_route() {
    let (_dir, daemon) = daemon();
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    };
    let routed = daemon
        .route(&mut conn, "daemon.ping", Value::Null)
        .await
        .unwrap();
    let reply = ask(&daemon, &json!({"id":7,"method":"daemon.ping"}).to_string()).await;
    assert_eq!(reply, json!({"jsonrpc":"2.0", "id":7, "result":routed}));
}

async fn frames(daemon: Daemon, requests: &str, count: usize) -> Vec<Value> {
    let (client, server) = UnixStream::pair().unwrap();
    let handler = tokio::spawn(handle(server, Arc::new(daemon)));
    let (read, mut write) = client.into_split();
    let mut lines = BufReader::new(read).lines();
    write.write_all(requests.as_bytes()).await.unwrap();
    let mut frames = Vec::new();
    for _ in 0..count {
        frames.push(serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap());
    }
    drop(write);
    drop(lines);
    handler.await.unwrap().unwrap();
    frames
}

#[tokio::test]
async fn r16_frames_preserve_complete_error_envelopes() {
    for (request, expected) in [
        (
            "invalid\n",
            json!({"jsonrpc":"2.0", "id":null,
                "error":{"code":-32700, "message":"parse error"}}),
        ),
        (
            "{\"id\":null,\"method\":\"missing.method\"}\n",
            json!({"jsonrpc":"2.0", "id":null,
                "error":{"code":-32601, "message":"method not found: missing.method"}}),
        ),
    ] {
        let (_dir, daemon) = daemon();
        assert_eq!(frames(daemon, request, 1).await, vec![expected]);
    }
}

#[tokio::test]
async fn r16_notifications_do_not_add_frames_between_pipelined_replies() {
    let (_dir, daemon) = daemon();
    let mut frames = frames(
        daemon,
        concat!(
            "{\"id\":7,\"method\":\"rail.tree\"}\n",
            "{\"method\":\"daemon.ping\"}\n",
            "{\"id\":8,\"method\":\"rail.tree\"}\n"
        ),
        2,
    )
    .await;
    frames.sort_by_key(|frame| frame["id"].as_u64());
    assert_eq!(
        frames,
        vec![
            json!({"jsonrpc":"2.0", "id":7, "result":[]}),
            json!({"jsonrpc":"2.0", "id":8, "result":[]}),
        ]
    );
}

#[tokio::test]
async fn a38_ping_reports_the_generated_contract() {
    let (_dir, daemon) = daemon();
    let reply = ask(
        &daemon,
        r#"{"jsonrpc":"2.0","id":7,"method":"daemon.ping"}"#,
    )
    .await;
    assert_eq!(reply["id"], 7);
    assert_eq!(reply["result"]["pong"], true);
    let generated = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../contracts/generated/contract.ts"
    ))
    .unwrap();
    let contract = &reply["result"]["contract"];
    let listed: Vec<(&str, &str)> = generated
        .lines()
        .filter_map(|line| line.trim().strip_suffix("\","))
        .filter_map(|line| line.strip_prefix('"')?.split_once("\": \""))
        .collect();
    assert!(contract.get("methods").is_none());
    let methods = ask(&daemon, r#"{"id":8,"method":"daemon.methods"}"#).await;
    let names: Vec<&str> = methods["result"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_str().unwrap())
        .collect();
    assert!(!names.is_empty());
    assert_eq!(
        listed.iter().map(|(name, _)| *name).collect::<Vec<_>>(),
        names
    );
    assert_eq!(
        contract["fingerprint"].as_str().unwrap(),
        contracts::methods::fingerprint_of_hashes(&listed)
    );
}

struct Echo;

#[async_trait::async_trait]
impl Module for Echo {
    fn namespaces(&self) -> &'static [&'static str] {
        &["echo"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, _params: Value) -> Result<Value, RpcError> {
        Ok(json!({ "method": method, "actor": ctx.actor.id }))
    }
}

#[tokio::test]
async fn module_methods_reach_their_module_with_the_callers_actor() {
    let (_dir, mut daemon) = daemon();
    daemon.register(Arc::new(Echo));

    let reply = ask(&daemon, r#"{"jsonrpc":"2.0","id":1,"method":"echo.hello"}"#).await;

    assert_eq!(reply["result"]["method"], "echo.hello");
    assert_eq!(reply["result"]["actor"], "you");
}

#[tokio::test]
async fn subscribers_receive_events_pushed_on_the_same_connection() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = Arc::new(Daemon::open(dir.path()).unwrap());
    let socket = dir.path().join("rupd.sock");
    tokio::spawn(serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::clone(&daemon),
    ));
    let mut client = rpc::Client::connect(&socket).await.unwrap();
    client
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();

    daemon
        .bus
        .emit(Actor::daemon(), contracts::EventData::RailChanged);

    let event = client.next_event().await.unwrap();
    assert_eq!(event.actor, Actor::daemon());
    assert!(matches!(event.data, contracts::EventData::RailChanged));
}

/// Lists one running Terminal whose program has already ended, so every kill is `NOT_FOUND`.
struct SelfEnded;

#[async_trait::async_trait]
impl Module for SelfEnded {
    fn namespaces(&self) -> &'static [&'static str] {
        &["terminal"]
    }

    async fn call(&self, _ctx: &Ctx, method: &str, _params: Value) -> Result<Value, RpcError> {
        match method {
            "terminal.list" => Ok(json!([TerminalInfo {
                program_pid: None,
                id: "1".into(),
                incarnation: "self-ended-terminal".into(),
                cwd: "/".into(),
                title: None,
                program: "sh".into(),
                running: true,
                exit_code: None,
                owner: None,
                status: None,
            }])),
            _ => Err(RpcError::not_found("running terminal 1")),
        }
    }
}

#[tokio::test]
async fn d1_stopping_programs_that_ended_by_themselves_is_not_a_failure() {
    let (_dir, mut daemon) = daemon();
    daemon.register(Arc::new(SelfEnded));

    daemon.stop_terminals().await.unwrap();
}

/// The Daemon wires up every module it owns, including `messages` (`scenarios/messages.md`
/// B5): a real request through `Daemon::open`, not a fake module, must reach it.
#[tokio::test]
async fn the_messages_module_is_reachable_through_the_daemon() {
    let (_dir, daemon) = daemon();
    let reply = ask(&daemon, r#"{"jsonrpc":"2.0","id":1,"method":"route.list"}"#).await;
    assert_eq!(reply["result"], json!([]));
}

/// Answers only once released, and says when its call enters and when it is dropped
/// unanswered.
struct Hangs {
    says: tokio::sync::mpsc::UnboundedSender<&'static str>,
    release: Arc<tokio::sync::Notify>,
}

/// Says `dropped` when its call ends without an answer.
struct Dropped(Option<tokio::sync::mpsc::UnboundedSender<&'static str>>);

impl Drop for Dropped {
    fn drop(&mut self) {
        if let Some(says) = self.0.take() {
            let _ = says.send("dropped");
        }
    }
}

#[async_trait::async_trait]
impl Module for Hangs {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent"]
    }

    async fn call(&self, _ctx: &Ctx, _method: &str, _params: Value) -> Result<Value, RpcError> {
        let _ = self.says.send("entered");
        let mut dropped = Dropped(Some(self.says.clone()));
        self.release.notified().await;
        dropped.0 = None;
        Ok(json!("answered"))
    }
}

async fn serving_a_module_that_hangs() -> (
    tempfile::TempDir,
    tokio::sync::mpsc::UnboundedReceiver<&'static str>,
    Arc<tokio::sync::Notify>,
    std::path::PathBuf,
) {
    let (dir, mut daemon) = daemon();
    daemon
        .agents
        .call(
            &daemon.ctx(Actor::user()),
            "rail.createWorkstream",
            json!({"name":"fixture"}),
        )
        .await
        .unwrap();
    let (says, said) = mpsc::unbounded_channel();
    let release = Arc::new(tokio::sync::Notify::new());
    daemon.register(Arc::new(Hangs {
        says,
        release: Arc::clone(&release),
    }));
    let socket = dir.path().join("rupd.sock");
    tokio::spawn(serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::new(daemon),
    ));
    (dir, said, release, socket)
}

/// What `Hangs` says first, once its call reaches it.
async fn first_said(said: &mut tokio::sync::mpsc::UnboundedReceiver<&'static str>) -> &'static str {
    tokio::time::timeout(std::time::Duration::from_secs(5), said.recv())
        .await
        .expect("the call reached the module")
        .expect("the module still reports its calls")
}

/// A call is not dropped by a half-close: a client may write its request, shut down
/// its write side and wait for the reply.
#[tokio::test]
async fn a_half_closed_call_still_runs() {
    let (_dir, mut said, release, socket) = serving_a_module_that_hangs().await;
    let mut client = UnixStream::connect(&socket).await.unwrap();
    client
        .write_all(
            b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"agent.stop\",\"params\":{\"id\":\"1\"}}\n",
        )
        .await
        .unwrap();
    client.shutdown().await.unwrap();
    assert_eq!(first_said(&mut said).await, "entered");

    release.notify_one();
    let mut reply = String::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        BufReader::new(&mut client).read_line(&mut reply),
    )
    .await
    .expect("the half-closed client reads the reply")
    .unwrap();
    let reply: Value = serde_json::from_str(&reply).unwrap();
    assert_eq!(reply["id"], 1);
    assert_eq!(reply["result"], "answered");

    assert!(said.try_recv().is_err());
}

// U3808 names the real Daemon and restart: no vendor program or socket is needed.
#[tokio::test]
async fn u3808_the_list_reads_recorded_handoffs_without_history_or_touches() {
    async fn facts(daemon: &Daemon, conn: &mut Conn) -> Value {
        daemon
            .route(conn, "todo.listHanded", Value::Null)
            .await
            .unwrap()
    }
    let dir = tempfile::tempdir().unwrap();
    let daemon = test_daemon(dir.path()).unwrap();
    let owner = Actor {
        kind: ActorKind::Agent,
        id: "owner".into(),
        parent: None,
    };
    let other = Actor {
        id: "other".into(),
        ..owner.clone()
    };
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    };
    // No Agent is started just to own fixture work; writes still use the real Todo module.
    let todos = daemon.modules.get("todo").unwrap();
    let ctx = daemon.ctx(Actor::user());
    for title in ["first", "second", "blocked", "legacy"] {
        todos
            .call(&ctx, "todo.create", json!({"title": title, "owner": owner}))
            .await
            .unwrap();
    }
    todos
        .call(&ctx, "todo.setBlockers", json!({"id": 3, "blockers": [1]}))
        .await
        .unwrap();
    todos
        .call(&ctx, "todo.reorder", json!({"id": 2, "before": 1}))
        .await
        .unwrap();
    assert_eq!(facts(&daemon, &mut conn).await, json!([]));
    let (mut events, _) = daemon.subscribe();
    let daemon_ctx = daemon.ctx(Actor::daemon());
    // Exact global Change sequences: four creates, a blocker change, then these Hand-offs.
    for (id, seq) in [(2, 6), (1, 7)] {
        let before = daemon
            .route(&mut conn, "todo.list", Value::Null)
            .await
            .unwrap();
        let handed = todos
            .call(&daemon_ctx, "todo.hand", json!({"agent": "owner"}))
            .await
            .unwrap();
        assert_eq!(handed["id"], id);
        let event = events.recv().await.unwrap();
        assert!(matches!(event.data, contracts::EventData::TodoUpdated(ref t) if t.id == id));
        assert_eq!(
            daemon
                .route(&mut conn, "todo.list", Value::Null)
                .await
                .unwrap(),
            before
        );
        assert_eq!(
            facts(&daemon, &mut conn)
                .await
                .as_array()
                .unwrap()
                .last()
                .unwrap(),
            &json!({"todo": id, "seq": seq, "owner": owner})
        );
    }
    assert_eq!(
        facts(&daemon, &mut conn).await,
        json!([
            {"todo": 2, "seq": 6, "owner": owner}, {"todo": 1, "seq": 7, "owner": owner}
        ])
    );
    // Todo order and Hand-off sequence order must be independently observable.
    todos
        .call(&ctx, "todo.reorder", json!({"id": 2, "before": null}))
        .await
        .unwrap();
    // An away/back assignment invalidates only that Todo's old Hand-off.
    for owner in [&other, &owner] {
        todos
            .call(&ctx, "todo.assign", json!({"id": 1, "owner": owner}))
            .await
            .unwrap();
        assert_eq!(
            facts(&daemon, &mut conn).await,
            json!([{"todo": 2, "seq": 6, "owner": {"kind":"agent","id":"owner","parent":null}}])
        );
    }
    todos
        .call(&daemon_ctx, "todo.hand", json!({"agent": "owner"}))
        .await
        .unwrap();
    let expected =
        json!([{"todo": 2, "seq": 6, "owner": owner}, {"todo": 1, "seq": 10, "owner": owner}]);
    assert_eq!(facts(&daemon, &mut conn).await, expected);
    // These are recorded facts; done/blocked filtering belongs to the marker's Todo read.
    for method in ["todo.complete", "todo.reopen"] {
        todos.call(&ctx, method, json!({"id": 1})).await.unwrap();
        assert_eq!(facts(&daemon, &mut conn).await, expected);
    }
    let list = daemon
        .route(&mut conn, "todo.list", Value::Null)
        .await
        .unwrap();
    assert_eq!(
        list.as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].clone())
            .collect::<Vec<_>>(),
        vec![json!(1), json!(3), json!(4), json!(2)]
    );
    let touches = daemon.touches.sequence().unwrap();
    let messages = daemon
        .route(&mut conn, "message.list", json!({}))
        .await
        .unwrap();
    for _ in 0..2 {
        assert_eq!(facts(&daemon, &mut conn).await, expected);
    }
    assert_eq!(daemon.touches.sequence().unwrap(), touches);
    assert_eq!(
        daemon
            .route(&mut conn, "message.list", json!({}))
            .await
            .unwrap(),
        messages
    );
    assert!(
        daemon
            .route(&mut conn, "rail.tree", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    drop(daemon);
    let restarted = test_daemon(dir.path()).unwrap();
    assert_eq!(facts(&restarted, &mut conn).await, expected);
    assert_eq!(
        restarted
            .route(&mut conn, "todo.list", Value::Null)
            .await
            .unwrap(),
        list
    );
}

/// R3696b: the wire reader's actor serves routing, so one write walks its peer's ancestry once.
#[tokio::test]
async fn r3696b_write_classifies_its_caller_once() {
    let (dir, daemon) = daemon();
    let socket = dir.path().join("rupd.sock");
    tokio::spawn(serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::new(daemon),
    ));
    let mut client = BufReader::new(UnixStream::connect(&socket).await.unwrap());
    let mut call = async |method: &str| {
        let line = format!(
            "{{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"{method}\",\"params\":{{\"id\":\"none\",\"data\":\"eA==\"}}}}\n"
        );
        client.get_mut().write_all(line.as_bytes()).await.unwrap();
        let mut reply = String::new();
        client.read_line(&mut reply).await.unwrap();
    };
    // `agent.stop` classifies its caller once; a write must not classify more often.
    call("agent.stop").await;
    let before = agents::classifications();
    let lookups = agents::parent_lookups();
    call("terminal.write").await;
    let write = agents::classifications() - before;
    // With no Agent running no ancestor can be one, so a write reads no /proc.
    assert_eq!(
        agents::parent_lookups(),
        lookups,
        "a write walked /proc with no Agent running"
    );
    let before = agents::classifications();
    call("agent.stop").await;
    let chain = agents::classifications() - before;
    assert_eq!(chain, 1, "one classification for agent.stop");
    assert_eq!(
        write, 1,
        "{write} classifications for a write, one chain is {chain}"
    );
}
