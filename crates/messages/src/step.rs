//! The one pure, total transition function of a receiver's Messages (B1 to B9) and of one question's
//! escalation chain (B13 to B17), named and ordered
//! as `proofs/messages/model.bend` names them. No I/O, clock or random source: the Daemon builds
//! the `Event`, reads the `State` back from the store and applies the `Effect`s.

use contracts::message::Delivery;

/// Where a question is on its chain (B13 to B17); `model.bend`'s `Phase`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Phase {
    /// No question yet.
    NoQ,
    /// The chain is read, no hop made.
    Chained,
    /// The current hop is live.
    OnHop,
    /// The current hop ended without an answer; the next is due.
    Ended,
    /// B17 stopped the bubble, or the user answered the Escalated question.
    Answered,
    /// The Escalated question was made for the user, who has it at once (B15).
    Escalated,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct State {
    pub queue: Vec<u32>,
    pub typed: Vec<u32>,
    pub dropped: Vec<u32>,
    pub users: Vec<u32>,
    pub next: u32,
    pub idle: bool,
    pub gone: bool,
    pub phase: Phase,
    /// The sender of the question, never a hop.
    pub origin: u32,
    /// The hops still to make, nearest first.
    pub rest: Vec<u32>,
    /// The hops made, latest first.
    pub hops: Vec<u32>,
    /// How many per-hop bounds (B14) have passed.
    pub bounds: u32,
}

impl Default for State {
    fn default() -> Self {
        Self {
            queue: vec![],
            typed: vec![],
            dropped: vec![],
            users: vec![],
            next: 1,
            idle: false,
            gone: false,
            phase: Phase::NoQ,
            origin: 0,
            rest: vec![],
            hops: vec![],
            bounds: 0,
        }
    }
}

#[derive(Clone, Debug)]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) enum Event {
    Send { from_user: bool, route: Delivery },
    Idle,
    Busy,
    Exit,
    UserDrop(u32),
    Restart { alive: bool },
    Ask { origin: u32, chain: Vec<u32> },
    HopMade,
    HopEnded,
    BoundPassed,
    Answer,
    Escalate,
    Reply,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Effect {
    Type(u32),
}

#[cfg(test)]
pub(crate) const TRANSITIONS: [&str; 13] = [
    "send",
    "idle",
    "busy",
    "exit",
    "user_drop",
    "restart",
    "ask",
    "hop_made",
    "hop_ended",
    "bound_passed",
    "answer",
    "escalate",
    "reply",
];

fn flush(mut s: State, effects: &mut Vec<Effect>) -> State {
    if s.idle && !s.queue.is_empty() {
        // B30: every pending Message goes in this `idle`'s one prompt.
        for x in std::mem::take(&mut s.queue) {
            s.typed.push(x);
            effects.push(Effect::Type(x));
        }
        s.idle = false;
    }
    s
}

/// B13: the chain as read when the sender sends: the sender skipped, an Agent at most once.
fn clean(origin: u32, chain: &[u32]) -> Vec<u32> {
    chain
        .iter()
        .enumerate()
        .filter(|(i, x)| **x != origin && !chain[i + 1..].contains(x))
        .map(|(_, x)| *x)
        .collect()
}

pub(crate) fn step(state: &State, event: Event) -> (State, Vec<Effect>) {
    let mut s = state.clone();
    let mut fx = vec![];
    match event {
        Event::Send { from_user, route } => {
            if s.gone {
                return (s, fx);
            }
            let n = s.next;
            s.next += 1;
            match route {
                Delivery::Auto => {
                    if from_user {
                        s.users.push(n);
                    }
                    s.queue.push(n);
                    s = flush(s, &mut fx);
                }
                Delivery::Drop => {
                    s.dropped.push(n);
                    if from_user {
                        s.users.push(n);
                    }
                }
            }
        }
        Event::Idle => {
            if !s.gone {
                s.idle = true;
                s = flush(s, &mut fx);
            }
        }
        Event::Busy => s.idle = false,
        Event::Exit => {
            let mut gone = std::mem::take(&mut s.queue);
            s.dropped.append(&mut gone);
            s.idle = false;
            s.gone = true;
        }
        Event::UserDrop(id) => {
            // U3782: a pending Message the user removed; nothing is typed.
            if let Some(i) = s.queue.iter().position(|x| *x == id) {
                s.queue.remove(i);
                s.dropped.push(id);
            }
        }
        // B8: nothing is typed. A lost Terminal is the receiver gone (B9); a kept one is not yet known idle.
        Event::Restart { alive } => {
            if alive {
                s.idle = false;
            } else {
                s = step(&s, Event::Exit).0;
            }
        }
        // B13: the chain is read once; there is one question.
        Event::Ask { origin, chain } => {
            if s.phase == Phase::NoQ {
                s.phase = Phase::Chained;
                s.origin = origin;
                s.rest = clean(origin, &chain);
            }
        }
        // B13, B16: the next hop is the nearest Agent left in the chain.
        Event::HopMade => {
            if matches!(s.phase, Phase::Chained | Phase::Ended) && !s.rest.is_empty() {
                s.hops.insert(0, s.rest.remove(0));
                s.phase = Phase::OnHop;
            }
        }
        // B16: a hop that ended without an answer is passed at once.
        Event::HopEnded => {
            if s.phase == Phase::OnHop {
                s.phase = Phase::Ended;
            }
        }
        // B14: the live hop's bound ran out.
        Event::BoundPassed => {
            if s.phase == Phase::OnHop {
                s.phase = Phase::Ended;
                s.bounds += 1;
            }
        }
        // B17: the hop's Agent answered.
        Event::Answer => {
            if s.phase == Phase::OnHop {
                s.phase = Phase::Answered;
            }
        }
        // B15: no hop is left, so the Escalated question is made, once.
        Event::Escalate => {
            if matches!(s.phase, Phase::Chained | Phase::Ended) && s.rest.is_empty() {
                s.phase = Phase::Escalated;
            }
        }
        // B15: the user's reply answers the Escalated question.
        Event::Reply => {
            if s.phase == Phase::Escalated {
                s.phase = Phase::Answered;
            }
        }
    }
    (s, fx)
}

/// A35: a reserved receiver's temporary ending, idle and Daemon reopen cannot apply
/// Exit/Idle/Restart to its Message ledger. Removal is final and bypasses this projection.
pub(crate) fn restart_event(reserved: bool, event: Event) -> Event {
    if reserved
        && matches!(
            event,
            Event::Exit
                | Event::Idle
                | Event::Restart { .. }
                | Event::HopEnded
                | Event::BoundPassed
        )
    {
        Event::Busy
    } else {
        event
    }
}

/// A35: selected retirement is an enduring ineligible receiver, including after final removal.
/// Preserve its ledger on automatic lifecycle/replay inputs, refuse new sends.
pub(crate) fn retirement_event(retiring: bool, event: Event) -> Event {
    if retiring
        && matches!(
            event,
            Event::Send { .. }
                | Event::Exit
                | Event::Idle
                | Event::Restart { .. }
                | Event::HopEnded
                | Event::BoundPassed
        )
    {
        Event::Busy
    } else {
        event
    }
}
