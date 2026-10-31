//! The real `rupd` and `rup` on a temp Project, with the fake `claude` as every Agent's program.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use contracts::agent::{RailNode, SignalParams, SpawnParams, StatusEvent};
use contracts::{EventData, Kind, Status};
use rpc::Client;
use serde_json::{Value, json};

#[path = "../../../rupd/tests/support/rupd_harness.rs"]
pub(crate) mod rupd_harness;

#[allow(dead_code)]
#[path = "../../../rupd/tests/support/store_migrations.rs"]
pub mod storage;

/// Historical receipt triggers for fixtures that replay the Project migrations.
pub const INSTRUCTION_MESSAGES: &str =
    include_str!("../../../rupd/migrations/project/0013-instruction-messages.sql");

/// How long the Daemon, its Agents' hooks and their tools have to answer.
const BOUND: Duration = Duration::from_secs(30);

/// A Project from `start_real` (it holds a model) waits `REAL_BOUND`, one from `start` waits `BOUND`.
pub fn bound_for(real: bool) -> Duration {
    if real { aimock::REAL_BOUND } else { BOUND }
}

/// How long ten Agents' `SessionStart` hooks have to reach the Daemon (D4's bound), counted from
/// the first `agent.spawn`. Kept apart from `BOUND`, which `Drop` also uses, so this cannot drift.
pub const TEN_IDLE_BOUND: Duration = Duration::from_secs(30);

#[allow(dead_code)] // Each integration target uses a different part of the shared harness.
#[path = "aimock.rs"]
pub mod aimock;

pub struct Project {
    /// Its stdin is held open: `--attached` makes the Daemon exit, and stop its Agents, when it closes.
    daemon: rupd_harness::Rupd,
    pub model: Option<aimock::Model>,
    pub dir: tempfile::TempDir,
    /// The App's data folder (`ROUNDUP_DATA_DIR`, N1), kept outside the Project folder.
    pub data: tempfile::TempDir,
}

/// Start `rupd --attached` and return once it is serving. `fake` is the environment the fake
/// `claude` reads.
pub fn start(fake: &[(&str, &str)]) -> Project {
    start_in(
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        fake,
    )
}

pub fn start_in(dir: tempfile::TempDir, data: tempfile::TempDir, fake: &[(&str, &str)]) -> Project {
    let packaged = std::env::var_os("ROUNDUP_TEST_APP_BIN").map(PathBuf::from);
    let rup = packaged
        .as_ref()
        .map(|dir| dir.join("rup"))
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_rup")));
    let rupd = rup.with_file_name("rupd");
    assert!(
        rupd.is_file(),
        "{} is not built; run `cargo build -p rupd`",
        rupd.display()
    );
    let sidecar = data.path().join("sidecar");
    if packaged.is_none() {
        let bundled = Command::new("bash")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/sidecar/bundle.sh"))
            .arg(&sidecar)
            .arg("--local-node")
            .status()
            .unwrap();
        assert!(bundled.success(), "fixture sidecar is complete");
    }
    // Borrow both folders: a startup panic reaps the harness Daemon before these owners drop.
    let mut daemon = rupd_harness::start(&rupd, dir.path(), true, |command| {
        if packaged.is_some() {
            command
                .env_remove("ROUNDUP_RUP_BIN")
                .env_remove("ROUNDUP_SIDECAR_DIR");
        } else {
            command
                .env("ROUNDUP_RUP_BIN", &rup)
                .env("ROUNDUP_SIDECAR_DIR", &sidecar);
        }
        command
            .current_dir(dir.path())
            .env("CLAUDE_CONFIG_DIR", dir.path().join("claude-config"))
            .env(
                "ROUNDUP_CLAUDE_BIN",
                Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/e2e/fake_claude.py"),
            )
            .envs(fake.iter().copied())
            .env("ROUNDUP_DATA_DIR", data.path());
    });
    let mut stderr = daemon.stderr.take().unwrap();
    // Left unread, the pipe would fill and block the Daemon's logging.
    std::thread::spawn(move || std::io::copy(&mut stderr, &mut std::io::stderr()));
    Project {
        daemon,
        dir,
        data,
        model: None,
    }
}

