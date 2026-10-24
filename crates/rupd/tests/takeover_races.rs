//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/takeover_run.rs"]
mod takeover_run;
use door_terminals::{door_terminal, idle, order_child, recorded_bytes, rewrite_script};
use takeover_run::{BOUND, Run};

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::{Client, RpcError};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

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

#[tokio::test]
async fn b6_begin_racing_a_door_resume_waits_for_the_new_attempt() {
    let (run, caller) = order_child().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let fake = run.dir.path().join("claude");
    let script = std::fs::read_to_string(&fake).unwrap().replace(
        "hook('SessionStart',",
        "if '--resume' in sys.argv:\n    import time\n    open('resume-arrived', 'w').close()\n    while os.path.isfile('resume-gate'): time.sleep(0.005)\nhook('SessionStart',",
    );
    rewrite_script(&fake, script);
    let gate = run.dir.path().join("resume-gate");
    std::fs::write(&gate, "pause").unwrap();
    let child = run.child.clone();
    let resume =
        tokio::spawn(async move { caller.request("agent.resume", json!({"id":child})).await });
    tokio::time::timeout(BOUND, async {
        while !run.dir.path().join("resume-arrived").is_file() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let mut begin =
        tokio::spawn(async move { user.request("takeover.begin", json!({"agent":child})).await });
    // The new vendor process acknowledges launch before the absence observation window.
    let early = tokio::time::timeout(Duration::from_millis(200), &mut begin).await;
    std::fs::remove_file(gate).unwrap();
    let resumed = tokio::time::timeout(BOUND, resume)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        early.is_err(),
        "Takeover returned before Resume completed: {early:?}"
    );
    tokio::time::timeout(BOUND, begin)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_ne!(resumed["attempt"], run.attempt);
    let message = run
        .user
        .request(
            "message.send",
            json!({"to":run.child,"kind":"note","body":"new Attempt"}),
        )
        .await
        .unwrap();
    assert_eq!(message["status"], "held");
    assert_eq!(message["reason"], "takeover");
    run.finish().await;
}

async fn ending_takeover_race(method: &'static str) {
    let (run, caller) = if method == "agent.stop" {
        order_child().await
    } else {
        door_terminal().await
    };
    run.pause();
    let id = if method == "agent.stop" {
        json!(run.child)
    } else {
        run.terminal.clone()
    };
    let ending = tokio::spawn(async move { caller.request(method, json!({"id":id})).await });
    run.paused().await;
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let mut begin =
        tokio::spawn(async move { user.request("takeover.begin", json!({"agent":child})).await });
    // Arrival acknowledges the paused child effect; this window observes absence of acquisition.
    let early = tokio::time::timeout(Duration::from_millis(200), &mut begin).await;
    run.release();
    tokio::time::timeout(BOUND, ending)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        early.is_err(),
        "Takeover acquired before {method}'s child effect: {early:?}"
    );
    let acquired = tokio::time::timeout(BOUND, begin).await.unwrap().unwrap();
    if method == "agent.stop" {
        assert_eq!(acquired.unwrap_err().code, rpc::code::CONFLICT);
    } else {
        // The auxiliary Terminal ended; its owning child remains available for Takeover.
        acquired.unwrap();
    }
    run.finish().await;
}

#[tokio::test]
async fn b6_begin_racing_a_door_stop_waits_for_the_child_effect() {
    ending_takeover_race("agent.stop").await;
}

#[tokio::test]
async fn b6_begin_racing_a_door_terminal_kill_waits_for_the_child_effect() {
    ending_takeover_race("terminal.kill").await;
}

#[tokio::test]
async fn b6_begin_racing_a_door_terminal_close_waits_for_the_child_effect() {
    ending_takeover_race("terminal.close").await;
}

