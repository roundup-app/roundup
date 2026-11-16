//! Records the transcript receipt of Messages written to an inbox.
use super::*;

/// `messages` to `agent` left `pending` as delivered. Its failure is judged first, so the tell each
/// Event starts reads the Rail as it now stands (U6243a).
pub(crate) fn delivered(inner: &Inner, agent: &str, messages: Vec<Message>) {
    if let Err(err) = failure::settle(inner, agent) {
        log_failure("confirm_inbox", &err.to_string());
    }
    for message in messages {
        inner
            .bus
            .emit(Actor::daemon(), EventData::MessageDelivered(message.into()));
    }
}

pub(crate) fn confirm_ids(inner: &Inner, agent: &str, ids: &[u32]) -> bool {
    let ids = ids.to_vec();
    let confirmed = lock(&inner.store).confirm_flight(agent, &ids);
    match confirmed {
        Ok((mut messages, repeated)) => {
            messages.sort_by_key(|m| m.id);
            for message in &messages {
                lock(&inner.inbox_written).remove(&message.id);
            }
            delivered(inner, agent, messages);
            repeated
        }
        Err(err) => {
            log_failure("confirm_inbox", &err.to_string());
            false
        }
    }
}
