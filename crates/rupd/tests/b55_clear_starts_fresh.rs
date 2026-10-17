//! B55 through a real Daemon: the fake `claude` records its whole input per session.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use std::path::{Path, PathBuf};
use std::time::Duration;

use rpc::Client;
use serde_json::{Value, json};

const BOUND: Duration = Duration::from_secs(30);
const WORD: &str = "QUOKKA";

struct World {
    // Rust drops fields in declaration order: the Daemon goes before its folders.
    daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    data: tempfile::TempDir,
    summary: String,
    user: Client,
    door: String,
}

impl World {
    async fn start(summary: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let daemon = Self::launch(dir.path(), data.path(), summary);
        let user = Client::connect(&daemon.socket).await.unwrap();
        let mut world = Self {
            daemon,
            dir,
            data,
            summary: summary.to_owned(),
            user,
            door: String::new(),
        };
        let node = world
            .user
            .request(
                "rail.createWorkstream",
                json!({"name":"work","parent":null}),
            )
            .await
            .unwrap();
        world.door = node["id"].as_str().unwrap().to_owned();
        world.start_door().await;
        world
    }

    fn launch(dir: &Path, data: &Path, summary: &str) -> rupd_harness::Rupd {
        let rupd = PathBuf::from(env!("CARGO_BIN_EXE_rupd"));
        let rup = rupd.with_file_name("rup");
        assert!(rup.is_file(), "cargo build -p rup first");
        let fake = Path::new(env!("CARGO_MANIFEST_DIR")).join("../rup/tests/e2e/fake_claude.py");
        // The Handoff is written only for the clear's ask, never for another prompt.
        let on_prompt = json!([{
            "name": "workstream_handoff",
            "arguments": {"summary": summary, "keep_todos": [], "keep_pads": []},
            "skip_prompt": r"(?s)\A(?!.*Write the Handoff)"
        }]);
        let launch = rupd_harness::start(&rupd, dir, true, |command| {
            command
                .current_dir(dir)
                .env("CLAUDE_CONFIG_DIR", dir.join("claude-config"))
                .env("ROUNDUP_RUP_BIN", &rup)
                .env("ROUNDUP_CLAUDE_BIN", &fake)
                .env("FAKE_CLAUDE_LAUNCH_LOG", dir.join("launch"))
                .env("FAKE_CLAUDE_PROMPT_LOG", dir.join("prompts"))
                .env("FAKE_CLAUDE_ON_PROMPT", on_prompt.to_string())
                .env("ROUNDUP_DATA_DIR", data);
        });
        let mut daemon = launch;
        let mut stderr = daemon.stderr.take().unwrap();
        std::thread::spawn(move || std::io::copy(&mut stderr, &mut std::io::stderr()));
        daemon
    }

    async fn start_door(&self) {
        self.user
            .request("rail.startDoor", json!({"id":self.door}))
            .await
            .unwrap();
        self.until(|| !self.prompts().is_empty()).await;
    }

    async fn until(&self, ready: impl Fn() -> bool) {
        tokio::time::timeout(BOUND, async {
            while !ready() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!(
                "the fake claude reached the state: {:?} {:?}",
                self.launches(),
                self.prompts()
            )
        });
    }

