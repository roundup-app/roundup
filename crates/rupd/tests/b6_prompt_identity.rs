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
    door: Option<String>,
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
if sys.argv[1:3] == ['plugin', 'list']:
    print('[]'); sys.exit(0)
if sys.argv[1:3] == ['plugin', 'test']:
    print('Q11 runtime hook closure: 1 pass'); sys.exit(0)
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
pending = b''
while True:
    data = os.read(0, 1)
    if not data: break
    print('BARRIER' if data == b'\x00' else 'BYTE:' + data.hex(), flush=True)
    if data != b'\x00': pending += data
    if data == b'\r' and os.path.isfile('order-submit'):
        text = pending.decode().replace('\x1b[200~','').replace('\x1b[201~','').removeprefix('Follow this instruction: ').strip()
        pending = b''
        hook('UserPromptSubmit', {'prompt':text})
        hook('Stop', {})
        print('SUBMITTED', flush=True)
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
            door: None,
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
            .request(
                "agent.spawn",
                json!({"name":"child","cwd":self.dir.path(),"parent":self.door}),
            )
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
        let before = self.user.request("decision.list", ()).await.unwrap();
        let before = before.as_array().unwrap().first().map(|d| d["id"].clone());
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
                let mut payload = if kind == "unreadable" {
                    json!({})
                } else if kind == "native" {
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
                if let Some(decision) = listed.as_array().unwrap().first()
                    && Some(&decision["id"]) != before.as_ref()
                {
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

    async fn recorded_input(&self) -> String {
        // A NUL is a recording-handler barrier, not a prompt answer. Its receipt proves
        // the input thread and fake Claude consumed everything preceding the refusal.
        let before = self.screen().await.matches("BARRIER").count();
        let observer = Client::connect(&self.daemon.socket).await.unwrap();
        observer
            .request(
                "daemon.identify",
                json!({"actor":{"kind":"ext","id":"b6-observer"}}),
            )
            .await
            .unwrap();
        observer
            .request(
                "terminal.write",
                json!({"id":self.terminal,"data":STANDARD.encode(b"\0")}),
            )
            .await
            .unwrap();
        tokio::time::timeout(BOUND, async {
            loop {
                let recorded = self.screen().await;
                if recorded.matches("BARRIER").count() == before + 1 {
                    return recorded;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap()
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
                .env("TOKIO_WORKER_THREADS", "16")
                .env("RUPD_PROMPT_EFFECT_GATE", project.join("effect-gate"))
                .env("RUPD_ORDER_EFFECT_GATE", project.join("order-effect-gate"))
                .env("RUPD_TERMINAL_INPUT_GATE", project.join("input-gate"))
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
            !run.recorded_input().await.contains("BYTE:6f"),
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
    assert!(!run.recorded_input().await.contains("BYTE:6f"));
    let unavailable = run
        .user
        .request("decision.capture", json!({"id":"absent"}))
        .await
        .unwrap_err();
    assert!(unavailable.message.contains("unavailable"));
    run.finish().await;
}

#[tokio::test]
async fn b6_an_attempt_change_refuses_the_original_prompt_effect() {
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
        assert!(!run.recorded_input().await.contains("BYTE:"));
        run.finish().await;
    }
}

#[tokio::test]
async fn b6_a_daemon_crash_refuses_a_live_original_even_with_d1_reused() {
    for kind in ["permission", "ask_user", "native"] {
        let mut run = Run::start().await;
        let (original, original_waiting) = run.open(kind).await;
        assert_eq!(original["id"], "d1");
        let identity = run.capture(&original).await;
        run.daemon.child.kill().unwrap();
        run.daemon.child.wait().unwrap();
        let old_reply = original_waiting.await.unwrap();
        if kind != "native" {
            assert!(old_reply.is_err());
        }
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
        assert!(!run.recorded_input().await.contains("BYTE:"));
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
            assert!(!run.recorded_input().await.contains("BYTE:6f"));
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
    checked_effect_before_replacement().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn b6_checked_effects_exclude_prompt_replacement_under_parallel_load() {
    let mut runs = tokio::task::JoinSet::new();
    for _ in 0..8 {
        runs.spawn(checked_effect_before_replacement());
    }
    while let Some(result) = runs.join_next().await {
        result.unwrap();
    }
}

async fn checked_effect_before_replacement() {
    for kind in ["permission", "ask_user", "native"] {
        for answer_effect in [false, true] {
            if kind == "native" && answer_effect {
                continue;
            }
            let run = Run::start().await;
            let (original, waiting) = run.open(kind).await;
            let identity = run.capture(&original).await;
            std::fs::write(run.dir.path().join("effect-gate"), "effect").unwrap();
            let caller = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
            let params = if answer_effect {
                json!({"id":original["id"],"identity":identity,"answer":if kind == "permission" {"allow"} else {"Yes"},"proof":"0".repeat(64)})
            } else {
                json!({"id":run.terminal,"data":STANDARD.encode(b"v"),"identity":identity})
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
            tokio::time::timeout(BOUND, async {
                loop {
                    if run.dir.path().join("effect-gate.racing").is_file() {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            assert!(
                !effect.is_finished(),
                "effect left its pause before release"
            );
            // An observation window: a folded replacement would answer this socket.
            // The router's racing acknowledgement bounds its arrival, not a scheduler guess.
            let mut user = tokio::io::BufReader::new(user);
            let mut response = String::new();
            assert!(
                tokio::time::timeout(Duration::from_millis(50), user.read_line(&mut response))
                    .await
                    .is_err(),
                "{kind} answer_effect={answer_effect}: replacement completed while the original effect was paused: {response}"
            );
            run.release();
            effect.await.unwrap().unwrap();
            user.read_line(&mut response).await.unwrap();
            assert!(
                serde_json::from_str::<Value>(&response)
                    .unwrap()
                    .get("result")
                    .is_some(),
                "{response}"
            );
            let outcome = waiting.await.unwrap();
            if answer_effect {
                outcome.unwrap();
            }
            let (replacement, waiting) = run.open(kind).await;
            assert_eq!(original["args"], replacement["args"]);
            let recorded = run.recorded_input().await;
            assert_eq!(
                recorded.matches("BYTE:").count(),
                usize::from(!answer_effect)
            );
            assert!(run.capture(&replacement).await.is_object());
            run.clear().await;
            let _ = waiting.await.unwrap();
            run.finish().await;
        }
    }
}

#[tokio::test]
async fn b6_replacing_an_open_prompt_invalidates_its_captured_effect() {
    let run = Run::start().await;
    for kind in ["permission", "ask_user", "native"] {
        let (original, waiting) = run.open(kind).await;
        let identity = run.capture(&original).await;
        let (replacement, replacement_waiting) = run.open(kind).await;
        assert_eq!(original["args"], replacement["args"]);
        if kind != "native" {
            assert!(
                waiting
                    .await
                    .unwrap()
                    .unwrap_err()
                    .message
                    .contains("superseded")
            );
            assert!(
                run.guarded_answer(&original, identity.clone(), kind)
                    .await
                    .unwrap_err()
                    .message
                    .contains("original prompt")
            );
        } else {
            waiting.await.unwrap().unwrap();
        }
        assert!(
            run.write(identity, b"old")
                .await
                .unwrap_err()
                .message
                .contains("original prompt")
        );
        assert!(!run.recorded_input().await.contains("BYTE:"));
        assert!(run.capture(&replacement).await.is_object());
        run.clear().await;
        let _ = replacement_waiting.await.unwrap();
    }
    run.finish().await;
}

#[tokio::test]
async fn b6_an_unreadable_prompt_refuses_identity_and_effects() {
    let run = Run::start().await;
    let (original, waiting) = run.open("permission").await;
    let mut identity = run.capture(&original).await;
    run.clear().await;
    let _ = waiting.await.unwrap();
    let (unreadable, waiting) = run.open("unreadable").await;
    assert!(!unreadable["answerable"].as_bool().unwrap());
    let err = run
        .user
        .request("decision.capture", json!({"id":unreadable["id"]}))
        .await
        .unwrap_err();
    assert!(err.message.contains("identity unavailable"));
    // Even a fabricated identity with the current id cannot authorize an unreadable prompt.
    identity["decision"] = unreadable["id"].clone();
    let err = run.write(identity, b"old").await.unwrap_err();
    assert!(err.message.contains("identity unavailable"));
    assert!(!run.recorded_input().await.contains("BYTE:"));
    waiting.await.unwrap().unwrap();
    run.clear().await;
    run.finish().await;
}

#[tokio::test]
async fn b6_refusal_names_the_original_when_a_replacement_identity_is_unavailable() {
    let run = Run::start().await;
    for kind in ["permission", "ask_user", "native"] {
        let (original, waiting) = run.open(kind).await;
        let identity = run.capture(&original).await;
        run.user_answer(&original, kind).await;
        let _ = waiting.await.unwrap();
        let (replacement, waiting) = run.open(kind).await;
        run.user
            .request(
                "terminal.write",
                json!({"id":run.terminal,"data":STANDARD.encode(b"u")}),
            )
            .await
            .unwrap();
        let err = run.write(identity.clone(), b"old").await.unwrap_err();
        assert!(
            err.message
                .contains(&format!("prompt {}", original["id"].as_str().unwrap())),
            "{err:?}"
        );
        assert!(
            !err.message
                .contains(&format!("prompt {}", replacement["id"].as_str().unwrap())),
            "{err:?}"
        );
        if kind != "native" {
            let err = run
                .guarded_answer(&original, identity, kind)
                .await
                .unwrap_err();
            assert!(
                err.message
                    .contains(&format!("prompt {}", original["id"].as_str().unwrap())),
                "{err:?}"
            );
        }
        assert!(!run.recorded_input().await.contains("BYTE:6f"));
        run.clear().await;
        let _ = waiting.await.unwrap();
    }
    run.finish().await;
}

#[tokio::test]
async fn b6_an_order_completion_waits_for_its_steer_effect() {
    let (run, caller) = order_child().await;
    std::fs::write(run.dir.path().join("order-effect-gate"), "pause").unwrap();
    let child = run.child.clone();
    let mut completion = tokio::spawn(async move {
        caller
            .request(
                "agent.setOrder",
                json!({"id":child,"order":{"kind":"work","ask":"first order","limits":[]}}),
            )
            .await
    });
    tokio::select! {
        result = &mut completion => panic!("Order returned before its Steer effect: {result:?}"),
        arrived = tokio::time::timeout(BOUND, async {
            while !run.dir.path().join("order-effect-gate.arrived").is_file() { tokio::task::yield_now().await; }
        }) => { arrived.unwrap(); }
    }
    assert!(!completion.is_finished());
    std::fs::remove_file(run.dir.path().join("order-effect-gate")).unwrap();
    // This fake deliberately withholds submit: physically written bytes are uncertain,
    // never a successful Rail node and never an invitation to retry.
    let err = completion.await.unwrap().unwrap_err();
    assert_eq!(err.code, rpc::code::UNKNOWN_OUTCOME);
    assert!(err.message.contains("Order stored"), "{err:?}");
    assert!(err.message.contains("do not retry"), "{err:?}");
    assert!(run.recorded_input().await.contains("BYTE:"));
    run.finish().await;
}

async fn order_child() -> (Run, Arc<Client>) {
    let mut run = Run::start().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let door = run
        .user
        .request(
            "rail.createWorkstream",
            json!({"name":"team","parent":null}),
        )
        .await
        .unwrap();
    let caller = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
    caller
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":door["id"]}}),
        )
        .await
        .unwrap();
    let child = caller
        .request(
            "agent.spawn",
            json!({"name":"ordered child","cwd":run.dir.path()}),
        )
        .await
        .unwrap();
    run.child = child["id"].as_str().unwrap().to_owned();
    run.terminal = child["terminal_id"].clone();
    run.attempt = child["attempt"].clone();
    tokio::time::timeout(BOUND, async {
        while !run.screen().await.contains("READY") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (run, caller)
}

async fn idle(run: &Run) {
    tokio::time::timeout(BOUND, async {
        loop {
            let tree = run.user.request("rail.tree", ()).await.unwrap();
            if tree
                .as_array()
                .unwrap()
                .iter()
                .any(|node| node["id"] == run.child && node["status"]["kind"] == "idle")
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

async fn order_result(
    run: &Run,
    caller: Arc<Client>,
) -> tokio::task::JoinHandle<Result<Value, RpcError>> {
    let child = run.child.clone();
    tokio::spawn(async move {
        caller
            .request(
                "agent.setOrder",
                json!({"id":child,"order":{"kind":"work","ask":"first order","limits":[]}}),
            )
            .await
    })
}

async fn recorded_bytes(run: &Run) -> Vec<u8> {
    run.recorded_input()
        .await
        .lines()
        .filter_map(|line| {
            line.strip_prefix("BYTE:")
                .and_then(|hex| u8::from_str_radix(hex.trim(), 16).ok())
        })
        .collect()
}

#[tokio::test]
async fn b6_an_order_effect_finishes_before_the_following_prompt() {
    let (run, caller) = order_child().await;
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    std::fs::write(run.dir.path().join("order-effect-gate"), "pause").unwrap();
    let mut completion = order_result(&run, Arc::clone(&caller)).await;
    tokio::select! {
        result = &mut completion => panic!("premature completion: {result:?}"),
        arrived = tokio::time::timeout(BOUND, async {
            while !run.dir.path().join("order-effect-gate.arrived").is_file() { tokio::task::yield_now().await; }
        }) => { arrived.unwrap(); }
    }
    assert!(!run.screen().await.contains("BYTE:"));
    std::fs::remove_file(run.dir.path().join("order-effect-gate")).unwrap();
    let node = completion.await.unwrap().unwrap();
    assert_eq!(node["work"]["ask"], "first order");
    idle(&run).await;
    caller
        .request(
            "agent.prompt",
            json!({"id":run.child,"text":"second prompt"}),
        )
        .await
        .unwrap();
    let bytes = String::from_utf8(recorded_bytes(&run).await).unwrap();
    assert_eq!(
        bytes,
        format!(
            "{}\x1b[200~first order\x1b[201~\r{}\x1b[200~second prompt\x1b[201~\r",
            agents::claude_code::LEAD_IN,
            agents::claude_code::LEAD_IN
        )
    );
    run.finish().await;
}

#[tokio::test]
async fn b6_a_refused_order_steer_reports_the_stored_order_without_a_write() {
    let (run, caller) = order_child().await;
    std::fs::write(run.dir.path().join("order-effect-gate"), "refuse").unwrap();
    let err = order_result(&run, caller).await.await.unwrap().unwrap_err();
    assert_eq!(err.code, rpc::code::NOT_ACCEPTED);
    assert!(err.message.contains("Order stored"), "{err:?}");
    assert!(err.message.contains("no bytes written"), "{err:?}");
    std::fs::remove_file(run.dir.path().join("order-effect-gate")).unwrap();
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .any(|node| node["id"] == run.child && node["work"]["ask"] == "first order")
    );
    assert!(recorded_bytes(&run).await.is_empty());
    run.finish().await;
}

#[tokio::test]
async fn b6_a_child_ending_after_order_bytes_never_authorizes_a_retry() {
    let (run, caller) = order_child().await;
    let completion = order_result(&run, caller).await;
    tokio::time::timeout(BOUND, async {
        while !run.screen().await.contains("BYTE:0d") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(!completion.is_finished());
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let err = completion.await.unwrap().unwrap_err();
    assert_eq!(err.code, rpc::code::UNKNOWN_OUTCOME);
    assert!(
        err.message.contains("bytes may have been written"),
        "{err:?}"
    );
    assert!(err.message.contains("do not retry"), "{err:?}");
}

#[tokio::test]
async fn b6_a_busy_or_taken_over_child_reports_a_refused_order_steer() {
    for takeover in [false, true] {
        let (run, caller) = order_child().await;
        if takeover {
            run.user
                .request("takeover.begin", json!({"agent":run.child}))
                .await
                .unwrap();
        } else {
            run.user.request("agent.signal", json!({"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"UserPromptSubmit"}})).await.unwrap();
        }
        let err = order_result(&run, caller).await.await.unwrap().unwrap_err();
        assert_eq!(
            err.code,
            if takeover {
                rpc::code::CONFLICT
            } else {
                rpc::code::BUSY
            }
        );
        assert!(err.message.contains("Order stored"), "{err:?}");
        assert!(err.message.contains("no bytes written"), "{err:?}");
        let tree = run.user.request("rail.tree", ()).await.unwrap();
        assert!(
            tree.as_array()
                .unwrap()
                .iter()
                .any(|node| node["id"] == run.child && node["work"]["ask"] == "first order")
        );
        assert!(recorded_bytes(&run).await.is_empty());
        run.finish().await;
    }
}

#[tokio::test]
async fn b6_a_refused_prompt_effect_does_not_submit_the_users_input() {
    let run = Run::start().await;
    let (original, waiting) = run.open("native").await;
    let identity = run.capture(&original).await;
    run.user
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"draft")}),
        )
        .await
        .unwrap();
    let before = run.recorded_input().await;
    let message = run
        .user
        .request(
            "message.send",
            json!({"to":run.child,"kind":"note","body":"wait for the user's input"}),
        )
        .await
        .unwrap();
    assert_eq!(message["status"], "held");
    let refused = run.write(identity, b"\r").await.unwrap_err();
    assert_eq!(refused.code, rpc::code::CONFLICT);
    let held = run
        .user
        .request("message.get", json!({"id":message["id"]}))
        .await
        .unwrap();
    assert_eq!(
        held["status"], "held",
        "a refused submit released the Message"
    );
    assert_eq!(held["reason"], "takeover");
    assert_eq!(
        run.screen().await.matches("BYTE:").count(),
        before.matches("BYTE:").count()
    );
    run.clear().await;
    let _ = waiting.await.unwrap();
    run.finish().await;
}

#[tokio::test]
async fn b37_a_failed_decision_note_is_retained_or_visible_to_the_user() {
    for failure in ["send", "full", "terminal"] {
        let mut run = Run::start().await;
        let door = run
            .user
            .request("rail.createWorkstream", json!({"name":"supervisor"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        run.user
            .request("agent.stop", json!({"id":run.child}))
            .await
            .unwrap();
        run.door = Some(door.clone());
        run.spawn().await;
        run.user
            .request("rail.startDoor", json!({"id":door}))
            .await
            .unwrap();
        if failure != "terminal" {
            run.user
                .request("takeover.begin", json!({"agent":door}))
                .await
                .unwrap();
        }
        if failure == "full" {
            // Setup may already have queued a Digest. Fill the actual remaining capacity.
            for _ in 0..=32 {
                if let Err(err) = run
                    .user
                    .request(
                        "message.send",
                        json!({"to":door,"kind":"note","body":"queued"}),
                    )
                    .await
                {
                    assert_eq!(err.code, rpc::code::CONFLICT);
                    assert!(err.message.contains("32 pending or held"), "{err}");
                    break;
                }
            }
        }
        if failure == "send" {
            run.user
                .request("agent.stop", json!({"id":door}))
                .await
                .unwrap();
        }
        let (decision, waiting) = run.open("permission").await;
        let notice = tokio::time::timeout(Duration::from_secs(40), async {
            loop {
                let listed = run
                    .user
                    .request("message.list", json!({"to":contracts::Actor::user().id}))
                    .await
                    .unwrap();
                if let Some(message) = listed.as_array().unwrap().iter().find(|m| {
                    m["body"]
                        .as_str()
                        .unwrap()
                        .contains(&format!("[decision {}]", decision["id"].as_str().unwrap()))
                }) {
                    break message.clone();
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap_or_else(|err| {
            panic!("{failure}: failed Decision notice is visible to the user: {err}")
        });
        assert!(notice["body"].as_str().unwrap().contains("delivery failed"));
        assert_eq!(notice["status"], "delivered");
        if failure == "full" {
            assert!(
                notice["body"]
                    .as_str()
                    .unwrap()
                    .contains("32 pending or held"),
                "{notice}"
            );
        }
        if failure == "terminal" {
            let refused = run
                .user
                .request("message.get", json!({"id":notice["replyTo"]}))
                .await
                .unwrap();
            assert_eq!(refused["status"], "dropped");
            assert_eq!(refused["reason"], "not accepted");
            assert_eq!(refused["to"], door);
        }
        assert_eq!(
            run.user
                .request("message.get", json!({"id":notice["id"]}))
                .await
                .unwrap(),
            notice
        );
        assert_eq!(
            run.user.request("decision.list", ()).await.unwrap()[0],
            decision
        );
        run.user_answer(&decision, "permission").await;
        let outcome = waiting.await.unwrap().unwrap();
        assert!(
            outcome["output"].as_str().unwrap().contains("allow"),
            "{outcome}"
        );
        run.finish().await;
    }
}

#[tokio::test]
async fn b37_decision_note_exclusions_still_hold() {
    for exclusion in ["takeover", "unanswerable", "no Door"] {
        let mut run = Run::start().await;
        let door = run
            .user
            .request("rail.createWorkstream", json!({"name":"supervisor"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        if exclusion != "no Door" {
            run.user
                .request("agent.stop", json!({"id":run.child}))
                .await
                .unwrap();
            run.door = Some(door.clone());
            run.spawn().await;
        }
        if exclusion == "takeover" {
            run.user
                .request("takeover.begin", json!({"agent":run.child}))
                .await
                .unwrap();
        }
        let kind = if exclusion == "unanswerable" {
            "native"
        } else {
            "permission"
        };
        let (excluded, waiting) = run.open(kind).await;
        run.user_answer(&excluded, kind).await;
        waiting.await.unwrap().unwrap();
        // A later eligible Decision's Message acknowledges the serial note consumer has
        // passed the excluded Decision; no duration stands in for that ordering boundary.
        let excluded_child = run.child.clone();
        run.door = Some(door.clone());
        run.spawn().await;
        let (witness, waiting) = run.open("permission").await;
        let messages = tokio::time::timeout(BOUND, async {
            loop {
                let messages = run.user.request("message.list", json!({})).await.unwrap();
                if messages.as_array().unwrap().iter().any(|m| {
                    m["body"]
                        .as_str()
                        .unwrap()
                        .starts_with(&format!("[decision {}]", witness["id"].as_str().unwrap()))
                }) {
                    break messages;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(
            !messages.as_array().unwrap().iter().any(|m| m["body"]
                .as_str()
                .unwrap()
                .starts_with(&format!("[decision {}]", excluded["id"].as_str().unwrap()))),
            "{exclusion}: {messages}"
        );
        run.user_answer(&witness, "permission").await;
        waiting.await.unwrap().unwrap();
        run.user
            .request("agent.stop", json!({"id":excluded_child}))
            .await
            .unwrap();
        run.finish().await;
    }
}

async fn door_terminal() -> (Run, Arc<Client>) {
    let (mut run, caller) = order_child().await;
    // Agent panes are ownerless (M14); a child-owned Run is in the Door's Reach.
    let child = Client::connect(&run.daemon.socket).await.unwrap();
    child
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"agent","id":run.child}}),
        )
        .await
        .unwrap();
    let opened = child.request("terminal.spawn", json!({
        "cwd":run.dir.path(), "cols":80,"rows":24,"env":{},
        "command":["python3","-u","-c", "import os, tty\ntty.setraw(0)\nprint('READY')\nwhile True:\n b = os.read(0, 1)\n if not b: break\n print('BARRIER' if b == b'\\x00' else 'BYTE:' + b.hex())"]
    })).await.unwrap();
    run.terminal = opened["id"].clone();
    tokio::time::timeout(BOUND, async {
        while !run.screen().await.contains("READY") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    (run, caller)
}

#[tokio::test]
async fn b6_ordinary_door_write_waits_for_earlier_input_and_its_physical_effect() {
    let (run, caller) = door_terminal().await;
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, "pause").unwrap();
    // Direct user input still acknowledges enqueue while its physical write is held.
    run.user
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"user")}),
        )
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let terminal = run.terminal.clone();
    let mut completion = tokio::spawn(async move {
        caller
            .request(
                "terminal.write",
                json!({"id":terminal,"data":STANDARD.encode(b"door")}),
            )
            .await
    });
    // This window observes absence of completion, rather than assuming task scheduling.
    let early = tokio::time::timeout(Duration::from_millis(200), &mut completion).await;
    std::fs::remove_file(gate).unwrap();
    assert!(
        early.is_err(),
        "Door completed while its bytes were queued: {early:?}"
    );
    completion.await.unwrap().unwrap();
    assert_eq!(recorded_bytes(&run).await, b"userdoor");
    run.finish().await;
}

#[tokio::test]
async fn b6_ordinary_door_write_waits_at_its_own_physical_effect() {
    let (run, caller) = door_terminal().await;
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, "pause").unwrap();
    let terminal = run.terminal.clone();
    let mut completion = tokio::spawn(async move {
        caller
            .request(
                "terminal.write",
                json!({"id":terminal,"data":STANDARD.encode(b"once")}),
            )
            .await
    });
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let early = tokio::time::timeout(Duration::from_millis(200), &mut completion).await;
    std::fs::remove_file(gate).unwrap();
    assert!(
        early.is_err(),
        "Door completed before its physical write: {early:?}"
    );
    completion.await.unwrap().unwrap();
    assert_eq!(recorded_bytes(&run).await, b"once");
    run.finish().await;
}

#[tokio::test]
async fn b6_ordinary_door_write_refuses_a_full_queue_before_any_bytes() {
    let (run, caller) = door_terminal().await;
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, "pause").unwrap();
    run.user
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"first")}),
        )
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let mut accepted = 0;
    loop {
        match run
            .user
            .request(
                "terminal.write",
                json!({"id":run.terminal,"data":STANDARD.encode(b"x")}),
            )
            .await
        {
            Ok(_) => accepted += 1,
            Err(error) => {
                assert_eq!(error.code, rpc::code::CONFLICT);
                break;
            }
        }
    }
    let error = caller
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"refused")}),
        )
        .await
        .unwrap_err();
    std::fs::remove_file(gate).unwrap();
    assert_eq!(error.code, rpc::code::CONFLICT);
    tokio::time::timeout(BOUND, async {
        while run.screen().await.matches("BYTE:78").count() < accepted {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        recorded_bytes(&run).await,
        [b"first".as_slice(), &vec![b'x'; accepted]].concat()
    );
    run.finish().await;
}

async fn uncertain_terminal_write(failure: &str, expected: &[u8]) {
    let (run, caller) = door_terminal().await;
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, failure).unwrap();
    let error = caller
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"uncertain")}),
        )
        .await
        .unwrap_err();
    std::fs::remove_file(gate).unwrap();
    assert_eq!(
        error.code,
        rpc::code::UNKNOWN_OUTCOME,
        "{failure}: {error:?}"
    );
    assert!(error.message.contains("do not retry"), "{error:?}");
    // A later completed Door write and child barrier account for all earlier effects.
    caller
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"later")}),
        )
        .await
        .unwrap();
    assert_eq!(
        recorded_bytes(&run).await,
        [expected, b"later"].concat(),
        "{failure}"
    );
    run.finish().await;
}

#[tokio::test]
async fn b6_ordinary_door_partial_write_is_unknown_without_retry() {
    uncertain_terminal_write("partial", b"u").await;
}

#[tokio::test]
async fn b6_ordinary_door_flush_failure_is_unknown_without_retry() {
    uncertain_terminal_write("flush", b"uncertain").await;
}

#[tokio::test]
async fn b6_ordinary_door_write_lost_input_thread_result_stays_unknown() {
    let (run, caller) = door_terminal().await;
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, "end").unwrap();
    let error = caller
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"unknown")}),
        )
        .await
        .unwrap_err();
    std::fs::remove_file(gate).unwrap();
    assert_eq!(error.code, rpc::code::UNKNOWN_OUTCOME);
    assert!(error.message.contains("do not retry"), "{error:?}");
    assert!(error.message.contains("input ended"), "{error:?}");
    // The failed input thread cannot accept or replay bytes through a replacement queue.
    let later = caller
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"later")}),
        )
        .await
        .unwrap_err();
    assert_ne!(later.code, rpc::code::UNKNOWN_OUTCOME);
    // portable-pty's writer Drop may send newline/EOF; neither is a byte from
    // the lost call or the refused later call.
    let output = run.screen().await;
    assert!(
        !output.contains("BYTE:75"),
        "unknown bytes replayed: {output}"
    );
    assert!(!output.contains("BYTE:6c"), "later bytes written: {output}");
    run.finish().await;
}

