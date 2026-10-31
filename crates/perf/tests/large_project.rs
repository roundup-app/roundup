//! R5220: every read the App makes on start and on a click stays fast on a Project the size of the owner's.
#[path = "../../rupd/tests/support/rupd_harness.rs"]
mod rupd_harness;

use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const SEED: u64 = 5220;
const AGENTS: usize = 300;
const WORKSTREAMS: usize = 10;
const BIG_TRANSCRIPTS: usize = 6;
const TODOS: usize = 1_000;
const CHANGES_PER_TODO: usize = 16;
const PADS: usize = 100;
const EVENTS: usize = 9_000;
const CALLS: usize = 25;
const TIMEOUT: Duration = Duration::from_secs(10);

/// Every allowlisted read whose params are `()`, the App's start and click reads that name no id.
const SAMPLED: [&str; 18] = [
    "agent.extras",
    "ask.list",
    "daemon.methods",
    "daemon.ping",
    "models.list",
    "pad.list",
    "project.get",
    "project.getPrepared",
    "project.resources",
    "rail.list",
    "rail.tree",
    "reaction.list",
    "route.list",
    "terminal.list",
    "todo.list",
    "todo.listHanded",
    "todo.unread",
    "workstream.queue",
];
const SET_AUTO: &str = "workstream.setAuto";

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn text(&mut self, len: usize) -> String {
        const WORDS: [&str; 8] = [
            "rail", "agent", "todo", "pad", "queue", "fix", "read", "daemon",
        ];
        let mut out = String::with_capacity(len + 8);
        while out.len() < len {
            out.push_str(WORDS[(self.next() % 8) as usize]);
            out.push(' ');
        }
        out
    }

    fn uuid(&mut self) -> String {
        let (a, b) = (self.next(), self.next());
        format!(
            "{:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}",
            a >> 32,
            (a >> 16) & 0xffff,
            a & 0xfff,
            (b >> 52) & 0xfff,
            b & 0xffff_ffff_ffff
        )
    }
}

fn rupd() -> PathBuf {
    let bin = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("rupd");
    assert!(
        bin.is_file(),
        "build rupd before running the large-Project gate"
    );
    bin
}

fn start(project: &Path, data: &Path, config: &Path) -> rupd_harness::Rupd {
    let data = data.to_owned();
    let config = config.to_owned();
    rupd_harness::start(&rupd(), project, false, move |command| {
        command
            .env("ROUNDUP_DATA_DIR", data)
            .env("CLAUDE_CONFIG_DIR", config)
            .env(
                "ROUNDUP_SIDECAR_DIR",
                concat!(env!("CARGO_MANIFEST_DIR"), "/../agents/sidecar"),
            )
            .stderr(std::process::Stdio::null());
    })
}

/// A transcript of about `size` bytes: valid records, the last one carrying usage so the overview has a context figure.
fn transcript(path: &Path, id: &str, size: usize, rng: &mut Rng) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut block = String::new();
    for turn in 0..64 {
        let role = if turn % 2 == 0 { "user" } else { "assistant" };
        block.push_str(
            &json!({"type": role, "sessionId": id, "message": {"role": role, "content": rng.text(4000)}})
                .to_string(),
        );
        block.push('\n');
    }
    let mut file = std::io::BufWriter::new(std::fs::File::create(path).unwrap());
    let mut written = 0;
    while written < size {
        file.write_all(block.as_bytes()).unwrap();
        written += block.len();
    }
    let last = json!({"type": "assistant", "sessionId": id, "message": {"model": "claude-haiku-4-5", "usage": {"input_tokens": 1000, "cache_read_input_tokens": 2000, "output_tokens": 10}}});
    writeln!(file, "{last}").unwrap();
}

struct Project {
    root: tempfile::TempDir,
}

impl Project {
    fn project(&self) -> PathBuf {
        self.root.path().join("project")
    }
    fn data(&self) -> PathBuf {
        self.root.path().join("data")
    }
    fn config(&self) -> PathBuf {
        self.root.path().join("claude")
    }
}

