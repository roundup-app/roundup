//! A24: a Door whose Run is gone takes a Message once it resumes.

use contracts::{Actor, Kind, Status};

use serde_json::json;

use super::*;
use super::{FakeRail, agent_node, node};

fn status(kind: Kind, label: &str) -> Option<Status> {
    Some(Status {
        kind,
        label: label.into(),
        since: 0,
        finished: "0".into(),
    })
}

#[tokio::test]
async fn a24_a_door_resumed_after_its_run_is_gone_takes_a_message() {
    let dir = tempfile::tempdir().unwrap();
    let gone = RailNode {
        status_revision: None,
        ..node(
            "m",
            NodeKind::Workstream,
            true,
            status(Kind::Done, "terminal gone"),
        )
    };
    let rail = FakeRail::new(vec![gone]);
    let bus = Bus::new();
    let agents: Arc<dyn Module> = rail.clone();
    let messages = Messages::open(dir.path(), bus.clone(), agents).unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    let mut completed = messages.inner.completed.subscribe();
    while completed.recv().await.unwrap() != "initial" {}
    let send = json!({"to": "m", "kind": "note", "body": "ship b"});
    messages
        .call(&ctx, "message.send", send.clone())
        .await
        .unwrap_err();

    // Resuming: Attempt 2 shows `starting` at Status revision 1, then the ack makes it idle.
    let resuming = RailNode {
        attempt: Some("2".into()),
        ..node(
            "m",
            NodeKind::Workstream,
            true,
            status(Kind::Working, "starting"),
        )
    };
    *rail.0.lock().unwrap() = vec![resuming];
    on_status(&messages.inner, "m", "2", "1", Kind::Working).await;
    let idle = RailNode {
        attempt: Some("2".into()),
        status_revision: Some("2".into()),
        ..agent_node("m", Kind::Idle)
    };
    *rail.0.lock().unwrap() = vec![idle];

    let sent = messages.call(&ctx, "message.send", send).await.unwrap();
    assert_eq!(sent["status"], "pending");
}

fn survivor(kind: Kind, revision: Option<&str>) -> RailNode {
    RailNode {
        terminal_id: Some("terminal-b".into()),
        status_revision: revision.map(str::to_owned),
        ..agent_node("b", kind)
    }
}

async fn initial(messages: &Messages) {
    let mut completed = messages.inner.completed.subscribe();
    while completed.recv().await.unwrap() != "initial" {}
}

#[tokio::test]
async fn b5551a_a_surviving_agent_accepts_messages_after_its_first_status() {
    for kind in ["note", "question"] {
        for poisoned in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let mut finals = Vec::new();
            if poisoned {
                let rail = FakeRail::new(vec![survivor(Kind::Idle, Some("1"))]);
                let before = Harness::open(dir.path(), rail.clone(), true);
                initial(&before.messages).await;
                before
                    .call_as(
                        agent("a"),
                        "message.send",
                        json!({"to":"b", "kind":kind, "body":"already delivered"}),
                    )
                    .await
                    .unwrap();
                *rail.0.lock().unwrap() = vec![survivor(Kind::Working, Some("2"))];
                before
                    .call(
                        "message.send",
                        json!({"to":"b", "kind":kind, "body":"already dropped"}),
                    )
                    .await
                    .unwrap();
                before.call("message.drop", json!({"id":2})).await.unwrap();
                for id in [1, 2] {
                    finals.push(before.call("message.get", json!({"id":id})).await.unwrap());
                }
                before
                    .call_as(
                        agent("a"),
                        "message.send",
                        json!({"to":"b", "kind":kind, "body":"legacy pending binding"}),
                    )
                    .await
                    .unwrap();
                drop(before);
                let store = Store::open(&dir.path().join("messages.db")).unwrap();
                store.bind(3, (1, i64::MAX)).unwrap();
                store
                    .set_generation(
                        "b",
                        store::ReceiverState {
                            attempt: 1,
                            revision: i64::MAX,
                            closed_revision: i64::MAX,
                            closed: true,
                        },
                    )
                    .unwrap();
            }
            let rail = FakeRail::new(vec![survivor(Kind::Working, None)]);
            let mut h = Harness::open(dir.path(), rail.clone(), true);
            h.inbox.receipt(false);
            initial(&h.messages).await;
            *rail.0.lock().unwrap() = vec![survivor(Kind::Working, Some("1"))];
            on_status(&h.messages.inner, "b", "1", "1", Kind::Working).await;
            let sent = h
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to":"b", "kind":kind, "body":"after restart"}),
                )
                .await
                .unwrap();
            assert_eq!(sent["status"], "pending");
            on_status(&h.messages.inner, "b", "1", "2", Kind::Idle).await;
            let expected = if poisoned { vec![3, 4] } else { vec![1] };
            assert_eq!(h.inbox.written(), expected, "{kind} poisoned={poisoned}");
            for final_message in finals {
                assert_eq!(
                    h.call("message.get", json!({"id":final_message["id"]}))
                        .await
                        .unwrap(),
                    final_message
                );
            }
            assert!(!h.events().iter().any(|e| e == "message.dropped"));
        }
    }
}

