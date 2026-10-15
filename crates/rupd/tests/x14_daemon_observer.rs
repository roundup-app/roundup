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

struct Fixture {
    daemon: Arc<rupd::Daemon>,
    client: Client,
    server: tokio::task::JoinHandle<std::io::Result<()>>,
    _dir: tempfile::TempDir,
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
        Ok(Self {
            daemon,
            client,
            server,
            _dir: dir,
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
        self.call("rail.createWorkstream", json!({"name": identity}))
            .await?;
        Ok(())
    }

    async fn finish(&self) -> Result<(), Error> {
        timeout(BOUND, self.daemon.stop_terminals()).await??;
        let terminals = self.call("terminal.list", Value::Null).await?;
        let terminals = terminals.as_array().ok_or("Terminal list is an array")?;
        if terminals
            .iter()
            .any(|terminal| terminal["running"] != false)
        {
            return Err("a fixture Terminal survived shutdown".into());
        }
        Ok(())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
        // A panic must not leave this fixture's programs behind either.
        let daemon = Arc::clone(&self.daemon);
        tokio::spawn(async move {
            let _ = daemon.stop_terminals().await;
        });
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
    let observation = async {
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
    }
    .await;
    let cleanup = fixture.finish().await;
    cleanup.unwrap();
    observation.unwrap();
}
