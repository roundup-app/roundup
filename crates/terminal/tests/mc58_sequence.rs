//! MC58: any seeded sequence of Daemon restarts, core restarts and upgrades, a second Daemon,
//! killed programs and deleted Agents ends, once roundup settles, with one program per Agent. The
//! same generator runs against the test-support core and, where `MC58_HERDR_CORE` names one, a real
//! herdr-core under `env -i` in a scratch `HOME` and session.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::collections::{BTreeMap, BTreeSet};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use contracts::terminal::SpawnParams;
use rpc::Bus;
use serde_json::{Value, json};
use terminal::Terminals;
use terminal::reconcile::{apply, labels, parse, reconcile};

const PROJECT: &str = "mc58";
const STEPS: usize = 30;
const SEQUENCES: u64 = 200;
const WORKERS: u64 = 16;
const TIMEOUT: Duration = Duration::from_secs(15);

/// One event of a sequence; a `usize` picks among what is there when the event runs.
#[derive(Clone, Copy, Debug)]
enum Event {
    DaemonRestart,
    CoreRestart,
    CoreUpgrade,
    SecondDaemon,
    KillProgram(usize),
    DeleteAgent(usize),
}

/// The generator both cores run: `steps` events drawn from `seed`.
fn sequence(seed: u64, steps: usize) -> Vec<Event> {
    let mut rng = fastrand::Rng::with_seed(seed);
    (0..steps)
        .map(|_| match rng.u8(..6) {
            0 => Event::DaemonRestart,
            1 => Event::CoreRestart,
            2 => Event::CoreUpgrade,
            3 => Event::SecondDaemon,
            4 => Event::KillProgram(rng.usize(..)),
            _ => Event::DeleteAgent(rng.usize(..)),
        })
        .collect()
}

/// Names the seed of a sequence that panics, so `MC58_SEED` reruns it.
struct Seed(u64);

impl Drop for Seed {
    fn drop(&mut self) {
        if std::thread::panicking() {
            eprintln!(
                "MC58 failed at seed {}: rerun with MC58_SEED={}",
                self.0, self.0
            );
        }
    }
}

/// Link `dir/core` to the one script named `name` with `body`, written once per run: a host that
/// checks each new executable before it first runs (as a Mac's malware scanner does) checks it once,
/// not once per sequence. The script reads its folder from the link's path, `${0%/*}`.
fn link_core(dir: &Path, name: &str, body: &str) {
    static SCRIPTS: Mutex<Option<tempfile::TempDir>> = Mutex::new(None);
    let mut scripts = SCRIPTS.lock().unwrap();
    let script = scripts
        .get_or_insert_with(|| tempfile::tempdir().unwrap())
        .path()
        .join(name);
    if !script.exists() {
        std::fs::write(&script, format!("#!/bin/sh\nhere=\"${{0%/*}}\"\n{body}\n")).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::os::unix::fs::symlink(&script, dir.join("core")).unwrap();
}

fn sh(program: &Path, args: &[&str], env: &[(&str, &Path)], session: Option<&str>) -> String {
    let mut command = Command::new("env");
    command.arg("-i").arg("PATH=/usr/bin:/bin");
    for (name, value) in env {
        command.arg(format!("{name}={}", value.display()));
    }
    if let Some(session) = session {
        command.arg(format!("HC_SESSION={session}"));
    }
    let out = command.arg(program).args(args).output().unwrap();
    assert!(out.status.success(), "{program:?} {args:?}: {out:?}");
    String::from_utf8(out.stdout).unwrap()
}

/// Every process on the host, as pid to parent pid, read from `ps`.
fn ps() -> BTreeMap<u32, u32> {
    let out = Command::new("ps")
        .args(["-A", "-o", "pid=,ppid="])
        .output()
        .unwrap();
    String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace().map(str::parse::<u32>);
            Some((fields.next()?.ok()?, fields.next()?.ok()?))
        })
        .collect()
}

