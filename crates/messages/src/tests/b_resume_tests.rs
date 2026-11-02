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
            if poisoned {
                let store = Store::open(&dir.path().join("messages.db")).unwrap();
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
            assert_eq!(h.inbox.written(), [1], "{kind} poisoned={poisoned}");
            assert!(!h.events().iter().any(|e| e == "message.dropped"));
        }
    }
}
