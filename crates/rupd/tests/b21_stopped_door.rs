//! B21/B22 through a real Daemon, fake claude, captured stderr and a fake clock.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::io::{BufRead, BufReader};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};

const BOUND: Duration = Duration::from_secs(30);

struct Run {
    dir: tempfile::TempDir,
    data: tempfile::TempDir,
    daemon: rupd_harness::Rupd,
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
        let (daemon, log) = launch(dir.path(), data.path());
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
        run.stop_door().await;
        run
    }

    async fn idle(&self, id: &str) {
        // fake_claude.py's play_prompts acknowledges the initial order with Submit then Stop:
        // revision 4 is its Idle after Starting (1), SessionStart (2) and Submit (3).
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
            snapshots(self.dir.path())
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
                >= snapshots(self.dir.path()).len()
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

fn launch(project: &Path, data: &Path) -> (rupd_harness::Rupd, Arc<Mutex<String>>) {
    let rup = PathBuf::from(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup");
    assert!(rup.is_file(), "cargo build -p rup first");
    let fake = project.join("fake-claude");
    std::fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py"),
        &fake,
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let mut daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project,
        true,
        |command| {
            command
                .env("ROUNDUP_DATA_DIR", data)
                .env("CLAUDE_CONFIG_DIR", project.join("config"))
                .env("ROUNDUP_RUP_BIN", rup)
                .env("ROUNDUP_CLAUDE_BIN", &fake)
                .env("FAKE_CLAUDE_LAUNCH_LOG", project.join("launches"))
                .env("FAKE_CLAUDE_ON_PROMPT", "[]")
                .env("FAKE_CLAUDE_PASTE_WHOLE", "1")
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
}

#[tokio::test]
async fn b21_a_reopened_door_waits_until_explicit_start() {
    let mut run = Run::start().await;
    drop(run.daemon.stdin.take());
    run.daemon.child.wait().unwrap();
    std::fs::write(run.dir.path().join("comparisons"), "").unwrap();
    let (daemon, log) = launch(run.dir.path(), run.data.path());
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
}

impl Drop for Run {
    fn drop(&mut self) {
        // --attached stops only the programs this Daemon owns, then exits.
        drop(self.daemon.stdin.take());
        let started = std::time::Instant::now();
        while self.daemon.child.try_wait().unwrap().is_none() && started.elapsed() < BOUND {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

#[tokio::test]
async fn b21_a_failed_start_keeps_the_entries_waiting() {
    let run = Run::start().await;
    let before = run.digests().await.len();
    run.change("first").await;
    let fake = run.dir.path().join("fake-claude");
    let saved = run.dir.path().join("saved-claude");
    std::fs::rename(&fake, &saved).unwrap();
    assert!(
        run.user
            .request("rail.startDoor", json!({"id":run.door}))
            .await
            .is_err()
    );
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
    tokio::time::timeout(BOUND, changed_children_under_caps())
        .await
        .expect("B21/B22 burst completes inside BOUND");
}

async fn changed_children_under_caps() {
    let run = Run::start().await;
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
    // Force a setup queue past eight sends, then drain it before counting the regression burst.
    for i in 0..20 {
        run.change(&format!("setup {i}")).await;
    }
    eprintln!("B21/B22: setup changes compared");
    advance(&run, 60_000);
    // The setup rollup acknowledges the full initial queue at the first window's end.
    tokio::time::timeout(BOUND, async {
        loop {
            if run.digests().await.iter().any(|m| m["at"] == 60_000) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
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
        let id = messages.last().unwrap()["id"].clone();
        // B34 folds queued updates of one child. Delivery acknowledges this send before
        // the next change, so the setup consumes eight slots without a merged Message.
        tokio::time::timeout(BOUND, async {
            loop {
                let message = run
                    .user
                    .request("message.get", json!({"id":id}))
                    .await
                    .unwrap();
                if message["status"] == "delivered" {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("live setup Digest delivered before the next change");
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
}
