//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::{Client, RpcError};
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

const BOUND: Duration = Duration::from_secs(15);

struct Run {
    daemon: rupd_harness::Rupd,
    dir: tempfile::TempDir,
    data: tempfile::TempDir,
    user: Arc<Client>,
    child: String,
    terminal: Value,
    attempt: Value,
}

impl Run {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let fake = dir.path().join("claude");
        std::fs::write(&fake, r#"#!/usr/bin/env python3
import json, os, subprocess, sys, tty
tty.setraw(0)
print('\033]0;✳ Ready\007', flush=True)
settings = json.load(open(sys.argv[sys.argv.index('--settings') + 1]))
def hook(event, fields):
    fields['hook_event_name'] = event
    for group in settings['hooks'][event]:
        for item in group['hooks']:
            subprocess.run(item['command'], shell=True, input=json.dumps(fields), text=True, check=True)
hook('SessionStart', {'session_id':'00000000-0000-4000-8000-000000000006','source':'resume' if '--resume' in sys.argv else 'startup'})
if '--resume' not in sys.argv:
    pending = b''
    while not pending.endswith(b'\r'):
        pending += os.read(0, 1)
    text = pending.decode().replace('\x1b[200~','').replace('\x1b[201~','').removeprefix('Follow this instruction: ').strip()
    hook('UserPromptSubmit', {'prompt':text})
hook('Stop', {})
print('READY', flush=True)
while True:
    data = os.read(0, 1)
    if not data: break
    print('BYTE:' + data.hex(), flush=True)
"#).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let daemon = launch(dir.path(), data.path());
        let user = Arc::new(Client::connect(&daemon.socket).await.unwrap());
        let mut run = Self {
            daemon,
            dir,
            data,
            user,
            child: String::new(),
            terminal: Value::Null,
            attempt: Value::Null,
        };
        run.spawn().await;
        run
    }

