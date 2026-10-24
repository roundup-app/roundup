//! V4: `inv_` replays tie `proofs/messages/model.bend` to the Rust. A Builder adds a law's test here
//! before the code that passes it, and changes an existing test only as V3 changes a law: reviewed,
//! and only stronger.
//!
//! Pinned seam, `crates/messages/src/step.rs` (new), the one pure, total function the Daemon's
//! transitions run through, named and ordered as `model.bend` names and orders them:
//! ```text
//! pub(crate) struct State { queue, typed, dropped, users: Vec<u32>,
//!                           next: u32, idle: bool, gone: bool,
//!                           phase: Phase, origin: u32, rest, hops: Vec<u32>, bounds: u32 }   // Clone, Debug, PartialEq
//! impl Default for State   // model.bend's `init`: empty lists, `next` 1, `idle` and `gone` false
//! #[derive(Clone, Debug)]
//! pub(crate) enum Event { Send { from_user: bool, route: Delivery }, Idle, Busy, Exit,
//!                         UserDrop(u32),
//!                         Restart { alive: bool }, Ask { origin: u32, chain: Vec<u32> },
//!                         HopMade, HopEnded, BoundPassed, Answer, Escalate, Reply }
//! pub(crate) enum Effect { Type(u32) }             // Clone, Debug, PartialEq
//! pub(crate) fn step(state: &State, event: Event) -> (State, Vec<Effect>)
//! pub(crate) const TRANSITIONS: [&str; 13]          // the snake_case names of the Event variants
//! ```
//! `step` has no I/O, clock or random source. Slice 2's Daemon applies its effects: `Type(id)`
//! is the one prompt handed to `Deliver`.

use contracts::message::Delivery;

use crate::step::{Effect, Event, Phase, State, TRANSITIONS, step};

/// xorshift64: a fixed seed gives the same schedules on every machine.
struct Rng(u64);

impl Rng {
    fn below(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }
}

const MESSAGES: u64 = 3;
const EVENTS: u64 = 6;

/// At most 6 events and 3 Messages (V4): a schedule never sends a fourth.
fn schedule(rng: &mut Rng) -> Vec<Event> {
    let mut sends = 0;
    let mut events = vec![];
    for _ in 0..rng.below(EVENTS + 1) {
        let event = match rng.below(7) {
            0 if sends < MESSAGES => {
                sends += 1;
                Event::Send {
                    from_user: rng.below(2) == 0,
                    route: [Delivery::Auto, Delivery::Drop][rng.below(2) as usize],
                }
            }
            1 => Event::Idle,
            2 => Event::Busy,
            3 => Event::Exit,
            4 => Event::UserDrop(1 + rng.below(MESSAGES) as u32),
            5 => Event::Restart {
                alive: rng.below(2) == 0,
            },
            _ => Event::Idle,
        };
        events.push(event);
    }
    events
}

fn schedules() -> Vec<Vec<Event>> {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    (0..4000).map(|_| schedule(&mut rng)).collect()
}

/// One transition: the state before, the event and the state after.
struct Move {
    before: State,
    event: Event,
    after: State,
}

fn replay(events: &[Event]) -> Vec<Move> {
    let mut state = State::default();
    events
        .iter()
        .map(|event| {
            let (after, _) = step(&state, event.clone());
            let before = std::mem::replace(&mut state, after.clone());
            Move {
                before,
                event: event.clone(),
                after,
            }
        })
        .collect()
}

fn last(moves: &[Move]) -> State {
    moves
        .last()
        .map_or_else(State::default, |m| m.after.clone())
}

fn is_prefix(short: &[u32], long: &[u32]) -> bool {
    long.starts_with(short)
}

fn disjoint(a: &[u32], b: &[u32]) -> bool {
    a.iter().all(|x| !b.contains(x))
}

#[test]
fn inv_m1_a_message_is_typed_at_most_once() {
    for events in schedules() {
        let typed = last(&replay(&events)).typed;
        let mut unique = typed.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), typed.len(), "{events:?}");
    }
}

#[test]
fn inv_m4_the_typed_list_only_grows_at_its_end() {
    for events in schedules() {
        for m in replay(&events) {
            assert!(
                is_prefix(&m.before.typed, &m.after.typed),
                "{events:?} at {:?}",
                m.event
            );
        }
    }
}

#[test]
fn inv_m5_delivered_and_dropped_are_disjoint_and_a_typed_id_waits_nowhere() {
    for events in schedules() {
        let s = last(&replay(&events));
        assert!(disjoint(&s.typed, &s.dropped), "{events:?}");
        assert!(disjoint(&s.typed, &s.queue), "{events:?}");
    }
}

#[test]
fn inv_m6_every_id_handed_out_is_in_exactly_one_list() {
    for events in schedules() {
        let s = last(&replay(&events));
        assert_eq!(
            1 + s.queue.len() + s.typed.len() + s.dropped.len(),
            s.next as usize,
            "{events:?}"
        );
    }
}

