//! AMG2–AMG4: starts the memory guard's sampler and tells the Agent and its Door of each end.

use std::collections::HashSet;

use agents::guard::{self, End, Live};
use contracts::Actor;
use contracts::agent::NodeKind;
use serde_json::json;

use crate::Daemon;
use crate::digest::Reader;

impl Daemon {
    /// Start the sampler on its own thread, and a task that sends each end's note. The thread
    /// lives as long as the Daemon process.
    pub fn start_memory_guard(&self) {
        let (ends, mut ended) = tokio::sync::mpsc::unbounded_channel::<End>();
        let agents = std::sync::Arc::clone(&self.agents);
        let source = Live::new(move || {
            agents
                .running_programs()
                .into_iter()
                .map(|(_, pid)| pid)
                .collect::<HashSet<u32>>()
        });
        guard::spawn(
            source,
            self.observers.memory_budget,
            true,
            guard::every_second(),
            move |end| {
                let _ = ends.send(end);
            },
        );
        let reader = self.reader();
        tokio::spawn(async move {
            while let Some(end) = ended.recv().await {
                tell(&reader, &end).await;
            }
        });
    }
}

/// The note to the Agent whose process ended, and to the Door it belongs to: one each.
async fn tell(reader: &Reader, end: &End) {
    let body = end.note();
    let mut targets = vec![(end.agent.clone(), body.clone())];
    if let Ok(nodes) = reader.rail().await {
        let mut at = nodes.iter().find(|n| n.id == end.agent);
        while let Some(node) = at {
            if node.kind == NodeKind::Workstream {
                targets.push((node.id.clone(), format!("Agent {}: {body}", end.agent)));
                break;
            }
            at = node
                .parent
                .as_ref()
                .and_then(|parent| nodes.iter().find(|n| &n.id == parent));
        }
    }
    for (to, body) in targets {
        let sent = reader
            .call::<contracts::message::Message>(
                "message",
                "message.send",
                json!({"to": to, "kind": "note", "body": body}),
                Actor::daemon(),
            )
            .await;
        if let Err(err) = sent {
            eprintln!("memory guard: note to {to} not sent: {err}");
        }
    }
}
