//! Records the transcript receipt of Messages written to an inbox.
use super::*;

pub(crate) fn confirm_ids(inner: &Inner, agent: &str, ids: &[u32]) -> bool {
    let ids = ids.to_vec();
    let confirmed = lock(&inner.store).confirm_flight(agent, &ids);
    match confirmed {
        Ok((mut messages, repeated)) => {
            messages.sort_by_key(|m| m.id);
            for message in messages {
                inner
                    .bus
                    .emit(Actor::daemon(), EventData::MessageDelivered(message.into()));
            }
            repeated
        }
        Err(err) => {
            log_failure("confirm_inbox", &err.to_string());
            false
        }
    }
}