#[test]
fn inv_m7_once_the_receiver_is_gone_nothing_waits_and_a_send_changes_nothing() {
    for events in schedules() {
        let s = last(&replay(&events));
        if s.gone {
            assert!(s.queue.is_empty(), "{events:?}");
            let (after, effects) = step(
                &s,
                Event::Send {
                    from_user: false,
                    route: Delivery::Auto,
                },
            );
            assert_eq!((after, effects), (s, vec![]), "{events:?}");
        }
    }
}

#[test]
fn inv_m10_a_live_receiver_that_turns_idle_again_types_every_pending_message() {
    for events in schedules() {
        let mut s = last(&replay(&events));
        if s.gone {
            continue;
        }
        for _ in 0..s.queue.len() {
            s = step(&s, Event::Busy).0;
            s = step(&s, Event::Idle).0;
        }
        assert!(s.queue.is_empty(), "{events:?}");
    }
}

fn replay_of(s: &State, alive: bool) -> (State, Vec<Effect>) {
    // B8, read from the stored records alone: a kept Terminal is not yet known idle; a lost one drops
    // every `pending` Message.
    let mut r = s.clone();
    r.idle = false;
    if !alive {
        r.dropped.extend(s.queue.clone());
        r.queue = vec![];
        r.gone = true;
    }
    (r, vec![])
}

#[test]
fn inv_m9_restart_is_a_replay() {
    for events in schedules() {
        let s = last(&replay(&events));
        for alive in [true, false] {
            let (after, effects) = step(&s, Event::Restart { alive });
            assert_eq!(
                (after.clone(), effects),
                replay_of(&s, alive),
                "{events:?} restarted alive={alive}"
            );
            assert_eq!(after.typed, s.typed, "a restart types nothing: {events:?}");
            let mut unique = after.typed.clone();
            unique.sort_unstable();
            unique.dedup();
            assert_eq!(unique.len(), after.typed.len(), "{events:?}");
        }
    }
}

/// B13 to B17 as events: the chain read at send (the sender may be in it, an Agent may repeat), a hop made,
/// a hop ended without an answer, its bound passing, the answer, the Escalated question, the user's reply.
fn chain_schedule(rng: &mut Rng) -> Vec<Event> {
    (0..rng.below(EVENTS + 1))
        .map(|_| match rng.below(8) {
            0 | 7 => Event::Ask {
                origin: 1 + rng.below(3) as u32,
                chain: (0..rng.below(5)).map(|_| 1 + rng.below(4) as u32).collect(),
            },
            1 => Event::HopMade,
            2 => Event::HopEnded,
            3 => Event::BoundPassed,
            4 => Event::Answer,
            5 => Event::Escalate,
            _ => Event::Reply,
        })
        .collect()
}

fn chain_schedules() -> Vec<Vec<Event>> {
    let mut rng = Rng(0xD1B5_4A32_D192_ED03);
    (0..4000).map(|_| chain_schedule(&mut rng)).collect()
}

#[test]
fn inv_m8_escalation_terminates() {
    for events in chain_schedules() {
        let mut s = State::default();
        for event in &events {
            s = step(&s, event.clone()).0;
            let mut unique = s.hops.clone();
            unique.sort_unstable();
            unique.dedup();
            assert_eq!(unique.len(), s.hops.len(), "a hop twice: {events:?}");
            assert!(!s.hops.contains(&s.origin), "the sender a hop: {events:?}");
            assert!(s.bounds as usize <= s.hops.len(), "{events:?}");
        }
        if s.phase == Phase::NoQ {
            continue;
        }
        // hops + 1 bounds: a round makes the next hop, lets its bound pass and escalates when none is left.
        for _ in 0..=s.rest.len() {
            for event in [Event::HopMade, Event::BoundPassed, Event::Escalate] {
                s = step(&s, event).0;
            }
        }
        assert!(
            matches!(s.phase, Phase::Answered | Phase::Escalated),
            "{events:?} ended {:?}",
            s.phase
        );
    }
}

#[test]
fn inv_the_transition_names_in_step_and_in_model_bend_are_the_same_set() {
    let model = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../proofs/messages/model.bend"
    ))
    .unwrap();
    let ev = model
        .split("type Ev is Data:")
        .nth(1)
        .unwrap()
        .split("\n\n")
        .next()
        .unwrap();
    let mut in_model: Vec<String> = ev
        .lines()
        .filter_map(|line| line.trim().split('{').next())
        .filter(|name| !name.is_empty())
        .map(|name| {
            name.chars()
                .enumerate()
                .flat_map(|(i, c)| {
                    let lower = c.to_ascii_lowercase();
                    if i > 0 && c.is_ascii_uppercase() {
                        vec!['_', lower]
                    } else {
                        vec![lower]
                    }
                })
                .collect()
        })
        .collect();
    in_model.sort();
    let mut in_step: Vec<String> = TRANSITIONS.iter().map(|name| (*name).to_owned()).collect();
    in_step.sort();
    assert_eq!(in_step, in_model);
}