#[tokio::test]
async fn b6_begin_racing_a_door_resize_waits_for_the_child_effect() {
    let (run, caller) = door_terminal().await;
    run.pause();
    let terminal = run.terminal.clone();
    let resize = tokio::spawn(async move {
        caller
            .request(
                "terminal.resize",
                json!({"id":terminal,"cols":101,"rows":37}),
            )
            .await
    });
    run.paused().await;
    let before = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(
        (before["cols"].as_u64(), before["rows"].as_u64()),
        (Some(80), Some(24))
    );
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let mut begin =
        tokio::spawn(async move { user.request("takeover.begin", json!({"agent":child})).await });
    // The gate acknowledges arrival before resize. This window observes absence of acquisition.
    let early = tokio::time::timeout(Duration::from_millis(200), &mut begin).await;
    run.release();
    tokio::time::timeout(BOUND, resize)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let acquired_early = early.is_ok();
    let acquired = match early {
        Ok(result) => result.unwrap(),
        Err(_) => tokio::time::timeout(BOUND, begin).await.unwrap().unwrap(),
    };
    let after = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    run.finish().await;
    assert!(
        !acquired_early,
        "Takeover acquired before Door resize completed"
    );
    acquired.unwrap();
    assert_eq!(
        (after["cols"].as_u64(), after["rows"].as_u64()),
        (Some(101), Some(37))
    );
}

#[tokio::test]
async fn b6_a_new_takeover_does_not_wait_for_an_end_delivering_a_recorded_message() {
    let (run, caller) = door_terminal().await;
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    caller
        .request(
            "terminal.resize",
            json!({"id":run.terminal,"cols":101,"rows":37}),
        )
        .await
        .unwrap();
    let message = run
        .user
        .request(
            "message.send",
            json!({"to":run.child,"kind":"note","body":"legacy recorded cut"}),
        )
        .await
        .unwrap();
    let gate = run.dir.path().join("input-gate");
    std::fs::write(&gate, "pause").unwrap();
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let end =
        tokio::spawn(async move { user.request("takeover.end", json!({"agent":child})).await });
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
    let early = tokio::time::timeout(Duration::from_secs(1), &mut begin).await;
    std::fs::remove_file(gate).unwrap();
    end.await.unwrap().unwrap();
    let acquired_early = early.is_ok();
    match early {
        Ok(result) => {
            result.unwrap().unwrap();
        }
        Err(_) => {
            begin.await.unwrap().unwrap();
        }
    }
    let record = run
        .user
        .request("message.get", json!({"id":message["id"]}))
        .await
        .unwrap();
    assert_eq!(record["status"], "delivered");
    let snapshot = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert!(
        acquired_early,
        "begin waited for the earlier end's Message typing"
    );
    assert_eq!(
        snapshot["cols"], 80,
        "the earlier end released a resize into the new Takeover"
    );
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let snapshot = run
        .user
        .request("terminal.snapshot", json!({"id":run.terminal}))
        .await
        .unwrap();
    assert_eq!(snapshot["cols"], 101);
    run.finish().await;
}

#[tokio::test]
async fn b6_begin_racing_a_door_rename_waits_for_the_child_effect() {
    let (run, caller) = order_child().await;
    run.pause();
    let child = run.child.clone();
    let rename = tokio::spawn(async move {
        caller
            .request(
                "rail.rename",
                json!({"id":child,"name":"renamed before Takeover"}),
            )
            .await
    });
    run.paused().await;
    let user = Arc::clone(&run.user);
    let child = run.child.clone();
    let mut begin =
        tokio::spawn(async move { user.request("takeover.begin", json!({"agent":child})).await });
    // The observer acknowledges arrival before the rename. This window checks no acquisition.
    let acquired_early = tokio::time::timeout(Duration::from_millis(200), &mut begin)
        .await
        .is_ok();
    run.release();
    let renamed = tokio::time::timeout(BOUND, rename)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    if !acquired_early {
        tokio::time::timeout(BOUND, begin)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }
    run.finish().await;
    assert!(
        !acquired_early,
        "Takeover acquired before Door rename completed"
    );
    assert_eq!(renamed["name"], "renamed before Takeover");
}
