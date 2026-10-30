//! A33: an idle Agent that waits on an open blocker reads `blocked`.

use std::collections::HashMap;

use contracts::agent::StatusEvent;
use contracts::{EventData, Kind};
use serde_json::json;

use crate::common::{Fixture, status_of};

impl Fixture {
    async fn event(&self, id: &str, event: &str) {
        let payload = json!({"hook_event_name": event});
        self.call(
            "agent.signal",
            json!({"id": id, "attempt": self.attempt(id).await, "payload": payload}),
        )
        .await
        .unwrap();
    }

    fn waits(&self, pairs: &[(&str, u32)]) {
        let waits: HashMap<String, u32> =
            pairs.iter().map(|(id, n)| ((*id).to_owned(), *n)).collect();
        self.agents.set_waits(waits);
    }

    fn status_events(&mut self) -> Vec<StatusEvent> {
        std::iter::from_fn(|| self.events.try_recv().ok())
            .filter_map(|event| match event.data {
                EventData::AgentStatus(status) => Some(*status),
                _ => None,
            })
            .collect()
    }

    async fn reading(&self, id: &str) -> (Kind, String) {
        let tree = self.tree().await;
        let status = status_of(&tree, id);
        (status.kind, status.label.clone())
    }
}

async fn idle_agent() -> (Fixture, String) {
    let f = Fixture::running("sleep 30");
    let id = f.spawn(None, None).await.unwrap().id;
    f.event(&id, "Stop").await;
    (f, id)
}

#[tokio::test]
async fn a33_an_idle_agent_with_a_blocked_todo_reads_blocked() {
    let (f, id) = idle_agent().await;
    assert_eq!(f.reading(&id).await.0, Kind::Idle);
    f.waits(&[(&id, 4)]);
    assert_eq!(f.reading(&id).await, (Kind::Blocked, "waits on #4".into()));
}

#[tokio::test]
async fn a33_working_error_and_needs_you_outrank_blocked() {
    let (f, id) = idle_agent().await;
    f.waits(&[(&id, 4)]);
    f.event(&id, "UserPromptSubmit").await;
    assert_eq!(f.reading(&id).await.0, Kind::Working);
    f.event(&id, "Stop").await;
    assert_eq!(f.reading(&id).await.0, Kind::Blocked);
    f.event(&id, "PermissionRequest").await;
    assert_eq!(f.reading(&id).await.0, Kind::NeedsYou);
}

#[tokio::test]
async fn a33_completing_the_blocker_reads_idle_with_a_new_revision() {
    let (mut f, id) = idle_agent().await;
    f.status_events();
    f.waits(&[(&id, 4)]);
    let blocked = f.status_events();
    assert_eq!(blocked.len(), 1);
    assert_eq!(blocked[0].status.kind, Kind::Blocked);
    f.waits(&[]);
    let idle = f.status_events();
    assert_eq!(idle.len(), 1);
    assert_eq!(idle[0].status.kind, Kind::Idle);
    let revision = |e: &StatusEvent| e.status_revision.parse::<u64>().unwrap();
    assert!(revision(&idle[0]) > revision(&blocked[0]));
    assert_eq!(f.reading(&id).await.0, Kind::Idle);
}
