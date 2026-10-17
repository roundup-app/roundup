//! B21/B22 through a real Daemon, the pinned real `claude` on aimock, captured stderr and a fake clock.
#[path = "../../rup/tests/e2e/aimock.rs"]
#[allow(dead_code)]
mod aimock;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};

const BOUND: Duration = Duration::from_secs(30);

struct Run {
    // Rust drops fields in declaration order, including when shutdown panics.
    daemon: rupd_harness::Rupd,
    model: aimock::Model,
    dir: tempfile::TempDir,
    data: tempfile::TempDir,
    log: Arc<Mutex<String>>,
    door: String,
    child: String,
    user: Client,
    agent: Client,
}

impl Run {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("clock"), "0").unwrap();
        let model = model();
        let (daemon, log) = launch(dir.path(), data.path(), &model);
        let user = Client::connect(&daemon.socket).await.unwrap();
        wait(|| {
            snapshots(dir.path())
                .iter()
                .any(|v| v["nodes"] == json!([]))
        })
        .await;
        let door = user
            .request(
                "rail.createWorkstream",
                json!({"name":"work","parent":null}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let child = user
            .request(
                "agent.spawn",
                json!({"name":"review","parent":door,"cwd":dir.path()}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let agent = Client::connect(&daemon.socket).await.unwrap();
        agent
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":child,"parent":door}}),
            )
            .await
            .unwrap();
        let run = Self {
            model,
            dir,
            data,
            daemon,
            log,
            door,
            child,
            user,
            agent,
        };
        run.idle(&run.child).await;
        run.start_door().await;
        // SessionStart saves the Door's conversation (A21) before Claude Code writes it, so every
        // later start resumes it (A23) only once its first prompt is on disk; stopped earlier, the
        // Door keeps a conversation `claude --resume` cannot find.
        run.idle(&run.door).await;
        wait(|| written(&run.dir.path().join("config"), DOOR_PROMPT)).await;
        run.stop_door().await;
        run
    }

    async fn idle(&self, id: &str) {
        // The initial order's turn ends Idle at revision 4: Starting (1), SessionStart (2), Submit (3).
        wait(|| {
            snapshots(self.dir.path()).iter().any(|v| {
                v["nodes"].as_array().unwrap().iter().any(|n| {
                    n["id"] == id
                        && n["status"]["kind"] == "idle"
                        && n["status_revision"]
                            .as_str()
                            .is_some_and(|r| r.parse::<u32>().unwrap() >= 4)
                })
            })
        })
        .await;
    }

    async fn start_door(&self) {
        let node = self
            .user
            .request("rail.startDoor", json!({"id":self.door}))
            .await
            .unwrap();
        let attempt = node["attempt"].clone();
        wait(|| {
            snapshots(self.dir.path()).iter().any(|v| {
                v["nodes"].as_array().unwrap().iter().any(|n| {
                    n["id"] == self.door && n["attempt"] == attempt && n["status"]["kind"] == "idle"
                })
            })
        })
        .await;
    }

    async fn stop_door(&self) {
        self.user
            .request("agent.stop", json!({"id":self.door}))
            .await
            .unwrap();
        wait(|| {
            snapshots(self.dir.path()).last().is_some_and(|v| {
                v["nodes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|n| n["id"] == self.door && n["status"]["kind"] == "done")
            })
        })
        .await;
        // Separate setup pushes from the stopped-Door observation.
        std::fs::write(self.dir.path().join("attempts"), "").unwrap();
    }

    async fn change(&self, title: &str) {
        let todo = self
            .agent
            .request("todo.create", json!({"title":title}))
            .await
            .unwrap();
        let id = todo["id"].clone();
        wait(|| {
            latest_snapshot(self.dir.path())
                .iter()
                .any(|v| v["todos"].as_array().unwrap().iter().any(|t| t["id"] == id))
        })
        .await;
    }

    async fn assert_silent(&self) {
        // Consume stderr through the same comparison acknowledgement before asserting absence.
        wait(|| {
            self.log
                .lock()
                .unwrap()
                .lines()
                .filter(|line| *line == "rupd: digest comparison complete")
                .count()
                >= std::fs::read_to_string(self.dir.path().join("comparisons"))
                    .unwrap_or_default()
                    .bytes()
                    .filter(|byte| *byte == b'\n')
                    .count()
        })
        .await;
        let attempts =
            std::fs::read_to_string(self.dir.path().join("attempts")).unwrap_or_default();
        assert!(
            !attempts
                .lines()
                .any(|op| op == "push" || op == "message.send"),
            "send attempted while stopped: {attempts}"
        );
        let log = self.log.lock().unwrap();
        assert!(
            !log.contains("push failed") && !log.contains("refused"),
            "refusal while stopped: {log}"
        );
    }

    async fn digests(&self) -> Vec<Value> {
        self.user
            .request("message.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["to"] == self.door && m["body"].as_str().unwrap().starts_with("[digest]"))
            .cloned()
            .collect()
    }

    async fn newest(&self) -> Value {
        tokio::time::timeout(BOUND, async {
            loop {
                if let Some(message) = self
                    .digests()
                    .await
                    .into_iter()
                    .find(|m| m["body"].as_str().unwrap().contains("open todos: 2"))
                {
                    return message;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("newest entry released on start")
    }
}

fn model() -> aimock::Model {
    aimock::Model::start_at(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/b21_stopped_door.json"),
    )
}

fn launch(
    project: &Path,
    data: &Path,
    model: &aimock::Model,
) -> (rupd_harness::Rupd, Arc<Mutex<String>>) {
    let built = PathBuf::from(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup");
    assert!(built.is_file(), "cargo build -p rup first");
    // A copy the failed-start test can take away: the Launcher checks `rup` before every launch.
    let rup = project.join("rup");
    if !rup.exists() {
        std::os::unix::fs::symlink(&built, &rup).unwrap();
    }
    let claude = project.join("claude");
    if !claude.exists() {
        std::os::unix::fs::symlink(aimock::package_bin("claude"), &claude).unwrap();
    }
    let config = project.join("config");
    aimock::configure(&config, project, &model.url);
    let mut daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project,
        true,
        |command| {
            command
                .env("ROUNDUP_DATA_DIR", data)
                .env("CLAUDE_CONFIG_DIR", project.join("config"))
                .env("ROUNDUP_RUP_BIN", rup)
                .env("ROUNDUP_CLAUDE_BIN", &claude)
                .env("CLAUDE_CODE_OAUTH_TOKEN", "")
                .env("RUPD_DIGEST_OBSERVER", project.join("comparisons"))
                .env("RUPD_MESSAGES_CLOCK", project.join("clock"))
                .env("RUPD_MESSAGES_OBSERVER", project.join("attempts"))
                .env("RUPD_MESSAGES_FAULT_FILE", project.join("fault"));
        },
    );
    let log = Arc::new(Mutex::new(String::new()));
    let captured = Arc::clone(&log);
    let stderr = daemon.stderr.take().unwrap();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            captured
                .lock()
                .unwrap()
                .push_str(&format!("{}\n", line.unwrap()));
        }
    });
    (daemon, log)
}

fn snapshots(project: &Path) -> Vec<Value> {
    std::fs::read_to_string(project.join("comparisons"))
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

// The burst's Todos only accumulate, so its newest complete comparison acknowledges every
// earlier Todo too. Parsing the full history for each input repeatedly decodes all earlier Todos.
fn latest_snapshot(project: &Path) -> Option<Value> {
    std::fs::read_to_string(project.join("comparisons"))
        .unwrap_or_default()
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
}

/// The Door's first prompt, as `tests/fixtures/b21_stopped_door.json` matches it.
const DOOR_PROMPT: &str = "Follow this instruction: What is this Workstream for?";

/// Whether Claude Code, configured in `config`, has written a conversation whose user message
/// holds `prompt`.
fn written(config: &Path, prompt: &str) -> bool {
    std::fs::read_dir(config.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|project| {
            std::fs::read_dir(project.path())
                .into_iter()
                .flatten()
                .flatten()
        })
        .filter(|file| file.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|file| std::fs::read_to_string(file.path()).ok())
        .any(|conversation| {
            conversation
                .lines()
                .any(|line| line.contains(r#""type":"user""#) && line.contains(prompt))
        })
}

async fn wait(ready: impl Fn() -> bool) {
    tokio::time::timeout(BOUND, async {
        while !ready() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("Daemon completed the Digest comparison");
}

#[tokio::test]
async fn b21_a_stopped_door_waits_silently_and_gets_the_newest_entry_on_start() {
    let run = Run::start().await;
    let before = run.digests().await.len();
    run.change("first").await;
    run.change("second").await;
    run.assert_silent().await;
    assert_eq!(run.digests().await.len(), before);
    run.start_door().await;
    let newest = run.newest().await;
    assert!(newest["body"].as_str().unwrap().contains("review"));
    assert!(
        newest["body"]
            .as_str()
            .unwrap()
            .contains("[2 updates held back]"),
        "{newest}"
    );
    assert_eq!(run.digests().await.len(), before + 1);
    run.model.assert_matched();
}

#[tokio::test]
async fn b21_a_reopened_door_waits_until_explicit_start() {
    let mut run = Run::start().await;
    drop(run.daemon.stdin.take());
    run.daemon.child.wait().unwrap();
    std::fs::write(run.dir.path().join("comparisons"), "").unwrap();
    let (daemon, log) = launch(run.dir.path(), run.data.path(), &run.model);
    run.daemon = daemon;
    run.log = log;
    run.user = Client::connect(&run.daemon.socket).await.unwrap();
    run.agent = Client::connect(&run.daemon.socket).await.unwrap();
    run.agent
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child,"parent":run.door}}),
        )
        .await
        .unwrap();
    run.user
        .request("agent.resume", json!({"id":run.child}))
        .await
        .unwrap();
    // A resumed Subagent has no initial order, so SessionStart's Idle is the readiness signal.
    wait(|| {
        snapshots(run.dir.path()).last().is_some_and(|v| {
            v["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["id"] == run.child && n["status"]["kind"] == "idle")
        })
    })
    .await;
    std::fs::write(run.dir.path().join("attempts"), "").unwrap();
    let before = run.digests().await.len();
    run.change("first").await;
    run.change("second").await;
    run.assert_silent().await;
    assert_eq!(run.digests().await.len(), before);
    run.start_door().await;
    let newest = run.newest().await;
    assert!(newest["body"].as_str().unwrap().contains("review"));
    assert_eq!(run.digests().await.len(), before + 1);
    run.model.assert_matched();
}

impl Run {
    fn shutdown(&mut self, bound: Duration) {
        // --attached stops only the programs this Daemon owns, then exits.
        drop(self.daemon.stdin.take());
        let started = std::time::Instant::now();
        while self.daemon.child.try_wait().unwrap().is_none() && started.elapsed() < bound {
            std::thread::sleep(Duration::from_millis(10));
        }
        if self.daemon.child.try_wait().unwrap().is_none() {
            self.daemon.child.kill().unwrap();
        }
        self.daemon.child.wait().unwrap();
    }
}

impl Drop for Run {
    fn drop(&mut self) {
        self.shutdown(BOUND);
    }
}

#[tokio::test]
async fn b21_a_failed_start_keeps_the_entries_waiting() {
    let run = Run::start().await;
    let before = run.digests().await.len();
    run.change("first").await;
    let fake = run.dir.path().join("rup");
    let saved = run.dir.path().join("saved-rup");
    std::fs::rename(&fake, &saved).unwrap();
    let started = run
        .user
        .request("rail.startDoor", json!({"id":run.door}))
        .await;
    assert!(started.is_err(), "{started:?}");
    // A failed launch returns before publishing a Status; a later child change acknowledges
    // the comparison with that Door still stopped.
    run.change("second").await;
    run.assert_silent().await;
    assert_eq!(run.digests().await.len(), before);
    std::fs::rename(saved, fake).unwrap();
    run.start_door().await;
    let newest = run.newest().await;
    assert!(
        newest["body"]
            .as_str()
            .unwrap()
            .contains("[2 updates held back]"),
        "{newest}"
    );
    assert_eq!(run.digests().await.len(), before + 1);
    run.model.assert_matched();
}

#[tokio::test]
async fn b21_a_removed_door_gets_no_waiting_digest() {
    let run = Run::start().await;
    let before = run.digests().await.len();
    run.change("first").await;
    run.user
        .request("rail.remove", json!({"id":run.door}))
        .await
        .unwrap();
    wait(|| {
        snapshots(run.dir.path()).last().is_some_and(|v| {
            v["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .all(|n| n["id"] != run.door)
        })
    })
    .await;
    let other = run
        .user
        .request(
            "rail.createWorkstream",
            json!({"name":"later","parent":null}),
        )
        .await
        .unwrap();
    let child = run
        .user
        .request(
            "agent.spawn",
            json!({"name":"later","parent":other["id"],"cwd":run.dir.path()}),
        )
        .await
        .unwrap();
    run.idle(child["id"].as_str().unwrap()).await;
    let later = Client::connect(&run.daemon.socket).await.unwrap();
    later
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":child["id"],"parent":other["id"]}}),
        )
        .await
        .unwrap();
    later
        .request("todo.create", json!({"title":"later"}))
        .await
        .unwrap();
    wait(|| {
        snapshots(run.dir.path()).last().is_some_and(|v| {
            v["todos"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t["title"] == "later")
        })
    })
    .await;
    run.assert_silent().await;
    assert_eq!(run.digests().await.len(), before);
    run.model.assert_matched();
}

#[tokio::test]
async fn b21_a_refusal_other_than_a_stopped_door_is_logged_and_retried() {
    let run = Run::start().await;
    run.start_door().await;
    let before = run.digests().await.len();
    std::fs::write(run.dir.path().join("fault"), "push").unwrap();
    run.change("first").await;
    wait(|| {
        run.log.lock().unwrap().contains(&format!(
            "push failed: {}: injected failure in push",
            run.door
        ))
    })
    .await;
    assert_eq!(run.digests().await.len(), before);
    std::fs::remove_file(run.dir.path().join("fault")).unwrap();
    run.change("second").await;
    run.newest().await;
    assert!(run.digests().await.len() > before);
    run.model.assert_matched();
}

fn weight(message: &Value) -> u32 {
    let body = message["body"].as_str().unwrap();
    if let Some(header) = body.strip_prefix("[digest] [") {
        header.split(' ').next().unwrap().parse().unwrap()
    } else if let Some(line) = body
        .lines()
        .last()
        .and_then(|line| line.strip_prefix("  ("))
    {
        line.split(' ').next().unwrap().parse().unwrap()
    } else {
        1
    }
}

fn advance(run: &Run, milliseconds: i64) {
    let next = run.dir.path().join("clock.next");
    std::fs::write(&next, milliseconds.to_string()).unwrap();
    std::fs::rename(next, run.dir.path().join("clock")).unwrap();
}

async fn accounted(run: &Run, after: u64, expected: u32) -> Vec<Value> {
    tokio::time::timeout(BOUND, async {
        loop {
            let messages: Vec<_> = run
                .digests()
                .await
                .into_iter()
                .filter(|m| m["id"].as_u64().unwrap() > after)
                .collect();
            let kept: u32 = messages
                .iter()
                .filter(|m| m["status"] != "dropped")
                .map(weight)
                .sum();
            if kept == expected {
                return messages;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("every change represented after the fake-clock window")
}

#[tokio::test]
async fn b21_start_releases_each_changed_child_under_b22s_caps() {
    // About 30 real Claude turns, one per delivered Digest, fit well inside this.
    tokio::time::timeout(BOUND * 4, changed_children_under_caps())
        .await
        .expect("B21/B22 burst completes inside four BOUNDs");
}

async fn delivered(events: &mut Client, id: u64) {
    tokio::time::timeout(BOUND, async {
        loop {
            let event = events.next_event().await.expect("Daemon event connection open");
            if matches!(event.data, EventData::MessageDelivered(message) if u64::from(message.id) == id) {
                return;
            }
        }
    })
    .await
    .expect("Digest prompt acknowledged before the next change");
}

async fn changed_children_under_caps() {
    let run = Run::start().await;
    let mut events = Client::connect(&run.daemon.socket).await.unwrap();
    events.request("events.subscribe", json!({})).await.unwrap();
    eprintln!("B21/B22: stopped-Door setup complete");
    run.start_door().await;
    let first = Client::connect(&run.daemon.socket).await.unwrap();
    first
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child,"parent":run.door}}),
        )
        .await
        .unwrap();
    let mut children = vec![("review".to_owned(), first)];
    // Populate while running; initial Kind changes belong to setup, not the stopped burst.
    for name in ["build", "check", "observe"] {
        let node = run
            .user
            .request(
                "agent.spawn",
                json!({"name":name,"parent":run.door,"cwd":run.dir.path()}),
            )
            .await
            .unwrap();
        let id = node["id"].as_str().unwrap();
        run.idle(id).await;
        let client = Client::connect(&run.daemon.socket).await.unwrap();
        client
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":id,"parent":run.door}}),
            )
            .await
            .unwrap();
        children.push((name.to_owned(), client));
    }
    // Hold setup Digests so draining them costs one prompt, rather than racing repeated
    // fake-claude hooks against the burst's 30-second bound on macOS.
    run.user
        .request("takeover.begin", json!({"agent":run.door}))
        .await
        .unwrap();
    // Force a setup queue past eight sends, then drain it before counting the regression burst.
    for i in 0..20 {
        run.change(&format!("setup {i}")).await;
    }
    eprintln!("B21/B22: setup changes compared");
    advance(&run, 60_000);
    // message.sent is emitted after the fake-clock flush records the setup rollup.
    let setup = tokio::time::timeout(BOUND, async {
        loop {
            let event = events
                .next_event()
                .await
                .expect("Daemon event connection open");
            if let EventData::MessageSent(message) = event.data
                && message.to == run.door
                && message.at == 60_000
                && message.body.starts_with("[digest]")
            {
                break u64::from(message.id);
            }
        }
    })
    .await
    .expect("setup rollup sent at the fake-clock window's end");
    run.user
        .request("takeover.end", json!({"agent":run.door}))
        .await
        .unwrap();
    delivered(&mut events, setup).await;
    let base = run
        .digests()
        .await
        .iter()
        .map(|m| m["id"].as_u64().unwrap())
        .max()
        .unwrap();
    eprintln!("B21/B22: setup rollup observed");
    advance(&run, 120_000);
    // Eight pushes use up this window before the Door is stopped.
    for i in 0..8 {
        let todo = children[0]
            .1
            .request("todo.create", json!({"title":format!("live {i}")}))
            .await
            .unwrap();
        wait(|| {
            latest_snapshot(run.dir.path()).iter().any(|v| {
                v["todos"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|t| t["id"] == todo["id"])
            })
        })
        .await;
        let messages = accounted(&run, base, i + 1).await;
        let id = messages.last().unwrap()["id"].as_u64().unwrap();
        // Stored delivery is provisional until H11 accepts the prompt. B30 emits the event
        // after acceptance; waiting for it keeps B34 from folding the next input into this one.
        delivered(&mut events, id).await;
    }
    eprintln!("B21/B22: eight live pushes delivered");
    run.stop_door().await;
    for i in 0..10 {
        let todo = children[i % 4]
            .1
            .request("todo.create", json!({"title":format!("stopped {i}")}))
            .await
            .unwrap();
        wait(|| {
            latest_snapshot(run.dir.path()).iter().any(|v| {
                v["todos"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|t| t["id"] == todo["id"])
            })
        })
        .await;
    }
    run.assert_silent().await;
    assert_eq!(
        run.digests()
            .await
            .iter()
            .filter(|m| m["id"].as_u64().unwrap() > base)
            .count(),
        8
    );
    run.start_door().await;
    // The full window still caps the restart. Only advancing time releases its newest entries.
    advance(&run, 180_000);
    let messages = accounted(&run, base, 18).await;
    eprintln!("B21/B22: stopped changes released");
    let rollup = messages.iter().find(|m| m["at"] == 180_000).unwrap();
    assert!(
        rollup["body"]
            .as_str()
            .unwrap()
            .starts_with("[digest] [10 updates held back]")
    );
    for (name, count) in [("review", 31), ("build", 3), ("check", 2), ("observe", 2)] {
        let body = rollup["body"].as_str().unwrap();
        let entry = body.split(&format!("{name} is ")).nth(1).unwrap();
        assert!(
            entry
                .lines()
                .take(3)
                .any(|line| line == format!("  open todos: {count}"))
        );
    }
    run.user
        .request("takeover.begin", json!({"agent":run.door}))
        .await
        .unwrap();
    let mut all = messages;
    // Bring the total to B22(c)'s 100 changes; each tick ends the preceding cap window.
    for i in 0..82 {
        advance(&run, 240_000 + i64::from(i) * 60_000);
        let todo = children[i as usize % 4]
            .1
            .request("todo.create", json!({"title":format!("held {i}")}))
            .await
            .unwrap();
        wait(|| {
            latest_snapshot(run.dir.path()).iter().any(|v| {
                v["todos"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|t| t["id"] == todo["id"])
            })
        })
        .await;
        all = accounted(&run, base, 19 + i).await;
        eprintln!("B21/B22: {} changes accounted", 19 + i);
        assert!(
            all.iter()
                .filter(|m| m["status"] == "pending" || m["status"] == "held")
                .count()
                <= 20
        );
    }
    assert_eq!(
        all.iter()
            .filter(|m| m["status"] != "dropped")
            .map(weight)
            .sum::<u32>(),
        100
    );
    for message in &all {
        let at = message["at"].as_i64().unwrap();
        assert!(
            all.iter()
                .filter(
                    |m| m["at"].as_i64().unwrap() > at - 60_000 && m["at"].as_i64().unwrap() <= at
                )
                .count()
                <= 8
        );
        run.user
            .request("message.get", json!({"id":message["id"]}))
            .await
            .unwrap();
    }
    run.model.assert_matched();
}

#[path = "support/n7_data.rs"]
mod n7_data;

#[tokio::test]
async fn n7_launch_sites_clean_on_success_and_failure() {
    if n7_data::isolated("n7_launch_sites_clean_on_success_and_failure") {
        return;
    }
    for exceeds_bound in [false, true] {
        // No Agents are started: suspending the Daemon must not strand their programs.
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("clock"), "0").unwrap();
        let model = model();
        let (daemon, log) = launch(dir.path(), data.path(), &model);
        let user = Client::connect(&daemon.socket).await.unwrap();
        let agent = Client::connect(&daemon.socket).await.unwrap();
        let mut run = Run {
            daemon,
            model,
            dir,
            data,
            log,
            door: String::new(),
            child: String::new(),
            user,
            agent,
        };
        let project = run.dir.path().to_owned();
        let data = run.data.path().to_owned();
        let pid = run.daemon.child.id();
        assert!(data.is_absolute());
        assert!(data.join("projects").is_dir());
        if exceeds_bound {
            assert!(
                std::process::Command::new("kill")
                    .args(["-STOP", &pid.to_string()])
                    .status()
                    .unwrap()
                    .success()
            );
        }
        run.shutdown(if exceeds_bound { Duration::ZERO } else { BOUND });
        let exited = run.daemon.child.try_wait().unwrap().is_some();
        // Resume on a failing implementation so its Drop can still clean up this test's Daemon.
        if !exited && exceeds_bound {
            assert!(
                std::process::Command::new("kill")
                    .args(["-CONT", &pid.to_string()])
                    .status()
                    .unwrap()
                    .success()
            );
        }
        assert!(
            exited,
            "cleanup returned with a live Daemon (timeout: {exceeds_bound})"
        );
        n7_data::assert_exited(pid);
        assert!(data.exists(), "data removed before the exit observation");
        drop(run);
        assert!(!data.exists());
        assert!(!project.exists());
    }
}