#[tokio::test]
async fn b6_interrupt_completion_accounts_for_a_blocked_escape_before_takeover() {
    let (run, caller) = order_child().await;
    idle(&run).await;
    let gate = run.dir.path().join("order-effect-gate");
    std::fs::write(&gate, "pause").unwrap();
    let order = order_result(&run, Arc::clone(&caller)).await;
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    run.user.request("agent.signal", json!({"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"UserPromptSubmit","prompt":"working"}})).await.unwrap();
    let child = run.child.clone();
    let mut interrupt =
        tokio::spawn(async move { caller.request("agent.interrupt", json!({"id":child})).await });
    // INTERRUPT_BOUND is the acknowledgement timer being tested. No completion may
    // escape that timer while the input thread still has an Escape to write.
    let early = tokio::time::timeout(
        agents::INTERRUPT_BOUND + Duration::from_millis(200),
        &mut interrupt,
    )
    .await;
    std::fs::remove_file(gate).unwrap();
    assert!(
        early.is_err(),
        "Interrupt completed with its Escape still queued: {early:?}"
    );
    let error = interrupt.await.unwrap().unwrap_err();
    assert_eq!(error.code, rpc::code::NOT_ACKED);
    assert!(error.message.contains("outcome uncertain"), "{error:?}");
    assert!(error.message.contains("do not retry"), "{error:?}");
    let before = recorded_bytes(&run).await;
    assert_eq!(before.iter().filter(|byte| **byte == 0x1b).count(), 3);
    assert_eq!(before.last(), Some(&0x1b));
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    run.user
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"later")}),
        )
        .await
        .unwrap();
    assert_eq!(
        recorded_bytes(&run).await,
        [before, b"later".to_vec()].concat()
    );
    let _ = order.await.unwrap();
    run.finish().await;
}

