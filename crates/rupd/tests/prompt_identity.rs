//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/takeover_run.rs"]
mod takeover_run;
use takeover_run::{BOUND, Run, launch};

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::Client;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn b6_checked_effects_exclude_prompt_replacement_under_parallel_load() {
    let mut runs = tokio::task::JoinSet::new();
    for (kind, answer_effect) in [
        ("permission", false),
        ("permission", true),
        ("ask_user", false),
        ("ask_user", true),
        ("native", false),
    ] {
        runs.spawn(checked_effect_before_replacement(kind, answer_effect));
    }
    while let Some(result) = runs.join_next().await {
        result.unwrap();
    }
}

async fn checked_effect_before_replacement(kind: &str, answer_effect: bool) {
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
