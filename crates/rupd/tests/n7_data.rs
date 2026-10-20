//! N7: real test launches own data and leave seeded App data untouched.
use std::path::{Path, PathBuf};
use std::process::Stdio;

#[path = "support/rupd_harness.rs"]
mod rupd_harness;

#[path = "support/n7_data.rs"]
mod n7_data;
use n7_data::{assert_exited, isolated};

#[test]
fn n7_launch_sites_use_owned_data() {
    if isolated("n7_launch_sites_use_owned_data") {
        return;
    }
    let project = tempfile::tempdir().unwrap();
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        false,
        |command| {
            command.stderr(Stdio::null());
        },
    );
    let data = daemon.data.as_ref().unwrap().path().to_owned();
    assert!(data.is_absolute());
    assert!(!data.starts_with(project.path()));
    assert!(data.join("projects").is_dir());
    drop(daemon);
}

#[test]
fn n7_launch_sites_clean_on_success_and_failure() {
    if isolated("n7_launch_sites_clean_on_success_and_failure") {
        return;
    }
    let project = tempfile::tempdir().unwrap();
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        false,
        |_| {},
    );
    let data = daemon.data.as_ref().unwrap().path().to_owned();
    let pid = daemon.child.id();
    drop(daemon);
    assert_exited(pid);
    assert!(!data.exists());

    // An exec wrapper records the real Daemon's inherited data and PID before startup fails.
    use std::os::unix::fs::PermissionsExt;
    let wrapper = project.path().join("launch");
    std::fs::write(&wrapper, "#!/bin/sh\nprintf '%s\n%s\n' \"$ROUNDUP_DATA_DIR\" \"$$\" > \"$N7_RECORD\"\nexec \"$N7_RUPD\" \"$@\"\n").unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
    let record = project.path().join("record");
    let failure = std::panic::catch_unwind(|| {
        rupd_harness::start(&wrapper, project.path(), false, |command| {
            command
                .env("N7_RECORD", &record)
                .env("N7_RUPD", env!("CARGO_BIN_EXE_rupd"))
                .env("RUPD_SOCKET", project.path().join("launch/rupd.sock"));
        });
    });
    assert!(failure.is_err());
    let record = std::fs::read_to_string(record).unwrap();
    let mut lines = record.lines();
    let data = PathBuf::from(lines.next().unwrap());
    assert!(data.is_absolute());
    assert!(!data.exists());
    assert_exited(lines.next().unwrap().parse().unwrap());
}

