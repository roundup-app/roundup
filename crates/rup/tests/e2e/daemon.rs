//! The real `rupd` and `rup` on a temp Project, with the fake `claude` as every Agent's program.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use contracts::agent::{RailNode, SignalParams, SpawnParams, StatusEvent};
use contracts::{EventData, Kind, Status};
use rpc::Client;
use serde_json::{Value, json};

#[path = "../../../rupd/tests/support/rupd_harness.rs"]
pub(crate) mod rupd_harness;

/// How long the Daemon, its Agents' hooks and their tools have to answer.
const BOUND: Duration = Duration::from_secs(30);

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
    let rup = PathBuf::from(env!("CARGO_BIN_EXE_rup"));
    let rupd = rup.with_file_name("rupd");
    assert!(
        rupd.is_file(),
        "{} is not built; run `cargo build -p rupd`",
        rupd.display()
    );
    // Borrow both folders: a startup panic reaps the harness Daemon before these owners drop.
    let mut daemon = rupd_harness::start(&rupd, dir.path(), true, |command| {
        command
            .current_dir(dir.path())
            .env("CLAUDE_CONFIG_DIR", dir.path().join("claude-config"))
            .env("ROUNDUP_RUP_BIN", &rup)
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
            cwd: self.dir.path().to_string_lossy().into_owned(),
            prompt: None,
            order: None,
            name: None,
            parent: None,
            model: None,
            effort: None,
            scout: None,
            extras: None,
        };
        let node = client.request("agent.spawn", params).await.unwrap();
        serde_json::from_value(node).unwrap()
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        drop(self.daemon.stdin.take());
        let deadline = Instant::now() + BOUND;
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
    tokio::time::timeout(BOUND, async {
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
    let attempt = rail_tree(client)
        .await
        .into_iter()
        .find(|n| n.id == id)
        .unwrap()
        .attempt
        .unwrap();
    tokio::time::timeout(
        BOUND,
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
    let tree = tokio::time::timeout(BOUND, client.request("rail.tree", Value::Null))
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

// H21: an Agent answers the Decisions of the Agents in its Reach, never its own.

/// The proof the harness hands the Daemon, the user's.
pub const H21_PROOF: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// `agent`'s permission request, left open: the call returns once the Decision is cleared.
pub async fn h21_ask(
    project: &Project,
    agent: &str,
    tool: &str,
    input: Value,
) -> tokio::task::JoinHandle<Result<Value, rpc::RpcError>> {
    let client = project.client().await;
    let (agent, tool) = (agent.to_owned(), tool.to_owned());
    tokio::spawn(async move {
        client
            .request(
                "agent.permission",
                json!({"id": agent, "payload": {"hook_event_name": "PermissionRequest",
                    "tool_name": tool, "tool_input": input}}),
            )
            .await
    })
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

/// The open Decision of `agent` that is not `except`.
pub async fn h21_decision(client: &Client, agent: &str, except: Option<&str>) -> Value {
    h21_poll("a Decision", async || {
        let listed = client.request("decision.list", Value::Null).await.unwrap();
        listed
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["agent"] == agent && Some(d["id"].as_str().unwrap()) != except)
            .cloned()
    })
    .await
}

/// The `[decision <id>]` notes the Daemon sent to `to`, once at least `least` are there.
pub async fn h21_notes(client: &Client, to: &str, least: usize) -> Vec<Value> {
    h21_poll("the notes", async || {
        let listed = client
            .request("message.list", json!({ "to": to }))
            .await
            .unwrap();
        let notes: Vec<Value> = listed
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["body"].as_str().unwrap().starts_with("[decision "))
            .cloned()
            .collect();
        (notes.len() >= least).then_some(notes)
    })
    .await
}

pub async fn h21_user_answers(
    client: &Client,
    id: &str,
    answer: &str,
) -> Result<Value, rpc::RpcError> {
    client
        .request(
            "decision.answer",
            json!({"id": id, "answer": answer, "proof": H21_PROOF}),
        )
        .await
}

pub fn h21_bash() -> Value {
    json!({"command": "ls"})
}