    fn lines(&self, name: &str) -> Vec<Value> {
        std::fs::read_to_string(self.dir.path().join(name))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    fn launches(&self) -> Vec<Value> {
        self.lines("launch")
    }

    fn prompts(&self) -> Vec<Value> {
        self.lines("prompts")
    }

    /// Wait until the Door is idle and has stayed so for 300 ms, after the prompts typed so far.
    async fn idle(&self) {
        tokio::time::timeout(BOUND, async {
            let mut since: Option<(usize, std::time::Instant)> = None;
            loop {
                let tree = self.user.request("rail.tree", Value::Null).await.unwrap();
                let idle = tree
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|n| n["id"] == self.door && n["status"]["kind"] == "idle");
                let typed = self.prompts().len();
                match since {
                    Some((count, at)) if idle && count == typed => {
                        if at.elapsed() > Duration::from_millis(300) {
                            return;
                        }
                    }
                    _ => since = idle.then(|| (typed, std::time::Instant::now())),
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("the Door went idle");
    }

    async fn start_door_again(&self, launches: usize) {
        self.user
            .request("rail.startDoor", json!({"id":self.door}))
            .await
            .unwrap();
        self.until(|| self.launches().len() >= launches).await;
    }

    async fn restart(&mut self) {
        drop(self.daemon.stdin.take());
        while self.daemon.child.try_wait().unwrap().is_none() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        self.daemon = Self::launch(self.dir.path(), self.data.path(), &self.summary);
        self.user = Client::connect(&self.daemon.socket).await.unwrap();
    }

    /// The old Iteration's ask: the word in a Message, a Todo and a Pad.
    async fn ask(&self, delivered: bool) {
        self.user
            .request(
                "message.send",
                json!({"to":self.door,"kind":"note","body":format!("{WORD} plan")}),
            )
            .await
            .unwrap();
        self.user
            .request("todo.create", json!({"title":format!("{WORD} todo")}))
            .await
            .unwrap();
        self.user
            .request(
                "pad.create",
                json!({"name":"plan","text":format!("{WORD} pad")}),
            )
            .await
            .unwrap();
        if delivered {
            self.until(|| {
                self.prompts()
                    .iter()
                    .any(|p| p["prompt"].to_string().contains(WORD))
            })
            .await;
            self.idle().await;
        }
    }

    /// Clear and wait for the next session's first prompt.
    async fn clear(&self) {
        self.user
            .request(
                "workstream.clear",
                json!({"id":self.door,"reason":"start over"}),
            )
            .await
            .unwrap();
        self.until(|| self.launches().len() >= 2 && !self.after_the_ask().is_empty())
            .await;
    }

    /// The prompts typed after the clear's ask: the new session's.
    fn after_the_ask(&self) -> Vec<Value> {
        self.prompts()
            .into_iter()
            .skip_while(|p| !p["prompt"].as_str().unwrap().contains("Write the Handoff"))
            .skip(1)
            .collect()
    }

    /// Everything the second session was given: argv, the files argv names, and every prompt.
    fn second_session(&self) -> String {
        let mut record = String::new();
        for launch in self.launches().iter().skip(1) {
            record.push_str(&launch.to_string());
            for arg in launch["argv"].as_array().unwrap() {
                if let Ok(text) = std::fs::read_to_string(arg.as_str().unwrap()) {
                    record.push_str(&text);
                }
            }
        }
        for prompt in self.after_the_ask() {
            record.push_str(&prompt.to_string());
        }
        record
    }
}

fn word_free(w: &World) {
    let record = w.second_session();
    assert!(!record.contains(WORD), "{record}");
}

#[tokio::test]
async fn b55_the_next_session_holds_no_word_of_the_old_ask() {
    let w = World::start("Build the login page.").await;
    w.idle().await;
    w.ask(true).await;
    w.clear().await;
    assert!(!w.launches()[1]["argv"].to_string().contains("--resume"));
    word_free(&w);
}

#[tokio::test]
async fn b55_the_word_appears_only_inside_the_handoff_when_the_summary_has_it() {
    let w = World::start(&format!("Build the {WORD} page.")).await;
    w.idle().await;
    w.ask(true).await;
    w.clear().await;
    let record = w.second_session();
    assert_eq!(record.matches(WORD).count(), 1, "{record}");
    let first = w
        .prompts()
        .into_iter()
        .rev()
        .find(|p| p["resume"] == false)
        .unwrap();
    assert!(first["prompt"].as_str().unwrap().contains(WORD));
    assert!(!w.launches()[1]["argv"].to_string().contains("--resume"));
}

#[tokio::test]
async fn b55_a_restart_and_start_door_still_holds_no_word() {
    let mut w = World::start("Build the login page.").await;
    w.idle().await;
    w.ask(true).await;
    w.clear().await;
    w.restart().await;
    w.start_door_again(3).await;
    word_free(&w);
}

#[tokio::test]
async fn b55_pending_held_and_waiting_messages_of_the_old_iteration_are_not_replayed() {
    let w = World::start("Build the login page.").await;
    w.idle().await;
    w.user
        .request(
            "route.set",
            json!({"from":"you","to":w.door,"delivery":"ask-first"}),
        )
        .await
        .unwrap();
    w.ask(false).await;
    w.clear().await;
    w.idle().await;
    word_free(&w);
}

#[tokio::test]
async fn b55_thirty_idle_edges_of_the_new_session_type_none_of_it() {
    let w = World::start("Build the login page.").await;
    w.idle().await;
    w.ask(true).await;
    w.clear().await;
    w.idle().await;
    for _ in 0..30 {
        let tree = w.user.request("rail.tree", Value::Null).await.unwrap();
        let attempt = tree
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == w.door)
            .unwrap()["attempt"]
            .clone();
        w.user
            .request(
                "agent.signal",
                json!({"id":w.door,"attempt":attempt,"payload":{"hook_event_name":"Stop"}}),
            )
            .await
            .unwrap();
    }
    word_free(&w);
}