#[tokio::test]
async fn b6_a_full_terminal_refuses_interrupt_before_bytes() {
    let (run, caller) = order_child().await;
    idle(&run).await;
    let gate = run.dir.path().join("order-effect-gate");
    std::fs::write(&gate, "pause").unwrap();
    let order = order_result(&run, Arc::clone(&caller)).await;
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    run.user.request("agent.signal", json!({"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"UserPromptSubmit","prompt":"working"}})).await.unwrap();
    let observer = Client::connect(&run.daemon.socket).await.unwrap();
    observer
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"ext","id":"b6-observer"}}),
        )
        .await
        .unwrap();
    let mut queued = 0;
    loop {
        match observer
            .request(
                "terminal.write",
                json!({"id":run.terminal,"data":STANDARD.encode(b"x")}),
            )
            .await
        {
            Ok(_) => queued += 1,
            Err(error) => {
                assert_eq!(error.code, rpc::code::CONFLICT);
                break;
            }
        }
    }
    let error = caller
        .request("agent.interrupt", json!({"id":run.child}))
        .await
        .unwrap_err();
    std::fs::remove_file(gate).unwrap();
    assert_eq!(error.code, rpc::code::CONFLICT);
    assert!(error.message.contains("no bytes written"), "{error:?}");
    let expected = [
        agents::claude_code::LEAD_IN.as_bytes(),
        b"\x1b[200~first order\x1b[201~\r",
        &vec![b'x'; queued],
    ]
    .concat();
    tokio::time::timeout(BOUND, async {
        while run.screen().await.matches("BYTE:78").count() < queued {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(recorded_bytes(&run).await, expected);
    let _ = order.await.unwrap();
    run.finish().await;
}

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

#[tokio::test]
async fn b6_takeover_acquisition_waits_for_a_door_spawned_first_prompt() {
    let (mut run, caller) = order_child().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, "pause").unwrap();
    let node = caller
        .request(
            "agent.spawn",
            json!({"name":"first prompt child","cwd":run.dir.path(),"prompt":"first prompt","order":{"kind":"work","ask":"first prompt","limits":[]}}),
        )
        .await
        .unwrap();
    run.child = node["id"].as_str().unwrap().to_owned();
    run.terminal = node["terminal_id"].clone();
    run.attempt = node["attempt"].clone();
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let mut begin =
        tokio::spawn(async move { user.request("takeover.begin", json!({"agent":child})).await });
    // The physical input observer acknowledges the first Steer before this absence window.
    let early = tokio::time::timeout(Duration::from_millis(200), &mut begin).await;
    std::fs::remove_file(&gate).unwrap();
    assert!(
        early.is_err(),
        "Takeover acquired before the first prompt effect: {early:?}"
    );
    tokio::time::timeout(BOUND, begin)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let held = caller
        .request(
            "message.send",
            json!({"to":run.child,"kind":"note","body":"after acquisition"}),
        )
        .await
        .unwrap();
    assert_eq!(held["status"], "held");
    assert_eq!(held["reason"], "takeover");
    run.finish().await;
}

async fn pause_door_write(
    run: &Run,
    caller: Arc<Client>,
) -> tokio::task::JoinHandle<Result<Value, RpcError>> {
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, "pause").unwrap();
    let terminal = run.terminal.clone();
    let write = tokio::spawn(async move {
        caller
            .request(
                "terminal.write",
                json!({"id":terminal,"data":STANDARD.encode(b"once")}),
            )
            .await
    });
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    write
}

