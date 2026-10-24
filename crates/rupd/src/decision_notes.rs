//! H21: when an `answerable` Decision opens for an Agent under a Door, the Door is sent one
//! Message about it. It is the Message source of P9: the Bus event is what wakes this, nothing
//! is polled.

use contracts::agent::{NodeKind, RailNode};
use contracts::decision::Decision;
use contracts::message::{Message, MessageKind, Reason, SendParams};
use contracts::{Actor, EventData};
use serde_json::json;
use tokio::sync::broadcast::{Receiver, error::RecvError};

use crate::digest::Reader;

/// How much of a Decision's `args` the note carries.
const ARGS_CHARS: usize = 200;

/// The note for `decision` of the Agent named `name`.
fn body(decision: &Decision, name: &str) -> String {
    let args: String = decision.args.chars().take(ARGS_CHARS).collect();
    format!(
        "[decision {}] {name} asks {}: {args}",
        decision.id, decision.tool
    )
}

/// The Door above Agent `agent`: the Workstream it descends from. A Door has none above it.
fn door_of<'a>(nodes: &'a [RailNode], agent: &str) -> Option<&'a RailNode> {
    let mut at = nodes.iter().find(|node| node.id == agent)?;
    if at.kind == NodeKind::Workstream {
        return None;
    }
    while let Some(parent) = at
        .parent
        .as_ref()
        .and_then(|parent| nodes.iter().find(|n| &n.id == parent))
    {
        if parent.kind == NodeKind::Workstream {
            return Some(parent);
        }
        at = parent;
    }
    None
}

/// On each `decision.opened`, send the Agent's Door a note, unless the Decision is not
/// `answerable` or the Door is gone. Runs until the Bus closes.
pub async fn tell_doors(reader: Reader, mut events: Receiver<contracts::Event>) {
    loop {
        let decision = match events.recv().await {
            Ok(event) => match event.data {
                EventData::DecisionOpened(decision) if decision.answerable => decision,
                EventData::MessageDropped(message)
                    if message.from == Actor::daemon()
                        && message.to != Actor::user().id
                        && message.body.starts_with("[decision ") =>
                {
                    let failure = match message.reason {
                        Some(Reason::ReceiverGone) => "receiver gone",
                        Some(Reason::NotAccepted) => "Terminal did not accept the notice",
                        _ => "notice was dropped",
                    };
                    report_failure(
                        &reader,
                        &message.to,
                        &message.body,
                        failure,
                        Some(message.id),
                    )
                    .await;
                    continue;
                }
                _ => continue,
            },
            Err(RecvError::Lagged(_)) => continue,
            Err(RecvError::Closed) => return,
        };
        let Ok(nodes) = reader
            .call::<Vec<RailNode>>(
                "rail",
                "rail.tree",
                serde_json::Value::Null,
                Actor::daemon(),
            )
            .await
        else {
            continue;
        };
        let Some(door) = door_of(&nodes, &decision.agent) else {
            continue;
        };
        let name = nodes
            .iter()
            .find(|node| node.id == decision.agent)
            .map_or(decision.agent.as_str(), |node| node.name.as_str());
        let params = SendParams {
            to: door.id.clone(),
            kind: MessageKind::Note,
            body: body(&decision, name),
            reply_to: None,
        };
        let sent = reader
            .call::<Message>("message", "message.send", json!(params), Actor::daemon())
            .await;
        if let Err(err) = sent {
            report_failure(&reader, &door.id, &params.body, &err.to_string(), None).await;
        }
    }
}

async fn report_failure(
    reader: &Reader,
    door: &str,
    note: &str,
    failure: &str,
    reply_to: Option<u32>,
) {
    let params = SendParams {
        to: Actor::user().id,
        kind: MessageKind::Note,
        body: format!("{note}\nDecision notice delivery failed for supervisor {door}: {failure}"),
        reply_to,
    };
    reader
        .call::<Message>("message", "message.send", json!(params), Actor::daemon())
        .await
        .expect("store Decision notice delivery failure for the user");
}
