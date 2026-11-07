//! What folding one Observation into a Run decides, apart from doing it.

#![deny(clippy::too_many_lines)]

use crate::Kind;
use contracts::Status;

use crate::claude_code;
use crate::{Observation, Run};

/// What an Observation is, read once so every decision about it agrees.
pub(crate) struct Facts {
    pub(crate) signal: bool,
    pub(crate) prompt: bool,
    pub(crate) session_start: bool,
    pub(crate) star: bool,
    pub(crate) exited: bool,
    /// The Agent is over: it exited or was stopped.
    pub(crate) over: bool,
    /// A title or a Tick: either may acknowledge an Interrupt (H13).
    pub(crate) acks: bool,
}

impl Facts {
    pub(crate) fn of(observation: &Observation) -> Self {
        let (prompt, session_start) = match observation {
            Observation::Signal(payload) => {
                let seen = claude_code::see(payload);
                (seen.prompt.is_some(), seen.session_start)
            }
            _ => (false, false),
        };
        Self {
            signal: matches!(observation, Observation::Signal(_)),
            prompt,
            session_start,
            // A4452a: coordination waits for SessionStart; no star gates it.
            star: matches!(observation, Observation::Title(title) if title.starts_with('✳')),
            exited: matches!(observation, Observation::Exit { .. }),
            over: matches!(observation, Observation::Exit { .. } | Observation::Stopped),
            acks: matches!(observation, Observation::Title(_) | Observation::Tick),
        }
    }

    /// The first prompt of an Attempt is submitted: its input has started.
    pub(crate) fn starts_input(&self, run: &Run) -> bool {
        self.prompt && !run.input_started()
    }
}

/// What the shell does after `decide`, in list order, stopping at the first failure.
pub(crate) enum Effect {
    /// H11: a submitted prompt ends the Steer's wait, once its slash command is written.
    SubmitSteer,
    /// Show the Agent on the Rail; announce when that changed it.
    ShowOnRail,
    /// Announce that the Rail changed.
    RailChanged,
    Completed(contracts::event::Completion),
    /// A Signal moved the Agent on: a Steer whose slash command is written is submitted.
    SettleSteer,
    /// H13, H4702a: the Interrupt's wait ends.
    AckInterrupt,
    /// The Agent's program is gone; its Terminal leaves the Rail.
    Exit,
    /// DCL3c: background work is saved before its Status is published.
    SaveBackground(Option<claude_code::background::Retained>),
    /// U3566c: a counted finish is saved before its Status is published.
    SaveFinished(u64),
    Publish(Status),
    /// The first prompt may name the Agent.
    Name(Option<String>),
}

/// Fold `observation` into `run` and say what is left to do, in order. Reads no clock and takes
/// no lock: `now` is the caller's.
pub(crate) fn decide(
    run: &mut Run,
    id: &str,
    observation: Observation,
    facts: &Facts,
    now: i64,
    first_prompt: Option<Option<String>>,
) -> Vec<Effect> {
    let mut effects = Vec::new();
    // H11: the Steer's wait ends with the Signal that names it, or with the Agent.
    if facts.prompt {
        effects.push(Effect::SubmitSteer);
    } else if facts.over {
        // No Steer or Interrupt waits on it. A prompt no writer owns is refused; a released or
        // queued writer must publish its own completion instead.
        run.finish_waits();
    }
    let was = run.view().clone();
    let was_kind = was.status.as_ref().map(|status| status.kind);
    let (changed, completion_changed) = run.observe(observation);
    let changed = changed.or_else(|| {
        if !facts.exited || run.ended() {
            return None;
        }
        let mut status = run.view().status.clone()?;
        status.since = now;
        Some(status)
    });
    let kind_after = run.view().status.as_ref().map(|status| status.kind);
    if crate::rail_view::visibility_protection(kind_after).is_some() {
        effects.push(Effect::ShowOnRail);
    }
    if was.final_text != run.view().final_text || completion_changed {
        effects.push(Effect::RailChanged);
    }
    if let Some(turn) = run.view().completed_turn.as_deref()
        && was.completed_turn.as_deref() != Some(turn)
    {
        effects.push(Effect::Completed(contracts::event::Completion {
            maker: id.to_owned(),
            attempt: run.attempt().to_string(),
            turn: turn.to_owned(),
        }));
    }
    let moved = changed
        .as_ref()
        .is_some_and(|status| Some(status.kind) != was_kind);
    if facts.signal && (facts.session_start || moved) {
        effects.push(Effect::SettleSteer);
    }
    // H4702a: a Signal that takes a native question from `needs-you` to idle or working
    // is an observed dismissal, though the title never changes.
    let dismissed = facts.signal
        && was_kind == Some(Kind::NeedsYou)
        && changed
            .as_ref()
            .is_some_and(|status| matches!(status.kind, Kind::Idle | Kind::Working));
    let idle = changed
        .as_ref()
        .is_some_and(|status| status.kind == Kind::Idle);
    if dismissed || facts.acks && idle {
        effects.push(Effect::AckInterrupt);
    }
    if facts.exited {
        effects.push(Effect::Exit);
    }
    if run.view().retained != was.retained {
        effects.push(Effect::SaveBackground(run.view().retained.clone()));
    }
    if run.view().finished != was.finished {
        effects.push(Effect::SaveFinished(run.view().finished));
    }
    effects.extend(changed.map(Effect::Publish));
    effects.extend(first_prompt.map(Effect::Name));
    effects
}

/// The name a Signal's first prompt gives the Agent; `None` when the Observation has no prompt
/// worth naming by.
pub(crate) fn first_prompt(observation: &Observation) -> Option<Option<String>> {
    match observation {
        Observation::Signal(payload) => claude_code::see(payload)
            .prompt
            .filter(|prompt| !crate::order::is_clarification_steer(prompt))
            .map(crate::name::from_prompt),
        _ => None,
    }
}
