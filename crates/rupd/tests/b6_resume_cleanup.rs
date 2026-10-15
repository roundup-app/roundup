//! Resume completion includes the failed Attempt's physical Terminal cleanup.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use rpc::Client;
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const BOUND: Duration = Duration::from_secs(15);
const CONVERSATION: &str = "11111111-1111-4111-8111-111111111111";

struct Run {
    _daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    _data: tempfile::TempDir,
    user: Arc<Client>,
    child: Value,
    db: rusqlite::Connection,
}

async fn arrived(path: &Path) {
    tokio::time::timeout(BOUND, async {
        while !path.is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("observer never reached {}", path.display()));
}

impl Run {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, r#"#!/usr/bin/env python3
import json, os, subprocess, sys, time, tty
if sys.argv[1:3] == ['plugin', 'list']:
    print('[]'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'test']:
    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
tty.setraw(0)
if '--resume' not in sys.argv:
    settings = json.load(open(sys.argv[sys.argv.index('--settings')+1]))
    payload = json.dumps({'hook_event_name':'SessionStart','source':'startup','session_id':'11111111-1111-4111-8111-111111111111'})
    for group in settings['hooks']['SessionStart']:
        for hook in group['hooks']:
            subprocess.run(hook['command'], shell=True, input=payload, text=True, check=True)
    print('SAVED', flush=True)
else:
    print('RESUMED', flush=True)
while True: time.sleep(60)
"#).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let rup = Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup");
        assert!(rup.is_file(), "cargo build -p rup first");
        let daemon = rupd_harness::start(
            Path::new(env!("CARGO_BIN_EXE_rupd")),
            dir.path(),
            true,
            |command| {
                command
                    .env("ROUNDUP_DATA_DIR", data.path())
                    .env("ROUNDUP_CLAUDE_BIN", &fake)
                    .env("ROUNDUP_RUP_BIN", rup)
                    .env("CLAUDE_CONFIG_DIR", dir.path().join("config"))
                    .env("RUPD_RESUME_EFFECT_GATE", dir.path().join("resume"))
                    .stderr(std::process::Stdio::null());
            },
        );
        let user = Arc::new(Client::connect(&daemon.socket).await.unwrap());
        let node = user
            .request("agent.spawn", json!({"name":"child","cwd":dir.path()}))
            .await
            .unwrap();
        tokio::time::timeout(BOUND, async {
            loop {
                let screen = user
                    .request("terminal.read", json!({"id":node["terminal_id"],"after":0}))
                    .await
                    .unwrap();
                if screen["text"].as_str().unwrap().contains("SAVED") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        user.request("agent.stop", json!({"id":node["id"]}))
            .await
            .unwrap();
        let folder = rupd::data::project_data(data.path(), dir.path()).unwrap();
        let db = rusqlite::Connection::open(folder.join("agents.db")).unwrap();
        Self {
            _daemon: daemon,
            dir,
            _data: data,
            user,
            child: node["id"].clone(),
            db,
        }
    }

    fn gate(&self, phase: &str) -> PathBuf {
        self.dir.path().join(format!("resume.{phase}"))
    }

    async fn ack(&self) -> Result<Value, rpc::RpcError> {
        self.user.request("agent.signal", json!({"id":self.child,"attempt":"2","payload":{"hook_event_name":"SessionStart","source":"resume","session_id":CONVERSATION}})).await
    }

    async fn terminal_running(&self, terminal: &str) -> bool {
        let terminals = self.user.request("terminal.list", ()).await.unwrap();
        terminals
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == terminal && t["running"] == true)
    }
}

#[tokio::test]
async fn b6_resume_completion_waits_for_both_promotion_failure_cleanups() {
    for column in ["terminal_id", "conversation_id"] {
        for early_ack in [false, true] {
            let run = Run::start().await;
            run.db.execute_batch(&format!("CREATE TRIGGER refuse_resume BEFORE UPDATE OF {column} ON nodes WHEN NEW.{column} IS NOT NULL BEGIN SELECT RAISE(ABORT, 'resume {column} fault'); END;")).unwrap();
            std::fs::write(run.gate("cleanup"), "pause").unwrap();
            if early_ack {
                std::fs::write(run.gate("claim"), "pause").unwrap();
            }
            let caller = Arc::clone(&run.user);
            let child = run.child.clone();
            let mut resume =
                tokio::spawn(
                    async move { caller.request("agent.resume", json!({"id":child})).await },
                );
            arrived(&run.gate(if early_ack {
                "claim-arrived"
            } else {
                "claimed-arrived"
            }))
            .await;
            let ack = run.ack().await;
            if early_ack {
                ack.unwrap();
                std::fs::remove_file(run.gate("claim")).unwrap();
            } else {
                assert!(ack.unwrap_err().message.contains("fault"));
            }
            arrived(&run.gate("cleanup-arrived")).await;
            let terminal = std::fs::read_to_string(run.gate("cleanup-arrived")).unwrap();
            assert!(run.terminal_running(&terminal).await);
            // The acknowledgement timer must not escape cleanup, even when it expires.
            let early = tokio::time::timeout(
                agents::RESUME_ACK_BOUND + Duration::from_millis(100),
                &mut resume,
            )
            .await;
            std::fs::remove_file(run.gate("cleanup")).unwrap();
            assert!(
                early.is_err(),
                "Resume completed before its cleanup: {early:?}"
            );
            let error = tokio::time::timeout(BOUND, resume)
                .await
                .unwrap()
                .unwrap()
                .unwrap_err();
            assert!(
                error.message.contains(&format!("resume {column} fault")),
                "{error:?}"
            );
            assert!(
                !run.terminal_running(&terminal).await,
                "cleanup reported before exit"
            );
            // A following Resume gets a new Terminal. No task from the failed one can kill it.
            run.db.execute_batch("DROP TRIGGER refuse_resume;").unwrap();
            let caller = Arc::clone(&run.user);
            let child = run.child.clone();
            let next =
                tokio::spawn(
                    async move { caller.request("agent.resume", json!({"id":child})).await },
                );
            tokio::time::timeout(BOUND, async {
                loop {
                    let tree = run.user.request("rail.tree", ()).await.unwrap();
                    if tree
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|n| n["id"] == run.child && n["attempt"] == "3")
                    {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            run.user.request("agent.signal", json!({"id":run.child,"attempt":"3","payload":{"hook_event_name":"SessionStart","source":"resume","session_id":CONVERSATION}})).await.unwrap();
            let node = tokio::time::timeout(BOUND, next)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            run.user
                .request("takeover.begin", json!({"agent":run.child}))
                .await
                .unwrap();
            assert!(
                run.terminal_running(node["terminal_id"].as_str().unwrap())
                    .await
            );
            run.user
                .request("agent.stop", json!({"id":run.child}))
                .await
                .unwrap();
        }
    }
}
