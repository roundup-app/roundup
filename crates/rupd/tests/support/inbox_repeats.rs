//! B5763: repeats have a final outcome without a second peer entry.
use super::*;

#[tokio::test]
async fn b5763c_restart_closes_a_dropped_inflight_repeat() {
    let mut run = Run::start().await;
    run.identify_sender("daemon").await;
    let id = run.note("once").await;
    until("original write", async || (run.entries().len() == 1).then_some(())).await;
    run.restart().await;
    until("repeat closed", async || (run.status(id).await.1.as_deref() == Some("repeat of last inbox entry")).then_some(())).await;
    assert!(run.entries().is_empty());
    assert_eq!(run.seen().await, [id]);
    for _ in 0..30 { run.idle_edge().await; }
    run.record(&[id, id]).await;
    assert!(run.entries().is_empty());
    assert!(run.seen().await.is_empty());
    run.restart().await;
    run.idle_edge().await;
    assert!(run.entries().is_empty());
    assert!(run.seen().await.is_empty());
    assert_eq!(run.typed().await, 0);
}

// Rejects reconstructing history from authored bodies or losing legacy admitted-entry evidence.
#[tokio::test]
async fn b5763c_legacy_transcript_closes_a_dropped_inflight_repeat() {
    use std::io::Write;
    let mut run = Run::start().await;
    run.identify_sender("daemon").await;
    let first = run.note("legacy note").await;
    until("predecessor write", async || (run.entries().len() == 1).then_some(())).await;
    let entry = run.received().remove(0);
    run.record(&[first]).await;
    until("predecessor receipt", async || (run.status(first).await.0 == "delivered").then_some(())).await;
    run.daemon.child.kill().unwrap();
    run.daemon.child.wait().unwrap();
    let path = rupd::data::project_data(run.data.path(), run.dir.path()).unwrap().join("project.db");
    let db = rusqlite::Connection::open(path).unwrap();
    db.execute("DELETE FROM message_inbox_last", []).unwrap();
    db.execute("INSERT INTO messages(from_actor,to_id,kind,body,reply_to,status,at,receiver_attempt,receiver_revision,rank) SELECT from_actor,to_id,kind,body,reply_to,'pending',at,receiver_attempt,receiver_revision,rank FROM messages WHERE id=?", [first]).unwrap();
    let repeat = u32::try_from(db.last_insert_rowid()).unwrap();
    db.execute("INSERT INTO message_flight(message_id,prompt) VALUES(?,?)", [repeat,repeat]).unwrap();
    drop(db);
    let mut transcript = std::fs::OpenOptions::new().append(true).open(run.dir.path().join("transcript.jsonl")).unwrap();
    writeln!(transcript,"{}", json!({"sessionId":"00000000-0000-4000-8000-000000000050", "origin":{"kind":"peer","from":entry["from"],"msg_id":entry["msg_id"]},"message":entry["message"]})).unwrap();
    run.restart().await;
    until("legacy repeat closed", async || (run.status(repeat).await.1.as_deref() == Some("repeat of last inbox entry")).then_some(())).await;
    assert!(run.entries().is_empty());
    assert_eq!(run.seen().await, [repeat]);
    run.restart().await;
    assert!(run.entries().is_empty());
    assert!(run.seen().await.is_empty());
}
