use std::collections::BTreeMap;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rpc::{Client, OutputFrame};
use serde_json::{Value, json};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tokio::process::{Child, Command};
use tokio::sync::broadcast;

const READY_WITHIN: Duration = Duration::from_secs(10);
const SETTLE: Duration = Duration::from_millis(500);
const WARMUP: usize = 100;
const TERMINALS: usize = 10;
const TREE_SIZES: [usize; 2] = [10, 40];

/// H15's tool-use loop: 100 tool uses, each running `rup signal` for `PreToolUse` and again for
/// `PostToolUse`, since `STATE_EVENTS` keeps both.
const HOOK_LOOP_CALLS: usize = 200;

/// Metrics of one Daemon, by name.
pub type Sample = BTreeMap<String, f64>;

fn ms(elapsed: Duration) -> f64 {
    elapsed.as_secs_f64() * 1000.0
}

/// Nearest-rank percentile, `p` in 0..=1.
fn percentile(mut values: Vec<f64>, p: f64) -> f64 {
    values.sort_by(f64::total_cmp);

    values[((p * values.len() as f64).ceil() as usize).max(1) - 1]
}

fn resident_mb(system: &mut System, pid: u32) -> io::Result<f64> {
    let pid = Pid::from_u32(pid);

    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);

    system
        .process(pid)
        .map(|process| process.memory() as f64 / 1_048_576.0)
        .ok_or_else(|| io::Error::other("rupd is gone"))
}

fn call_failed(method: &str, err: impl std::fmt::Display) -> io::Error {
    io::Error::other(format!("{method}: {err}"))
}

async fn ask(client: &Client, method: &str, params: Value) -> io::Result<Value> {
    client
        .request(method, params)
        .await
        .map_err(|err| call_failed(method, err))
}

async fn latencies(
    client: &Client,
    method: &str,
    params: Value,
    calls: usize,
) -> io::Result<Vec<f64>> {
    for _ in 0..WARMUP {
        ask(client, method, params.clone()).await?;
    }

    let mut taken = Vec::with_capacity(calls);

    for _ in 0..calls {
        let started = Instant::now();

        ask(client, method, params.clone()).await?;
        taken.push(ms(started.elapsed()));
    }

    Ok(taken)
}

async fn wait_for_output(
    output: &mut broadcast::Receiver<OutputFrame>,
    terminal: &str,
) -> io::Result<Instant> {
    loop {
        match output.recv().await {
            Ok(OutputFrame::Bytes(bytes)) if bytes.id == terminal => return Ok(Instant::now()),
            Ok(_) => {}
            Err(err) => return Err(io::Error::other(format!("the output connection: {err}"))),
        }
    }
}

/// Select Terminal `terminal` on `events` once its program printed `ready`, and return with everything
/// printed so far delivered, so the next frame is a byte the measurement caused.
async fn select_when_ready(
    client: &Client,
    events: &Client,
    output: &mut broadcast::Receiver<OutputFrame>,
    terminal: &str,
) -> io::Result<()> {
    let started = ask(events, "terminal.output", json!({ "id": terminal })).await?;
    let mut seen = started["offset"]
        .as_u64()
        .ok_or_else(|| io::Error::other("terminal.output returned no offset"))?;
    let printed = loop {
        let screen = ask(client, "terminal.screen", json!({ "id": terminal })).await?;

        if screen["lines"]
            .as_array()
            .is_some_and(|lines| lines.iter().any(|line| line == "ready"))
        {
            break screen["offset"]
                .as_u64()
                .ok_or_else(|| io::Error::other("terminal.screen returned no offset"))?;
        }

        tokio::time::sleep(Duration::from_millis(1)).await;
    };

    while seen < printed {
        match output.recv().await {
            Ok(OutputFrame::Bytes(bytes)) if bytes.id == terminal => {
                seen = bytes.offset
                    + STANDARD
                        .decode(&bytes.data)
                        .map_err(|err| io::Error::other(format!("terminal.output: {err}")))?
                        .len() as u64;
            }
            Ok(_) => {}
            Err(err) => return Err(io::Error::other(format!("the output connection: {err}"))),
        }
    }

    Ok(())
}

/// R15: each write's own call time, sending the next only after `echo` has seen the last come back,
/// so the Terminal never holds more than one unread write (it refuses past 16).
pub async fn paced_writes(
    mut write: impl AsyncFnMut() -> io::Result<()>,
    mut echo: impl AsyncFnMut() -> io::Result<()>,
    calls: usize,
) -> io::Result<Vec<f64>> {
    let mut taken = Vec::with_capacity(WARMUP + calls);

    for _ in 0..WARMUP + calls {
        let started = Instant::now();

        write().await?;
        taken.push(ms(started.elapsed()));
        echo().await?;
    }

    taken.drain(..WARMUP);

    Ok(taken)
}

