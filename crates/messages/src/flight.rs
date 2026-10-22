//! Whether a prompt the Agents holder took is the flight of these Messages.
use super::*;

pub(crate) fn confirm(inner: &Inner, agent: &str, prompt: &str) -> bool {
    let Some(ids) = flight_ids(prompt) else {
        return false;
    };
    // Legacy model fixtures project both transports onto Deliver and synthetic prompt receipts.
    #[cfg(test)]
    if inner.inbox.get().is_none() {
        return confirm_ids(inner, agent, &ids);
    }
    let mut user_ids = Vec::new();
    {
        let store = lock(&inner.store);
        for &id in &ids {
            match store.get(id) {
                Ok(Some(message)) if message.from.kind == ActorKind::User => user_ids.push(id),
                Ok(_) => {}
                Err(err) => {
                    log_failure("confirm_prompt", &err.to_string());
                    return false;
                }
            }
        }
    }
    // A mixed id line must not block a prompt merely because its user Messages were delivered.
    let repeated = confirm_ids(inner, agent, &user_ids);
    repeated && user_ids.len() == ids.len()
}

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
            log_failure("confirm_prompt", &err.to_string());
            false
        }
    }
}

/// B39: the ids of a prompt's last line, `[rup messages: <id> <id>]`; `None` when it has none or
/// the line cannot be read.
pub(crate) fn flight_ids(prompt: &str) -> Option<Vec<u32>> {
    let line = prompt.trim_end().lines().last()?;
    let ids = line
        .strip_prefix("[rup messages:")?
        .strip_suffix(']')?
        .split_whitespace()
        .map(|word| word.parse().ok())
        .collect::<Option<Vec<u32>>>()?;
    (!ids.is_empty()).then_some(ids)
}