async fn release_door_write(run: &Run, write: tokio::task::JoinHandle<Result<Value, RpcError>>) {
    std::fs::remove_file(run.dir.path().join("input-gate")).unwrap();
    tokio::time::timeout(BOUND, write)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn b6_begin_racing_a_door_write_waits_for_the_child_effect() {
    let (run, caller) = door_terminal().await;
    let write = pause_door_write(&run, caller).await;
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let mut begin =
        tokio::spawn(async move { user.request("takeover.begin", json!({"agent":child})).await });
    // The physical input observer establishes that the Door call is inside its effect.
    let early = tokio::time::timeout(Duration::from_millis(200), &mut begin).await;
    release_door_write(&run, write).await;
    assert!(
        early.is_err(),
        "Takeover acquired before the Door write: {early:?}"
    );
    tokio::time::timeout(BOUND, begin)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(recorded_bytes(&run).await, b"once");
    run.finish().await;
}

#[tokio::test]
async fn b6_another_childs_takeover_does_not_wait_for_a_door_write() {
    let (run, caller) = door_terminal().await;
    let other = caller
        .request(
            "agent.spawn",
            json!({"name":"other child","cwd":run.dir.path()}),
        )
        .await
        .unwrap();
    tokio::time::timeout(BOUND, async {
        loop {
            let output = run
                .user
                .request(
                    "terminal.read",
                    json!({"id":other["terminal_id"],"after":0}),
                )
                .await
                .unwrap();
            if output["text"].as_str().unwrap().contains("READY") {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let write = pause_door_write(&run, caller).await;
    let begin = tokio::time::timeout(
        Duration::from_secs(1),
        run.user
            .request("takeover.begin", json!({"agent":other["id"]})),
    )
    .await;
    release_door_write(&run, write).await;
    begin
        .expect("another child's Takeover waited for the paused write")
        .unwrap();
    run.user
        .request("agent.stop", json!({"id":other["id"]}))
        .await
        .unwrap();
    run.finish().await;
}

#[tokio::test]
async fn b6_direct_user_input_does_not_wait_for_a_door_write() {
    let (run, caller) = door_terminal().await;
    let write = pause_door_write(&run, caller).await;
    // Direct input acknowledges enqueue even while the Door's physical write is paused.
    let user_write = tokio::time::timeout(
        Duration::from_secs(1),
        run.user.request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"user")}),
        ),
    )
    .await;
    release_door_write(&run, write).await;
    user_write
        .expect("direct user input waited for the Door write")
        .unwrap();
    assert_eq!(recorded_bytes(&run).await, b"onceuser");
    run.finish().await;
}

async fn steering_takeover_race(method: &'static str) {
    let (run, caller) = order_child().await;
    idle(&run).await;
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    if method == "agent.interrupt" {
        run.user.request("agent.signal", json!({"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"UserPromptSubmit","prompt":"working"}})).await.unwrap();
    }
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, "pause").unwrap();
    let child = run.child.clone();
    let action = tokio::spawn(async move {
        caller.request(method, json!({"id":child,"text":"one prompt","order":{"kind":"work","ask":"one order","limits":[]}})).await
    });
    tokio::time::timeout(BOUND, async {
        while !gate.with_extension("arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let mut begin =
        tokio::spawn(async move { user.request("takeover.begin", json!({"agent":child})).await });
    // The physical input observer establishes that the action is inside its effect.
    let early = tokio::time::timeout(Duration::from_millis(200), &mut begin).await;
    std::fs::remove_file(&gate).unwrap();
    let outcome = tokio::time::timeout(BOUND, action).await.unwrap().unwrap();
    assert!(
        early.is_err(),
        "Takeover acquired before {method}'s effect: {early:?}"
    );
    if method == "agent.interrupt" {
        assert_eq!(outcome.unwrap_err().code, rpc::code::NOT_ACKED);
    } else {
        outcome.unwrap();
    }
    tokio::time::timeout(BOUND, begin)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let bytes = recorded_bytes(&run).await;
    match method {
        "agent.prompt" => assert!(bytes.ends_with(b"one prompt\x1b[201~\r")),
        "agent.setOrder" => assert!(bytes.ends_with(b"one order\x1b[201~\r")),
        _ => assert_eq!(bytes, b"\x1b"),
    }
    run.finish().await;
}

#[tokio::test]
async fn b6_begin_racing_a_door_prompt_waits_for_the_child_effect() {
    steering_takeover_race("agent.prompt").await;
}

#[tokio::test]
async fn b6_begin_racing_a_door_order_waits_for_the_child_effect() {
    steering_takeover_race("agent.setOrder").await;
}

#[tokio::test]
async fn b6_begin_racing_a_door_interrupt_waits_for_the_child_effect() {
    steering_takeover_race("agent.interrupt").await;
}
