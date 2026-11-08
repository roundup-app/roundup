//! U6248b: a scripted server error reaches a real Claude, and roundup resumes it.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use contracts::{EventData, Kind};
use serde_json::json;

#[tokio::test]
async fn u6248b_real_claude_resumes_after_a_server_error() {
    let mut project =
        daemon::start_real("u6248b_server_error", &[("ROUNDUP_RESUME_DELAY_MS", "200")]);
    let user = project.client().await;
    let mut events = project.subscribed().await;
    let id = user
        .request(
            "agent.spawn",
            json!({"cwd":project.dir.path(),"name":"U6248b child","prompt":"U6248b scripted server error"}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // The scripted 500 shows as a waiting state with its cause, never `error`.
    let waiting = project
        .next_named("the waiting status", &mut events, |data| match data {
            EventData::AgentStatus(s)
                if s.id == id && s.status.label.starts_with("Claude's servers failed") =>
            {
                Some(s)
            }
            _ => None,
        })
        .await;
    assert_eq!(waiting.status.kind, Kind::Blocked);
    // The Daemon sends the resume Message, and the next turn clears the waiting state.
    project
        .next_named("the resume Message", &mut events, |data| match data {
            EventData::MessageSent(m) if m.to == id && m.body == agents::RESUME_BODY => Some(()),
            _ => None,
        })
        .await;
    tokio::time::timeout(project.bound(), async {
        loop {
            let nodes = project.rail_tree(&user).await;
            let node = nodes.iter().find(|n| n.id == id).unwrap();
            if node.status.as_ref().unwrap().kind == Kind::Idle && node.resume.is_none() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("the resumed turn went idle and cleared the waiting state");
    let model = project.model.take().unwrap();
    let journal = model.journal();
    assert_eq!(
        journal
            .iter()
            .filter(|e| e["response"]["status"] == 500)
            .count(),
        1,
        "{journal:#?}"
    );
}