/// From the write call to the `terminal.output` frame it causes; the program is `cat` on a raw tty with echo off, so a byte only comes back if `cat` read and rewrote it.
async fn write_to_output(
    writer: &Client,
    events: &mut broadcast::Receiver<OutputFrame>,
    terminal: &str,
    calls: usize,
) -> io::Result<Vec<f64>> {
    let params = json!({ "id": terminal, "data": "YQ==" });
    let mut taken = Vec::with_capacity(calls);

    for turn in 0..WARMUP + calls {
        let started = Instant::now();
        let (reply, seen) = tokio::join!(
            ask(writer, "terminal.write", params.clone()),
            wait_for_output(events, terminal)
        );

        reply?;

        if turn >= WARMUP {
            taken.push(ms(seen?.duration_since(started)));
        }
    }

    Ok(taken)
}

async fn first_ping(socket: &Path, child: &mut Child) -> io::Result<()> {
    let give_up = Instant::now() + READY_WITHIN;

    loop {
        if let Some(status) = child.try_wait()? {
            return Err(io::Error::other(format!(
                "rupd exited before it answered: {status}"
            )));
        }

        if let Ok(client) = Client::connect(socket).await
            && client.request("daemon.ping", Value::Null).await.is_ok()
        {
            return Ok(());
        }

        if Instant::now() > give_up {
            return Err(io::Error::other("rupd did not answer daemon.ping in time"));
        }

        tokio::time::sleep(Duration::from_millis(1)).await;
    }
}

/// H15: run the built `rup signal` `calls` times, one after another (Claude Code answers one hook at
/// a time, spike finding 8), and return the wall time. A call that exits non-zero fails the metric:
/// a `rup signal` that always fails would otherwise report a fast, passing loop.
pub async fn hook_calls(
    rup: &Path,
    socket: &Path,
    id: &str,
    attempt: &str,
    payloads: &[&Path],
    calls: usize,
) -> io::Result<Duration> {
    let started = Instant::now();

    for call in 0..calls {
        let payload = payloads[call % payloads.len()];
        let status = Command::new(rup)
            .args(["signal", id])
            .env("ROUNDUP_ATTEMPT", attempt)
            .env("RUPD_SOCKET", socket)
            .stdin(std::fs::File::open(payload)?)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map_err(|err| io::Error::other(format!("{}: {err}", rup.display())))?;

        if !status.success() {
            return Err(io::Error::other(format!("rup signal exited {status}")));
        }
    }

    Ok(started.elapsed())
}

