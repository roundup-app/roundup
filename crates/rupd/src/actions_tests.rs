//! NA6–NA9 over a real socket, with a fake App connection that answers as the App's handler does.

use std::sync::Mutex;
use std::time::Duration;

use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};

struct Wire {
    lines: tokio::io::Lines<BufReader<OwnedReadHalf>>,
    write: OwnedWriteHalf,
}

impl Wire {
    async fn connect(socket: &Path) -> Self {
        let (read, write) = UnixStream::connect(socket).await.unwrap().into_split();
        Self {
            lines: BufReader::new(read).lines(),
            write,
        }
    }

    async fn send(&mut self, line: Value) {
        self.write
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn next(&mut self) -> Option<Value> {
        let line = self.lines.next_line().await.unwrap()?;
        Some(serde_json::from_str(&line).unwrap())
    }

    async fn project(&mut self) -> Value {
        loop {
            let request = self.next().await.expect("App request");
            if request["method"] == "action.list" {
                self.send(json!({"jsonrpc":"2.0","id":request["id"],"result":rows()}))
                    .await;
            } else {
                return request;
            }
        }
    }

    /// One request and its reply.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        self.send(json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
            .await;
        self.next().await.unwrap()
    }
}

fn rows() -> Value {
    json!([
        {"name":"agent.new","label":"New agent","keys":"⌘N","args":[],"available":true},
        {"name":"leader.row","label":"Switch to a row","keys":"⌘K K","args":[{"key":"query","type":"string","required":false}],"available":true},
        {"name":"rail.remove","label":"Remove","keys":"⌫","args":[],"available":false,"cause":"needs a Rail row"}
    ])
}

/// How the fake App answers `action.run`.
#[derive(Clone)]
enum Run {
    Answer(Value),
    Refuse(i64, &'static str),
    Silent,
}

struct Fixture {
    _dir: tempfile::TempDir,
    socket: std::path::PathBuf,
    /// Every `action.run` the fake App received.
    runs: Arc<Mutex<Vec<Value>>>,
    lists: Arc<Mutex<usize>>,
}

async fn daemon() -> Fixture {
    daemon_waiting(Duration::from_secs(10)).await
}

async fn daemon_waiting(timeout: Duration) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let (mut daemon, watchers) = <Daemon>::open(dir.path()).unwrap();
    daemon.actions = crate::actions::Answerer::with_timeout(timeout);
    let daemon = Arc::new(daemon);
    let socket = dir.path().join("actions.sock");
    tokio::spawn(serve(
        UnixListener::bind(&socket).unwrap(),
        daemon,
        watchers,
    ));
    Fixture {
        _dir: dir,
        socket,
        runs: Arc::default(),
        lists: Arc::default(),
    }
}

impl Fixture {
    /// Registers a fake App that answers lists with `rows()` and runs as `run` says.
    async fn app(&self, run: Run) -> tokio::task::JoinHandle<()> {
        let mut app = Wire::connect(&self.socket).await;
        let reply = app.call("action.serve", Value::Null).await;
        assert_eq!(reply["result"], Value::Null);
        let (runs, lists) = (Arc::clone(&self.runs), Arc::clone(&self.lists));
        tokio::spawn(async move {
            while let Some(request) = app.next().await {
                let id = request["id"].clone();
                match request["method"].as_str() {
                    Some("action.list") => {
                        *lists.lock().unwrap() += 1;
                        app.send(json!({"jsonrpc":"2.0","id":id,"result":rows()}))
                            .await;
                    }
                    Some("action.run") => {
                        runs.lock().unwrap().push(request["params"].clone());
                        match &run {
                            Run::Answer(result) => {
                                app.send(json!({"jsonrpc":"2.0","id":id,"result":result})).await
                            }
                            Run::Refuse(code, message) => {
                                app.send(json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})).await
                            }
                            Run::Silent => {}
                        }
                    }
                    _ => {}
                }
            }
        })
    }

    async fn user(&self) -> Wire {
        Wire::connect(&self.socket).await
    }

    async fn agent(&self) -> Wire {
        let mut wire = self.user().await;
        let reply = wire
            .call(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":"7","parent":null}}),
            )
            .await;
        assert!(reply.get("error").is_none());
        wire
    }
}

fn done() -> Run {
    Run::Answer(json!({"status":"done"}))
}

#[tokio::test]
async fn na6_list_returns_the_apps_list() {
    let fixture = daemon().await;
    let _app = fixture.app(done()).await;
    let reply = fixture.user().await.call("action.list", Value::Null).await;
    assert_eq!(reply["result"], rows());
}

