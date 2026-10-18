//! X14: Terminal output is selected per Terminal over the real Daemon's socket.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use contracts::{Actor, ActorKind, EventData};
use rpc::{Client, OutputFrame};
use serde_json::{Value, json};
use tokio::net::UnixListener;
use tokio::sync::broadcast::Receiver;
use tokio::time::timeout;

const BOUND: Duration = Duration::from_secs(30);
/// Ten saturating Terminals each overflow the Bus on a shared CI runner; 16 s alone on a quiet one.
const FLOOD_BOUND: Duration = Duration::from_secs(120);

struct Fixture {
    dir: tempfile::TempDir,
    daemon: Arc<rupd::Daemon>,
    client: Client,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
}

impl Fixture {
    async fn open() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        let daemon =
            Arc::new(rupd::Daemon::open_project(&project, &dir.path().join("data"), None).unwrap());
        let socket = dir.path().join("daemon.sock");
        let server = tokio::spawn(rupd::serve(
            UnixListener::bind(&socket).unwrap(),
            Arc::clone(&daemon),
        ));
        let client = Client::connect(&socket).await.unwrap();
        Self {
            dir,
            daemon,
            client,
            server,
        }
    }

    async fn connect(&self) -> (Client, Receiver<OutputFrame>) {
        let mut client = Client::connect(&self.dir.path().join("daemon.sock"))
            .await
            .unwrap();
        let output = client.take_output().unwrap();
        (client, output)
    }

    async fn call(&self, method: &str, params: Value) -> Value {
        timeout(BOUND, self.client.request(method, params))
            .await
            .unwrap()
            .unwrap()
    }

    async fn spawn(&self, script: &str) -> String {
        let spawned = self
            .call(
                "terminal.spawn",
                json!({
                    "cwd": self.dir.path().join("project"),
                    "command": ["/bin/sh", "-c", script],
                    "env": {}, "cols": 80, "rows": 24,
                }),
            )
            .await;
        spawned["id"].as_str().unwrap().to_owned()
    }

    async fn write(&self, id: &str, text: &str) {
        self.call(
            "terminal.write",
            json!({"id": id, "data": STANDARD.encode(text)}),
        )
        .await;
    }

    async fn finish(self) {
        self.daemon.stop_terminals().await.unwrap();
        self.server.abort();
    }
}

/// The bytes a selection received until `expected` appeared in them; other Terminals' ids fail.
async fn bytes_until(output: &mut Receiver<OutputFrame>, id: &str, expected: &str) -> String {
    timeout(BOUND, async {
        let mut text = String::new();
        loop {
            match output.recv().await.unwrap() {
                OutputFrame::Bytes(event) => {
                    assert_eq!(
                        event.id, id,
                        "a frame of a Terminal this connection did not select"
                    );
                    text.push_str(&String::from_utf8_lossy(
                        &STANDARD.decode(event.data).unwrap(),
                    ));
                    if text.contains(expected) {
                        return text;
                    }
                }
                OutputFrame::Gap(gap) => panic!("unexpected gap {gap:?}"),
            }
        }
    })
    .await
    .unwrap()
}

const ECHO: &str =
    "stty -echo; read -r go; while IFS= read -r line; do printf '%s:%s\\n' \"$go\" \"$line\"; done";

#[tokio::test]
async fn x14_socket_output_is_selected_by_terminal() {
    let fixture = Fixture::open().await;
    let (first, mut first_output) = fixture.connect().await;
    let (second, mut second_output) = fixture.connect().await;
    let a = fixture.spawn(ECHO).await;
    let b = fixture.spawn(ECHO).await;
    first
        .request("terminal.output", json!({"id": a}))
        .await
        .unwrap();
    second
        .request("terminal.output", json!({"id": b}))
        .await
        .unwrap();
    fixture.write(&a, "A\n").await;
    fixture.write(&b, "B\n").await;
    fixture.write(&a, "one\n").await;
    fixture.write(&b, "two\n").await;
    assert!(
        bytes_until(&mut first_output, &a, "A:one")
            .await
            .contains("A:one")
    );
    assert!(
        bytes_until(&mut second_output, &b, "B:two")
            .await
            .contains("B:two")
    );
    fixture.write(&a, "tail\n").await;
    bytes_until(&mut first_output, &a, "A:tail").await;
    // Whatever else arrived on a connection belongs to its own Terminal.
    for (output, id) in [(&mut first_output, &a), (&mut second_output, &b)] {
        while let Ok(frame) = output.try_recv() {
            assert!(matches!(frame, OutputFrame::Bytes(event) if event.id == *id));
        }
    }
    fixture.finish().await;
}

