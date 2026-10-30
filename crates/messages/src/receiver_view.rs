//! How the store's pending Messages map onto `step`, and the id lists `step` answers with.
use crate::step::{Effect, Event, State, step};
use contracts::ActorKind;
use contracts::message::{Delivery, Message, MessageStatus};

/// The `State` of one receiver as the store holds it: `pending` Messages in delivery order.
pub(crate) fn view(pending: &[Message]) -> State {
    State {
        queue: pending.iter().map(|m| m.id).collect(),
        users: pending
            .iter()
            .filter(|m| m.from.kind == ActorKind::User)
            .map(|m| m.id)
            .collect(),
        ..State::default()
    }
}

/// B2, B4: where `step` puts a new Message from `from_user` over `route`.
pub(crate) fn send_status(from_user: bool, route: Delivery) -> MessageStatus {
    let (after, _) = step(&State::default(), Event::Send { from_user, route });
    if after.dropped.contains(&1) {
        MessageStatus::Dropped
    } else {
        MessageStatus::Pending
    }
}

/// B9: the ids `step` drops when the receiver is gone.
pub(crate) fn gone_drops(open: &[Message]) -> Vec<u32> {
    step(&view(open), Event::ReceiverExit).0.dropped
}

/// B30, B7: the ids `step` delivers at an `idle`, in order, from these `pending` Messages.
pub(crate) fn idle_batch(pending: &[Message]) -> Vec<u32> {
    let (_, effects) = step(&view(pending), Event::Idle);
    effects.iter().map(|Effect::Type(id)| *id).collect()
}

/// U3782: whether `step` takes `id` out of the queue when the user drops it.
pub(crate) fn user_drop_moves(pending: &[Message], id: u32) -> bool {
    step(&view(pending), Event::UserDrop(id))
        .0
        .dropped
        .contains(&id)
}

/// B5168f: whether `message` is a Quiet Digest for a receiver that was `given` these Messages: a
/// pushed digest in which no entry has a new `error` or `needs-you` Kind, a newer `last` than the
/// receiver was last given for that child, or fewer open Todos than it was given.
pub(crate) fn is_quiet_digest(given: &[Message], message: &Message) -> bool {
    use crate::pushes::{entries_of, is_digest};
    use contracts::Kind;
    if !is_digest(&message.from, &message.body) {
        return false;
    }
    let entries = entries_of(&message.body);
    !entries.is_empty()
        && entries.iter().all(|entry| {
            let before = given
                .iter()
                .rev()
                .filter(|m| is_digest(&m.from, &m.body))
                .find_map(|m| entries_of(&m.body).into_iter().find(|e| e.name == entry.name));
            let prior_kind = before.as_ref().map(|e| e.kind);
            let alarming = matches!(entry.kind, Kind::Error | Kind::NeedsYou)
                && prior_kind != Some(entry.kind);
            let new_last = before.as_ref().map_or(!entry.last.is_empty(), |e| e.last != entry.last);
            let todo_done = before.as_ref().is_some_and(|e| entry.todos < e.todos);
            !(alarming || new_last || todo_done)
        })
}