/// The owner's Project, generated: 300 Agents with transcripts of 1–5 MB (six of 50 MB) and a `project.db` of about 800 MB.
fn generate() -> Project {
    let fixture = Project {
        root: tempfile::tempdir().unwrap(),
    };
    for dir in [fixture.project(), fixture.data(), fixture.config()] {
        std::fs::create_dir(&dir).unwrap();
    }
    let project = fixture.project().canonicalize().unwrap();
    // A first start makes `project.db` with every migration applied; the fixture then fills it.
    drop(start(&project, &fixture.data(), &fixture.config()));
    let db_dir = std::fs::read_dir(fixture.data().join("projects"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let db = rusqlite_open(&db_dir.join("project.db"));
    let mut rng = Rng(SEED);
    let bucket: String = project
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let transcripts = fixture.config().join("projects").join(bucket);
    db.execute_batch("BEGIN").unwrap();
    for ws in 0..WORKSTREAMS {
        db.execute(
            "INSERT INTO nodes (kind, name, parent, ord) VALUES ('workstream', ?, NULL, ?)",
            rusqlite::params![format!("workstream {ws}"), ws as i64],
        )
        .unwrap();
    }
    for agent in 0..AGENTS {
        let id = rng.uuid();
        let size = if agent < BIG_TRANSCRIPTS {
            50_000_000
        } else {
            1_000_000 + (rng.next() % 4_000_000) as usize
        };
        transcript(
            &transcripts.join(format!("{id}.jsonl")),
            &id,
            size,
            &mut rng,
        );
        db.execute(
            "INSERT INTO nodes (kind, name, parent, ord, conversation_id, conversation_cwd)
                VALUES ('agent', ?, ?, ?, ?, ?)",
            rusqlite::params![
                format!("agent {agent}"),
                (agent % WORKSTREAMS) as i64 + 1,
                (agent / WORKSTREAMS) as i64,
                id,
                project.to_string_lossy(),
            ],
        )
        .unwrap();
    }
    for todo in 0..TODOS {
        db.execute(
            "INSERT INTO todos (title, body, created_at, pos) VALUES (?, ?, ?, ?)",
            rusqlite::params![
                format!("todo {todo} {}", rng.text(40)),
                rng.text(500),
                1_700_000_000 + todo as i64,
                todo as i64
            ],
        )
        .unwrap();
    }
    for pad in 0..PADS {
        db.execute(
            "INSERT INTO pads (key, name, text, updated_at) VALUES (?, ?, ?, ?)",
            rusqlite::params![
                format!("pad-{pad}"),
                format!("pad {pad}"),
                rng.text(5_000),
                1_700_000_000 + pad as i64
            ],
        )
        .unwrap();
    }
    let rail_changed =
        json!({"actor": {"kind": "user", "id": "you", "parent": null}, "kind": "rail-changed"});
    for _ in 0..EVENTS {
        db.execute(
            "INSERT INTO events (event) VALUES (?)",
            [rail_changed.to_string()],
        )
        .unwrap();
    }
    // The history of every Todo is the bulk of the file: each Change keeps the whole Todo after it.
    let history = rng.text(45_000);
    for change in 0..CHANGES_PER_TODO {
        db.execute(
            "INSERT INTO changes (todo, after_values, after_touch, changed_at, actor)
                SELECT id, ?, 0, ? + id, 'user' FROM todos",
            rusqlite::params![format!("{{\"body\":\"{history}\"}}"), change as i64],
        )
        .unwrap();
    }
    db.execute_batch("COMMIT").unwrap();
    db.pragma_update(None, "wal_checkpoint", "TRUNCATE")
        .unwrap();
    fixture
}

fn rusqlite_open(path: &Path) -> rusqlite::Connection {
    let db = rusqlite::Connection::open(path).unwrap();
    db.pragma_update(None, "synchronous", "OFF").unwrap();
    db
}

/// The 95th percentile of `samples`, the nearest rank.
fn p95(mut samples: Vec<Duration>) -> Duration {
    samples.sort();
    samples[(samples.len() * 95).div_ceil(100) - 1]
}

fn budget(metric: &str) -> f64 {
    let budgets: Value =
        serde_json::from_str(include_str!("../large-project-budgets.json")).unwrap();
    budgets[metric]["limit"].as_f64().unwrap()
}

/// The methods of the App's read allowlist.
fn allowlist() -> Vec<String> {
    let source = include_str!("../../../apps/desktop/src/state/connectedProject.ts");
    let set = source
        .split_once("const reads = new Set<RpcMethodName>([")
        .and_then(|(_, rest)| rest.split_once("]);"))
        .expect("the read allowlist")
        .0;
    set.split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

/// The allowlisted methods whose declaration takes no params and that `sampled` does not name.
fn unsampled(allowlist: &[String], declarations: &str, sampled: &[&str]) -> Vec<String> {
    allowlist
        .iter()
        .filter(|name| declarations.contains(&format!("\"{name}\": () =>")))
        .filter(|name| !sampled.contains(&name.as_str()))
        .cloned()
        .collect()
}

fn declarations() -> &'static str {
    include_str!("../../contracts/src/declarations.rs")
}

/// One method's `CALLS` latencies, or the method name when a call outlasts `TIMEOUT`.
async fn sample(
    client: &rpc::Client,
    method: &str,
    params: Value,
) -> Result<Vec<Duration>, String> {
    let mut latencies = Vec::new();
    for _ in 0..CALLS {
        let started = Instant::now();
        // An error answer is an answer: `agent.extras` refuses outside a Door, and the App's wait is the same.
        if tokio::time::timeout(TIMEOUT, client.request(method, params.clone()))
            .await
            .is_err()
        {
            return Err(format!("{method} timed out after {TIMEOUT:?}"));
        }
        latencies.push(started.elapsed());
    }
    Ok(latencies)
}

/// Every sampled method's p95 in milliseconds against `limit`; `Err` names each method over it.
async fn measure(daemon: &rupd_harness::Rupd, limit: f64, listings: usize) -> Result<(), String> {
    let missing = unsampled(&allowlist(), declarations(), &SAMPLED);
    if !missing.is_empty() {
        return Err(format!("read methods missing from the sample: {missing:?}"));
    }
    let client = rpc::Client::connect(&daemon.socket).await.unwrap();
    let tree = client.request("rail.tree", Value::Null).await.unwrap();
    let workstream = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["kind"] == "workstream")
        .expect("a Workstream in the Rail")["id"]
        .clone();
    let stop = Arc::new(AtomicBool::new(false));
    let mut loads = Vec::new();
    for _ in 0..listings {
        let load = rpc::Client::connect(&daemon.socket).await.unwrap();
        let stop = stop.clone();
        loads.push(tokio::spawn(async move {
            while !stop.load(Ordering::Relaxed) {
                let _ = tokio::time::timeout(TIMEOUT, load.request("rail.tree", Value::Null)).await;
            }
        }));
    }
    let mut p95s = BTreeMap::new();
    let mut failures = Vec::new();
    let methods = SAMPLED
        .iter()
        .map(|method| (*method, Value::Null))
        .chain([(SET_AUTO, json!({"id": workstream, "auto": false}))]);
    for (method, params) in methods {
        match sample(&client, method, params).await {
            Ok(latencies) => {
                p95s.insert(method, p95(latencies).as_secs_f64() * 1000.0);
            }
            Err(failure) => failures.push(failure),
        }
    }
    stop.store(true, Ordering::Relaxed);
    for load in loads {
        let _ = load.await;
    }
    failures.extend(
        p95s.iter()
            .filter(|(_, ms)| **ms >= limit)
            .map(|(method, ms)| format!("{method} p95 {ms:.1} ms, over {limit} ms")),
    );
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}

async fn gate(metric: &str, listings: usize) {
    let fixture = generate();
    let daemon = start(
        &fixture.project().canonicalize().unwrap(),
        &fixture.data(),
        &fixture.config(),
    );
    if let Err(failure) = measure(&daemon, budget(metric), listings).await {
        panic!("{failure}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 6)]
async fn r5220_every_read_is_under_budget_alone() {
    gate("alone_p95_ms", 0).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 6)]
async fn r5220_every_read_is_under_budget_under_three_rail_listings() {
    gate("under_three_rail_listings_p95_ms", 3).await;
}

#[test]
fn r5220_an_unsampled_read_method_fails_the_gate() {
    let allowlist = allowlist();
    assert!(
        unsampled(&allowlist, declarations(), &SAMPLED).is_empty(),
        "the sample covers the allowlist"
    );
    let mut grown = allowlist;
    grown.push("todo.countAll".into());
    let declarations = format!("{}\n\"todo.countAll\": () => u32,", declarations());
    assert_eq!(
        unsampled(&grown, &declarations, &SAMPLED),
        ["todo.countAll"]
    );
}
