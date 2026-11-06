//! U6248b: the Daemon owns the schedule on which a turn Claude Code gave up on is resumed. The
//! table lives in `agents`; this task sleeps to the next due time, sends each due Agent the
//! resume Message through the ordinary delivery path, and wakes again on any Rail change.

use std::sync::Arc;
use std::time::Duration;

use contracts::{Actor, Event, EventData};
use tokio::sync::broadcast::{Receiver, error::RecvError};

use crate::digest::Reader;

/// Runs until the Bus closes.
pub async fn resume_turns(
    reader: Reader,
    agents: Arc<agents::Agents>,
    mut events: Receiver<Event>,
) {
    loop {
        for id in agents.take_due_resumes() {
            let sent = reader
                .call::<contracts::message::Message>(
                    "message",
                    "message.send",
                    serde_json::json!({"to": id, "kind": "note", "body": agents::RESUME_BODY}),
                    Actor::daemon(),
                )
                .await;
            if let Err(err) = sent {
                eprintln!("resume of {id} not sent: {err}");
            }
        }
        let wait = agents
            .until_next_resume()
            .unwrap_or(Duration::from_secs(3600));
        tokio::select! {
            event = events.recv() => match event {
                Ok(Event { data: EventData::MessageSent(m), .. }) if m.body != agents::RESUME_BODY => {
                    agents.cancel_resume(&m.to);
                }
                Ok(_) | Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => return,
            },
            () = tokio::time::sleep(wait) => {}
        }
    }
}