#[tokio::test]
async fn x14_output_subscription_lifetime() {
    let fixture = Fixture::open().await;
    let (selector, mut output) = fixture.connect().await;
    let unknown = selector
        .request("terminal.output", json!({"id": "99"}))
        .await
        .unwrap_err();
    assert_eq!(unknown.code, rpc::code::NOT_FOUND);
    let id = fixture.spawn(ECHO).await;
    let started = selector
        .request("terminal.output", json!({"id": id}))
        .await
        .unwrap();
    assert_eq!(started["offset"], 0);
    fixture.write(&id, "x\n").await;
    fixture.write(&id, "1\n").await;
    bytes_until(&mut output, &id, "x:1").await;
    // Releasing the selection stops delivery to this connection only.
    let (other, mut other_output) = fixture.connect().await;
    other
        .request("terminal.output", json!({"id": id}))
        .await
        .unwrap();
    selector
        .request("terminal.outputStop", json!({"id": id}))
        .await
        .unwrap();
    fixture.write(&id, "2\n").await;
    bytes_until(&mut other_output, &id, "x:2").await;
    // Frames sent before the stop may still arrive; nothing written after it does.
    while let Ok(OutputFrame::Bytes(event)) = output.try_recv() {
        let text = String::from_utf8_lossy(&STANDARD.decode(event.data).unwrap()).into_owned();
        assert!(!text.contains("x:2"), "{text}");
    }
    // A closed connection releases its selection; the Terminal and others carry on.
    drop(other);
    fixture.write(&id, "3\n").await;
    // An exited Terminal is NOT_FOUND again, and its final bytes arrive first.
    let (again, _final_output) = fixture.connect().await;
    again
        .request("terminal.output", json!({"id": id}))
        .await
        .unwrap();
    fixture.call("terminal.kill", json!({"id": id})).await;
    let gone = loop {
        match again.request("terminal.output", json!({"id": id})).await {
            Err(err) => break err,
            Ok(_) => tokio::time::sleep(Duration::from_millis(20)).await,
        }
    };
    assert_eq!(gone.code, rpc::code::NOT_FOUND);
    fixture.finish().await;
}

/// Run capture and MCP read plain text through the selected-stream Daemon, not output events.
#[tokio::test]
async fn x14_all_output_callers_use_selected_streams() {
    let fixture = Fixture::open().await;
    let id = fixture.spawn("printf 'caller\\n'; read line").await;
    timeout(BOUND, async {
        loop {
            let read = fixture
                .call("terminal.read", json!({"id": id, "after": 0}))
                .await;
            if read["text"]
                .as_str()
                .is_some_and(|text| text.contains("caller"))
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let screen = fixture.call("terminal.screen", json!({"id": id})).await;
    assert!(screen.to_string().contains("caller"));
    let found = fixture
        .call("terminal.search", json!({"id": id, "pattern": "call+er"}))
        .await;
    assert!(found.to_string().contains("caller"));
    fixture.finish().await;
}

#[tokio::test]
async fn x14_ten_busy_terminals_do_not_lag_rail_events() {
    let fixture = Fixture::open().await;
    let rail = fixture
        .call("rail.createWorkstream", json!({"name": "flood"}))
        .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (mut receiver, capacity) = fixture.daemon.subscribe();
    assert!(capacity > 2);
    let (selector, mut output) = fixture.connect().await;
    let mut ids = Vec::new();
    for _ in 0..8 {
        let id = fixture.spawn("read go; exec yes").await;
        selector
            .request("terminal.output", json!({"id": id}))
            .await
            .unwrap();
        fixture.write(&id, "\n").await;
        ids.push(id);
    }
    for _ in 0..2 {
        let id = fixture.spawn("read go; exec yes").await;
        selector
            .request("terminal.output", json!({"id": id}))
            .await
            .unwrap();
        fixture.write(&id, "\n").await;
        ids.push(id);
    }
    let marker = |name: &'static str| {
        let fixture = &fixture;
        let rail = rail.clone();
        async move {
            fixture
                .call("daemon.identify", json!({"actor": Actor { kind: ActorKind::User, id: name.into(), parent: None }}))
                .await;
            fixture
                .call("rail.rename", json!({"id": rail, "name": name}))
                .await;
        }
    };
    marker("first").await;
    let mut counts = std::collections::HashMap::<String, usize>::new();
    timeout(FLOOD_BOUND, async {
        // The receiver stays unread while every Terminal exceeds the Bus capacity in chunks.
        while ids
            .iter()
            .any(|id| counts.get(id).copied().unwrap_or(0) <= capacity)
        {
            if let Ok(OutputFrame::Bytes(event)) = output.recv().await {
                *counts.entry(event.id).or_default() += 1;
            }
        }
    })
    .await
    .unwrap();
    marker("second").await;
    let mut markers = Vec::new();
    while let Ok(event) = receiver.try_recv() {
        match event.data {
            EventData::RailChanged if event.actor.id == "first" || event.actor.id == "second" => {
                markers.push(event.actor.id);
            }
            EventData::RailRenamed { id, name }
                if id == rail && (name == "first" || name == "second") => {}
            EventData::RailChanged | EventData::TerminalChanged => {}
            other => panic!("unexpected Bus event {other:?}"),
        }
    }
    assert_eq!(markers, ["first", "second"]);
    assert!(matches!(
        receiver.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
    fixture.finish().await;
}
