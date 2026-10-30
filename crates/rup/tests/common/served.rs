//! A real `rupd` in a child process of its own, as A4's and A15's tests both need: only a process
//! of its own can be given a fake `claude` and extra environment variables before it starts.

use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const SERVE_ENV: &str = "ROUNDUP_TEST_SERVE_DIR";

/// Not a test of its own: with `SERVE_ENV` set this process becomes a Daemon until it is killed.
#[tokio::test]
async fn serve_for_the_parent() {
    let Some(dir) = std::env::var_os(SERVE_ENV) else {
        return;
    };
    let dir = Path::new(&dir);
    let daemon = rupd::Daemon::open(&dir.join(".roundup")).unwrap();
    let listener = tokio::net::UnixListener::bind(dir.join("rupd.sock")).unwrap();
    rupd::serve(listener, std::sync::Arc::new(daemon))
        .await
        .unwrap();
}

/// Serve an authoritative Project store on an isolated test socket.
#[allow(dead_code)] // Only the MCP integration target uses the in-process server.
pub fn serve(dir: &Path, socket: &Path) -> tokio::task::JoinHandle<std::io::Result<()>> {
    let daemon = Arc::new(rupd::Daemon::open(&dir.join(".roundup")).unwrap());
    tokio::spawn(rupd::serve(
        tokio::net::UnixListener::bind(socket).unwrap(),
        daemon,
    ))
}

/// A Daemon child process that is killed when this drops.
pub struct Served {
    pub dir: tempfile::TempDir,
    child: Child,
    /// Every byte the Daemon wrote to stderr so far; each is passed on to the test's stderr too.
    stderr: Arc<Mutex<Vec<u8>>>,
}

impl Served {
    /// `fake_claude` is the script `ROUNDUP_CLAUDE_BIN` points the Daemon at; `extra_env` is set on
    /// the Daemon's own environment before it starts.
    pub async fn start(fake_claude: &str, extra_env: &[(&str, &str)]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake-claude");
        let fake_claude = fake_claude.replacen(
            "#!/bin/sh\n",
            "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nif [ \"$1\" = --version ]; then echo '2.1.300 (Claude Code)'; exit 0; fi\n",
            1,
        );
        std::fs::write(&fake, fake_claude).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        // `--nocapture`: the Daemon's log lines reach its stderr instead of the test harness's capture.
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "common::serve_for_the_parent", "--nocapture"])
            .env(SERVE_ENV, dir.path())
            .env("RUPD_SOCKET", dir.path().join("rupd.sock"))
            .env("ROUNDUP_CLAUDE_BIN", &fake)
            .env("ROUNDUP_RUP_BIN", env!("CARGO_BIN_EXE_rup"))
            .env("CLAUDE_CONFIG_DIR", dir.path())
            .envs(extra_env.iter().copied())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stderr = Arc::new(Mutex::new(Vec::new()));
        let (mut pipe, kept) = (child.stderr.take().unwrap(), Arc::clone(&stderr));
        std::thread::spawn(move || {
            let mut chunk = [0; 4096];
            while let Ok(n @ 1..) = pipe.read(&mut chunk) {
                let _ = std::io::stderr().write_all(&chunk[..n]);
                kept.lock().unwrap().extend_from_slice(&chunk[..n]);
            }
        });
        let served = Self { dir, child, stderr };
        for _ in 0..500 {
            if rpc::Client::connect(&served.socket()).await.is_ok() {
                return served;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("the Daemon never listened");
    }

    pub fn socket(&self) -> std::path::PathBuf {
        self.dir.path().join("rupd.sock")
    }

    /// What the Daemon has written to stderr so far.
    #[allow(dead_code)] // signal.rs reads it; the other includers do not
    pub fn stderr(&self) -> String {
        String::from_utf8_lossy(&self.stderr.lock().unwrap()).into_owned()
    }
}

impl Drop for Served {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Populated real-Daemon fixture for the Rail-name result scenarios.
#[allow(dead_code)] // Each integration target exercises a different surface.
pub struct NamedRail {
    pub served: Served,
    pub user: rpc::Client,
    pub door: String,
    pub child: String,
    pub peer: String,
}

#[allow(dead_code)]
impl NamedRail {
    pub async fn start() -> Self {
        use serde_json::json;
        let fake = format!(
            "#!/bin/sh\nexec python3 '{}/tests/e2e/fake_claude.py' \"$@\"\n",
            env!("CARGO_MANIFEST_DIR")
        );
        let served = Served::start(&fake, &[("FAKE_CLAUDE_PROMPT_LOG", "/dev/null")]).await;
        for args in [
            vec!["init", "-b", "main"],
            vec![
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        ] {
            let output = Command::new("git")
                .args(args)
                .current_dir(served.dir.path())
                .output()
                .unwrap();
            assert!(output.status.success(), "{:?}", output);
        }
        let user = rpc::Client::connect(&served.socket()).await.unwrap();
        user.request("project.setWorktrees", json!({"on":true,"check":null}))
            .await
            .unwrap();
        let door = user
            .request("rail.createWorkstream", json!({"name":"Research"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let mut events = rpc::Client::connect(&served.socket()).await.unwrap();
        events.request("events.subscribe", ()).await.unwrap();
        user.request("rail.startDoor", json!({"id":door}))
            .await
            .unwrap();
        Self::idle(&mut events, &door).await;
        let mut fx = Self {
            served,
            user,
            door,
            child: String::new(),
            peer: String::new(),
        };
        fx.child = fx.spawn("Writer").await;
        fx.peer = fx.spawn("Reviewer").await;
        fx
    }

    pub async fn idle(events: &mut rpc::Client, id: &str) {
        tokio::time::timeout(Duration::from_secs(20), async {
            while let Some(event) = events.next_event().await {
                if let contracts::EventData::AgentStatus(status) = event.data
                    && status.id == id
                    && status.status.kind == contracts::Kind::Idle
                {
                    return;
                }
            }
            panic!("event connection closed");
        })
        .await
        .expect("Agent became idle");
    }

    pub async fn spawn(&self, name: &str) -> String {
        use serde_json::json;
        let mut events = rpc::Client::connect(&self.served.socket()).await.unwrap();
        events.request("events.subscribe", ()).await.unwrap();
        let id = self
            .user
            .request(
                "agent.spawn",
                json!({"cwd":self.served.dir.path(),"parent":self.door,"name":name}),
            )
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        Self::idle(&mut events, &id).await;
        id
    }

    pub async fn rename(&self) {
        for (id, name) in [
            (&self.door, "Planning"),
            (&self.child, "Author"),
            (&self.peer, "Editor"),
        ] {
            self.user
                .request("rail.rename", serde_json::json!({"id":id,"name":name}))
                .await
                .unwrap();
        }
    }
}
