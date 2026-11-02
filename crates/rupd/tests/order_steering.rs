//! B6's Agent prerequisite: real Daemon, fake Claude and its recorded Terminal input. The user's
//! Steer is the one write left that types (A4452d), so these tests drive it.
#[path = "support/child_run.rs"]
mod child_run;
#[path = "support/door_terminals.rs"]
mod door_terminals;
#[path = "support/rupd_harness.rs"]
mod rupd_harness;
use door_terminals::{order_child, recorded_bytes};

#[path = "support/user_steer.rs"]
mod user_steer;
use user_steer::user_steer;

#[tokio::test]
async fn b6_a_refused_steer_writes_no_byte() {
    let (run, _caller) = order_child().await;
    std::fs::write(run.dir.path().join("order-effect-gate"), "refuse").unwrap();
    let err = user_steer(&run).await.await.unwrap().unwrap_err();
    assert_eq!(err.code, rpc::code::NOT_ACCEPTED, "{err:?}");
    assert!(err.message.contains("did not accept"), "{err:?}");
    std::fs::remove_file(run.dir.path().join("order-effect-gate")).unwrap();
    assert!(recorded_bytes(&run).await.is_empty());
    run.finish().await;
}
