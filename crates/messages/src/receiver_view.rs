//! How the store's pending and held Messages map onto `step`, and the id lists `step` answers with.
use crate::step::{Event, State, step};
use contracts::message::{Message, MessageKind};

/// The `State` of one receiver as the store holds it: `pending` Messages in delivery order, the
/// `held` ones by Reason. `escalated` holds are not in `step` yet (B13 to B17).
pub(crate) fn view(pending: &[Message], held: &[Message], takeover: bool) -> State {
    let ids = |messages: &[Message], reason: Option<Reason>| -> Vec<u32> {
        messages
            .iter()
            .filter(|m| reason.is_none() || m.reason == reason)
            .map(|m| m.id)
            .collect()
    };
    State {
        queue: ids(pending, None),
        held_ask_first: ids(held, Some(Reason::AskFirst)),
        held_takeover: ids(held, Some(Reason::Takeover)),
        users: pending
            .iter()
            .chain(held)
            .filter(|m| m.from.kind == ActorKind::User)
            .map(|m| m.id)
            .collect(),
        takeover,
        ..State::default()
    }
}

/// B2, B3, B4, B6: where `step` puts a new Message from `from_user` over `route`, with a Takeover
/// active or not.
pub(crate) fn send_status(
    from_user: bool,
    route: Delivery,
    takeover: bool,
) -> (MessageStatus, Option<Reason>) {
    let state = State {
        takeover,
        ..State::default()
    };
    let (after, _) = step(&state, Event::Send { from_user, route });
    if after.dropped.contains(&1) {
        (MessageStatus::Dropped, None)
    } else if after.held_takeover.contains(&1) {
        (MessageStatus::Held, Some(Reason::Takeover))
    } else if after.held_ask_first.contains(&1) {
        (MessageStatus::Held, Some(Reason::AskFirst))
    } else {
        (MessageStatus::Pending, None)
    }
}

/// B6: the ids `step` holds when a Takeover begins over these `pending` Messages.
pub(crate) fn hold_for_takeover(pending: &[Message]) -> Vec<u32> {
    step(&view(pending, &[], false), Event::TakeoverBegin)
        .0
        .held_takeover
}

/// B32: the ids `step` holds when the user types into a Terminal over these `pending` Messages.
pub(crate) fn hold_for_input(pending: &[Message]) -> Vec<u32> {
    step(&view(pending, &[], false), Event::UserInput)
        .0
        .held_takeover
}

/// B6: the ids `step` makes `pending` when a Takeover ends, in the order they wait.
pub(crate) fn release_order(held: &[Message]) -> Vec<u32> {
    step(&view(&[], held, true), Event::TakeoverEnd).0.queue
}

/// B9: the ids `step` drops when the receiver is gone.
pub(crate) fn gone_drops(open: &[Message]) -> Vec<u32> {
    let (pending, held): (Vec<Message>, Vec<Message>) = open
        .iter()
        .cloned()
        .partition(|m| m.status == MessageStatus::Pending);
    step(&view(&pending, &held, false), Event::Exit).0.dropped
}

/// B30, B7: the ids `step` types at an `idle`, in order, from these `pending` Messages.
pub(crate) fn idle_batch(pending: &[Message]) -> Vec<u32> {
    let (_, effects) = step(&view(pending, &[], false), Event::Idle);
    effects.iter().map(|Effect::Type(id)| *id).collect()
}

/// B3, B6: whether the user's `deliver` or `drop` of the `held` `message` takes effect. A Message
/// held for a reason `step` does not know yet is left to the store's own check.
pub(crate) fn user_call_moves(message: &Message, call: Event) -> bool {
    if !matches!(message.reason, Some(Reason::AskFirst | Reason::Takeover)) {
        return true;
    }
    let before = view(&[], std::slice::from_ref(message), false);
    let (after, _) = step(&before, call);
    after.held_ask_first.len() + after.held_takeover.len()
        < before.held_ask_first.len() + before.held_takeover.len()
}