/// H15: the cost of a 100-tool-use loop's hook processes against a fresh Daemon, as the wall time
/// of `HOOK_LOOP_CALLS` `rup signal` runs. A Daemon and Agent of its own, so this metric shares no
/// state with `one_run`'s.
async fn hook_loop_ms(rupd: &Path, rup: &Path) -> io::Result<f64> {
    let dir = tempfile::tempdir()?;
    let project = dir.path().join("project");
    std::fs::create_dir(&project)?;
    let socket = dir.path().join("rupd.sock");
    let claude = dir.path().join("fake-claude.sh");
    std::fs::write(
        &claude,
        "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nsleep 300\n",
    )?;
    std::fs::set_permissions(&claude, std::fs::Permissions::from_mode(0o755))?;
    let pre = dir.path().join("pre-tool-use.json");
    std::fs::write(&pre, r#"{"hook_event_name":"PreToolUse"}"#)?;
    let post = dir.path().join("post-tool-use.json");
    std::fs::write(&post, r#"{"hook_event_name":"PostToolUse"}"#)?;

    let mut child = Command::new(rupd)
        .arg(&project)
        .env("RUPD_SOCKET", &socket)
        .env(
            "ROUNDUP_DATA_DIR",
            std::path::absolute(dir.path().join("data"))?,
        )
        .env("CLAUDE_CONFIG_DIR", dir.path().join("claude-config"))
        .env("ROUNDUP_RUP_BIN", rup)
        .env("ROUNDUP_CLAUDE_BIN", &claude)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| io::Error::other(format!("{}: {err}", rupd.display())))?;

    let result = async {
        first_ping(&socket, &mut child).await?;

        let client = Client::connect(&socket).await?;
        let agent = ask(
            &client,
            "agent.spawn",
            json!({ "cwd": project.to_string_lossy(), "prompt": null, "parent": null }),
        )
        .await?;
        let id = agent["id"]
            .as_str()
            .ok_or_else(|| io::Error::other("agent.spawn returned no id"))?;

        let elapsed = hook_calls(
            rup,
            &socket,
            id,
            agent["attempt"]
                .as_str()
                .ok_or_else(|| io::Error::other("agent.spawn returned no Attempt"))?,
            &[&pre, &post],
            HOOK_LOOP_CALLS,
        )
        .await;
        ask(&client, "rail.remove", json!({ "id": id })).await?;

        Ok(ms(elapsed?))
    }
    .await;
    crate::launch::finish(dir, &mut child, false, result).await
}

/// One fresh Daemon on an empty Project: cold start, memory with ten login-shell Terminals, and call latencies with 10 and 40 Workstreams on the Rail.
pub async fn one_run(rupd: &Path, rup: &Path, calls: usize) -> io::Result<Sample> {
    if calls == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "calls must be positive",
        ));
    }
    let dir = tempfile::tempdir()?;
    let project = dir.path().join("project");
    std::fs::create_dir(&project)?;
    let socket = dir.path().join("rupd.sock");
    let cwd = project.to_string_lossy().into_owned();
    let mut sample = Sample::new();

    // Each sample uses empty storage so no earlier run supplies plugin files.
    let plugins = tempfile::tempdir()?;
    let started = Instant::now();
    let bundle =
        agents::claude_code::plugins::materialize(plugins.path()).map_err(io::Error::other)?;
    let elapsed = started.elapsed();
    bundle.validate().map_err(io::Error::other)?;
    sample.insert("cold_plugin_materialization_ms".into(), ms(elapsed));

    let started = Instant::now();
    let mut child = Command::new(rupd)
        .arg(&project)
        .env("RUPD_SOCKET", &socket)
        .env(
            "ROUNDUP_DATA_DIR",
            std::path::absolute(dir.path().join("data"))?,
        )
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| io::Error::other(format!("{}: {err}", rupd.display())))?;

    let result = async {
    first_ping(&socket, &mut child).await?;
    sample.insert("cold_start_ms".into(), ms(started.elapsed()));

    let pid = child
        .id()
        .ok_or_else(|| io::Error::other("rupd has no pid"))?;
    let mut system = System::new();
    let client = Client::connect(&socket).await?;

    tokio::time::sleep(SETTLE).await;

    let idle = resident_mb(&mut system, pid)?;

    for _ in 0..TERMINALS {
        ask(
            &client,
            "terminal.spawn",
            json!({ "cwd": cwd, "command": null, "env": {}, "cols": 80, "rows": 24 }),
        )
        .await?;
    }

    tokio::time::sleep(SETTLE).await;
    sample.insert("rss_extra_mb".into(), resident_mb(&mut system, pid)? - idle);

    let mut nodes = 0;

    for size in TREE_SIZES {
        for index in nodes..size {
            ask(
                &client,
                "rail.createWorkstream",
                json!({ "name": format!("g{index}"), "parent": null }),
            )
            .await?;
        }

        nodes = size;
        sample.insert(
            format!("rail_tree_{size}_p95_ms"),
            percentile(
                latencies(&client, "rail.tree", Value::Null, calls).await?,
                0.95,
            ),
        );
    }

    sample.insert(
        "ping_p95_ms".into(),
        percentile(
            latencies(&client, "daemon.ping", Value::Null, calls).await?,
            0.95,
        ),
    );

    // The Terminal's first output is `ready`, printed once `stty` has made the tty raw: before that a write is line-edited, and more than a line of them is refused.
    let mut selected = Client::connect(&socket).await?;
    let mut events = selected
        .take_output()
        .ok_or_else(|| io::Error::other("the output connection was already taken"))?;

    let echo = ask(
        &client,
        "terminal.spawn",
        json!({ "cwd": cwd, "command": ["/bin/sh", "-c", "stty raw -echo; echo ready; exec cat"], "env": {}, "cols": 80, "rows": 24 }),
    )
    .await?;
    let terminal = echo["id"]
        .as_str()
        .ok_or_else(|| io::Error::other("terminal.spawn returned no id"))?;

    select_when_ready(&client, &selected, &mut events, terminal).await?;

    sample.insert(
        "write_to_output_p95_ms".into(),
        percentile(
            write_to_output(&client, &mut events, terminal, calls).await?,
            0.95,
        ),
    );

    // Each write waits for its echo before the next (R15): unpaced, a busy machine leaves 16 unread and the Terminal refuses.
    let params = json!({ "id": terminal, "data": "YQ==" });

    sample.insert(
        "terminal_write_p95_ms".into(),
        percentile(
            paced_writes(
                async || {
                    ask(&client, "terminal.write", params.clone())
                        .await
                        .map(drop)
                },
                async || wait_for_output(&mut events, terminal).await.map(drop),
                calls,
            )
            .await?,
            0.95,
        ),
    );

    sample.insert("hook_loop_ms".into(), hook_loop_ms(rupd, rup).await?);

    Ok(sample)
    }.await;
    crate::launch::finish(dir, &mut child, false, result).await
}