impl Project {
    /// D1/D5: close the App's lifetime pipe and require a clean, bounded shutdown.
    pub async fn close(&mut self) {
        drop(self.daemon.stdin.take());
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                if let Some(status) = self.daemon.child.try_wait().unwrap() {
                    assert!(status.success(), "attached shutdown failed: {status}");
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("attached Daemon exits within D1's 15-second bound");
    }

    pub fn crash(&mut self) {
        if self.daemon.child.try_wait().unwrap().is_none() {
            self.daemon.child.kill().unwrap();
        }
        self.daemon.child.wait().unwrap();
        self.daemon.stdin.take();
    }

    pub fn restart(&mut self, fake: &[(&str, &str)]) {
        self.crash();
        let placeholder = tempfile::tempdir().unwrap();
        let dir = std::mem::replace(&mut self.dir, placeholder);
        let data = std::mem::replace(&mut self.data, tempfile::tempdir().unwrap());
        let model = self.model.take();
        let mut restarted = start_in(dir, data, fake);
        restarted.model = model;
        *self = restarted;
    }

    /// N1: where the Daemon keeps this Project's databases, launch files and Pad files.
    pub fn data_dir(&self) -> PathBuf {
        rupd::data::project_data(self.data.path(), self.dir.path()).unwrap()
    }

    #[allow(dead_code)] // m12.rs includes this file and uses it
    pub fn socket(&self) -> &Path {
        &self.daemon.socket
    }

    /// How long a wait on this Project's Daemon, probes or model lasts.
    pub fn bound(&self) -> Duration {
        bound_for(self.model.is_some())
    }

    /// `next`, bounded by this Project's `bound`.
    pub async fn next<T>(&self, client: &mut Client, pick: impl Fn(EventData) -> Option<T>) -> T {
        next_within(self.bound(), client, pick).await
    }

    /// `rail_tree`, bounded by this Project's `bound`.
    pub async fn rail_tree(&self, client: &Client) -> Vec<RailNode> {
        rail_tree_within(self.bound(), client).await
    }

    /// `needs_you`, bounded by this Project's `bound`.
    pub async fn needs_you(&self, client: &Client, agent: &str) {
        needs_you_within(self.bound(), client, agent).await
    }

    pub fn pid(&self) -> u32 {
        self.daemon.child.id()
    }

    pub async fn client(&self) -> Client {
        Client::connect(&self.daemon.socket).await.unwrap()
    }

    /// A client that receives every event from now on.
    pub async fn subscribed(&self) -> Client {
        let client = self.client().await;
        client
            .request("events.subscribe", serde_json::Value::Null)
            .await
            .unwrap();
        client
    }

    pub async fn spawn_agent(&self, client: &Client) -> RailNode {
        let params = SpawnParams {
            cols: None,
            rows: None,
            permission_mode: None,
            engine: None,
            cwd: self.dir.path().to_string_lossy().into_owned(),
            prompt: None,
            order: None,
            name: None,
            parent: None,
            model: None,
            effort: None,
            scout: None,
            specialist: None,
            extras: None,
        };
        let node = client.request("agent.spawn", params).await.unwrap();
        serde_json::from_value(node).unwrap()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        drop(self.daemon.stdin.take());
        let deadline = Instant::now() + self.bound();
        while Instant::now() < deadline && matches!(self.daemon.child.try_wait(), Ok(None)) {
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.daemon.child.kill();
        let _ = self.daemon.child.wait();
        if !std::thread::panicking()
            && let Some(model) = &self.model
        {
            model.assert_matched();
        }
    }
}

/// The next event the Daemon pushes that satisfies `pick`.
pub async fn next<T>(client: &mut Client, pick: impl Fn(EventData) -> Option<T>) -> T {
    next_within(BOUND, client, pick).await
}

async fn next_within<T>(
    bound: Duration,
    client: &mut Client,
    pick: impl Fn(EventData) -> Option<T>,
) -> T {
    tokio::time::timeout(bound, async {
        while let Some(event) = client.next_event().await {
            if let Some(found) = pick(event.data) {
                return found;
            }
        }
        panic!("the connection closed before the event");
    })
    .await
    .expect("the event arrived")
}

async fn next_status(client: &mut Client) -> StatusEvent {
    next(client, |data| match data {
        EventData::AgentStatus(status) => Some(*status),
        _ => None,
    })
    .await
}

pub async fn next_kind(client: &mut Client) -> Kind {
    next_status(client).await.status.kind
}

/// Hand Agent `id` a Signal directly over RPC, the way `rup signal` does, bypassing the fake
/// `claude` process so a test can drive one Agent's Status without the others.
pub async fn signal(client: &Client, id: &str, payload: Value) {
    signal_within(BOUND, client, id, payload).await
}

async fn signal_within(bound: Duration, client: &Client, id: &str, payload: Value) {
    let attempt = rail_tree_within(bound, client)
        .await
        .into_iter()
        .find(|n| n.id == id)
        .unwrap()
        .attempt
        .unwrap();
    tokio::time::timeout(
        bound,
        client.request(
            "agent.signal",
            SignalParams {
                id: id.to_owned(),
                attempt,
                payload,
            },
        ),
    )
    .await
    .expect("agent.signal answered within the bound")
    .unwrap();
}

pub async fn rail_tree(client: &Client) -> Vec<RailNode> {
    rail_tree_within(BOUND, client).await
}

pub async fn rail_tree_within(bound: Duration, client: &Client) -> Vec<RailNode> {
    let tree = tokio::time::timeout(bound, client.request("rail.tree", Value::Null))
        .await
        .expect("rail.tree answered within the bound")
        .unwrap();
    serde_json::from_value(tree).unwrap()
}

/// Wait, from one shared `deadline`, for every one of `ids` to reach `Kind::Idle` on the event
/// stream. A miss names, for each Agent not yet Idle, the status last seen on the event stream
/// (`None` if none arrived) and the Daemon's own `rail.tree` view of it: if the tree already shows
/// Idle, the event did not reach this client even though the Daemon already saw it. A connection
/// that closes before the deadline is reported directly, instead of blaming the deadline and
/// then failing to read `rail.tree` on a dead connection.
pub async fn wait_until_idle(
    client: &mut Client,
    ids: &[String],
    deadline: Instant,
) -> Result<(), String> {
    let mut idle: HashSet<String> = HashSet::new();
    let mut last_seen: HashMap<String, Status> = HashMap::new();
    while idle.len() < ids.len() {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let event = match tokio::time::timeout(remaining, client.next_event()).await {
            Ok(Some(event)) => event,
            Ok(None) => {
                return Err(format!(
                    "the connection closed with {} of {} Agents not yet Idle",
                    ids.len() - idle.len(),
                    ids.len()
                ));
            }
            Err(_) => break,
        };
        if let EventData::AgentStatus(status) = event.data
            && ids.contains(&status.id)
        {
            if status.status.kind == Kind::Idle {
                idle.insert(status.id.clone());
            }
            last_seen.insert(status.id, status.status);
        }
    }
    if idle.len() == ids.len() {
        return Ok(());
    }

    let tree = rail_tree(client).await;
    let mut report = format!(
        "{} of {} Agents were not Idle before the deadline:\n",
        ids.len() - idle.len(),
        ids.len()
    );
    for id in ids.iter().filter(|id| !idle.contains(*id)) {
        let tree_status = tree
            .iter()
            .find(|node| &node.id == id)
            .and_then(|node| node.status.as_ref());
        let idle_in_tree = matches!(tree_status, Some(status) if status.kind == Kind::Idle);
        report += &format!(
            "  {id}: event stream last saw {:?}; rail.tree shows {tree_status:?}{}\n",
            last_seen.get(id),
            if idle_in_tree {
                " (Idle in the tree but not seen on the stream)"
            } else {
                ""
            }
        );
    }
    Err(report)
}

/// Start the actual pinned vendor against this test's model fixture.
pub fn start_real(fixture: &str, env: &[(&str, &str)]) -> Project {
    let model = aimock::Model::start(fixture);
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("home");
    std::fs::create_dir(&home).unwrap();
    aimock::configure(&dir.path().join("claude-config"), dir.path());
    let claude = aimock::routed_claude(dir.path());
    let mut launch = vec![
        ("ROUNDUP_CLAUDE_BIN", claude.to_str().unwrap()),
        ("HOME", home.to_str().unwrap()),
        ("CLAUDE_CODE_OAUTH_TOKEN", ""),
        ("AIMOCK_URL", model.url.as_str()),
    ];
    launch.extend_from_slice(env);
    let mut project = start_in(dir, tempfile::tempdir().unwrap(), &launch);
    project.model = Some(model);
    project
}

/// Put Agent `agent` in needs-you, the way Claude's `PermissionRequest` hook does.
pub async fn needs_you(client: &Client, agent: &str) {
    needs_you_within(BOUND, client, agent).await
}

async fn needs_you_within(bound: Duration, client: &Client, agent: &str) {
    signal_within(
        bound,
        client,
        agent,
        json!({"hook_event_name": "PermissionRequest", "tool_name": "Bash",
            "tool_input": {"command": "ls"}}),
    )
    .await;
}

pub async fn h21_poll<T>(what: &str, mut found: impl AsyncFnMut() -> Option<T>) -> T {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if let Some(value) = found().await {
                return value;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
}

/// Allow the permission prompt on `agent`'s Terminal: type the number of its first choice, "Yes".
pub async fn allow_prompt(client: &Client, agent: &str) {
    use base64::Engine as _;
    let terminal = rail_tree(client)
        .await
        .into_iter()
        .find(|n| n.id == agent)
        .unwrap()
        .terminal_id
        .unwrap();
    client
        .request(
            "terminal.write",
            json!({"id": terminal,
                "data": base64::engine::general_purpose::STANDARD.encode("1")}),
        )
        .await
        .unwrap();
}

#[test]
fn e5417_a_real_project_waits_the_real_bound_and_a_fake_one_the_short_bound() {
    assert_eq!(bound_for(true), aimock::REAL_BOUND);
    assert_ne!(bound_for(false), aimock::REAL_BOUND);
    assert!(bound_for(true) > bound_for(false));
}
