//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/takeover_run.rs"]
mod takeover_run;
use door_terminals::{door_terminal, idle, order_child, order_result, recorded_bytes};
use takeover_run::BOUND;

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::Client;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

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
    // The input thread drops its result before it drops its queue; wait until the queue is gone,
    // so the later write meets the ended thread and not one still unwinding.
    tokio::time::timeout(BOUND, async {
        loop {
            let probe = caller
                .request(
                    "terminal.write",
                    json!({"id":run.terminal,"data":STANDARD.encode(b"")}),
                )
                .await;
            if probe.is_err_and(|e| e.code != rpc::code::UNKNOWN_OUTCOME) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the ended input thread drops its queue");
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
