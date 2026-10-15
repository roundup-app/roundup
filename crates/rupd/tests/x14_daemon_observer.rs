//! X14's fixture prerequisite: observe today's global Bus without a forwarding queue.

use std::sync::Arc;
use std::time::Duration;

use contracts::{Actor, ActorKind, Event, EventData};
use rpc::Client;
use serde_json::{Value, json};
use tokio::net::UnixListener;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::timeout;

type Error = Box<dyn std::error::Error + Send + Sync>;
const BOUND: Duration = Duration::from_secs(15);
const OBSERVATION_BOUND: Duration = Duration::from_secs(45);

struct Fixture {
    daemon: Arc<rupd::Daemon>,
    client: Client,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
    dir: tempfile::TempDir,
    terminals: Vec<String>,
    rail: String,
}

impl Fixture {
    async fn open() -> Result<Self, Error> {
        let dir = tempfile::tempdir()?;
        let project = dir.path().join("project");
        std::fs::create_dir(&project)?;
        let daemon = Arc::new(rupd::Daemon::open_project(
            &project,
            &dir.path().join("data"),
            None,
        )?);
        let socket = dir.path().join("daemon.sock");
        let listener = UnixListener::bind(&socket)?;
        let server = tokio::spawn(rupd::serve(listener, Arc::clone(&daemon)));
        let client = timeout(BOUND, Client::connect(&socket)).await??;
        let node = timeout(
            BOUND,
            client.request("rail.createWorkstream", json!({"name": "observer"})),
        )
        .await??;
        let rail = node["id"].as_str().ok_or("Rail id is a string")?.to_owned();
        Ok(Self {
            rail,
            daemon,
            client,
            server,
            dir,
            terminals: Vec::new(),
        })
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, Error> {
        Ok(timeout(BOUND, self.client.request(method, params)).await??)
    }

    async fn marker(&self, identity: &str) -> Result<(), Error> {
        self.call(
            "daemon.identify",
            json!({"actor": Actor {
                kind: ActorKind::User, id: identity.into(), parent: None,
            }}),
        )
        .await?;
        self.call("rail.rename", json!({"id": self.rail, "name": identity}))
            .await?;
        Ok(())
    }

    async fn finish(&self) -> Result<(), Error> {
        timeout(BOUND, self.daemon.stop_terminals()).await??;
        let terminals = self.call("terminal.list", Value::Null).await?;
        let terminals = terminals.as_array().ok_or("Terminal list is an array")?;
        for id in &self.terminals {
            let terminal = terminals
                .iter()
                .find(|terminal| terminal["id"] == *id)
                .ok_or("fixture Terminal missing from shutdown observation")?;
            if terminal["running"] != false {
                return Err(format!("fixture Terminal {id} survived shutdown").into());
            }
        }
        Ok(())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

fn rail_marker(event: Event, identity: &str) -> Result<(), Error> {
    if !matches!(event.data, EventData::RailChanged) || event.actor.id != identity {
        return Err(format!("expected Rail marker {identity}, got {event:?}").into());
    }
    Ok(())
}

#[tokio::test]
async fn x14_daemon_observer_capacity_matches_its_receiver() {
    let fixture = Fixture::open().await.unwrap();
    let observation = timeout(OBSERVATION_BOUND, async {
        let (mut receiver, capacity) = fixture.daemon.subscribe();
        if capacity == 0 {
            return Err::<(), Error>("Bus capacity is positive".into());
        }
        for index in 0..capacity {
            fixture.marker(&format!("boundary-{index}")).await?;
        }
        // Exactly capacity events fit; their identities and order survive unchanged.
        for index in 0..capacity {
            rail_marker(
                timeout(BOUND, receiver.recv()).await??,
                &format!("boundary-{index}"),
            )?;
        }
        for index in 0..=capacity {
            fixture.marker(&format!("overflow-{index}")).await?;
        }
        if !matches!(
            timeout(BOUND, receiver.recv()).await?,
            Err(RecvError::Lagged(1))
        ) {
            return Err("capacity plus one must lose exactly one event".into());
        }
        rail_marker(timeout(BOUND, receiver.recv()).await??, "overflow-1")?;
        Ok(())
    })
    .await;
    let cleanup = fixture.finish().await;
    cleanup.unwrap();
    observation.unwrap().unwrap();
}

impl Fixture {
    async fn output_client(&self) -> Result<Client, Error> {
        let client =
            timeout(BOUND, Client::connect(&self.dir.path().join("daemon.sock"))).await??;
        timeout(BOUND, client.request("events.subscribe", ())).await??;
        Ok(client)
    }

    async fn terminal(&mut self) -> Result<String, Error> {
        let terminal = self.call("terminal.spawn", json!({
            "cwd": self.dir.path().join("project"),
            "command": ["/bin/sh", "-c", "stty -echo; printf 'observer-ready\\n'; while IFS= read -r line; do printf 'payload:%s\\n' \"$line\"; done"],
            "env": {}, "cols": 80, "rows": 24,
        })).await?;
        let id = terminal["id"]
            .as_str()
            .ok_or("Terminal id is a string")?
            .to_owned();
        self.terminals.push(id.clone());
        Ok(id)
    }

    async fn write(&self, id: &str, payload: &str) -> Result<(), Error> {
        use base64::Engine as _;
        self.call(
            "terminal.write",
            json!({
                "id": id,
                "data": base64::engine::general_purpose::STANDARD.encode(payload),
            }),
        )
        .await?;
        Ok(())
    }
}

async fn output_payload(client: &mut Client, id: &str, expected: &str) -> Result<usize, Error> {
    use base64::Engine as _;
    timeout(BOUND, async {
        let mut bytes = Vec::new();
        let mut chunks = 0;
        loop {
            let event = client.next_event().await.ok_or("RPC events closed")?;
            if let EventData::TerminalOutput(output) = event.data {
                if output.id != id {
                    return Err::<usize, Error>("unexpected Terminal output identity".into());
                }
                chunks += 1;
                bytes.extend(base64::engine::general_purpose::STANDARD.decode(output.data)?);
                if String::from_utf8_lossy(&bytes).contains(expected) {
                    return Ok(chunks);
                }
            }
        }
    })
    .await?
}

async fn receiver_payload(
    receiver: &mut tokio::sync::broadcast::Receiver<Event>,
    id: &str,
    expected: &str,
) -> Result<(), Error> {
    use base64::Engine as _;
    timeout(BOUND, async {
        let mut bytes = Vec::new();
        loop {
            if let EventData::TerminalOutput(output) = receiver.recv().await?.data {
                if output.id != id {
                    return Err::<(), Error>("unexpected Bus Terminal identity".into());
                }
                bytes.extend(base64::engine::general_purpose::STANDARD.decode(output.data)?);
                if String::from_utf8_lossy(&bytes).contains(expected) {
                    return Ok(());
                }
            }
        }
    })
    .await?
}

#[tokio::test]
async fn x14_daemon_observer_exposes_output_induced_bus_lag() {
    let mut fixture = Fixture::open().await.unwrap();
    let observation = timeout(OBSERVATION_BOUND, async {
        let mut output = fixture.output_client().await?;
        let (mut receiver, capacity) = fixture.daemon.subscribe();
        if capacity <= 2 {
            return Err::<(), Error>("Rail markers must fit below capacity".into());
        }
        let mut ids = Vec::new();
        for _ in 0..2 {
            let id = fixture.terminal().await?;
            output_payload(&mut output, &id, "observer-ready\r\n").await?;
            receiver_payload(&mut receiver, &id, "observer-ready\r\n").await?;
            ids.push(id);
        }
        fixture.marker("before-output").await?;
        rail_marker(timeout(BOUND, receiver.recv()).await??, "before-output")?;
        fixture.marker("paused-output").await?;
        let mut chunks = 0;
        for index in 0..=capacity {
            let payload = format!("chunk-{index}");
            fixture.write(&ids[0], &format!("{payload}\n")).await?;
            chunks +=
                output_payload(&mut output, &ids[0], &format!("payload:{payload}\r\n")).await?;
        }
        if chunks <= capacity {
            return Err("Terminal chunks must exceed Bus capacity".into());
        }
        // RPC continues while the actual receiver is unread, with only one paused Rail marker.
        if fixture.call("daemon.ping", Value::Null).await?["pong"] != true {
            return Err("RPC stalled during observation".into());
        }
        match timeout(BOUND, receiver.recv()).await? {
            Err(RecvError::Lagged(missed)) if missed > 0 => {}
            other => {
                return Err(
                    format!("expected structured output-induced lag, got {other:?}").into(),
                );
            }
        }
        receiver_payload(
            &mut receiver,
            &ids[0],
            &format!("payload:chunk-{capacity}\r\n"),
        )
        .await?;
        fixture.marker("after-output").await?;
        rail_marker(timeout(BOUND, receiver.recv()).await??, "after-output")?;
        Ok(())
    })
    .await;
    let cleanup = fixture.finish().await;
    cleanup.unwrap();
    observation.unwrap().unwrap();
}

#[tokio::test]
async fn x14_daemon_observer_cleanup_after_error() {
    let mut fixture = Fixture::open().await.unwrap();
    let observation = timeout(OBSERVATION_BOUND, async {
        let mut output = fixture.output_client().await?;
        for _ in 0..2 {
            let id = fixture.terminal().await?;
            output_payload(&mut output, &id, "observer-ready\r\n").await?;
        }
        let (mut receiver, _) = fixture.daemon.subscribe();
        fixture.marker("actual-marker").await?;
        rail_marker(
            timeout(BOUND, receiver.recv()).await??,
            "induced-wrong-marker",
        )
    })
    .await;
    let cleanup = fixture.finish().await;
    cleanup.unwrap();
    assert!(
        observation
            .unwrap()
            .unwrap_err()
            .to_string()
            .contains("expected Rail marker induced-wrong-marker")
    );
}
