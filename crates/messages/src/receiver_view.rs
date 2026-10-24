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
    step(&view(open), Event::Exit).0.dropped
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
