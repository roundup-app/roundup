//! The one pure, total transition function of a receiver's Messages (B1 to B9), named and ordered
//! as `proofs/messages/model.bend` names them. No I/O, clock or random source: the Daemon builds
//! the `Event`, reads the `State` back from the store and applies the `Effect`s.

use contracts::message::Delivery;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct State {
    pub queue: Vec<u32>,
    pub typed: Vec<u32>,
    pub dropped: Vec<u32>,
    pub users: Vec<u32>,
    pub next: u32,
    pub idle: bool,
    pub gone: bool,
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
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Effect {
    Type(u32),
}

#[cfg(test)]
pub(crate) const TRANSITIONS: [&str; 6] = ["send", "idle", "busy", "exit", "user_drop", "restart"];

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
    }
    (s, fx)
}

/// A35: a reserved receiver's temporary ending, idle and Daemon reopen cannot apply
/// Exit/Idle/Restart to its Message ledger. Removal is final and bypasses this projection.
pub(crate) fn restart_event(reserved: bool, event: Event) -> Event {
    if reserved && matches!(event, Event::Exit | Event::Idle | Event::Restart { .. }) {
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
            Event::Send { .. } | Event::Exit | Event::Idle | Event::Restart { .. }
        )
    {
        Event::Busy
    } else {
        event
    }
}
