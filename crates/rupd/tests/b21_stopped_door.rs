//! B21/B22 through a real Daemon, fake claude, captured stderr and a fake clock.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::io::{BufRead, BufReader};
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
        // The completed comparison contains the Idle emitted by the fake's SessionStart hook.
        wait(|| {
            snapshots(self.dir.path()).iter().any(|v| {
                v["nodes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|n| n["id"] == id && n["status"]["kind"] == "idle")
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

    fn assert_silent(&self) {
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
    let mut daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project,
        true,
        |command| {
            command
                .env("ROUNDUP_DATA_DIR", data)
                .env("CLAUDE_CONFIG_DIR", project.join("config"))
                .env("ROUNDUP_RUP_BIN", rup)
                .env(
                    "ROUNDUP_CLAUDE_BIN",
                    Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py"),
                )
                .env("FAKE_CLAUDE_LAUNCH_LOG", project.join("launches"))
                .env("RUPD_DIGEST_OBSERVER", project.join("comparisons"))
                .env("RUPD_MESSAGES_CLOCK", project.join("clock"))
                .env("RUPD_MESSAGES_OBSERVER", project.join("attempts"));
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
    run.assert_silent();
    assert_eq!(run.digests().await.len(), before);
    run.start_door().await;
    let newest = run.newest().await;
    assert!(newest["body"].as_str().unwrap().contains("review"));
    assert!(
        newest["body"]
            .as_str()
            .unwrap()
            .contains("[2 updates held back]")
    );
    assert_eq!(run.digests().await.len(), before + 1);
}
