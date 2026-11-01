//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input.
#[path = "support/child_run.rs"]
mod child_run;
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
use child_run::Run;
use door_terminals::{order_child, recorded_bytes};

use serde_json::{Value, json};

#[path = "support/idle.rs"]
mod idle;
use idle::idle;

#[tokio::test]
async fn u2773c_orders_external_change_keeps_original() {
    let (run, caller) = order_child().await;
    idle(&run).await;
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    run.user
        .request(
            "agent.setOrder",
            json!({
                "id":run.child,"order":{"kind":"work","ask":"original A","limits":[]}
            }),
        )
        .await
        .unwrap();
    let captured = stored_order(&run).await;
    // This authorized external write is after the editor's final read.
    let external = json!({"kind":"work","ask":"another Actor's exact Order","limits":["keep B"]});
    run.user
        .request("agent.setOrder", json!({"id":run.child,"order":external}))
        .await
        .unwrap();
    let writes = order_writes(&run).await;
    let before = recorded_bytes(&run).await;
    let result = caller
        .request(
            "agent.setOrder",
            json!({
                "id":run.child,
                "order":{"kind":"work","ask":"stale edit","limits":[]},
                "captured":{"order":captured}
            }),
        )
        .await;
    let stored = stored_order(&run).await;
    let bytes = recorded_bytes(&run).await;
    let after_writes = order_writes(&run).await;
    run.finish().await;
    assert_eq!(after_writes, writes, "U2773c: zero accepted stale effects");
    assert_eq!(result.unwrap_err().code, rpc::code::CONFLICT);
    assert_eq!(
        stored, external,
        "U2773c: refuse overwriting the external Order"
    );
    assert_eq!(
        bytes, before,
        "U2773c: refused edit types zero Terminal bytes"
    );
}

async fn stored_order(run: &Run) -> Value {
    let tree = run.user.request("rail.tree", ()).await.unwrap();
    tree.as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == run.child)
        .unwrap()["work"]
        .clone()
}

async fn order_writes(run: &Run) -> usize {
    run.user
        .request(
            "provenance.history",
            json!({"item":format!("agent:{}",run.child)}),
        )
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .filter(|touch| touch["verb"] == "wrote")
        .count()
}

#[tokio::test]
async fn u2773c_orders_unchanged_base_applies_exactly_once() {
    let (run, caller) = order_child().await;
    idle(&run).await;
    std::fs::write(run.dir.path().join("order-submit"), "accept").unwrap();
    let captured = stored_order(&run).await;
    let submitted = json!({
        "kind":"work","title":"Exact edit","ask":"  submitted Order\n",
        "done":"tests pass","limits":[" keep spacing "]
    });
    let before = order_writes(&run).await;
    let result = caller
        .request(
            "agent.setOrder",
            json!({
                "id":run.child,"order":submitted,"captured":{"order":captured}
            }),
        )
        .await
        .unwrap();
    assert_eq!(result["work"], submitted);
    assert_eq!(
        stored_order(&run).await,
        submitted,
        "U2773c: store the exact edit"
    );
    assert_eq!(
        order_writes(&run).await - before,
        1,
        "U2773c: one accepted mutation"
    );
    assert!(
        recorded_bytes(&run).await.is_empty(),
        "A4452d: an Order types no Terminal byte"
    );
    run.finish().await;
}

#[tokio::test]
async fn u2773c_orders_removed_original_never_substitutes_same_named_objects() {
    let (mut run, _) = order_child().await;
    let other = Run::start().await;
    let original = run.child.clone();
    run.user
        .request("rail.rename", json!({"id":original,"name":"child"}))
        .await
        .unwrap();
    let captured = stored_order(&run).await;
    run.user
        .request("agent.stop", json!({"id":original}))
        .await
        .unwrap();
    run.user
        .request("rail.remove", json!({"id":original}))
        .await
        .unwrap();
    run.spawn().await;
    assert_ne!(run.child, original);
    // Both temporary Projects contain an identically named child.
    assert_eq!(stored_order(&run).await, Value::Null);
    assert_eq!(stored_order(&other).await, Value::Null);
    let before = order_writes(&run).await;
    let result = run
        .user
        .request(
            "agent.setOrder",
            json!({
                "id":original,"order":{"kind":"work","ask":"must not substitute","limits":[]},
                "captured":{"order":captured}
            }),
        )
        .await;
    assert_eq!(result.unwrap_err().code, rpc::code::NOT_FOUND);
    assert_eq!(stored_order(&run).await, Value::Null);
    assert_eq!(stored_order(&other).await, Value::Null);
    assert_eq!(order_writes(&run).await, before);
    assert!(recorded_bytes(&run).await.is_empty());
    assert!(recorded_bytes(&other).await.is_empty());
    run.finish().await;
    other.finish().await;
}
