//! Owns native commands and the monotonic acquisition clock. No sudo or browser attach.
use contracts::{
    agent::{NodeKind, RailNode},
    common::Kind,
    terminal::{Read, Snapshot},
};
use perf::idle::{self, Interval, Journal, Member, Phase, Settings};
use rpc::Client;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    io::{self, Write},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};

fn failure(e: impl ToString) -> io::Error {
    io::Error::other(e.to_string())
}
pub(super) struct Native {
    root: PathBuf,
    clock: Instant,
    command: usize,
    pub provenance: BTreeMap<String, String>,
    settings: Option<Settings>,
    first_receipt: Option<f64>,
    helpers: BTreeMap<u32, u64>,
}
#[derive(Deserialize)]
struct Host {
    display_power: String,
    release: String,
    accounting_verified: String,
    cursor_enabled: bool,
}
impl Native {
    pub fn new(root: &Path) -> io::Result<Self> {
        Ok(Self {
            root: std::path::absolute(root)?,
            clock: Instant::now(),
            command: 0,
            provenance: BTreeMap::new(),
            settings: None,
            first_receipt: None,
            helpers: BTreeMap::new(),
        })
    }
    fn now(&self) -> f64 {
        self.clock.elapsed().as_secs_f64()
    }
    /// Every command retains its exact argv, start/end, exit status and stdout/stderr,
    /// including a failed spawn. Top's long-lived streaming acquisition is below.
    async fn command(&mut self, program: &str, args: &[String]) -> io::Result<String> {
        self.command += 1;
        let prefix = self.root.join(format!("command-{:04}", self.command));
        let begin = self.now();
        let result = tokio::time::timeout(
            Duration::from_secs(30),
            Command::new(program)
                .args(args)
                .env("LC_ALL", "C")
                .kill_on_drop(true)
                .output(),
        )
        .await;
        let (status, termination, stdout, stderr) = match result {
            Ok(Ok(out)) => (
                out.status.code(),
                format!("{:?}", out.status),
                out.stdout,
                out.stderr,
            ),
            Ok(Err(e)) => (
                None,
                "spawn failed".into(),
                vec![],
                e.to_string().into_bytes(),
            ),
            Err(e) => (
                None,
                "command deadline".into(),
                vec![],
                format!("command deadline: {e}").into_bytes(),
            ),
        };
        std::fs::write(prefix.with_extension("stdout"), &stdout)?;
        std::fs::write(prefix.with_extension("stderr"), &stderr)?;
        std::fs::write(
            prefix.with_extension("json"),
            serde_json::to_vec_pretty(
                &json!({ "argv":[program,args.join(" ").as_str()], "args":args, "start_s":begin, "end_s":self.now(), "status":status, "termination":termination }),
            )?,
        )?;
        if status != Some(0) {
            return Err(failure(format!(
                "{program} {args:?}: status {status:?}; {}; raw {}",
                String::from_utf8_lossy(&stderr),
                prefix.display()
            )));
        }
        String::from_utf8(stdout).map_err(failure)
    }
    pub async fn prepare(&mut self, app: &Path, host: &Path) -> io::Result<()> {
        self.provenance
            .insert("evidence".into(), self.root.display().to_string());
        self.provenance.insert("clock_correlation".into(), "observer monotonic seconds; producer origin bounded by launch and first start receipt; renderer origin no earlier than launch; ambiguous overlaps refused".into());
        let host_raw = std::fs::read(host)
            .map_err(|e| failure(format!("host input {}: {e}", host.display())))?;
        std::fs::write(self.root.join("host.json"), &host_raw)?;
        let host: Host = serde_json::from_slice(&host_raw).map_err(failure)?;
        if host.display_power.trim().is_empty()
            || host.release.trim().is_empty()
            || host.accounting_verified.trim().is_empty()
            || !host.cursor_enabled
        {
            return Err(failure(
                "host input needs display/power, release settings, verified tool accounting and ordinary enabled cursor",
            ));
        }
        self.provenance
            .insert("display_power".into(), host.display_power.clone());
        self.provenance
            .insert("release".into(), host.release.clone());
        let commit = self
            .command("git", &["rev-parse".into(), "HEAD".into()])
            .await?;
        self.provenance
            .insert("commit".into(), commit.trim().into());
        // Refuse mislabeled release builds; C9 implementation must be present before calibration.
        let manifest = std::fs::read_to_string("Cargo.toml")?;
        if !manifest.contains("[profile.release]") {
            return Err(failure(
                "release-profile implementation #3807 is not present; #3777 was specification only",
            ));
        }
        let macos = self.command("/usr/bin/sw_vers", &[]).await?;
        self.provenance.insert("macos".into(), macos);
        let hardware = self
            .command(
                "/usr/sbin/system_profiler",
                &[
                    "SPHardwareDataType".into(),
                    "SPDisplaysDataType".into(),
                    "SPPowerDataType".into(),
                ],
            )
            .await?;
        self.provenance.insert("hardware".into(), hardware);
        let power = self
            .command("/usr/bin/pmset", &["-g".into(), "custom".into()])
            .await?;
        std::fs::write(self.root.join("power-settings.txt"), power)?;
        let mut hashes = BTreeMap::new();
        for (name, path) in [
            ("app", app.to_owned()),
            ("rupd", app.with_file_name("rupd")),
            ("rup", app.with_file_name("rup")),
        ] {
            let result = self
                .command(
                    "/usr/bin/shasum",
                    &[
                        "-a".into(),
                        "256".into(),
                        std::path::absolute(path)?.display().to_string(),
                    ],
                )
                .await?;
            let hash = result
                .split_whitespace()
                .next()
                .filter(|h| h.len() == 64)
                .ok_or_else(|| failure("missing executable SHA256"))?;
            hashes.insert(name.into(), hash.into());
        }
        // Local man pages identify the actual host tool contracts; -h commonly exits 1.
        let mut tools = self
            .command(
                "/usr/bin/what",
                &["/usr/bin/top".into(), "/usr/bin/footprint".into()],
            )
            .await?;
        tools.push_str(&host.accounting_verified);
        self.provenance.insert("tools".into(), tools);
        self.provenance.insert("commands".into(), "top -l 0 -s 1 -c d -F -R -stats pid,command,cpu,idlew (-pid PID for each member); footprint -p PID -f bytes after top; python3 libSystem responsibility lookup; sysinfo inventory".into());
        self.settings = Some(Settings {
            hashes,
            release: host.release,
            renderer: String::new(),
            terminal: String::new(),
            project: String::new(),
            width: 0,
            height: 0,
            scale: 0.0,
            physical_width: 0,
            physical_height: 0,
            display_power: host.display_power,
        });
        Ok(())
    }
    fn journal(&mut self, pid: u32, complete: bool) -> io::Result<Journal> {
        let text = std::fs::read_to_string(self.root.join("app-idle.jsonl"))?;
        // Online tail ignores a partial trailing row only until the next read; final parse refuses it.
        let raw = if complete {
            text.as_str()
        } else {
            text.rfind('\n')
                .map(|n| &text[..=n])
                .ok_or_else(|| failure("no complete App evidence row"))?
        };
        let first = *self
            .first_receipt
            .get_or_insert_with(|| self.clock.elapsed().as_secs_f64());
        Journal::parse(raw, first, pid, complete).map_err(failure)
    }
    async fn inventory(&mut self, app: u32, daemon: u32) -> io::Result<Vec<Member>> {
        let mut system = sysinfo::System::new();
        system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        let mut inventory: Vec<_> = system
            .processes()
            .iter()
            .map(|(pid, p)| Member {
                pid: pid.as_u32(),
                started: p.start_time(),
                parent: p.parent().map(|v| v.as_u32()),
                name: p.name().to_string_lossy().into(),
                role: String::new(),
                responsible: None,
            })
            .collect();
        self.helpers = inventory
            .iter()
            .filter(|p| p.name.starts_with("com.apple.WebKit."))
            .map(|p| (p.pid, p.started))
            .collect();
        let pids: Vec<_> = inventory
            .iter()
            .filter(|p| p.name.starts_with("com.apple.WebKit.") || p.pid == app)
            .map(|p| p.pid.to_string())
            .collect();
        // Platform SPI used by Chromium. No FFI/unsafe in the product and no privileged command.
        // A shared responsible ancestor cannot prove this App owns an XPC helper.
        let script = "import ctypes,json,sys\nf=ctypes.CDLL('/usr/lib/libSystem.B.dylib').responsibility_get_pid_responsible_for_pid\nf.argtypes=[ctypes.c_int]; f.restype=ctypes.c_int\nprint(json.dumps({p:f(int(p)) for p in sys.argv[1:]}))";
        let mut args = vec!["-c".into(), script.into()];
        args.extend(pids);
        let owners: BTreeMap<String, i32> =
            serde_json::from_str(&self.command("python3", &args).await?).map_err(failure)?;
        let app_owner = owners
            .get(&app.to_string())
            .copied()
            .ok_or_else(|| failure("unresolved App responsibility"))?;
        for p in &mut inventory {
            p.responsible = owners
                .get(&p.pid.to_string())
                .and_then(|p| u32::try_from(*p).ok())
                .filter(|p| *p != 0);
            if p.name.starts_with("com.apple.WebKit.")
                && app_owner != app as i32
                && p.responsible == u32::try_from(app_owner).ok()
                && p.parent != Some(app)
            {
                p.responsible = None;
            }
        }
        std::fs::write(
            self.root.join(format!("inventory-{}.json", self.command)),
            serde_json::to_vec_pretty(&inventory)?,
        )?;
        idle::membership(&inventory, app, daemon).map_err(failure)
    }
    pub fn start(&mut self) {
        self.clock = Instant::now();
    }
    pub async fn collect(
        &mut self,
        socket: &Path,
        app: u32,
        project: &Path,
        phases: &mut [Phase],
    ) -> io::Result<()> {
        tokio::time::timeout(
            Duration::from_secs(1200),
            self.round(socket, app, project, phases),
        )
        .await
        .map_err(failure)?
    }
    async fn round(
        &mut self,
        socket: &Path,
        app: u32,
        project: &Path,
        phases: &mut [Phase],
    ) -> io::Result<()> {
        let client = tokio::time::timeout(Duration::from_secs(30), async {
            let mut readiness = tokio::time::interval(Duration::from_millis(50));
            readiness.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                readiness.tick().await;
                if let Ok(c) = Client::connect(socket).await {
                    break c;
                }
            }
        })
        .await
        .map_err(failure)?;
        let mut agents = Vec::new();
        for _ in 0..10 {
            let node: RailNode = request(
                &client,
                "agent.spawn",
                json!({"cwd":project,"prompt":null,"parent":null}),
            )
            .await?;
            agents.push(node.id);
        }
        let mut baseline = tokio::time::timeout(Duration::from_secs(30), async {
            let mut readiness = tokio::time::interval(Duration::from_millis(100));
            readiness.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                readiness.tick().await;
                let nodes: Vec<RailNode> = request(&client, "rail.tree", Value::Null).await?;
                if nodes.len() == 10
                    && nodes.iter().all(|n| {
                        n.status.as_ref().is_some_and(|s| s.kind == Kind::Idle)
                            && n.terminal_id.is_some()
                    })
                {
                    break Ok::<_, io::Error>(nodes);
                }
            }
        })
        .await
        .map_err(failure)??;
        let view = tokio::time::timeout(Duration::from_secs(30), async {
            let mut readiness = tokio::time::interval(Duration::from_millis(50));
            readiness.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                readiness.tick().await;
                if let Ok(j) = self.journal(app, false)
                    && let Some(v) = j.latest()
                    && v.terminal.is_some()
                    && v.renderer.is_some()
                {
                    break v.clone();
                }
            }
        })
        .await
        .map_err(failure)?;
        let (physical_width, physical_height, scale) = self
            .journal(app, false)?
            .geometry()
            .ok_or_else(|| failure("missing native scale"))?;
        let settings = self
            .settings
            .as_mut()
            .ok_or_else(|| failure("missing release settings"))?;
        let observed_project = view
            .project
            .as_ref()
            .ok_or_else(|| failure("missing selected Project"))?;
        if std::fs::canonicalize(observed_project)? != std::fs::canonicalize(project)? {
            return Err(failure(
                "selected Project is outside the run-owned workload",
            ));
        }
        settings.project = observed_project.clone();
        settings.terminal = view
            .terminal
            .ok_or_else(|| failure("missing selected Terminal"))?;
        settings.renderer = view.renderer.ok_or_else(|| failure("missing renderer"))?;
        settings.scale = scale;
        settings.physical_width = physical_width;
        settings.physical_height = physical_height;
        settings.width = view.width;
        settings.height = view.height;
        let settings = settings.clone();
        let selected = baseline
            .iter()
            .find(|n| n.terminal_id.as_ref() == Some(&settings.terminal))
            .ok_or_else(|| failure("selected Terminal is not a prepared Agent"))?
            .id
            .clone();
        let daemon = {
            let mut s = sysinfo::System::new();
            s.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            let pids: Vec<_> = s
                .processes()
                .iter()
                .filter(|(_, p)| {
                    p.parent().is_some_and(|p| p.as_u32() == app) && p.name() == "rupd"
                })
                .map(|(pid, _)| pid.as_u32())
                .collect();
            if pids.len() != 1 {
                return Err(failure("missing/ambiguous owned rupd PID"));
            }
            pids[0]
        };
        for phase in phases.iter_mut() {
            if phase.count == 1 && baseline.len() == 10 {
                for id in &agents {
                    if id != &selected {
                        let _: Value = request(&client, "agent.stop", json!({"id":id})).await?;
                        let _: Value = request(&client, "rail.remove", json!({"id":id})).await?;
                    }
                }
                baseline = request(&client, "rail.tree", Value::Null).await?;
                if baseline.len() != 1 || baseline[0].id != selected {
                    return Err(failure("one-Agent Rail does not retain selected Agent"));
                }
            }
            phase.settings = settings.clone();
            phase.errors.clear();
            let result = self
                .phase(&client, socket, app, daemon, &baseline, phase)
                .await;
            if let Err(e) = result {
                phase.errors.push(e.to_string());
            }
            std::fs::write(
                self.root
                    .join(format!("{}-{:?}.json", phase.count, phase.state)),
                serde_json::to_vec_pretty(phase)?,
            )?;
        }
        eprintln!(
            "All samples retained. Unhide roundup, wait five seconds, then quit this run's App normally. This drains renderer delivery and writes checkpoint/end (60 s deadline)."
        );
        let final_journal = tokio::time::timeout(Duration::from_secs(60), async {
            let mut readiness = tokio::time::interval(Duration::from_millis(100));
            readiness.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                readiness.tick().await;
                if let Ok(j) = self.journal(app, true) {
                    break j;
                }
            }
        })
        .await
        .map_err(|e| failure(format!("App final checkpoint/end missing: {e}")))?;
        // Validate again after suspended renderer messages have drained.
        for phase in phases {
            let timing: Timing = serde_json::from_slice(&std::fs::read(
                self.root
                    .join(format!("{}-{:?}-timing.json", phase.count, phase.state)),
            )?)
            .map_err(failure)?;
            if let Err(e) = final_journal.phase(
                phase.state,
                timing.stable_start,
                timing.end,
                &phase.settings,
            ) {
                phase.errors.push(e);
            }
        }
        Ok(())
    }
    async fn phase(
        &mut self,
        client: &Client,
        socket: &Path,
        app: u32,
        daemon: u32,
        baseline: &[RailNode],
        phase: &mut Phase,
    ) -> io::Result<()> {
        eprintln!(
            "{} Agents, {:?}: arrange the native window now (focused Terminal / unfocused but fully visible / native App hide). Do not resize, type, change display or power. Waiting for observed state (60 s deadline).",
            phase.count, phase.state
        );
        tokio::time::timeout(Duration::from_secs(60), async {
            let mut readiness = tokio::time::interval(Duration::from_millis(100));
            readiness.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                readiness.tick().await;
                let now = self.now();
                if let Ok(j) = self.journal(app, false)
                    && j.phase(phase.state, now, now + 0.001, &phase.settings)
                        .is_ok()
                {
                    break;
                }
            }
        })
        .await
        .map_err(|e| {
            failure(format!(
                "invalid/missing observed {:?} state: {e}",
                phase.state
            ))
        })?;
        let stable_start = self.now();
        // This is the specified observation window, not an acknowledgement delay.
        tokio::time::sleep(Duration::from_secs(5)).await;
        phase.settle_s = self.now() - stable_start;
        phase.members = self.inventory(app, daemon).await?;
        phase.absent_roles = ["WebContent", "GPU", "Networking"]
            .into_iter()
            .filter(|role| {
                !phase
                    .members
                    .iter()
                    .any(|p| p.name.starts_with(&format!("com.apple.WebKit.{role}")))
            })
            .map(|role| format!("{role}: absent in retained complete inventory/ownership lookup"))
            .collect();
        let nodes: Vec<RailNode> = request(client, "rail.tree", Value::Null).await?;
        if nodes.iter().any(|n| n.kind != NodeKind::Agent) || nodes.len() != phase.count {
            return Err(failure("wrong Agent count/kind"));
        }
        let mut offsets = BTreeMap::new();
        for node in &nodes {
            let id = node
                .terminal_id
                .as_ref()
                .ok_or_else(|| failure("Agent has no Terminal"))?;
            let snap: Snapshot = request(client, "terminal.snapshot", json!({"id":id})).await?;
            offsets.insert(id.clone(), snap.after);
            std::fs::write(
                self.root.join(format!("setup-{}-{}.json", phase.count, id)),
                serde_json::to_vec_pretty(&snap)?,
            )?;
        }
        let mut events = Client::connect(socket).await?;
        let subscribed: contracts::common::SubscribeResult =
            request(&events, "events.subscribe", Value::Null).await?;
        let statuses: Vec<_> = nodes
            .iter()
            .filter_map(|n| n.status.as_ref().map(|s| s.kind))
            .collect();
        let (intervals, mut changes) = self
            .top(&phase.members, &mut events, subscribed.head, phase)
            .await?;
        phase.intervals = intervals;
        let end = self.now();
        std::fs::write(
            self.root
                .join(format!("{}-{:?}-timing.json", phase.count, phase.state)),
            serde_json::to_vec_pretty(&json!({"stable_start":stable_start,"end":end}))?,
        )?;
        // Traversal is strictly after the last CPU/wake interval.
        for p in &phase.members {
            let raw = self
                .command(
                    "/usr/bin/footprint",
                    &["-p".into(), p.pid.to_string(), "-f".into(), "bytes".into()],
                )
                .await?;
            phase
                .footprint_bytes
                .insert(p.pid, idle::parse_footprint(&raw).map_err(failure)?);
        }
        let after = self.inventory(app, daemon).await?;
        if let Err(e) = idle::same_members(&phase.members, &after) {
            phase.errors.push(e);
        }
        let mut cursors = Vec::new();
        for (id, before) in offsets {
            let read: Read =
                request(client, "terminal.read", json!({"id":id,"after":before})).await?;
            std::fs::write(
                self.root.join(format!(
                    "{}-{:?}-{id}-output.json",
                    phase.count, phase.state
                )),
                serde_json::to_vec_pretty(&read)?,
            )?;
            cursors.push((before, read.next));
            if read.truncated || read.from != before {
                phase
                    .errors
                    .push(format!("Terminal {id}: output collection loss"));
            }
        }
        let after_nodes: Vec<RailNode> = request(client, "rail.tree", Value::Null).await?;
        if baseline.iter().map(|n| &n.id).collect::<Vec<_>>()
            != after_nodes.iter().map(|n| &n.id).collect::<Vec<_>>()
        {
            phase
                .errors
                .push("Agent membership changed during phase".into());
        }
        // A final durable replay closes the race between the last top header and
        // a queued Status transition that already returned to idle.
        let mut replay = Client::connect(socket).await?;
        let completed: contracts::common::SubscribeResult = request(
            &replay,
            "events.subscribe",
            json!({"after":subscribed.head}),
        )
        .await?;
        let mut cursor = subscribed.head;
        let mut replay_log = std::fs::File::create(self.root.join(format!(
            "{}-{:?}-status-replay.jsonl",
            phase.count, phase.state
        )))?;
        while cursor < completed.head {
            let event = tokio::time::timeout(Duration::from_secs(10), replay.next_event())
                .await
                .map_err(failure)?
                .ok_or_else(|| failure("final Status replay closed"))?;
            writeln!(replay_log, "{}", json!({"at_s":self.now(),"event":event}))?;
            if let Some(seq) = event.seq {
                if seq != cursor + 1 {
                    return Err(failure("final Status replay gap/reset"));
                }
                cursor = seq;
            }
            if let contracts::EventData::AgentStatus(change) = event.data {
                changes.push(change.status.kind);
            }
        }
        let mut all_statuses = statuses;
        all_statuses.extend(
            after_nodes
                .iter()
                .filter_map(|n| n.status.as_ref().map(|s| s.kind)),
        );
        if let Err(e) = idle::activity(phase.count, &all_statuses, &cursors, &changes) {
            phase.errors.push(e);
        }
        if let Err(e) =
            self.journal(app, false)?
                .phase(phase.state, stable_start, end, &phase.settings)
        {
            phase.errors.push(e);
        }
        // Keep later transitions outside conservative clock uncertainty intervals.
        tokio::time::sleep(Duration::from_secs(5)).await;
        eprintln!(
            "{} {:?} finished; {} errors retained",
            phase.count,
            phase.state,
            phase.errors.len()
        );
        Ok(())
    }
    async fn top(
        &mut self,
        members: &[Member],
        events: &mut Client,
        mut seq: u64,
        phase: &Phase,
    ) -> io::Result<(Vec<Interval>, Vec<Kind>)> {
        let prefix = self
            .root
            .join(format!("{}-{:?}-top", phase.count, phase.state));
        let mut args = [
            "-l",
            "0",
            "-s",
            "1",
            "-c",
            "d",
            "-F",
            "-R",
            "-stats",
            "pid,command,cpu,idlew",
        ]
        .map(String::from)
        .to_vec();
        for p in members {
            args.extend(["-pid".into(), p.pid.to_string()]);
        }
        let started = self.now();
        let launch = Command::new("/usr/bin/top")
            .args(&args)
            .env("LC_ALL", "C")
            .stdout(Stdio::piped())
            .stderr(std::fs::File::create(prefix.with_extension("stderr"))?)
            .kill_on_drop(true)
            .spawn();
        let mut child = match launch {
            Ok(child) => child,
            Err(e) => {
                std::fs::write(
                    prefix.with_extension("json"),
                    serde_json::to_vec_pretty(
                        &json!({"program":"/usr/bin/top","args":args,"start_s":started,"end_s":self.now(),"status":null,"error":e.to_string()}),
                    )?,
                )?;
                return Err(failure(format!(
                    "/usr/bin/top: {e}; raw {}",
                    prefix.display()
                )));
            }
        };
        let mut lines = BufReader::new(
            child
                .stdout
                .take()
                .ok_or_else(|| failure("missing top stdout"))?,
        )
        .lines();
        let mut raw = std::fs::File::create(prefix.with_extension("jsonl"))?;
        let mut event_log = std::fs::File::create(prefix.with_extension("events.jsonl"))?;
        let result = tokio::time::timeout(Duration::from_secs(75), async {
            let mut samples = idle::TopSamples::default();
            let mut changes = Vec::new();
            loop {
                tokio::select! {
                    line = lines.next_line() => {
                        let line = line?.ok_or_else(|| failure("top exited/incomplete sample"))?;
                        let now = self.now();
                        writeln!(raw, "{}", json!({"at_s":now,"line":line}))?;
                        if line.starts_with("Processes:") {
                            // Fixed top selections must not hide a helper born during sampling.
                            let mut system = sysinfo::System::new();
                            system.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All,true,sysinfo::ProcessRefreshKind::nothing());
                            let helpers: BTreeMap<_,_> = system.processes().iter().filter(|(_,p)| p.name().to_string_lossy().starts_with("com.apple.WebKit.")).map(|(pid,p)| (pid.as_u32(),p.start_time())).collect();
                            writeln!(raw,"{}",json!({"at_s":self.now(),"webkit_start_identities":helpers}))?;
                            if helpers != self.helpers { return Err(failure("WebKit inventory changed during CPU sampling; missing/unknown helper ownership or PID reuse")); }
                        }
                        if samples.push(now, &line).map_err(failure)? { break Ok::<_,io::Error>((samples.finish().map_err(failure)?,changes)); }
                    }
                    event = events.next_event() => {
                        let event = event.ok_or_else(|| failure("Daemon event stream closed"))?;
                        writeln!(event_log, "{}", json!({"at_s":self.now(),"event":event}))?;
                        if let Some(n) = event.seq { if n != seq+1 { return Err(failure("Daemon event sequence gap/reset")); } seq=n; }
                        if let contracts::EventData::AgentStatus(change) = event.data { changes.push(change.status.kind); }
                    }
                }
            }
        }).await.map_err(failure).and_then(|v| v);
        let stop = child.kill().await;
        let status = child.wait().await;
        std::fs::write(
            prefix.with_extension("json"),
            serde_json::to_vec_pretty(
                &json!({"program":"/usr/bin/top","args":args,"start_s":started,"end_s":self.now(),"status":format!("{status:?}"),"stop":format!("{stop:?}"),"initial_sample":"discarded","mode":"delta","error":result.as_ref().err().map(ToString::to_string)}),
            )?,
        )?;
        result
    }
}
#[derive(Deserialize)]
struct Timing {
    stable_start: f64,
    end: f64,
}
async fn request<T: DeserializeOwned>(
    client: &Client,
    method: &str,
    params: Value,
) -> io::Result<T> {
    let value = tokio::time::timeout(Duration::from_secs(10), client.request(method, params))
        .await
        .map_err(failure)?
        .map_err(|e| failure(format!("{method}: {e}")))?;
    serde_json::from_value(value).map_err(|e| failure(format!("{method}: {e}")))
}
