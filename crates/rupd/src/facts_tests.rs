//! DCL5a: the end and stall facts reach the Door through the real Daemon, stores and RPC, with a
//! fake Claude socket and an injected clock.
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

use serde_json::{Value, json};

use crate::facts::{Facts, STALL_MS};
use crate::workstream_door::IdleDoor;

async fn pass(run: &IdleDoor, facts: &mut Facts) {
    let messages = run.daemon.sender.get().unwrap();
    crate::digest::push_once(&run.daemon.reader(), messages, &run.daemon.digests, facts)
        .await
        .unwrap();
}

/// The Daemon's notes to `door` that open with `tag`, read as the user reads the inbox.
async fn notes(run: &IdleDoor, door: &str, tag: &str) -> Vec<String> {
    run.call("message.list", json!({}))
        .await
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| {
            m["to"] == door && m["kind"] == "note" && m["body"].as_str().unwrap().starts_with(tag)
        })
        .map(|m| m["body"].as_str().unwrap().to_owned())
        .collect()
}

async fn signal(run: &IdleDoor, id: &str, event: &str) {
    run.call(
        "agent.signal",
        json!({"id":id,"attempt":"1","payload":{"hook_event_name":event}}),
    )
    .await;
}

#[tokio::test]
async fn dcl5_end_and_stall_facts_reach_the_door_through_the_daemon() {
    let clock = Arc::new(AtomicI64::new(1_000_000));
    let run = IdleDoor::with_clock(Arc::clone(&clock), true);
    let (door, _door_socket) = run.start("workstream", None).await;
    let (killed, _killed_socket) = run.start("agent", Some(&door)).await;
    let (slow, _slow_socket) = run.start("agent", Some(&door)).await;
    let mut facts = Facts::default();

    // (a) A killed Subagent owning seven open Todos, with no report, is told to its Door once.
    for n in 0..7 {
        run.call(
            "todo.create",
            json!({"title":format!("owned {n}"),"owner":killed}),
        )
        .await;
    }
    signal(&run, &killed, "SessionEnd").await;
    pass(&run, &mut facts).await;
    pass(&run, &mut facts).await;
    let ended = notes(&run, &door, "[ended]").await;
    assert_eq!(ended.len(), 1, "{ended:?}");
    assert!(ended[0].contains("7 open Todos"), "{}", ended[0]);
    let todos = run.call("todo.list", Value::Null).await;
    let owners: Vec<&Value> = todos
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["title"].as_str().unwrap().starts_with("owned"))
        .map(|t| &t["owner"]["id"])
        .collect();
    assert_eq!(owners, vec![&json!(killed); 7]);

    // (b) A working Agent unchanged past the limit stalls once.
    signal(&run, &slow, "UserPromptSubmit").await;
    clock.fetch_add(STALL_MS - 1, Ordering::SeqCst);
    pass(&run, &mut facts).await;
    assert!(notes(&run, &door, "[stalled]").await.is_empty());
    clock.fetch_add(1, Ordering::SeqCst);
    pass(&run, &mut facts).await;
    // A different Daemon note between the passes lets the Messages module accept a repeat of the
    // stall, so only the published bookkeeping keeps it to one.
    let (second, _second_socket) = run.start("agent", Some(&door)).await;
    run.call("todo.create", json!({"title":"owned late","owner":second}))
        .await;
    signal(&run, &second, "SessionEnd").await;
    pass(&run, &mut facts).await;
    assert_eq!(notes(&run, &door, "[ended]").await.len(), 2);
    assert_eq!(notes(&run, &door, "[stalled]").await.len(), 1);
    signal(&run, &slow, "UserPromptSubmit").await;

    // (c) The Door itself stalled shows it on its Workstream row and is sent no note.
    signal(&run, &door, "UserPromptSubmit").await;
    clock.fetch_add(STALL_MS, Ordering::SeqCst);
    pass(&run, &mut facts).await;
    let tree = run.call("rail.tree", Value::Null).await;
    let row = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == json!(door))
        .unwrap();
    assert_eq!(row["status"]["label"], "stalled");
    pass(&run, &mut facts).await;
    assert_eq!(notes(&run, &door, "[stalled]").await.len(), 1);
}
