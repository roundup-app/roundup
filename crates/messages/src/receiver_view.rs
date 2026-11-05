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

/// B5168f: whether every pending Message is a Quiet Digest. `given` is delivered history in
/// Message-id order. A new alarming Kind, changed `last` or fewer open Todos makes news;
/// B5640b resolves requested names in one newest-first history pass for the entire batch.
pub(crate) fn are_quiet_digests(given: &[Message], pending: &[Message]) -> bool {
    use crate::pushes::{entries_of, is_digest};
    use contracts::Kind;
    use std::collections::HashMap;

    let mut entries = Vec::new();
    for message in pending {
        if !is_digest(&message.from, &message.body) {
            return false;
        }
        let parsed = entries_of(&message.body);
        if parsed.is_empty() {
            return false;
        }
        entries.extend(parsed);
    }
    // B5640b: resolve overlapping pending names once, without retaining parsed history.
    let mut before: HashMap<&str, Option<contracts::agent::DigestEntry>> =
        entries.iter().map(|e| (e.name.as_str(), None)).collect();
    let mut unresolved = before.len();
    for message in given.iter().rev() {
        if unresolved == 0 {
            break;
        }
        if !is_digest(&message.from, &message.body) {
            continue;
        }
        #[cfg(test)]
        HISTORY_PARSES.with_borrow_mut(|ids| ids.push(message.id));
        for entry in entries_of(&message.body) {
            if let Some(prior) = before.get_mut(entry.name.as_str())
                && prior.is_none()
            {
                *prior = Some(entry);
                unresolved -= 1;
            }
        }
    }
    entries.iter().all(|entry| {
        let prior = before[entry.name.as_str()].as_ref();
        let alarming = matches!(entry.kind, Kind::Error | Kind::NeedsYou)
            && prior.map(|e| e.kind) != Some(entry.kind);
        let new_last = prior.map_or(!entry.last.is_empty(), |e| e.last != entry.last);
        let todo_done = prior.is_some_and(|e| entry.todos < e.todos);
        !(alarming || new_last || todo_done)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digest::push_body;
    use contracts::agent::DigestEntry;
    use contracts::message::MessageKind;
    use contracts::{Actor, Kind};

    fn entry(kind: Kind, last: &str, todos: u32) -> DigestEntry {
        DigestEntry {
            name: "c".into(),
            kind,
            last: last.into(),
            todos,
            link: None,
            pads: vec![],
        }
    }

    fn digest(id: u32, status: MessageStatus, entry: &DigestEntry) -> Message {
        Message {
            id,
            from: Actor::daemon(),
            to: "top".into(),
            kind: MessageKind::Note,
            body: push_body(entry),
            reply_to: None,
            status,
            reason: None,
            held: None,
            at: 0,
        }
    }

    #[test]
    fn b5640b_history_is_parsed_once_per_batch() {
        let old = entry(Kind::Working, "old", 4);
        let current = entry(Kind::Working, "current", 2);
        let mut given = vec![
            digest(1, MessageStatus::Delivered, &old),
            digest(2, MessageStatus::Delivered, &current),
        ];
        given[0].at = 900;
        given[1].at = 1;
        // The first duplicate in the newest Message wins, including inside a merge.
        given[1].body = format!(
            "[digest] [2 earlier updates: #7 #8]\n{}\n{}",
            crate::digest::entry_text(&current),
            crate::digest::entry_text(&old)
        );
        let mut other = entry(Kind::Error, "second", 3);
        other.name = "other".into();
        let mut rollup = digest(3, MessageStatus::Delivered, &other);
        rollup.body = format!(
            "[digest] [5 updates kept back]\n{}",
            crate::digest::entry_text(&other)
        );
        let mut empty = rollup.clone();
        empty.id = 4;
        empty.body = "[digest] no parsed entries".into();
        given.extend([rollup, empty]);
        let mut absent = entry(Kind::Idle, "", 7);
        absent.name = "absent".into();
        // Missing names force the complete pass; repeated names must still parse each body once.
        for (extra, quiet) in [
            (absent.clone(), true),
            (other.clone(), true),
            (entry(Kind::Idle, "current", 9), true),
            (
                {
                    absent.last = "new".into();
                    absent
                },
                false,
            ),
        ] {
            let pending = vec![
                digest(10, MessageStatus::Pending, &current),
                digest(11, MessageStatus::Pending, &current),
                digest(12, MessageStatus::Pending, &extra),
            ];
            HISTORY_PARSES.with_borrow_mut(Vec::clear);
            assert_eq!(are_quiet_digests(&given, &pending), quiet);
            let parsed = HISTORY_PARSES.with_borrow(Clone::clone);
            for message in &given {
                assert!(
                    parsed.iter().filter(|id| **id == message.id).count() <= 1,
                    "{parsed:?}"
                );
            }
        }
        let mut empty = digest(13, MessageStatus::Pending, &current);
        empty.body = "[digest]".into();
        assert!(!are_quiet_digests(&given, &[empty]));
    }
    #[test]
    fn a_digest_with_news_is_not_quiet() {
        let given = [digest(
            1,
            MessageStatus::Delivered,
            &entry(Kind::Working, "a", 2),
        )];
        for next in [
            entry(Kind::Working, "b", 2),
            entry(Kind::Working, "a", 1),
            entry(Kind::Error, "a", 2),
            entry(Kind::NeedsYou, "a", 2),
        ] {
            let next = digest(2, MessageStatus::Pending, &next);
            assert!(
                !are_quiet_digests(&given, std::slice::from_ref(&next)),
                "{}",
                next.body
            );
        }
    }
}

#[cfg(test)]
thread_local! {
    static HISTORY_PARSES: std::cell::RefCell<Vec<u32>> = const { std::cell::RefCell::new(Vec::new()) };
}