#[tokio::test]
async fn na6_no_app_is_app_closed_with_cause_and_fix() {
    let fixture = daemon().await;
    let reply = fixture.user().await.call("action.list", Value::Null).await;
    assert_eq!(reply["error"]["code"], code::APP_CLOSED);
    let message = reply["error"]["message"].as_str().unwrap();
    assert!(message.contains("not open") && message.contains("open it and retry"));
    // The registration ends with the App's connection: nothing is cached.
    let app = fixture.app(done()).await;
    app.abort();
    let reply = loop {
        let reply = fixture.user().await.call("action.list", Value::Null).await;
        if reply["error"]["code"] == code::APP_CLOSED {
            break reply;
        }
        tokio::task::yield_now().await;
    };
    assert_eq!(reply["result"], Value::Null);
}

#[tokio::test]
async fn na7_run_reaches_the_app_once_and_returns_its_answer() {
    let fixture = daemon().await;
    let _app = fixture.app(Run::Answer(json!({"status":"awaiting"}))).await;
    let reply = fixture
        .user()
        .await
        .call(
            "action.run",
            json!({"name":"leader.row","args":[{"key":"query","value":"a=b c"}]}),
        )
        .await;
    assert_eq!(reply["result"], json!({"status":"awaiting"}));
    assert_eq!(
        *fixture.runs.lock().unwrap(),
        vec![json!({"name":"leader.row","args":[{"key":"query","value":"a=b c"}]})]
    );
}

