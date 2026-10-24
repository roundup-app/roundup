//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
#[path = "support/child_run.rs"]
mod child_run;
use door_terminals::{idle, order_child, order_result, ordered_ask, recorded_bytes};
use child_run::BOUND;

use serde_json::json;
use std::sync::Arc;

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
async fn b6_a_busy_child_reports_a_refused_order_steer() {
    let (run, caller) = order_child().await;
    run.user.request("agent.signal", json!({"id":run.child,"attempt":run.attempt,"payload":{"hook_event_name":"UserPromptSubmit"}})).await.unwrap();
    let err = order_result(&run, caller).await.await.unwrap().unwrap_err();
    assert_eq!(err.code, rpc::code::BUSY);
    assert!(err.message.contains("Order stored"), "{err:?}");
    assert!(err.message.contains("no bytes written"), "{err:?}");
    assert_eq!(ordered_ask(&run).await, "first order");
    assert!(recorded_bytes(&run).await.is_empty());
    run.finish().await;
}
