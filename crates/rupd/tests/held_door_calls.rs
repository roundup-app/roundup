//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/child_run.rs"]
mod child_run;
use door_terminals::{
    child_attempt, door_peer_request, door_terminal, idle, order_child, order_result, ordered_ask,
    recorded_bytes, start_answer_door,
};
use child_run::{BOUND, Run, launch};

use base64::{Engine, engine::general_purpose::STANDARD};
use rpc::{Client, RpcError};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

async fn working_child_with_held_interrupt() -> (Run, Arc<Client>, Value) {
    let (run, caller) = order_child().await;
    idle(&run).await;
    run.user.request("agent.signal", json!({"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"UserPromptSubmit","prompt":"working"}})).await.unwrap();
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request("agent.interrupt", json!({"id":run.child}))
        .await
        .unwrap();
    (run, caller, receipt)
}

#[tokio::test]
async fn b6_a_door_interrupt_waits_for_takeover_release() {
    let (run, caller, receipt) = working_child_with_held_interrupt().await;
    assert_eq!(receipt["method"], "agent.interrupt");
    assert_eq!(
        receipt["outcome"],
        json!({"status":"waiting","reason":"takeover"})
    );
    assert!(
        !recorded_bytes(&run).await.contains(&0x1b),
        "Door Interrupt wrote its Escape during Takeover"
    );
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    let escapes = recorded_bytes(&run)
        .await
        .iter()
        .filter(|byte| **byte == 0x1b)
        .count();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    // The fake Claude never changes its title, so the released Escape's outcome is an
    // unacknowledged one; the receipt records it and the Escape went out exactly once.
    assert_ne!(history[0]["outcome"]["status"], "waiting", "{history}");
    assert_eq!(escapes, 1);
}

#[tokio::test]
async fn b6_a_held_interrupt_is_dropped_when_the_child_exits() {
    let (run, caller, receipt) = working_child_with_held_interrupt().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
}

async fn idle_child_with_held_prompt() -> (Run, Arc<Client>, Value) {
    let (run, caller) = order_child().await;
    idle(&run).await;
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request("agent.prompt", json!({"id":run.child,"text":"held words"}))
        .await
        .unwrap();
    (run, caller, receipt)
}

#[tokio::test]
async fn b6_a_door_prompt_waits_for_takeover_release() {
    let (run, caller, receipt) = idle_child_with_held_prompt().await;
    assert_eq!(receipt["method"], "agent.prompt");
    assert_eq!(
        receipt["outcome"],
        json!({"status":"waiting","reason":"takeover"})
    );
    assert!(
        !run.recorded_input().await.contains("BYTE:"),
        "Door prompt reached the child during Takeover"
    );
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    let typed = String::from_utf8_lossy(&recorded_bytes(&run).await)
        .matches("held words")
        .count();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "completed", "{history}");
    assert_eq!(typed, 1);
}

#[tokio::test]
async fn b6_a_held_prompt_is_dropped_when_the_child_exits() {
    let (run, caller, receipt) = idle_child_with_held_prompt().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
}

async fn idle_child_with_held_order() -> (Run, Arc<Client>, Value) {
    let (run, caller) = order_child().await;
    idle(&run).await;
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = order_result(&run, Arc::clone(&caller))
        .await
        .await
        .unwrap()
        .unwrap();
    (run, caller, receipt)
}

#[tokio::test]
async fn b6_a_door_order_waits_for_takeover_release() {
    let (run, caller, receipt) = idle_child_with_held_order().await;
    assert_eq!(receipt["method"], "agent.setOrder");
    assert_eq!(
        receipt["outcome"],
        json!({"status":"waiting","reason":"takeover"})
    );
    assert_ne!(
        ordered_ask(&run).await,
        "first order",
        "Door Order changed the child during Takeover"
    );
    assert!(!run.recorded_input().await.contains("BYTE:"));
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    let ask = ordered_ask(&run).await;
    let typed = String::from_utf8_lossy(&recorded_bytes(&run).await)
        .matches("first order")
        .count();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "completed", "{history}");
    assert_eq!(ask, "first order");
    assert_eq!(typed, 1);
}

#[tokio::test]
async fn b6_a_waiting_order_is_dropped_with_a_reason_after_a_daemon_restart() {
    let (mut run, caller, receipt) = idle_child_with_held_order().await;
    run.daemon.child.kill().unwrap();
    run.daemon.child.wait().unwrap();
    run.daemon = launch(run.dir.path(), run.data.path());
    run.user = Arc::new(Client::connect(&run.daemon.socket).await.unwrap());
    // The Attempt does not survive the restart, so the Order is explained, never applied.
    let ask = ordered_ask(&run).await;
    let history = run
        .user
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    drop(caller);
    run.finish().await;
    assert_eq!(history.as_array().unwrap().len(), 1, "{history}");
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
    assert!(
        !history[0]["outcome"]["reason"].as_str().unwrap().is_empty(),
        "{history}"
    );
    assert_ne!(ask, "first order");
}

#[tokio::test]
async fn b6_a_held_order_is_dropped_when_the_child_exits() {
    let (run, caller, receipt) = idle_child_with_held_order().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
}

async fn idle_child_with_held_resume() -> (Run, Arc<Client>, Value) {
    let (run, caller) = order_child().await;
    idle(&run).await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request("agent.resume", json!({"id":run.child}))
        .await
        .unwrap();
    (run, caller, receipt)
}

#[tokio::test]
async fn b6_a_door_resume_waits_for_takeover_release() {
    let (run, caller, receipt) = idle_child_with_held_resume().await;
    assert_eq!(receipt["method"], "agent.resume");
    assert_eq!(
        receipt["outcome"],
        json!({"status":"waiting","reason":"takeover"})
    );
    assert_eq!(child_attempt(&run).await, run.attempt);
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    let attempt = child_attempt(&run).await.clone();
    let original = run.attempt.clone();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    // The child never exited, so there is nothing to resume: why is recorded.
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
    assert_eq!(attempt, original);
}

#[tokio::test]
async fn b6_a_held_resume_runs_once_when_the_child_exits_during_takeover() {
    let (run, caller, receipt) = idle_child_with_held_resume().await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let history = tokio::time::timeout(BOUND, async {
        loop {
            let history = caller
                .request("agent.actionHistory", json!({"id":run.child}))
                .await
                .unwrap();
            if history[0]["outcome"]["status"] != "in-progress" {
                break history;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the held Resume never finished");
    let attempt = child_attempt(&run).await.clone();
    let original = run.attempt.clone();
    run.finish().await;
    assert_eq!(history.as_array().unwrap().len(), 1, "{history}");
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "completed", "{history}");
    assert_ne!(attempt, original, "the held Resume started no new Attempt");
}

async fn held_door_answer(
    run: &Run,
    kind: &str,
) -> (
    Value,
    tokio::task::JoinHandle<Result<Value, RpcError>>,
    Value,
) {
    let (_, terminal) = start_answer_door(run).await;
    let (decision, waiting) = run.open(kind).await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let reply = door_peer_request(
        run,
        &terminal,
        json!({"jsonrpc":"2.0","id":1,"method":"decision.answer",
            "params":{"id":decision["id"],"answer":if kind == "permission" {"allow"} else {"Yes"}}}),
    )
    .await;
    (decision, waiting, reply["result"].clone())
}

#[tokio::test]
async fn u468_takeover_holds_door_answers_but_not_user_answers() {
    for kind in ["permission", "ask_user"] {
        let (run, _) = order_child().await;
        let (decision, waiting, receipt) = held_door_answer(&run, kind).await;
        assert_eq!(receipt["method"], "decision.answer", "{receipt}");
        assert_eq!(
            receipt["outcome"],
            json!({"status":"waiting","reason":"takeover"})
        );
        let open = run.user.request("decision.list", ()).await.unwrap();
        assert_eq!(
            open.as_array().unwrap().len(),
            1,
            "answered during Takeover"
        );
        assert!(!waiting.is_finished());
        run.user
            .request("takeover.end", json!({"agent":run.child}))
            .await
            .unwrap();
        let output = waiting.await.unwrap().unwrap();
        let history = run
            .user
            .request("agent.actionHistory", json!({"id":run.child}))
            .await
            .unwrap();
        run.finish().await;
        assert!(
            output
                .to_string()
                .contains(if kind == "permission" { "allow" } else { "Yes" })
        );
        assert_eq!(history[0]["id"], receipt["id"]);
        assert_eq!(history[0]["outcome"]["status"], "completed", "{history}");
        assert_eq!(decision["agent"], history[0]["agent"]);
    }
}

#[tokio::test]
async fn u468_an_answered_request_drops_the_held_door_answer_visibly() {
    let (run, _) = order_child().await;
    let (decision, waiting, receipt) = held_door_answer(&run, "permission").await;
    run.user_answer(&decision, "permission").await;
    waiting.await.unwrap().unwrap();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = run
        .user
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
    assert!(!history[0]["outcome"]["reason"].as_str().unwrap().is_empty());
}

async fn terminal_running(run: &Run) -> bool {
    let listed = run.user.request("terminal.list", json!({})).await.unwrap();
    listed
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == run.terminal && t["running"] == true)
}

async fn idle_child_with_held_terminal_call(method: &str) -> (Run, Arc<Client>, Value) {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request(method, json!({"id":run.terminal}))
        .await
        .unwrap();
    (run, caller, receipt)
}

async fn held_terminal_call_waits_for_release(method: &str) {
    let (run, caller, receipt) = idle_child_with_held_terminal_call(method).await;
    assert_eq!(receipt["method"], method);
    assert_eq!(
        receipt["outcome"],
        json!({"status":"waiting","reason":"takeover"})
    );
    assert!(
        terminal_running(&run).await,
        "Door {method} reached the Terminal during Takeover"
    );
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    let running = terminal_running(&run).await;
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "completed", "{history}");
    assert!(!running, "released {method} left the Terminal running");
}

#[tokio::test]
async fn b6_a_door_terminal_kill_waits_for_takeover_release() {
    held_terminal_call_waits_for_release("terminal.kill").await;
}

#[tokio::test]
async fn b6_a_door_terminal_close_waits_for_takeover_release() {
    held_terminal_call_waits_for_release("terminal.close").await;
}

#[tokio::test]
async fn b6_a_held_terminal_kill_is_dropped_when_the_child_exits() {
    let (run, caller, receipt) = idle_child_with_held_terminal_call("terminal.kill").await;
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
}

#[tokio::test]
async fn b6_a_door_terminal_write_waits_for_takeover_release() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"door")}),
        )
        .await
        .unwrap();
    assert_eq!(receipt["method"], "terminal.write");
    assert_eq!(
        receipt["outcome"],
        json!({"status":"waiting","reason":"takeover"})
    );
    // The user's own keystrokes still reach the child; the Door's bytes come after the end.
    run.user
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"user")}),
        )
        .await
        .unwrap();
    run.user
        .request("takeover.end", json!({"agent":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    let bytes = tokio::time::timeout(BOUND, async {
        loop {
            let bytes = recorded_bytes(&run).await;
            if bytes.len() >= 8 {
                return bytes;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "completed", "{history}");
    assert_eq!(bytes, b"userdoor");
}

#[tokio::test]
async fn b6_a_held_terminal_write_is_dropped_when_the_child_exits() {
    let (run, caller) = door_terminal().await;
    run.user
        .request("takeover.begin", json!({"agent":run.child}))
        .await
        .unwrap();
    let receipt = caller
        .request(
            "terminal.write",
            json!({"id":run.terminal,"data":STANDARD.encode(b"door")}),
        )
        .await
        .unwrap();
    run.user
        .request("agent.stop", json!({"id":run.child}))
        .await
        .unwrap();
    let history = caller
        .request("agent.actionHistory", json!({"id":run.child}))
        .await
        .unwrap();
    run.finish().await;
    assert_eq!(history[0]["id"], receipt["id"]);
    assert_eq!(history[0]["outcome"]["status"], "dropped", "{history}");
}
