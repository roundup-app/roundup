//! U3780a an Agent's tool call reaches the wire and stays with the Agent whose Signal carried it.

use contracts::agent::{ToolCallEvent, ToolCallState};
use contracts::{Event, EventData};
use serde_json::json;

use crate::common::Fixture;

async fn signal(f: &Fixture, id: &str, payload: serde_json::Value) {
    f.call(
        "agent.signal",
        json!({"id": id, "attempt": f.attempt(id).await, "payload": payload}),
    )
    .await
    .unwrap();
}

fn calls(f: &mut Fixture) -> Vec<ToolCallEvent> {
    std::iter::from_fn(|| f.events.try_recv().ok())
        .filter_map(|Event { data, .. }| match data {
            EventData::AgentToolCall(call) => Some(*call),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn u3780a_calls_stay_with_their_agent() {
    let mut f = Fixture::running("sleep 30");
    let a = f.spawn(None, None).await.unwrap();
    let b = f.spawn(None, None).await.unwrap();
    calls(&mut f);

    let pre = json!({"hook_event_name": "PreToolUse", "tool_use_id": "t1", "tool_name": "Bash", "tool_input": {"command": "just check"}});
    signal(&f, &a.id, pre).await;
    let post = json!({"hook_event_name": "PostToolUse", "tool_use_id": "t1", "tool_response": "ok", "duration_ms": 9});
    signal(&f, &b.id, post.clone()).await;

    let running = calls(&mut f);
    assert_eq!(running.len(), 1);
    assert_eq!(running[0].id, a.id);
    assert_eq!(running[0].call.state, ToolCallState::Running);

    signal(&f, &a.id, post).await;
    let done = calls(&mut f);
    assert_eq!(done.len(), 1);
    assert_eq!(done[0].call.duration_ms, Some(9));

    let tree = f.tree().await;
    let of = |id: &str| tree.iter().find(|n| n.id == id).unwrap().tool_call.clone();
    assert_eq!(of(&a.id).unwrap().state, ToolCallState::Done);
    assert_eq!(of(&b.id), None);
}
