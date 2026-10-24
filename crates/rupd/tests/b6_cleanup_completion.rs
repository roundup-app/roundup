//! B6 cleanup completion: Resume completion includes the failed Attempt's physical Terminal cleanup.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

mod cleanup_completion {
    // Resume completion includes the failed Attempt's physical Terminal cleanup.
    use super::rupd_harness;

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
import json, os, signal, subprocess, sys, time, tty
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
# Setup and explicit resolution obey Claude's normal exit key; failed Resume cleanup
# still kills the real PTY child directly and must confirm its exit.
while True:
    data = os.read(0, 1)
    if not data or data == b'\x03': break
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
                        .env("RUPD_TERMINAL_EXIT_GATE", dir.path().join("hold-exit"))
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
            let db = rusqlite::Connection::open(folder.join("project.db")).unwrap();
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

        async fn node(&self) -> Value {
            let tree = self.user.request("rail.tree", ()).await.unwrap();
            tree.as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == self.child)
                .unwrap()
                .clone()
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

    impl Drop for Run {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.dir.path().join("hold-exit"));
            let _ = std::fs::remove_file(self.gate("cleanup"));
            let _ = std::fs::remove_file(self.gate("claim"));
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
                let mut resume = tokio::spawn(async move {
                    caller.request("agent.resume", json!({"id":child})).await
                });
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
                assert!(
                    run.terminal_running(&terminal).await,
                    "cleanup marker named {terminal:?}"
                );
                let retry = run
                    .user
                    .request("agent.resume", json!({"id":run.child}))
                    .await
                    .unwrap_err();
                assert!(retry.message.contains(&terminal), "{retry:?}");
                assert_eq!(
                    run.node().await["attempt"],
                    "2",
                    "retry allocated an Attempt during cleanup"
                );
                // The acknowledgement timer must not escape cleanup, even when it expires.
                let early = tokio::time::timeout(
                    if column == "terminal_id" && !early_ack {
                        agents::RESUME_ACK_BOUND + Duration::from_millis(100)
                    } else {
                        // The other cases exercise different save/ack paths, but share the
                        // same completion timer. Cross its deadline once, not four times.
                        Duration::from_millis(100)
                    },
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
                assert_ne!(error.code, rpc::code::UNKNOWN_OUTCOME, "{error:?}");
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
                let next = tokio::spawn(async move {
                    caller.request("agent.resume", json!({"id":child})).await
                });
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

    #[tokio::test]
    async fn b6_cleanup_refusal_preserves_the_resume_failure_and_blocks_a_blind_retry() {
        failed_cleanup(false).await;
    }

    #[tokio::test]
    async fn b6_unconfirmed_terminal_exit_preserves_the_resume_failure_and_blocks_a_blind_retry() {
        failed_cleanup(true).await;
    }

    async fn failed_cleanup(uncertain: bool) {
        let run = Run::start().await;
        run.db.execute_batch("CREATE TRIGGER refuse_resume BEFORE UPDATE OF conversation_id ON nodes BEGIN SELECT RAISE(ABORT, 'resume save fault'); END;").unwrap();
        if uncertain {
            std::fs::write(run.dir.path().join("hold-exit"), "hold").unwrap();
        } else {
            std::fs::write(run.gate("cleanup"), "refuse").unwrap();
        }
        let caller = Arc::clone(&run.user);
        let child = run.child.clone();
        let resume =
            tokio::spawn(async move { caller.request("agent.resume", json!({"id":child})).await });
        arrived(&run.gate("claimed-arrived")).await;
        assert!(
            run.ack()
                .await
                .unwrap_err()
                .message
                .contains("resume save fault")
        );
        let error = tokio::time::timeout(BOUND, resume)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        let terminal = std::fs::read_to_string(run.gate("cleanup-arrived")).unwrap();
        assert_eq!(error.code, rpc::code::UNKNOWN_OUTCOME, "{error:?}");
        assert!(error.message.contains("resume save fault"), "{error:?}");
        assert!(error.message.contains(&terminal), "{error:?}");
        assert!(error.message.contains("do not retry Resume"), "{error:?}");
        assert!(
            error.message.contains(if uncertain {
                "exit not confirmed"
            } else {
                "refused before kill"
            }),
            "{error:?}"
        );
        assert!(run.terminal_running(&terminal).await);
        let retry = run
            .user
            .request("agent.resume", json!({"id":run.child}))
            .await
            .unwrap_err();
        assert_eq!(retry, error, "a retry lost the original outcome");
        let node = run.node().await;
        assert_eq!(node["attempt"], "2");
        assert_eq!(node["terminal_id"], terminal);
        assert_eq!(node["can_resume"], false);
        // Only explicit resolution of the remaining Terminal makes another Resume safe.
        if uncertain {
            let stop = run
                .user
                .request("agent.stop", json!({"id":run.child}))
                .await
                .unwrap_err();
            assert_eq!(stop.code, rpc::code::UNKNOWN_OUTCOME, "{stop:?}");
            assert_eq!(
                run.node().await["can_resume"],
                false,
                "an unconfirmed stop authorized Resume"
            );
            std::fs::remove_file(run.dir.path().join("hold-exit")).unwrap();
            tokio::time::timeout(BOUND, async {
                while run.terminal_running(&terminal).await {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
        } else {
            std::fs::remove_file(run.gate("cleanup")).unwrap();
        }
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
        assert!(!run.terminal_running(&terminal).await);
        assert_eq!(run.node().await["can_resume"], true);
    }

    #[tokio::test]
    async fn b6_ack_timeout_waits_for_rollback_cleanup_and_accounts_for_refusal() {
        let run = Run::start().await;
        std::fs::write(run.gate("cleanup"), "pause").unwrap();
        let caller = Arc::clone(&run.user);
        let child = run.child.clone();
        let mut resume =
            tokio::spawn(async move { caller.request("agent.resume", json!({"id":child})).await });
        arrived(&run.gate("cleanup-arrived")).await;
        let terminal = std::fs::read_to_string(run.gate("cleanup-arrived")).unwrap();
        let early = tokio::time::timeout(Duration::from_millis(100), &mut resume).await;
        std::fs::write(run.gate("cleanup"), "refuse").unwrap();
        assert!(
            early.is_err(),
            "timeout escaped rollback cleanup: {early:?}"
        );
        let error = tokio::time::timeout(BOUND, resume)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert_eq!(error.code, rpc::code::UNKNOWN_OUTCOME);
        assert!(
            error.message.contains("no acknowledgement within 10s"),
            "{error:?}"
        );
        assert!(error.message.contains("refused before kill"), "{error:?}");
        assert!(error.message.contains(&terminal), "{error:?}");
        assert!(run.terminal_running(&terminal).await);
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
    }
}
