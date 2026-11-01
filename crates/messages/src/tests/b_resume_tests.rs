//! A24: a Door whose Run is gone takes a Message once it resumes.

use contracts::{Actor, Kind, Status};
use std::time::Duration;

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
    bus.emit(Actor::daemon(), EventData::RailChanged);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let idle = RailNode {
        attempt: Some("2".into()),
        status_revision: Some("2".into()),
        ..agent_node("m", Kind::Idle)
    };
    *rail.0.lock().unwrap() = vec![idle];

    let sent = messages.call(&ctx, "message.send", send).await.unwrap();
    assert_eq!(sent["status"], "pending");
}
