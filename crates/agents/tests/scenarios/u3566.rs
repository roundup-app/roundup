//! U3566c: the Agent's finish count counts each direct `working` to `idle` or `done` turn end.

use contracts::agent::StatusEvent;
use contracts::{EventData, Kind};
use serde_json::json;

use crate::common::{Fixture, status_of};

impl Fixture {
    async fn hook(&self, id: &str, event: &str) {
        let payload = json!({"hook_event_name": event});
        self.call(
            "agent.signal",
            json!({"id": id, "attempt": self.attempt(id).await, "payload": payload}),
        )
        .await
        .unwrap();
    }

    async fn finished(&self, id: &str) -> String {
        status_of(&self.tree().await, id).finished.clone()
    }

    fn published(&mut self) -> Vec<StatusEvent> {
        std::iter::from_fn(|| self.events.try_recv().ok())
            .filter_map(|event| match event.data {
                EventData::AgentStatus(status) => Some(*status),
                _ => None,
            })
            .collect()
    }
}

#[tokio::test]
async fn u3566c_finish_count_survives_attempts_and_reopen() {
    let mut f = Fixture::running("sleep 30");
    let id = f.spawn(None, None).await.unwrap().id;
    assert_eq!(f.finished(&id).await, "0");
    f.published();

    f.hook(&id, "Stop").await;
    let first = f.published();
    assert_eq!(first.last().unwrap().status.finished, "1");
    assert_eq!(f.finished(&id).await, "1");

    // A repeat, a label-only change and a non-finish transition add nothing.
    f.hook(&id, "Stop").await;
    f.hook(&id, "PermissionRequest").await;
    assert_eq!(f.finished(&id).await, "1");

    f.hook(&id, "UserPromptSubmit").await;
    f.hook(&id, "Stop").await;
    let tree = f.tree().await;
    assert_eq!(status_of(&tree, &id).kind, Kind::Idle);
    assert_eq!(status_of(&tree, &id).finished, "2");
    let last = f.published().pop().unwrap();
    assert_eq!(last.status.finished, "2");

    let f = f.reopen();
    let tree = f.tree().await;
    assert_eq!(status_of(&tree, &id).kind, Kind::Done);
    assert_eq!(status_of(&tree, &id).finished, "2");
}