fn kill(pid: u32) {
    let _ = nix::sys::signal::kill(
        nix::unistd::Pid::from_raw(i32::try_from(pid).unwrap()),
        nix::sys::signal::SIGKILL,
    );
}

async fn until(what: &str, mut done: impl FnMut() -> bool) {
    let start = Instant::now();
    while !done() {
        assert!(start.elapsed() < TIMEOUT, "{what}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// The core a sequence runs against. `wrapper` starts a connection to it the way `Terminals` starts
/// its core, so every Daemon of the sequence reaches the same one.
enum Core {
    /// The test-support core, kept between connections in `dir` (its `herdr-core-persist` mode).
    Test { dir: tempfile::TempDir },
    /// herdr-core at `bin` under `env -i`, with `home` as its `HOME` and its own `session`.
    Real {
        bin: PathBuf,
        home: tempfile::TempDir,
        session: String,
    },
}

impl Core {
    fn test() -> Self {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("herdr-core-persist"), "").unwrap();
        link_core(
            dir.path(),
            "test-core",
            &format!(
                "TMPDIR=\"$here\" exec '{}' \"$@\"",
                env!("CARGO_BIN_EXE_herdr-core-test")
            ),
        );
        Self::Test { dir }
    }

    /// A real core that can never reach the user's: `env -i` drops the `HC_*` variables an App
    /// Terminal carries, `HOME` is a fresh folder, and the session is not `roundup`. Its folder sits
    /// under `/tmp` because the core's socket path must fit the 104 bytes macOS allows.
    fn real(bin: &Path, n: u64) -> Self {
        let home = tempfile::Builder::new()
            .prefix("mc58-")
            .tempdir_in("/tmp")
            .unwrap();
        let session = format!("mc58-{n}");
        assert_ne!(session, "roundup", "a test never reaches the App's session");
        std::fs::write(home.path().join("session"), &session).unwrap();
        link_core(
            home.path(),
            "real-core",
            &format!(
                "session=$(cat \"$here/session\")\n[ \"$session\" = roundup ] && exit 9\n\
                 exec env -i PATH=/usr/bin:/bin HOME=\"$here\" '{}' connect --session \"$session\"",
                bin.display()
            ),
        );
        Self::Real {
            bin: bin.to_owned(),
            home,
            session,
        }
    }

    fn wrapper(&self) -> PathBuf {
        match self {
            Self::Test { dir } => dir.path().join("core"),
            Self::Real { home, .. } => home.path().join("core"),
        }
    }

    async fn connect(&self) -> herdr::Conn {
        let mut command = tokio::process::Command::new(self.wrapper());
        command.arg("connect");
        herdr::Conn::spawn(command, TIMEOUT).await.unwrap()
    }

    /// The real core's `server status`, read under `env -i` in its scratch `HOME` and session.
    fn status(bin: &Path, home: &Path, session: &str) -> Value {
        serde_json::from_str(&sh(
            bin,
            &["server", "status", "--json"],
            &[("HOME", home)],
            Some(session),
        ))
        .unwrap()
    }

    /// The pids that run programs (the test core itself, or the real core's holders), and for the
    /// real core the core's own pid. Each real one is checked to be this test's, by the socket it
    /// listens on or the socket its command names, before anything is done to it.
    fn processes(&self) -> (Vec<u32>, Option<u32>) {
        match self {
            Self::Test { dir } => {
                let pid = std::fs::read_to_string(dir.path().join("herdr-core.pid")).unwrap();
                (vec![pid.trim().parse().unwrap()], None)
            }
            Self::Real { bin, home, session } => {
                let status = Self::status(bin, home.path(), session);
                let core = u32::try_from(status["pid"].as_u64().unwrap()).unwrap();
                let socket = Command::new("lsof")
                    .args(["-a", "-p", &core.to_string(), "-U", "-Fn"])
                    .output()
                    .unwrap();
                let ours = format!("n{}/", home.path().display());
                assert!(
                    String::from_utf8_lossy(&socket.stdout)
                        .lines()
                        .any(|line| line.starts_with(&ours)),
                    "core {core} listens on no socket under {}",
                    home.path().display()
                );
                let holders = status["holders"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|h| u32::try_from(h["pid"].as_u64().unwrap()).unwrap())
                    .collect::<Vec<_>>();
                for holder in &holders {
                    let command = Command::new("ps")
                        .args(["-o", "command=", "-p", &holder.to_string()])
                        .output()
                        .unwrap();
                    assert!(
                        String::from_utf8_lossy(&command.stdout)
                            .contains(&format!("--socket {}/", home.path().display())),
                        "holder {holder} is not this test's"
                    );
                }
                (holders, Some(core))
            }
        }
    }

    /// The core and every program it runs end; the next connect starts an empty core.
    async fn restart(&self) {
        let (parents, core) = self.processes();
        let gone: Vec<u32> = parents.iter().copied().chain(core).collect();
        for pid in &gone {
            kill(*pid);
        }
        match self {
            Self::Test { dir } => {
                let socket = dir.path().join("herdr-core.sock");
                until("the test core ends", || {
                    std::os::unix::net::UnixStream::connect(&socket).is_err()
                })
                .await;
            }
            Self::Real { .. } => {
                until("the real core and its holders end", || {
                    let running = ps();
                    gone.iter().all(|pid| !running.contains_key(pid))
                })
                .await;
            }
        }
    }

    /// Every connection closes and every program keeps running, as an upgrade of the core does.
    async fn upgrade(&self) {
        match self {
            Self::Test { dir } => {
                let file = dir.path().join("herdr-core-upgrade");
                std::fs::write(&file, "").unwrap();
                until("the test core closes its connections", || !file.exists()).await;
            }
            Self::Real { bin, home, session } => {
                self.processes();
                sh(
                    bin,
                    &["server", "restart", "--json"],
                    &[("HOME", home.path())],
                    Some(session),
                );
            }
        }
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        match self {
            Self::Test { dir } => {
                let _ = std::fs::remove_file(dir.path().join("herdr-core-persist"));
            }
            Self::Real { .. } => {
                let (holders, core) = self.processes();
                for pid in holders.iter().copied().chain(core) {
                    kill(pid);
                }
            }
        }
    }
}

/// A Daemon: the `Terminals` it starts Agents' programs with, and the connection MC52's reconcile
/// reads the core's list by.
struct Daemon {
    terminals: Terminals,
    conn: herdr::Conn,
    data: tempfile::TempDir,
}

impl Daemon {
    async fn start(core: &Core) -> Self {
        let data = tempfile::tempdir().unwrap();
        let terminals = Terminals::open(data.path(), Bus::new())
            .unwrap()
            .with_core(core.wrapper());
        Self {
            terminals,
            conn: core.connect().await,
            data,
        }
    }

    /// What roundup does to settle: read the core's list by MC52 and carry out its ends and
    /// removals, then start each Agent, which attaches to its one live program. A closed connection
    /// is replaced (MC53), and a failed start is tried once more as the App's Retry does (MC56).
    /// Answers every error text a start gave the App.
    async fn settle(&mut self, core: &Core, agents: &[String]) -> Vec<String> {
        let steps = match reconcile(&self.conn, PROJECT, agents).await {
            Ok((_, steps)) => steps,
            Err(herdr::Error::Closed) => {
                self.conn = core.connect().await;
                reconcile(&self.conn, PROJECT, agents).await.unwrap().1
            }
            Err(err) => panic!("reconcile: {err}"),
        };
        for step in &steps {
            if let Err(err) = apply(&self.conn, step).await {
                // A second Daemon settling at the same time may have removed it first.
                assert!(
                    matches!(&err, herdr::Error::Rpc(e) if e.kind == "not_found"),
                    "{step:?}: {err}"
                );
            }
        }
        let mut shown = Vec::new();
        for agent in agents {
            for _ in 0..2 {
                let params = SpawnParams {
                    cwd: self.data.path().to_string_lossy().into_owned(),
                    command: Some(vec!["cat".into()]),
                    env: BTreeMap::new(),
                    unset: Vec::new(),
                    cols: 80,
                    rows: 24,
                    machine: None,
                };
                match self
                    .terminals
                    .spawn_labelled(params, labels(PROJECT, agent, "1"))
                    .await
                {
                    Ok(_) => break,
                    Err(err) => shown.push(err.message),
                }
            }
        }
        shown
    }
}

/// The core's list of every Terminal, finished ones too.
async fn listed(core: &Core) -> Value {
    core.connect()
        .await
        .call("terminal.list", json!({"all": true}))
        .await
        .unwrap()
}

fn pid_of(list: &Value, address: &str) -> Option<u32> {
    list["terminals"]
        .as_array()?
        .iter()
        .find(|t| t["address"] == address)?["pid"]
        .as_u64()
        .and_then(|pid| u32::try_from(pid).ok())
}

/// Kill the `n`th live program of the Project with a signal, as a crash would, and wait until
/// the core reports it finished.
async fn kill_program(core: &Core, n: usize) {
    let list = listed(core).await;
    let live: Vec<_> = parse(PROJECT, &list)
        .into_iter()
        .filter(|t| !t.finished)
        .collect();
    let Some(target) = live.get(n % live.len().max(1)) else {
        return;
    };
    let Some(pid) = pid_of(&list, &target.address) else {
        return;
    };
    kill(pid);
    let conn = core.connect().await;
    let start = Instant::now();
    loop {
        let got = conn
            .call("terminal.get", json!({"terminal": target.address}))
            .await
            .unwrap();
        if got["state"] == "finished" {
            return;
        }
        assert!(
            start.elapsed() < TIMEOUT,
            "{} never finished",
            target.address
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Whether the App shows `message` with a herdr-core word in it. The App's `coreFailureText`
/// (`apps/desktop/src/terminal/coreFailure.ts`) replaces a message whose first or second segment is
/// a core failure code by its label, and shows any other as it is.
fn shows_core_word(message: &str) -> bool {
    const CODES: [&str; 7] = [
        "core_missing",
        "unsupported_generation",
        "core_closed",
        "core_silent",
        "core_error",
        "core_protocol",
        "core_io",
    ];
    let coded = message.splitn(3, ": ").take(2).any(|s| CODES.contains(&s));
    !coded && message.to_lowercase().contains("herdr")
}

/// The four invariants after settling, and the `ps` comparison: the program pids the core lists as
/// live are exactly the running children of what runs programs.
async fn check(core: &Core, agents: &[String], shown: &[String]) -> Vec<String> {
    let list = listed(core).await;
    let ours = parse(PROJECT, &list);
    let mut broken = Vec::new();
    for agent in agents {
        let n = ours
            .iter()
            .filter(|t| &t.agent == agent && !t.finished)
            .count();
        if n != 1 {
            broken.push(format!("Agent {agent} runs {n} programs"));
        }
    }
    for t in &ours {
        if !agents.contains(&t.agent) {
            broken.push(format!(
                "{} is labelled with gone Agent {}",
                t.address, t.agent
            ));
        }
        if t.finished {
            broken.push(format!("{} is finished and kept", t.address));
        }
    }
    broken.extend(
        shown
            .iter()
            .filter(|m| shows_core_word(m))
            .map(|m| format!("the App shows {m:?}")),
    );
    let listed_pids: BTreeSet<u32> = list["terminals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["state"] == "live")
        .filter_map(|t| t["pid"].as_u64().and_then(|p| u32::try_from(p).ok()))
        .collect();
    let (parents, _) = core.processes();
    let running: BTreeSet<u32> = ps()
        .into_iter()
        .filter(|(_, parent)| parents.contains(parent))
        .map(|(pid, _)| pid)
        .collect();
    if listed_pids != running {
        broken.push(format!(
            "the core lists programs {listed_pids:?} where ps runs {running:?}"
        ));
    }
    broken
}

/// Run the sequence of `seed` on `core`, settle, and answer each broken invariant.
async fn run(core: &Core, seed: u64) -> Vec<String> {
    let _seed = Seed(seed);
    let mut agents: Vec<String> = (1..=3).map(|n| format!("a{n}")).collect();
    let mut next = agents.len() + 1;
    let mut daemons = vec![Daemon::start(core).await];
    let mut shown = daemons[0].settle(core, &agents).await;
    for event in sequence(seed, STEPS) {
        match event {
            Event::DaemonRestart => daemons[0] = Daemon::start(core).await,
            Event::CoreRestart => core.restart().await,
            Event::CoreUpgrade => core.upgrade().await,
            Event::SecondDaemon => {
                daemons.truncate(1);
                daemons.push(Daemon::start(core).await);
            }
            Event::KillProgram(n) => kill_program(core, n).await,
            Event::DeleteAgent(n) => {
                agents.remove(n % agents.len());
                agents.push(format!("a{next}"));
                next += 1;
            }
        }
        match daemons.as_mut_slice() {
            [one, two] => {
                let (a, b) = tokio::join!(one.settle(core, &agents), two.settle(core, &agents));
                shown.extend(a.into_iter().chain(b));
            }
            [one] => shown.extend(one.settle(core, &agents).await),
            _ => unreachable!(),
        }
    }
    // Two Daemons at once may each start an Agent's program; the next settle ends the extra.
    shown.extend(daemons[0].settle(core, &agents).await);
    check(core, &agents, &shown)
        .await
        .into_iter()
        .map(|b| format!("seed {seed}: {b}"))
        .collect()
}

/// The first seed: `MC58_SEED`, or a random one.
fn first_seed() -> u64 {
    std::env::var("MC58_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| fastrand::u64(..))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mc58_random_sequences_keep_four_invariants() {
    let first = first_seed();
    let count = std::env::var("MC58_SEQUENCES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(SEQUENCES);
    let mut workers = tokio::task::JoinSet::new();
    for worker in 0..WORKERS {
        workers.spawn(async move {
            let mut broken = Vec::new();
            for n in (worker..count).step_by(usize::try_from(WORKERS).unwrap()) {
                broken.extend(run(&Core::test(), first.wrapping_add(n)).await);
            }
            broken
        });
    }
    let broken: Vec<String> = workers.join_all().await.into_iter().flatten().collect();
    assert!(
        broken.is_empty(),
        "{} of {count} sequences from MC58_SEED={first} broke:\n{}",
        broken.len(),
        broken.join("\n")
    );
}

/// The observer on a Mac: `MC58_HERDR_CORE=$(command -v herdr-core)` runs the generator against the
/// real core, pinned at the schema file's version. Without it the test prints why and passes.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mc58_real_core_sequence_matches_ps() {
    let Some(bin) = std::env::var_os("MC58_HERDR_CORE").map(PathBuf::from) else {
        eprintln!(
            "mc58_real_core_sequence_matches_ps: skipped, MC58_HERDR_CORE names no herdr-core"
        );
        return;
    };
    let pinned: Value = serde_json::from_str(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../herdr/schema/herdr-core-0.1.20.json"),
        )
        .unwrap(),
    )
    .unwrap();
    // `schema` starts a core of its own: it runs in a sequence's scratch core, which the test ends.
    let core = Core::real(&bin, 0);
    let Core::Real { home, session, .. } = &core else {
        unreachable!()
    };
    let schema: Value = serde_json::from_str(&sh(
        &bin,
        &["schema"],
        &[("HOME", home.path())],
        Some(session),
    ))
    .unwrap();
    assert_eq!(schema["info"]["version"], pinned["version"], "MC55's pin");
    drop(core);

    let first = first_seed();
    let count = std::env::var("MC58_SEQUENCES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);
    let mut broken = Vec::new();
    for n in 0..count {
        let core = Core::real(&bin, n);
        broken.extend(run(&core, first.wrapping_add(n)).await);
    }
    eprintln!(
        "mc58_real_core_sequence_matches_ps: {count} sequences of {STEPS} from MC58_SEED={first}"
    );
    assert!(broken.is_empty(), "{}", broken.join("\n"));
}