/// X14's bounded, isolated real-Daemon observation.
pub mod flood {
    use contracts::{Actor, ActorKind};
    use rpc::{Client, OutputFrame};
    use serde::{Deserialize, Serialize};
    use serde_json::{Value, json};
    use std::{collections::BTreeMap, sync::Arc, sync::Mutex, time::Duration};
    use tokio::{
        net::UnixListener,
        sync::broadcast::error::{RecvError, TryRecvError},
        time::timeout,
    };

    type Error = Box<dyn std::error::Error + Send + Sync>;

    /// Retained evidence, including partial collection and cleanup failures.
    #[derive(Debug, Default, Serialize, Deserialize)]
    pub struct Observation {
        pub capacity: usize,
        pub chunks: BTreeMap<String, usize>,
        pub markers_emitted: Vec<String>,
        pub markers_received: Vec<String>,
        /// Gaps the Terminals' own output streams reported to their subscribers (not Rail lag).
        pub output_gaps: usize,
        /// Frames the observer's own bounded intake dropped before it counted them.
        pub intake_lagged: u64,
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
        let result = timeout(bound, async {
            let dir = tempfile::tempdir()?;
            let project = dir.path().join("project");
            std::fs::create_dir(&project)?;
            let owner = Arc::new(rupd::Daemon::open_project(
                &project,
                &dir.path().join("data"),
            )?);
            daemon = Some(Arc::clone(&owner));
            let socket = dir.path().join("daemon.sock");
            let listener = UnixListener::bind(&socket)?;
            directory = Some(dir);
            server = Some(tokio::spawn(rupd::serve(listener, Arc::clone(&owner))));
            let client = Client::connect(&socket).await?;
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
            // One connection per Terminal: its selected output drains independently of the others.
            let counted = Arc::new(Mutex::new(BTreeMap::<String, (usize, usize, u64)>::new()));
            let mut collectors = tokio::task::JoinSet::new();
            for id in report.chunks.keys() {
                let mut selected = Client::connect(&socket).await?;
                let mut frames = selected.take_output().ok_or("output already taken")?;
                call(&selected, "terminal.output", json!({"id":id})).await?;
                counted
                    .lock()
                    .expect("counters")
                    .insert(id.clone(), (0, 0, 0));
                let (id, counted) = (id.clone(), Arc::clone(&counted));
                collectors.spawn(async move {
                    // Keeps the connection, and so the selection, until the collector is dropped.
                    let _selected = selected;
                    loop {
                        let frame = frames.recv().await;
                        let mut counters = counted.lock().expect("counters");
                        let (chunks, gaps, lagged) =
                            counters.get_mut(&id).expect("counted Terminal");
                        match frame {
                            Ok(OutputFrame::Bytes(bytes)) if bytes.id == id => *chunks += 1,
                            Ok(OutputFrame::Bytes(_)) => {}
                            Ok(OutputFrame::Gap(_)) => *gaps += 1,
                            Err(RecvError::Lagged(n)) => *lagged += n,
                            Err(RecvError::Closed) => return,
                        }
                    }
                });
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
            loop {
                {
                    let counters = counted.lock().expect("counters");
                    for (id, (chunks, _, _)) in counters.iter() {
                        report.chunks.insert(id.clone(), *chunks);
                    }
                    report.output_gaps = counters.values().map(|c| c.1).sum();
                    report.intake_lagged = counters.values().map(|c| c.2).sum();
                }
                if report.chunks.values().all(|n| *n > capacity) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            // Quiesce producers so resuming has a finite, exact observation boundary.
            owner.stop_terminals().await?;
            stopped(&client, &report.chunks).await?;
            collectors.abort_all();
            loop {
                match receiver.try_recv() {
                    Ok(event) => match event.data {
                        contracts::EventData::RailChanged
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
}
