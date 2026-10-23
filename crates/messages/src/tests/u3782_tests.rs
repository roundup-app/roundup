//! U3782: the user removes a `pending` note of theirs that the Daemon has not typed.

use contracts::Kind;
use rpc::code;
use serde_json::json;

use super::{Harness, agent, agent_node};

async fn working_with_note() -> (tempfile::TempDir, Harness) {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    let sent = h
        .call(
            "message.send",
            json!({"to": "b", "kind": "note", "body": "mind the tests"}),
        )
        .await
        .unwrap();
    assert_eq!(sent["status"], "pending");
    (dir, h)
}

#[tokio::test]
async fn u3782_drop_of_a_pending_user_message_types_nothing() {
    let (_dir, mut h) = working_with_note().await;
    h.events();

    let dropped = h.call("message.drop", json!({"id": 1})).await.unwrap();

    assert_eq!(dropped["status"], "dropped");
    assert_eq!(dropped["reason"], "removed");
    assert_eq!(h.events(), ["message.dropped"]);
    let again = h.call("message.drop", json!({"id": 1})).await.unwrap_err();
    assert_eq!(again.code, code::CONFLICT);
    let other = h
        .call_as(agent("a"), "message.drop", json!({"id": 1}))
        .await
        .unwrap_err();
    assert_eq!(other.code, code::FORBIDDEN);
}

#[tokio::test]
async fn u3782_drop_is_refused_once_the_prompt_is_in_flight() {
    let (_dir, h) = working_with_note().await;
    h.messages.store().unwrap().record_flight(1, 1).unwrap();

    let refused = h.call("message.drop", json!({"id": 1})).await.unwrap_err();

    assert_eq!(refused.code, code::CONFLICT);
    let note = h.call("message.get", json!({"id": 1})).await.unwrap();
    assert_eq!(note["status"], "pending");
}

#[tokio::test]
async fn u3782_a_pending_message_of_another_sender_stays_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(
        dir.path(),
        vec![
            agent_node("a", Kind::Working),
            agent_node("b", Kind::Working),
        ],
    );
    h.call_as(
        agent("a"),
        "message.send",
        json!({"to": "b", "kind": "note", "body": "hi"}),
    )
    .await
    .unwrap();

    let refused = h.call("message.drop", json!({"id": 1})).await.unwrap_err();

    assert_eq!(refused.code, code::CONFLICT);
}