/// Literal Rust delivery examples; executable B32 correspondence is checked below.
#[test]
fn inv_delivery_examples_preserve_batching_routes_and_exit() {
    let send = |from_user, route| Event::Send { from_user, route };
    let run = |events: Vec<Event>| {
        events
            .into_iter()
            .fold((State::default(), vec![]), |(s, mut typed), e| {
                let (next, effects) = step(&s, e);
                typed.extend(effects);
                (next, typed)
            })
    };

    let (s, typed) = run(vec![
        Event::Busy,
        send(false, Delivery::Auto),
        send(false, Delivery::Auto),
        Event::Idle,
    ]);
    assert_eq!(
        (s.queue, s.typed, s.idle, typed),
        (
            vec![],
            vec![1, 2],
            false,
            vec![Effect::Type(1), Effect::Type(2)]
        ),
        "B30: one idle types every pending Message, in order"
    );

    let (s, typed) = run(vec![Event::Idle, send(false, Delivery::Auto)]);
    assert_eq!(
        (s.typed, s.idle, typed),
        (vec![1], false, vec![Effect::Type(1)])
    );

    let (s, _) = run(vec![
        send(false, Delivery::Auto),
        send(false, Delivery::Drop),
        Event::UserDrop(1),
    ]);
    assert_eq!((s.queue, s.dropped), (vec![], vec![2, 1]));

    let (s, typed) = run(vec![send(false, Delivery::Auto), Event::Exit, Event::Idle]);
    assert_eq!((s.dropped, s.gone, typed), (vec![1], true, vec![]));
}

/// The laws above hold of `step`; this holds the Daemon to it: a transition coded beside `step`
/// would leave the laws proving a model nobody runs.
#[test]
fn inv_the_daemons_transitions_run_through_step() {
    let src = |file| {
        std::fs::read_to_string(format!("{}/src/{file}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    };
    let lib = src("lib.rs") + &src("receiver_view.rs") + &src("removal.rs");
    for event in [
        "Event::Send",
        "Event::Idle",
        "Event::Exit",
        "Event::UserDrop",
    ] {
        assert!(
            lib.contains(event),
            "lib.rs and removal.rs never build {event}"
        );
    }
}

#[test]
fn a35_reserved_projection_preserves_records_and_never_types() {
    for events in schedules() {
        let initial = events
            .iter()
            .fold(State::default(), |s, e| step(&s, e.clone()).0);
        for ending in [
            Event::Exit,
            Event::Idle,
            Event::Restart { alive: false },
            Event::Restart { alive: true },
        ] {
            let (after, effects) = step(&initial, crate::step::restart_event(true, ending));
            assert_eq!(after.queue, initial.queue);
            assert_eq!(after.typed, initial.typed);
            assert_eq!(after.dropped, initial.dropped);
            assert_eq!(after.next, initial.next);
            assert!(effects.is_empty());
        }
        let mut reserved = step(&initial, Event::Busy).0;
        for event in events {
            let (after, effects) = step(&reserved, crate::step::restart_event(true, event));
            assert!(effects.is_empty());
            assert_eq!(after.typed, initial.typed);
            assert_eq!(
                after.next as usize,
                1 + after.queue.len() + after.typed.len() + after.dropped.len()
            );
            reserved = after;
        }
    }
}

#[test]
fn a35_reserved_question_projection_preserves_the_live_hop() {
    for events in chain_schedules() {
        let initial = events
            .iter()
            .fold(State::default(), |s, e| step(&s, e.clone()).0);
        for event in [Event::HopEnded, Event::BoundPassed] {
            let after = step(&initial, crate::step::restart_event(true, event)).0;
            assert_eq!(after.phase, initial.phase);
            assert_eq!(after.rest, initial.rest);
            assert_eq!(after.hops, initial.hops);
            assert_eq!(after.bounds, initial.bounds);
        }
    }
}

#[test]
fn a35_retirement_projection_preserves_records_and_never_types() {
    let send = |from_user, route| Event::Send { from_user, route };
    for events in schedules() {
        let initial = events
            .iter()
            .fold(State::default(), |s, e| step(&s, e.clone()).0);
        for event in [
            Event::Exit,
            Event::Idle,
            Event::Restart { alive: false },
            Event::Restart { alive: true },
            Event::UserDrop(1),
            send(true, Delivery::Auto),
            send(false, Delivery::Drop),
            Event::HopEnded,
            Event::BoundPassed,
        ] {
            let (after, effects) = step(&initial, crate::step::retirement_event(true, event));
            assert_eq!(after.queue, initial.queue);
            assert_eq!(after.typed, initial.typed);
            assert_eq!(after.dropped, initial.dropped);
            assert_eq!(after.next, initial.next);
            assert_eq!(after.phase, initial.phase);
            assert_eq!(after.hops, initial.hops);
            assert_eq!(after.bounds, initial.bounds);
            assert!(effects.is_empty());
        }
    }
}