#[tokio::test]
async fn na7_unknown_name_or_argument_is_refused_before_the_app() {
    let fixture = daemon().await;
    let _app = fixture.app(done()).await;
    let mut user = fixture.user().await;
    let reply = user.call("action.run", json!({"name":"agent.nw"})).await;
    assert_eq!(reply["error"]["code"], code::INVALID_PARAMS);
    assert!(
        reply["error"]["message"]
            .as_str()
            .unwrap()
            .contains("agent.nw")
    );
    let reply = user
        .call(
            "action.run",
            json!({"name":"agent.new","args":[{"key":"force","value":"1"}]}),
        )
        .await;
    assert_eq!(reply["error"]["code"], code::INVALID_PARAMS);
    assert!(
        reply["error"]["message"]
            .as_str()
            .unwrap()
            .contains("force")
    );
    assert!(fixture.runs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn na7_app_refusals_pass_through() {
    let fixture = daemon().await;
    let _app = fixture
        .app(Run::Refuse(code::CONFLICT, "rail.remove needs a Rail row"))
        .await;
    let reply = fixture
        .user()
        .await
        .call("action.run", json!({"name":"rail.remove"}))
        .await;
    assert_eq!(reply["error"]["code"], code::CONFLICT);
    assert_eq!(reply["error"]["message"], "rail.remove needs a Rail row");
}

#[tokio::test]
async fn na7_run_with_no_app_runs_nothing() {
    let fixture = daemon().await;
    let reply = fixture
        .user()
        .await
        .call("action.run", json!({"name":"agent.new"}))
        .await;
    assert_eq!(reply["error"]["code"], code::APP_CLOSED);
    assert!(fixture.runs.lock().unwrap().is_empty());
}

#[tokio::test]
async fn na8_only_the_user_runs_an_action() {
    let fixture = daemon().await;
    let _app = fixture.app(done()).await;
    let mut agent = fixture.agent().await;
    assert_eq!(
        agent.call("action.list", Value::Null).await["result"],
        rows()
    );
    let reply = agent.call("action.run", json!({"name":"agent.new"})).await;
    assert_eq!(reply["error"]["code"], code::FORBIDDEN);
    assert!(fixture.runs.lock().unwrap().is_empty());
    // An Agent cannot take the App's place either.
    let reply = agent.call("action.serve", Value::Null).await;
    assert_eq!(reply["error"]["code"], code::FORBIDDEN);
    let reply = fixture
        .user()
        .await
        .call("action.run", json!({"name":"agent.new"}))
        .await;
    assert_eq!(reply["result"], json!({"status":"done"}));
}

#[tokio::test]
async fn na8_each_call_is_a_touch_with_name_and_argument_keys() {
    let fixture = daemon().await;
    let _app = fixture.app(done()).await;
    let mut user = fixture.user().await;
    user.call("action.list", Value::Null).await;
    user.call(
        "action.run",
        json!({"name":"leader.row","args":[{"key":"query","value":"secret"}]}),
    )
    .await;
    let touches = user
        .call("provenance.touched", json!({"actor_id":"you"}))
        .await;
    let items: Vec<_> = touches["result"]
        .as_array()
        .unwrap()
        .iter()
        .map(|touch| touch["item"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        items,
        [
            "action:list",
            "action:leader.row",
            "action:leader.row:query"
        ]
    );
    assert!(!touches.to_string().contains("secret"));
}

#[tokio::test]
async fn na9_a_run_the_app_never_answered_is_unknown_outcome_and_not_retried() {
    let fixture = daemon_waiting(Duration::from_millis(200)).await;
    let _app = fixture.app(Run::Silent).await;
    let reply = fixture
        .user()
        .await
        .call("action.run", json!({"name":"agent.new"}))
        .await;
    assert_eq!(reply["error"]["code"], code::UNKNOWN_OUTCOME);
    assert_eq!(fixture.runs.lock().unwrap().len(), 1);
    // The same call again is a second run: there is no operation id.
    let reply = fixture
        .user()
        .await
        .call("action.run", json!({"name":"agent.new"}))
        .await;
    assert_eq!(reply["error"]["code"], code::UNKNOWN_OUTCOME);
    assert_eq!(fixture.runs.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn a5765f_open_without_or_losing_the_app() {
    for method in ["project.open", "project.start"] {
        let fixture = daemon().await;
        let target = tempfile::tempdir().unwrap();
        let mut params = json!({"path": target.path()});
        if method == "project.start" {
            params["kind"] = json!("agent");
            params["name"] = json!("worker");
            params["prompt"] = json!("work");
        }
        let mut caller = fixture.user().await;
        let door = caller
            .call("rail.createWorkstream", json!({"name":"builder"}))
            .await;
        caller
            .call(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":door["result"]["id"],"parent":null}}),
            )
            .await;
        assert_eq!(
            caller.call(method, params.clone()).await["error"]["code"],
            code::APP_CLOSED
        );
        let mut app = fixture.user().await;
        app.call("action.serve", Value::Null).await;
        caller
            .send(json!({"jsonrpc":"2.0","id":2,"method":method,"params":params}))
            .await;
        let request = app.project().await;
        assert_eq!(request["method"], method);
        assert_eq!(request["params"]["path"], json!(target.path()));
        let mut replacement = fixture.user().await;
        replacement.call("action.serve", Value::Null).await;
        assert_eq!(
            caller.next().await.unwrap()["error"]["code"],
            code::UNKNOWN_OUTCOME
        );
    }
}

#[tokio::test(start_paused = true)]
async fn a5765b_open_confirmation_outlives_the_action_timeout() {
    let fixture = daemon().await;
    let target = tempfile::tempdir().unwrap();
    let mut app = fixture.user().await;
    app.call("action.serve", Value::Null).await;
    let mut caller = fixture.user().await;
    let door = caller
        .call("rail.createWorkstream", json!({"name":"builder"}))
        .await;
    let id = door["result"]["id"].as_str().unwrap();
    caller
        .call(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":id,"parent":null}}),
        )
        .await;
    for kind in [None, Some("agent"), Some("workstream"), Some("mode")] {
        let method = if kind.is_some() {
            "project.start"
        } else {
            "project.open"
        };
        let mut params = json!({"path":target.path()});
        let result = if let Some(kind) = kind {
            params["kind"] = json!(kind);
            params["name"] = json!("worker");
            params["prompt"] = json!("exact work");
            json!({"path":target.path(),"kind":kind,"id":"created"})
        } else {
            json!({"path":target.path()})
        };
        caller
            .send(json!({"jsonrpc":"2.0","id":2,"method":method,"params":params}))
            .await;
        let request = app.project().await;
        assert_eq!(request["method"], method);
        assert_eq!(
            request["params"]["agent"],
            json!({"id":id,"name":"builder"})
        );
        tokio::time::advance(Duration::from_secs(11)).await;
        app.send(json!({"jsonrpc":"2.0","id":request["id"],"result":result}))
            .await;
        assert_eq!(caller.next().await.unwrap()["result"], result);
    }
    assert!(!target.path().join(".roundup").exists());
}

#[tokio::test]
async fn a5765c_open_refusal_and_invalid_params_create_nothing() {
    let fixture = daemon().await;
    let target = tempfile::tempdir().unwrap();
    let mut caller = fixture.user().await;
    for params in [
        json!({"path":"relative"}),
        json!({"path":target.path(),"yolo":true}),
        json!({"path":target.path(),"actor":"you"}),
        json!({"path":target.path(),"rpc":"agent.spawn"}),
    ] {
        assert_eq!(
            caller.call("project.open", params).await["error"]["code"],
            code::INVALID_PARAMS
        );
    }
    let file = target.path().join("file");
    std::fs::write(&file, "").unwrap();
    for path in [file, target.path().join("missing")] {
        assert_eq!(
            caller.call("project.open", json!({"path":path})).await["error"]["code"],
            code::NOT_FOUND
        );
    }
    let mut unknown = fixture.agent().await;
    assert_eq!(
        unknown
            .call("project.open", json!({"path":target.path()}))
            .await["error"]["code"],
        code::FORBIDDEN
    );
    let mut app = fixture.user().await;
    app.call("action.serve", Value::Null).await;
    caller
        .send(
            json!({"jsonrpc":"2.0","id":2,"method":"project.open","params":{"path":target.path()}}),
        )
        .await;
    let request = app.project().await;
    let cause = format!("The user refused to open {}", target.path().display());
    app.send(json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":code::FORBIDDEN,"message":cause}})).await;
    let reply = caller.next().await.unwrap();
    assert_eq!(reply["error"]["code"], code::FORBIDDEN);
    assert_eq!(reply["error"]["message"], cause);
    assert!(!target.path().join(".roundup").exists());
}
