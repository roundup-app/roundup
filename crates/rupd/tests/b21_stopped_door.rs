//! B21/B22 through a real Daemon, the pinned real `claude` on aimock, captured stderr and a fake clock.
#[path = "../../rup/tests/e2e/aimock.rs"]
#[allow(dead_code)]
mod aimock;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/transcripts.rs"]
mod transcripts;

use parking_lot::Mutex;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use contracts::EventData;
use rpc::Client;
use serde_json::{Value, json};
use transcripts::{latest_snapshot, snapshots, transcript, user_turns_with, written};

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
        let run = Self::start_live().await;
        run.stop_door().await;
        run
    }

    /// The Daemon with its Door started and idle.
    async fn start_live() -> Self {
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
                json!({"name":"work","parent":null, "order":{"kind":"work","ask":"What is this Workstream for?","limits":[]}}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let child = user
            .request(
                "agent.spawn",
                json!({"name":"review","parent":door,"cwd":dir.path(),"prompt":"What should this Agent do?"}),
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
        run.idle(&run.child, 4).await;
        run.start_door().await;
        // SessionStart saves the Door's conversation (A21) before Claude Code writes it, so every
        // later start resumes it (A23) only once its first prompt is on disk; stopped earlier, the
        // Door keeps a conversation `claude --resume` cannot find.
        run.idle(&run.door, 4).await;
        wait(|| written(&run.dir.path().join("config"), DOOR_PROMPT)).await;
        run
    }

    /// A `kind` Message `from` sends the Door while its session is off the list (Claude Code not listening, B50), so it stays pending.
    async fn pend(&self, from: &Client, kind: &str, body: &str) {
        let sessions = self.dir.path().join("config/sessions");
        std::fs::read_dir(sessions)
            .unwrap()
            .for_each(|f| std::fs::remove_file(f.unwrap().path()).unwrap());
        let message = json!({"to":self.door,"kind":kind,"body":body});
        from.request("message.send", message).await.unwrap();
    }

    /// A stopped Door that holds two pending Messages, stopped after `pend` sent them.
    async fn start_with_backlog(open_job: bool) -> (Self, Vec<Value>) {
        let run = Self::start_live().await;
        run.pend(&run.user, "note", "first retained").await;
        if open_job {
            // DCL8: the Door's open Job, which has not reported, is in the snapshot a Start carries.
            let door = Client::connect(&run.daemon.socket).await.unwrap();
            door.request(
                "daemon.identify",
                json!({"actor":{"kind":"agent","id":run.door,"parent":null}}),
            )
            .await
            .unwrap();
            let job = door
                .request(
                    "agent.spawn",
                    json!({"name":"open-job","parent":run.door,"cwd":run.dir.path(),"role":"job",
                    "prompt":"Do the one thing.",
                    "order":{"kind":"work","ask":"Do the one thing.","limits":[]}}),
                )
                .await
                .unwrap();
            // Settle the Job's own traffic before the Door stops, so only the backlog is counted.
            run.idle(job["id"].as_str().unwrap(), 2).await;
        }
        let kind = if open_job { "question" } else { "note" };
        run.pend(&run.agent, kind, "second retained").await;
        let stored = run.thread().await;
        run.stop_door().await;
        // Two untold child facts, kept back while the Door is stopped.
        run.change("first").await;
        run.change("second").await;
        (run, stored)
    }

    /// `id` reads idle at `revision` or later: a Door's initial order's turn ends Idle at 4 (Starting
    /// (1), SessionStart (2), Submit (3)); an Agent spawned without a prompt is typed nothing (A9)
    /// and idles at 2.
    async fn idle(&self, id: &str, revision: u32) {
        wait(|| {
            snapshots(self.dir.path()).iter().any(|v| {
                v["nodes"].as_array().unwrap().iter().any(|n| {
                    n["id"] == id
                        && n["status"]["kind"] == "idle"
                        && n["status_revision"]
                            .as_str()
                            .is_some_and(|r| r.parse::<u32>().unwrap() >= revision)
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
        if attempt != "1" {
            self.user
                .request(
                    "message.send",
                    json!({"to":self.door,"kind":"note","body":DOOR_PROMPT}),
                )
                .await
                .unwrap();
        }
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
        let log = self.log.lock();
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
        std::os::unix::fs::symlink(aimock::routed_claude(project), &claude).unwrap();
    }
    let config = project.join("config");
    aimock::configure(&config, project);
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
                .env("AIMOCK_URL", &model.url)
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
            captured.lock().push_str(&format!("{}\n", line.unwrap()));
        }
    });
    (daemon, log)
}

/// The Door's first prompt, as `tests/fixtures/b21_stopped_door.json` matches it.
const DOOR_PROMPT: &str = "What is this Workstream for?";

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
async fn b21_a_reopened_door_waits_until_explicit_start() {
    let mut run = Run::start().await;
    drop(run.daemon.stdin.take());
    run.daemon.child.wait().unwrap();
    std::fs::write(run.dir.path().join("comparisons"), "").unwrap();
    (run.daemon, run.log) = launch(run.dir.path(), run.data.path(), &run.model);
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
            .contains("[2 updates kept back]"),
        "{newest}"
    );
    assert_eq!(run.digests().await.len(), before + 1);
    run.model.assert_matched();
}

#[tokio::test]
async fn dcl10_reopen_keeps_told_and_push_accounting() {
    let mut run = Run::start().await;
    let before = run.digests().await.len();
    run.change("first").await;
    run.change("second").await;
    run.assert_silent().await;
    drop(run.daemon.stdin.take());
    run.daemon.child.wait().unwrap();
    std::fs::write(run.dir.path().join("comparisons"), "").unwrap();
    std::fs::write(run.dir.path().join("attempts"), "").unwrap();
    (run.daemon, run.log) = launch(run.dir.path(), run.data.path(), &run.model);
    run.user = Client::connect(&run.daemon.socket).await.unwrap();
    // The reopened Daemon queues nothing again and launches nothing before the explicit start.
    run.assert_silent().await;
    assert_eq!(run.digests().await.len(), before);
    run.start_door().await;
    let newest = run.newest().await;
    assert!(
        newest["body"]
            .as_str()
            .unwrap()
            .contains("[2 updates kept back]"),
        "{newest}"
    );
    assert_eq!(run.digests().await.len(), before + 1);
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

/// B5168f: these changes are only new open Todos, so their Digests are held until a Message is
/// delivered; a note to the Door delivers them with it.
async fn release(run: &Run, events: &mut Client) {
    let note = run
        .user
        .request(
            "message.send",
            json!({"to":run.door,"kind":"note","body":"release held digests"}),
        )
        .await
        .unwrap();
    delivered(events, note["id"].as_u64().unwrap()).await;
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
        run.idle(id, 2).await;
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
    // Force a setup queue past eight sends, then drain it before counting the regression burst.
    for i in 0..20 {
        run.change(&format!("setup {i}")).await;
    }
    eprintln!("B21/B22: setup changes compared");
    // DTC2: the changes are quiet; the Message the Door takes carries them out as one rollup.
    release(&run, &mut events).await;
    let base = 0;
    accounted(&run, base, 20).await;
    let base = run
        .digests()
        .await
        .iter()
        .map(|m| m["id"].as_u64().unwrap())
        .max()
        .unwrap();
    eprintln!("B21/B22: setup rollup observed");
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
    }
    release(&run, &mut events).await;
    accounted(&run, base, 8).await;
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
        1
    );
    run.start_door().await;
    // The stopped Door's quiet notes wait for its next Message; one rollup carries them out.
    release(&run, &mut events).await;
    let messages = accounted(&run, base, 18).await;
    eprintln!("B21/B22: stopped changes released");
    let rollup = messages
        .iter()
        .find(|m| {
            m["body"]
                .as_str()
                .is_some_and(|b| b.starts_with("[digest] [10 updates kept back]"))
        })
        .unwrap();
    assert!(
        rollup["body"]
            .as_str()
            .unwrap()
            .starts_with("[digest] [10 updates kept back]")
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
    // Bring the total to B22(c)'s 100 changes, all quiet until the next Message.
    for i in 0..82 {
        let todo = children[i as usize % 4]
            .1
            .request("todo.create", json!({"title":format!("burst {i}")}))
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
    release(&run, &mut events).await;
    let all = accounted(&run, base, 100).await;
    assert_eq!(
        all.iter()
            .filter(|m| m["status"] != "dropped")
            .map(weight)
            .sum::<u32>(),
        100
    );
    for message in &all {
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

async fn waiting(run: &Run) -> Value {
    let tree = run.user.request("rail.tree", json!({})).await.unwrap();
    let nodes = tree.as_array().unwrap();
    let node = nodes.iter().find(|n| n["id"] == run.door).unwrap();
    node["waiting"].clone()
}

#[tokio::test]
async fn dcl10_waiting_count_follows_stored_backlog_without_double_count() {
    let (mut run, _) = Run::start_with_backlog(false).await;
    assert_eq!(waiting(&run).await, json!(4));
    run.change("first").await;
    run.change("second").await;
    run.assert_silent().await;
    assert_eq!(waiting(&run).await, json!(6));
    drop(run.daemon.stdin.take());
    run.daemon.child.wait().unwrap();
    (run.daemon, run.log) = launch(run.dir.path(), run.data.path(), &run.model);
    run.user = Client::connect(&run.daemon.socket).await.unwrap();
    assert_eq!(waiting(&run).await, json!(6));
}

#[tokio::test]
async fn dcl10c_running_door_with_a_pending_message_has_no_waiting_count() {
    let run = Run::start_live().await;
    run.pend(&run.user, "note", "first retained").await;
    assert_eq!(waiting(&run).await, Value::Null, "the Door program runs");
    run.stop_door().await;
    assert_eq!(waiting(&run).await, json!(1));
    run.start_door().await;
    assert_eq!(waiting(&run).await, Value::Null);
}

impl Run {
    /// Every Message stored for the Door, oldest first, with its status; the initial order `start_door` sends after a Start and the settled note of the Door's Job are not part of the backlog.
    async fn thread(&self) -> Vec<Value> {
        let mut all: Vec<Value> = self
            .user
            .request("message.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| {
                m["to"] == self.door
                    && !m["body"].as_str().unwrap().starts_with(DOOR_PROMPT)
                    && !m["body"].as_str().unwrap().starts_with("[digest]")
                    && !m["body"].as_str().unwrap().starts_with("[settled]")
            })
            .cloned()
            .collect();
        all.sort_by_key(|m| m["id"].as_u64().unwrap());
        all
    }
}

fn identity(thread: &[Value]) -> Vec<(u64, Value, Value, Value)> {
    thread
        .iter()
        .map(|m| {
            (
                m["id"].as_u64().unwrap(),
                m["from"].clone(),
                m["body"].clone(),
                m["kind"].clone(),
            )
        })
        .collect()
}

#[tokio::test]
async fn dcl10_start_replays_one_ordered_batch() {
    let (run, stored) = Run::start_with_backlog(true).await;
    assert_eq!(stored.len(), 2, "{stored:?}");
    assert!(
        stored.iter().all(|m| m["status"] == "pending"),
        "{stored:?}"
    );
    run.assert_silent().await;
    let mut events = subscribe(&run).await;
    run.start_door().await;
    wait_delivered(&mut events, &stored).await;
    let after = run.thread().await;
    assert_eq!(identity(&after), identity(&stored));
    assert_eq!(after[1]["kind"], "question", "{after:?}");
    assert!(
        after.iter().all(|m| m["status"] == "delivered"),
        "{after:?}"
    );
    let config = run.dir.path().join("config");
    wait(|| transcript(&config).contains("[open jobs]")).await;
    let written = transcript(&config);
    let first = written.find("first retained").expect("first in transcript");
    let second = written
        .find("second retained")
        .expect("second in transcript");
    assert!(first < second, "stored order");
    assert_eq!(
        user_turns_with(&written, "first retained"),
        1,
        "delivered once"
    );
    assert!(
        second < written.find("[open jobs]").expect("snapshot"),
        "after the Messages"
    );
    assert!(
        written.contains(&format!("replyTo: {}", stored[1]["id"])),
        "question identity"
    );
    assert_eq!(user_turns_with(&written, "[open jobs]"), 1, "snapshot once");
}

#[tokio::test]
async fn dcl10_failed_start_preserves_backlog_and_cause() {
    let (run, stored) = Run::start_with_backlog(true).await;
    let fake = run.dir.path().join("rup");
    let saved = run.dir.path().join("saved-rup");
    std::fs::rename(&fake, &saved).unwrap();
    let n = waiting(&run).await;
    let failed = run
        .user
        .request("rail.startDoor", json!({"id":run.door}))
        .await;
    let cause = failed.expect_err("launch fails").to_string();
    assert!(cause.contains("rup not found at"), "{cause}");
    assert_eq!(waiting(&run).await, n, "N kept");
    let before = run.digests().await.len();
    assert_eq!(run.thread().await, stored, "Messages kept");
    run.assert_silent().await;
    assert_eq!(run.digests().await.len(), before, "untold facts waiting");
    std::fs::rename(saved, fake).unwrap();
    let mut events = subscribe(&run).await;
    run.start_door().await;
    wait_delivered(&mut events, &stored).await;
    let after = run.thread().await;
    assert_eq!(identity(&after), identity(&stored));
    assert_eq!(after[1]["kind"], "question", "{after:?}");
    run.newest().await;
    let digests = run.digests().await;
    let review = digests
        .iter()
        .filter(|d| d["body"].as_str().unwrap().contains("open todos: 2"))
        .count();
    assert_eq!(review, 1, "fact queued twice: {digests:?}");
    let config = run.dir.path().join("config");
    wait(|| transcript(&config).contains("[open jobs]")).await;
    let written = transcript(&config);
    assert_eq!(
        user_turns_with(&written, "first retained"),
        1,
        "same batch once"
    );
    assert!(
        written.contains(&format!("replyTo: {}", stored[1]["id"])),
        "question identity"
    );
    assert_eq!(user_turns_with(&written, "[open jobs]"), 1, "snapshot once");
}

async fn wait_delivered(events: &mut Client, stored: &[Value]) {
    for message in stored {
        delivered(events, message["id"].as_u64().unwrap()).await;
    }
}

async fn subscribe(run: &Run) -> Client {
    let events = Client::connect(&run.daemon.socket).await.unwrap();
    events.request("events.subscribe", json!({})).await.unwrap();
    events
}

#[path = "support/dtc2_quiet_notes.rs"]
mod dtc2_quiet_notes;
