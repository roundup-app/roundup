//! B5168f: a quiet digest starts no turn; a held one rides the next delivery.
use super::*;

fn digest_of(last: &str) -> String {
    messages::digest::push_body(&contracts::agent::DigestEntry {
        name: "c".into(),
        kind: contracts::Kind::Working,
        last: last.into(),
        todos: 0,
        pads: vec![],
    })
}

/// A Daemon with one idle Agent, and the sender identified as the Daemon (B21).
async fn quiet_run() -> Run {
    let run = Run::start().await;
    run.identify_sender("daemon").await;
    run
}

#[tokio::test]
async fn b5168f_a_quiet_digest_starts_no_turn() {
    let mut run = quiet_run().await;
    let id = run.note(&digest_of("")).await;
    assert!(run.seen().await.is_empty());
    assert!(run.entries().is_empty());
    assert_eq!(run.status(id).await.0, "pending");
    run.idle_edge().await;
    assert!(run.entries().is_empty(), "no idle delivers it");
    assert_eq!(run.status(id).await.0, "pending");
}

#[tokio::test]
async fn b5168f_a_finished_result_starts_one_turn() {
    let run = quiet_run().await;
    let id = run.note(&digest_of("done: the build is green")).await;
    until("taken up", async || {
        (run.entries() == [format!("rup-{id}")]).then_some(())
    })
    .await;
}

#[tokio::test]
async fn b5168f_a_new_question_starts_one_turn() {
    let mut run = Run::start().await;
    run.kind = "question";
    let id = run.note("which branch?").await;
    until("taken up", async || {
        (run.entries() == [format!("rup-{id}")]).then_some(())
    })
    .await;
}

#[tokio::test]
async fn b5168f_a_held_quiet_digest_rides_the_next_delivery_once() {
    let run = quiet_run().await;
    let held = run.note(&digest_of("")).await;
    let next = run.note("hello").await;
    until("both taken up", async || {
        (run.entries() == [format!("rup-{held}"), format!("rup-{next}")]).then_some(())
    })
    .await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(run.entries().len(), 2, "delivered once");
}

#[tokio::test]
async fn b5168f_a_restart_keeps_a_held_quiet_digest() {
    let mut run = quiet_run().await;
    let held = run.note(&digest_of("")).await;
    assert!(run.seen().await.is_empty());
    run.restart().await;
    run.identify_sender("daemon").await;
    assert!(run.entries().is_empty(), "still pending after the restart");
    assert_eq!(run.status(held).await.0, "pending");
    let next = run.note("hello").await;
    until("both taken up", async || {
        (run.entries() == [format!("rup-{held}"), format!("rup-{next}")]).then_some(())
    })
    .await;
}