#[test]
fn n7_caller_owned_data_survives_restart_and_failed_start() {
    if isolated("n7_caller_owned_data_survives_restart_and_failed_start") {
        return;
    }
    let project = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    let start = || {
        rupd_harness::start(
            Path::new(env!("CARGO_BIN_EXE_rupd")),
            project.path(),
            false,
            |command| {
                command.env("ROUNDUP_DATA_DIR", data.path());
            },
        )
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let daemon = start();
    let todo = runtime.block_on(async {
        let client = rpc::Client::connect(&daemon.socket).await.unwrap();
        client
            .request(
                "todo.create",
                serde_json::json!({"title":"kept across restart"}),
            )
            .await
            .unwrap()
    });
    drop(daemon);
    std::fs::write(data.path().join("keep"), b"caller-owned bytes").unwrap();
    let daemon = start();
    let reopened = runtime.block_on(async {
        let client = rpc::Client::connect(&daemon.socket).await.unwrap();
        client
            .request("todo.get", serde_json::json!({"id":todo["id"]}))
            .await
            .unwrap()
    });
    assert_eq!(reopened["title"], "kept across restart");
    drop(daemon);
    assert!(
        std::panic::catch_unwind(|| {
            rupd_harness::start(
                Path::new(env!("CARGO_BIN_EXE_rupd")),
                project.path(),
                false,
                |command| {
                    command
                        .env("ROUNDUP_DATA_DIR", data.path())
                        .env("RUPD_SOCKET", data.path().join("keep/rupd.sock"));
                },
            );
        })
        .is_err()
    );
    assert_eq!(
        std::fs::read(data.path().join("keep")).unwrap(),
        b"caller-owned bytes"
    );
}

// X14 observes an isolated in-process Daemon and owns its Terminal cleanup.
mod x14_daemon_observer {

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
            // A same-name rename emits only RailChanged, keeping one marker per Bus slot.
            self.call("rail.rename", json!({"id": self.rail, "name": "observer"}))
                .await?;
            Ok(())
        }

        async fn finish(&self) -> Result<(), Error> {
            let (mut exits, _) = self.daemon.subscribe();
            timeout(BOUND, async {
                self.daemon.stop_terminals().await?;
                loop {
                    let terminals = self.call("terminal.list", Value::Null).await?;
                    let terminals = terminals.as_array().ok_or("Terminal list is an array")?;
                    let mut stopped = true;
                    for id in &self.terminals {
                        let terminal = terminals
                            .iter()
                            .find(|terminal| terminal["id"] == *id)
                            .ok_or("fixture Terminal missing from shutdown observation")?;
                        stopped &= terminal["running"] == false;
                    }
                    if stopped {
                        return Ok::<(), Error>(());
                    }
                    // Reaping precedes the pump's exit record. Subscribe before stopping so
                    // that record cannot fall between the list and this wait.
                    match exits.recv().await {
                        Ok(_) | Err(RecvError::Lagged(_)) => {}
                        Err(RecvError::Closed) => return Err("shutdown observation closed".into()),
                    }
                }
            })
            .await
            .map_err(|error| {
                format!(
                    "fixture Terminal exit metadata was not confirmed for {:?}: {error}",
                    self.terminals
                )
            })?
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

    impl Fixture {
        /// A connection that selects Terminal output, and its bounded receiver.
        async fn output_client(
            &self,
        ) -> Result<(Client, tokio::sync::broadcast::Receiver<rpc::OutputFrame>), Error> {
            let mut client =
                timeout(BOUND, Client::connect(&self.dir.path().join("daemon.sock"))).await??;
            let output = client.take_output().ok_or("output taken once")?;
            Ok((client, output))
        }

        /// Spawn a Terminal, select its output on `output`, then let its program start.
        async fn terminal(&mut self, output: &Client) -> Result<String, Error> {
            let terminal = self.call("terminal.spawn", json!({
            "cwd": self.dir.path().join("project"),
            "command": ["/bin/sh", "-c", "stty -echo; read -r start; printf 'observer-ready\\n'; while IFS= read -r line; do printf 'payload:%s\\n' \"$line\"; done"],
            "env": {}, "cols": 80, "rows": 24,
        })).await?;
            let id = terminal["id"]
                .as_str()
                .ok_or("Terminal id is a string")?
                .to_owned();
            self.terminals.push(id.clone());
            timeout(BOUND, output.request("terminal.output", json!({"id": id}))).await??;
            self.write(&id, "go\n").await?;
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

    async fn output_payload(
        client: &mut tokio::sync::broadcast::Receiver<rpc::OutputFrame>,
        id: &str,
        expected: &str,
    ) -> Result<usize, Error> {
        use base64::Engine as _;
        timeout(BOUND, async {
            let mut bytes = Vec::new();
            let mut chunks = 0;
            loop {
                if let rpc::OutputFrame::Bytes(output) = client.recv().await? {
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

    #[tokio::test]
    async fn x14_daemon_observer_leaves_the_bus_unlagged_by_output() {
        let mut fixture = Fixture::open().await.unwrap();
        let observation = timeout(OBSERVATION_BOUND, async {
            let (selected, mut output) = fixture.output_client().await?;
            let (mut receiver, capacity) = fixture.daemon.subscribe();
            if capacity <= 2 {
                return Err::<(), Error>("Rail markers must fit below capacity".into());
            }
            let mut ids = Vec::new();
            for _ in 0..2 {
                let id = fixture.terminal(&selected).await?;
                output_payload(&mut output, &id, "observer-ready\r\n").await?;
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
            // The unread receiver holds the paused marker and no Terminal payload: it did not lag.
            rail_marker(timeout(BOUND, receiver.recv()).await??, "paused-output")?;
            fixture.marker("after-output").await?;
            rail_marker(timeout(BOUND, receiver.recv()).await??, "after-output")?;
            if let Ok(extra) = receiver.try_recv() {
                return Err(format!("unexpected Bus event {extra:?}").into());
            }
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
            let (selected, mut output) = fixture.output_client().await?;
            for _ in 0..2 {
                let id = fixture.terminal(&selected).await?;
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
}
