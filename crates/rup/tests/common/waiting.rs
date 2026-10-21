//! Waits on a probe, a Door turn or a model request.
use crate::daemon::{aimock, rail_tree};

use contracts::Kind;

use std::time::Duration;

pub async fn until<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if let Some(found) = probe() {
                return found;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("never: {what}"))
}

pub async fn idle(client: &rpc::Client, id: &str) {
    until_async(&format!("{id} idle"), || async {
        rail_tree(client)
            .await
            .into_iter()
            .find(|n| n.id == id)
            .and_then(|n| n.status)
            .is_some_and(|s| s.kind == Kind::Idle)
            .then_some(())
    })
    .await;
}

pub async fn until_async<T>(what: &str, mut probe: impl AsyncFnMut() -> Option<T>) -> T {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if let Some(found) = probe().await {
                return found;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("never: {what}"))
}

/// The model's journal holds a user message with `needle`: the prompt reached real Claude.
pub async fn received(model: &aimock::Model, needle: &str) {
    until(&format!("the model received {needle:?}"), || {
        model
            .journal()
            .iter()
            .any(|entry| {
                entry["body"]["messages"]
                    .as_array()
                    .is_some_and(|messages| {
                        messages.iter().any(|m| {
                            m["role"] == "user"
                                && m["content"].as_str().is_some_and(|t| t.contains(needle))
                        })
                    })
            })
            .then_some(())
    })
    .await;
}

/// The Door is asked to hand off once the model's journal holds the Clear prompt.
pub async fn asked(model: &aimock::Model) {
    received(model, "workstream_handoff").await;
}

/// The Door ended the turn that took a prompt holding `needle`. The model's journal proves the prompt
/// arrived, and an Idle read after that is the turn's end: a Status event is not, because an Idle
/// can arrive as the next turn begins.
pub async fn turn_done(model: &aimock::Model, client: &rpc::Client, door: &str, needle: &str) {
    received(model, needle).await;
    idle(client, door).await;
}