#[tokio::test]
async fn b5551a_messages_wait_for_a_surviving_agents_status() {
    for kind in ["note", "question"] {
        // A cached idle Kind and an absent Status must both wait for a revision.
        for cached in [true, false] {
            let dir = tempfile::tempdir().unwrap();
            let rail = FakeRail::new(vec![survivor(Kind::Working, Some("1"))]);
            let before = Harness::open(dir.path(), rail.clone(), false);
            initial(&before.messages).await;
            let saved = before
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to":"b", "kind":kind, "body":"saved before restart"}),
                )
                .await
                .unwrap();
            drop(before);
            let mut unknown = survivor(Kind::Idle, None);
            if !cached {
                unknown.status = None;
            }
            *rail.0.lock().unwrap() = vec![unknown];
            let mut h = Harness::open(dir.path(), rail.clone(), true);
            h.inbox.receipt(false);
            initial(&h.messages).await;
            assert_eq!(h.call("message.get", json!({"id":1})).await.unwrap(), saved);
            let sent = h
                .call_as(
                    agent("a"),
                    "message.send",
                    json!({"to":"b", "kind":kind, "body":"sent before Status"}),
                )
                .await
                .unwrap();
            assert_eq!(sent["status"], "pending");
            assert!(h.inbox.written().is_empty());
            assert!(!h.events().iter().any(|e| e == "message.dropped"));

            *rail.0.lock().unwrap() = vec![survivor(Kind::Working, Some("2"))];
            on_status(&h.messages.inner, "b", "1", "2", Kind::Working).await;
            for id in [1, 2] {
                assert_eq!(
                    h.call("message.get", json!({"id":id})).await.unwrap()["status"],
                    "pending"
                );
            }
            assert!(h.inbox.written().is_empty());
            on_status(&h.messages.inner, "b", "1", "3", Kind::Idle).await;
            assert_eq!(h.inbox.written(), [1, 2]);
            assert_eq!(
                h.inbox.typed(),
                [
                    ("b".into(), "saved before restart".into()),
                    ("b".into(), "sent before Status".into()),
                ]
            );
            for id in [1, 2] {
                assert_eq!(
                    h.call("message.get", json!({"id":id})).await.unwrap()["status"],
                    "pending"
                );
                h.messages.confirm_inbox("b", &[id]);
                h.messages.confirm_inbox("b", &[id]);
                assert_eq!(
                    h.call("message.get", json!({"id":id})).await.unwrap()["status"],
                    "delivered"
                );
            }
            assert_eq!(
                h.events()
                    .iter()
                    .filter(|e| *e == "message.delivered")
                    .count(),
                2
            );
            on_status(&h.messages.inner, "b", "1", "4", Kind::Idle).await;
            assert_eq!(h.inbox.written(), [1, 2]);
        }
    }
}

#[tokio::test]
async fn b5551a_an_ended_agent_is_not_mistaken_for_a_survivor() {
    for kind in ["note", "question"] {
        let dir = tempfile::tempdir().unwrap();
        let mut gone = agent_node("b", Kind::Done);
        gone.status = None;
        gone.status_revision = None;
        let mut h = Harness::new(dir.path(), vec![gone]);
        initial(&h.messages).await;
        let err = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to":"b", "kind":kind, "body":"actually ended"}),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, code::CONFLICT);
        assert_eq!(h.call("message.list", json!({})).await.unwrap(), json!([]));
        assert!(!h.events().iter().any(|e| e == "message.sent"));
    }
}