    async fn spawn(&mut self) {
        assert!(self.data.path().is_dir());
        let node = self
            .user
            .request("agent.spawn", json!({"name":"child","cwd":self.dir.path()}))
            .await
            .unwrap();
        self.child = node["id"].as_str().unwrap().to_owned();
        self.terminal = node["terminal_id"].clone();
        self.attempt = node["attempt"].clone();
        tokio::time::timeout(BOUND, async {
            loop {
                if self.screen().await.contains("READY") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    async fn screen(&self) -> String {
        self.user
            .request("terminal.read", json!({"id":self.terminal,"after":0}))
            .await
            .unwrap()["text"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    async fn open(&self, kind: &str) -> (Value, tokio::task::JoinHandle<Result<Value, RpcError>>) {
        let caller = Arc::new(Client::connect(&self.daemon.socket).await.unwrap());
        if kind == "ask_user" {
            caller
                .request(
                    "daemon.identify",
                    json!({"actor":{"kind":"agent","id":self.child}}),
                )
                .await
                .unwrap();
        }
        let child = self.child.clone();
        let kind = kind.to_owned();
        let task = tokio::spawn(async move {
            if kind == "ask_user" {
                caller.request("agent.ask", json!({"question":"Same prompt?","answers":[{"label":"Yes","description":"Proceed"}]})).await
            } else {
                let mut payload = if kind == "native" {
                    json!({"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Same prompt?","options":[{"label":"Yes"}]}]}})
                } else {
                    json!({"tool_name":"Bash","tool_input":{"command":"Same prompt?"}})
                };
                payload["hook_event_name"] = json!("PermissionRequest");
                caller
                    .request("agent.permission", json!({"id":child,"payload":payload}))
                    .await
            }
        });
        let decision = tokio::time::timeout(BOUND, async {
            loop {
                let listed = self.user.request("decision.list", ()).await.unwrap();
                if let Some(decision) = listed.as_array().unwrap().first() {
                    return decision.clone();
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        (decision, task)
    }

    async fn capture(&self, decision: &Value) -> Value {
        self.user
            .request("decision.capture", json!({"id":decision["id"]}))
            .await
            .unwrap()
    }

    async fn clear(&self) {
        self.user.request("agent.signal", json!({"id":self.child,"attempt":self.attempt,"payload":{"hook_event_name":"PostToolUse"}})).await.unwrap();
    }

    async fn write(&self, identity: Value, bytes: &[u8]) -> Result<Value, RpcError> {
        self.user
            .request(
                "terminal.write",
                json!({"id":self.terminal,"data":STANDARD.encode(bytes),"identity":identity}),
            )
            .await
    }

    async fn user_answer(&self, decision: &Value, kind: &str) {
        if kind == "native" {
            self.user
                .request(
                    "terminal.write",
                    json!({"id":self.terminal,"data":STANDARD.encode(b"u")}),
                )
                .await
                .unwrap();
            self.clear().await;
        } else {
            self.user.request("decision.answer", json!({"id":decision["id"],"answer":if kind == "permission" {"allow"} else {"Yes"},"proof":"0".repeat(64)})).await.unwrap();
        }
    }

    async fn guarded_answer(
        &self,
        decision: &Value,
        identity: Value,
        kind: &str,
    ) -> Result<Value, RpcError> {
        self.user.request("decision.answer", json!({"id":decision["id"],"identity":identity,"answer":if kind == "permission" {"allow"} else {"Yes"},"proof":"0".repeat(64)})).await
    }

    async fn resumed(&mut self) {
        let node = self
            .user
            .request("agent.resume", json!({"id":self.child}))
            .await
            .unwrap();
        self.terminal = node["terminal_id"].clone();
        self.attempt = node["attempt"].clone();
        tokio::time::timeout(BOUND, async {
            loop {
                if self.screen().await.contains("READY") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    async fn paused(&self) {
        let arrival = self.dir.path().join("effect-gate.arrived");
        tokio::time::timeout(BOUND, async {
            loop {
                if arrival.is_file() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    fn pause(&self) {
        let arrival = self.dir.path().join("effect-gate.arrived");
        if arrival.exists() {
            std::fs::remove_file(arrival).unwrap();
        }
        std::fs::write(self.dir.path().join("effect-gate"), "before").unwrap();
    }

    fn release(&self) {
        std::fs::remove_file(self.dir.path().join("effect-gate")).unwrap();
    }

    async fn finish(self) {
        self.user
            .request("agent.stop", json!({"id":self.child}))
            .await
            .unwrap();
    }
}

fn launch(project: &Path, data: &Path) -> rupd_harness::Rupd {
    let rup = Path::new(env!("CARGO_BIN_EXE_rupd")).with_file_name("rup");
    assert!(rup.is_file(), "cargo build -p rup first");
    rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project,
        true,
        |command| {
            command
                .env("TOKIO_WORKER_THREADS", "4")
                .env("RUPD_PROMPT_EFFECT_GATE", project.join("effect-gate"))
                .env("ROUNDUP_DATA_DIR", data)
                .env("ROUNDUP_CLAUDE_BIN", project.join("claude"))
                .env("ROUNDUP_RUP_BIN", rup)
                .env("CLAUDE_CONFIG_DIR", project.join("config"))
                .stderr(std::process::Stdio::null());
        },
    )
}

#[tokio::test]
async fn b6_original_prompt_identity_refuses_identical_replacements() {
    let run = Run::start().await;
    for kind in ["permission", "ask_user", "native"] {
        let (original, waiting) = run.open(kind).await;
        let identity = run.capture(&original).await;
        run.user_answer(&original, kind).await;
        let _ = waiting.await.unwrap();
        let (replacement, waiting) = run.open(kind).await;
        assert_eq!(original["args"], replacement["args"]);
        let err = run.write(identity, b"old\r").await.unwrap_err();
        assert_eq!(err.code, rpc::code::CONFLICT);
        assert!(err.message.contains("original prompt"), "{err:?}");
        assert!(!err.message.contains("observer"), "{err:?}");
        // Only the user's native answer may have reached the Terminal.
        assert!(
            !run.screen().await.contains("BYTE:6f"),
            "old answer reached the replacement"
        );
        run.clear().await;
        let _ = waiting.await.unwrap();
    }
    run.finish().await;
}

#[tokio::test]
async fn b6_a_valid_original_prompt_has_one_effect() {
    let run = Run::start().await;
    for kind in ["permission", "ask_user", "native"] {
        let (decision, waiting) = run.open(kind).await;
        let identity = run.capture(&decision).await;
        if kind == "native" {
            run.write(identity.clone(), b"v").await.unwrap();
            let err = run.write(identity, b"duplicate").await.unwrap_err();
            assert_eq!(err.code, rpc::code::CONFLICT);
            assert!(err.message.contains("original prompt"));
            tokio::time::timeout(BOUND, async {
                loop {
                    if run.screen().await.contains("BYTE:76") {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            assert_eq!(run.screen().await.matches("BYTE:").count(), 1);
            // H7: typing does not prematurely remove the native Decision Card.
            assert_eq!(
                run.user.request("decision.list", ()).await.unwrap()[0]["id"],
                decision["id"]
            );
            run.clear().await;
        } else {
            run.guarded_answer(&decision, identity.clone(), kind)
                .await
                .unwrap();
            let err = run
                .guarded_answer(&decision, identity, kind)
                .await
                .unwrap_err();
            assert_eq!(err.code, rpc::code::CONFLICT);
            assert!(err.message.contains("original prompt"));
        }
        let reply = waiting.await.unwrap().unwrap();
        if kind == "permission" {
            assert!(reply["output"].as_str().unwrap().contains("allow"));
        }
        if kind == "ask_user" {
            assert_eq!(reply["answer"], "Yes");
        }
    }
    run.finish().await;
}

#[tokio::test]
async fn b6_terminal_input_invalidates_identity_before_the_next_signal() {
    let run = Run::start().await;
    for kind in ["permission", "ask_user", "native"] {
        let (decision, waiting) = run.open(kind).await;
        let identity = run.capture(&decision).await;
        run.user
            .request(
                "terminal.write",
                json!({"id":run.terminal,"data":STANDARD.encode(b"u")}),
            )
            .await
            .unwrap();
        let unavailable = run
            .user
            .request("decision.capture", json!({"id":decision["id"]}))
            .await
            .unwrap_err();
        assert!(unavailable.message.contains("identity unavailable"));
        assert!(
            run.write(identity.clone(), b"old")
                .await
                .unwrap_err()
                .message
                .contains("original prompt")
        );
        if kind != "native" {
            assert!(
                run.guarded_answer(&decision, identity, kind)
                    .await
                    .unwrap_err()
                    .message
                    .contains("original prompt")
            );
        }
        run.clear().await;
        let _ = waiting.await.unwrap();
    }
    assert!(!run.screen().await.contains("BYTE:6f"));
    let unavailable = run
        .user
        .request("decision.capture", json!({"id":"absent"}))
        .await
        .unwrap_err();
    assert!(unavailable.message.contains("unavailable"));
    run.finish().await;
}

#[tokio::test]
async fn b6_attempt_change_and_restart_refuse_old_prompt_effects_even_with_d1_reused() {
    for kind in ["permission", "ask_user", "native"] {
        let mut run = Run::start().await;
        let (original, waiting) = run.open(kind).await;
        assert_eq!(original["id"], "d1");
        let identity = run.capture(&original).await;
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
        let _ = waiting.await.unwrap();
        let attempt = run.attempt.clone();
        run.resumed().await;
        assert_ne!(run.attempt, attempt);
        let (replacement, waiting) = run.open(kind).await;
        assert_eq!(original["args"], replacement["args"]);
        assert!(
            run.write(identity.clone(), b"old")
                .await
                .unwrap_err()
                .message
                .contains("original prompt")
        );
        if kind != "native" {
            assert!(
                run.guarded_answer(&original, identity.clone(), kind)
                    .await
                    .unwrap_err()
                    .message
                    .contains("original prompt")
            );
        }
        run.clear().await;
        let _ = waiting.await.unwrap();
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
        run.daemon.child.kill().unwrap();
        run.daemon.child.wait().unwrap();
        run.daemon = launch(run.dir.path(), run.data.path());
        run.user = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
        run.resumed().await;
        let (replacement, waiting) = run.open(kind).await;
        assert_eq!(replacement["id"], "d1");
        assert_eq!(original["args"], replacement["args"]);
        let fresh = run.capture(&replacement).await;
        assert_ne!(identity["daemon"], fresh["daemon"]);
        assert!(
            run.write(identity.clone(), b"old")
                .await
                .unwrap_err()
                .message
                .contains("original prompt")
        );
        if kind != "native" {
            assert!(
                run.guarded_answer(&original, identity.clone(), kind)
                    .await
                    .unwrap_err()
                    .message
                    .contains("original prompt")
            );
        }
        // The Daemon run is an independent fence, even if Attempt and d1 coincide.
        let mut reused = identity;
        reused["attempt"] = fresh["attempt"].clone();
        assert!(
            run.write(reused, b"old")
                .await
                .unwrap_err()
                .message
                .contains("original prompt")
        );
        assert!(!run.screen().await.contains("BYTE:"));
        run.clear().await;
        let _ = waiting.await.unwrap();
        run.finish().await;
    }
}

#[tokio::test]
async fn b6_a_paused_effect_refuses_after_the_user_answers_or_replaces_the_original() {
    for kind in ["permission", "ask_user", "native"] {
        for answer_effect in [false, true] {
            if kind == "native" && answer_effect {
                continue;
            }
            let run = Run::start().await;
            let (original, waiting) = run.open(kind).await;
            let identity = run.capture(&original).await;
            run.pause();
            let caller = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
            let params = if answer_effect {
                json!({"id":original["id"],"identity":identity,"answer":if kind == "permission" {"allow"} else {"Yes"},"proof":"0".repeat(64)})
            } else {
                json!({"id":run.terminal,"data":STANDARD.encode(b"old"),"identity":identity})
            };
            let effect = tokio::spawn(async move {
                caller
                    .request(
                        if answer_effect {
                            "decision.answer"
                        } else {
                            "terminal.write"
                        },
                        params,
                    )
                    .await
            });
            run.paused().await;
            run.user_answer(&original, kind).await;
            let _ = waiting.await.unwrap();
            let (replacement, waiting) = run.open(kind).await;
            assert_eq!(original["args"], replacement["args"]);
            run.release();
            let err = effect.await.unwrap().unwrap_err();
            assert_eq!(err.code, rpc::code::CONFLICT);
            assert!(err.message.contains("original prompt"), "{err:?}");
            assert!(!err.message.contains("observer"), "{err:?}");
            assert!(!run.screen().await.contains("BYTE:6f"));
            assert_eq!(
                run.user.request("decision.list", ()).await.unwrap()[0]["id"],
                replacement["id"]
            );
            // The replacement still has its own usable identity.
            let fresh = run.capture(&replacement).await;
            if kind == "native" {
                run.write(fresh, b"v").await.unwrap();
                run.clear().await;
            } else {
                run.guarded_answer(&replacement, fresh, kind).await.unwrap();
            }
            waiting.await.unwrap().unwrap();
            run.finish().await;
        }
    }
}

#[tokio::test]
async fn b6_a_checked_effect_completes_before_a_racing_prompt_replacement() {
    for kind in ["permission", "ask_user", "native"] {
        let run = Run::start().await;
        let (original, waiting) = run.open(kind).await;
        let identity = run.capture(&original).await;
        std::fs::write(run.dir.path().join("effect-gate"), "effect").unwrap();
        let caller = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
        let params = json!({"id":run.terminal,"data":STANDARD.encode(b"v"),"identity":identity});
        let effect = tokio::spawn(async move { caller.request("terminal.write", params).await });
        run.paused().await;
        // Submit replacement before releasing the physical write. The Signal's fold must
        // acquire the same locks, so it cannot invalidate midway through the old effect.
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        let mut user = tokio::net::UnixStream::connect(&run.daemon.socket)
            .await
            .unwrap();
        let signal = json!({"jsonrpc":"2.0","id":1,"method":"agent.signal","params":{"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"PostToolUse"}}});
        user.write_all(format!("{signal}\n").as_bytes())
            .await
            .unwrap();
        run.release();
        effect.await.unwrap().unwrap();
        let mut response = String::new();
        tokio::io::BufReader::new(user)
            .read_line(&mut response)
            .await
            .unwrap();
        assert!(
            serde_json::from_str::<Value>(&response)
                .unwrap()
                .get("result")
                .is_some(),
            "{response}"
        );
        let _ = waiting.await.unwrap();
        let (replacement, waiting) = run.open(kind).await;
        assert_eq!(original["args"], replacement["args"]);
        tokio::time::timeout(BOUND, async {
            loop {
                if run.screen().await.contains("BYTE:76") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(run.screen().await.matches("BYTE:").count(), 1);
        assert!(run.capture(&replacement).await.is_object());
        run.clear().await;
        let _ = waiting.await.unwrap();
        run.finish().await;
    }
}
