//! X14's bounded, isolated real-Daemon observation. Output transport migration belongs to #1930.
use contracts::{Actor, ActorKind, EventData};
use rpc::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::{net::UnixListener, sync::broadcast::error::TryRecvError, time::timeout};

type Error = Box<dyn std::error::Error + Send + Sync>;

/// Retained evidence, including partial collection and cleanup failures.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Observation {
    pub capacity: usize,
    pub chunks: BTreeMap<String, usize>,
    pub markers_emitted: Vec<String>,
    pub markers_received: Vec<String>,
    pub payloads: usize,
    pub lagged: u64,
    pub lag_errors: usize,
    pub cleaned_up: bool,
    pub stopped: usize,
    pub error: Option<String>,
}

impl Observation {
    /// Acceptance requires complete counters, markers, isolation, and successful shutdown.
    pub fn passed(&self) -> bool {
        self.error.is_none()
            && self.cleaned_up
            && self.stopped == 10
            && self.capacity > 2
            && self.chunks.len() == 10
            && self.chunks.values().all(|n| *n > self.capacity)
            && self.markers_emitted.len() == 2
            && self.markers_emitted == self.markers_received
            && self.payloads == 0
            && self.lagged == 0
            && self.lag_errors == 0
    }
}

async fn call(client: &Client, method: &str, params: Value) -> Result<Value, Error> {
    Ok(timeout(Duration::from_secs(10), client.request(method, params)).await??)
}

async fn stopped(client: &Client, chunks: &BTreeMap<String, usize>) -> Result<usize, Error> {
    timeout(Duration::from_secs(10), async {
        loop {
            let list = call(client, "terminal.list", Value::Null).await?;
            let list = list.as_array().ok_or("missing shutdown Terminal list")?;
            let mut done = 0;
            for id in chunks.keys() {
                let terminal = list
                    .iter()
                    .find(|t| t["id"] == *id)
                    .ok_or("missing shutdown Terminal")?;
                if terminal["running"] == false {
                    done += 1;
                }
            }
            if done == chunks.len() && list.iter().all(|t| t["running"] == false) {
                return Ok(done);
            }
            // Terminal's reader publishes its final bytes before marking the entry exited.
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await?
}

/// Uses only temporary Project/data/socket resources. The bound covers startup and collection;
/// shutdown has its own ten-second bound and runs even after collection failure.
pub async fn observe(bound: Duration) -> Observation {
    let mut report = Observation::default();
    let mut daemon = None;
    let mut server = None;
    let mut directory = None;
    let result =
        timeout(bound, async {
            let dir = tempfile::tempdir()?;
            let project = dir.path().join("project");
            std::fs::create_dir(&project)?;
            let owner = Arc::new(rupd::Daemon::open_project(
                &project,
                &dir.path().join("data"),
                None,
            )?);
            daemon = Some(Arc::clone(&owner));
            let socket = dir.path().join("daemon.sock");
            let listener = UnixListener::bind(&socket)?;
            directory = Some(dir);
            server = Some(tokio::spawn(rupd::serve(listener, Arc::clone(&owner))));
            let client = Client::connect(&socket).await?;
            let mut output = Client::connect(&socket).await?;
            call(&output, "events.subscribe", Value::Null).await?;
            let rail = call(&client, "rail.createWorkstream", json!({"name":"flood"})).await?;
            for _ in 0..10 {
                let terminal = call(&client, "terminal.spawn", json!({
                "cwd":project, "command":["/bin/sh","-c","stty -echo; read -r start; exec yes"],
                "env":{},"cols":80,"rows":24
            })).await?;
                let id = terminal["id"]
                    .as_str()
                    .ok_or("missing Terminal id")?
                    .to_owned();
                report.chunks.insert(id, 0);
            }
            let (mut receiver, capacity) = owner.subscribe();
            report.capacity = capacity;
            if capacity <= 2 {
                return Err::<(), Error>("two Rail markers must be below Bus capacity".into());
            }
            for identity in ["flood-paused-0", "flood-paused-1"] {
                call(
                    &client,
                    "daemon.identify",
                    json!({"actor":Actor{kind:ActorKind::User,id:identity.into(),parent:None}}),
                )
                .await?;
                call(
                    &client,
                    "rail.rename",
                    json!({"id":rail["id"],"name":identity}),
                )
                .await?;
                report.markers_emitted.push(identity.into());
            }
            // RPC's reader drains independently while the actual Rail receiver remains unread.
            for id in report.chunks.keys() {
                call(&client, "terminal.write", json!({"id":id,"data":"Z28K"})).await?;
            }
            while report.chunks.values().any(|n| *n <= capacity) {
                let event = output
                    .next_event()
                    .await
                    .ok_or("output receiver closed before counters completed")?;
                if let EventData::TerminalOutput(payload) = event.data {
                    let count = report
                        .chunks
                        .get_mut(&payload.id)
                        .ok_or("unexpected Terminal output")?;
                    *count += 1;
                }
            }
            // Quiesce producers so resuming has a finite, exact observation boundary.
            owner.stop_terminals().await?;
            stopped(&client, &report.chunks).await?;
            loop {
                match receiver.try_recv() {
                    Ok(event) => match event.data {
                        EventData::TerminalOutput(_) => report.payloads += 1,
                        EventData::RailChanged
                            if report.markers_emitted.contains(&event.actor.id) =>
                        {
                            report.markers_received.push(event.actor.id)
                        }
                        _ => {}
                    },
                    Err(TryRecvError::Lagged(n)) => {
                        report.lagged += n;
                        report.lag_errors += 1;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Closed) => return Err("Rail receiver closed".into()),
                }
            }
            Ok(())
        })
        .await;
    report.error = match result {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error.to_string()),
        Err(_) => Some("flood observation timed out before complete collection".into()),
    };
    if let Some(owner) = daemon {
        match timeout(Duration::from_secs(10), owner.stop_terminals()).await {
            Ok(Ok(())) => {
                let verify = timeout(Duration::from_secs(10), async {
                    let dir = directory.as_ref().ok_or("missing fixture directory")?;
                    let client = Client::connect(&dir.path().join("daemon.sock")).await?;
                    stopped(&client, &report.chunks).await
                })
                .await;
                match verify {
                    Ok(Ok(stopped)) => {
                        report.stopped = stopped;
                        report.cleaned_up = true;
                    }
                    other => {
                        report.error = Some(format!(
                            "{:?}; shutdown verification failed: {other:?}",
                            report.error
                        ))
                    }
                }
            }
            result => {
                report.error = Some(format!("{:?}; cleanup failed: {result:?}", report.error))
            }
        }
    } else {
        report.cleaned_up = true;
    }
    if let Some(task) = server {
        task.abort();
        let _ = task.await;
    }
    if !report.cleaned_up {
        if let Some(dir) = directory {
            let path = dir.keep();
            report.error = Some(format!(
                "{:?}; retained fixture data at {}",
                report.error,
                path.display()
            ));
        }
    } else {
        drop(directory);
    }
    report
}
