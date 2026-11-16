//! TS1 to TS4: an Agent stays working for the whole turn. The production Adapter on an injected
//! clock replays the Signals and titles the vendor gives; `messages::wake::finished` is the
//! predicate the Daemon's wake path reads from each Status.

use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

use agents::claude_code::{ClaudeCode, STAR_HOLD};
use agents::{AgentAdapter, Observation};
use contracts::Kind;
use serde_json::json;

struct Turn {
    now: Arc<AtomicI64>,
    adapter: ClaudeCode,
    /// The Kinds the Adapter announced, as the wake path would read them.
    announced: Vec<Kind>,
    kind: Option<Kind>,
}

impl Turn {
    fn new() -> Self {
        let now = Arc::new(AtomicI64::new(0));
        let clock = Arc::clone(&now);
        let adapter = ClaudeCode::new(move || clock.load(Ordering::SeqCst));
        Self {
            now,
            adapter,
            announced: Vec::new(),
            kind: None,
        }
    }

    fn at(&mut self, ms: i64, observation: Observation) -> Kind {
        self.now.store(ms, Ordering::SeqCst);
        let folded = self.adapter.observe(observation);
        self.announced.extend(folded.changed.map(|s| s.kind));
        self.kind = self.announced.last().copied();
        self.kind.unwrap()
    }

    fn signal(&mut self, ms: i64, payload: serde_json::Value) -> Kind {
        self.at(ms, Observation::Signal(payload))
    }

    fn event(&mut self, ms: i64, event: &str) -> Kind {
        self.signal(ms, json!({ "hook_event_name": event }))
    }

    fn title(&mut self, ms: i64, title: &str) -> Kind {
        self.at(ms, Observation::Title(title.into()))
    }

    fn tick(&mut self, ms: i64) -> Kind {
        self.at(ms, Observation::Tick)
    }

    /// An idle Agent that has finished a turn.
    fn idle() -> Self {
        let mut turn = Self::new();
        turn.event(0, "SessionStart");
        turn.event(10, "UserPromptSubmit");
        assert_eq!(turn.event(20, "Stop"), Kind::Idle);
        turn.announced.clear();
        turn
    }

    fn woke(&self) -> usize {
        self.announced
            .iter()
            .filter(|kind| messages::wake::finished(**kind))
            .count()
    }
}

#[test]
fn ts1_a_turn_stays_working_from_prompt_to_its_stop() {
    let mut turn = Turn::idle();
    assert_eq!(turn.at(1_000, Observation::Delivered), Kind::Working);
    // Silence past SPINNER_HOLD with a spinner title and a tick.
    assert_eq!(turn.title(1_100, "◐ Claude Code"), Kind::Working);
    assert_eq!(turn.tick(9_000), Kind::Working);
    // A star with no PreToolUse before it.
    assert_eq!(turn.title(9_100, "✳ Claude Code"), Kind::Working);
    assert_eq!(turn.tick(20_000), Kind::Working);
    // A compaction with a star between its notices.
    assert_eq!(turn.event(21_000, "PreCompact"), Kind::Working);
    assert_eq!(turn.title(22_000, "✳ Claude Code"), Kind::Working);
    assert_eq!(turn.event(60_000, "PostCompact"), Kind::Working);
    assert_eq!(turn.tick(70_000), Kind::Working);
    assert_eq!(turn.event(80_000, "Stop"), Kind::Idle);
}

#[test]
fn ts2_only_the_current_turns_stop_ends_it() {
    let mut turn = Turn::new();
    turn.event(0, "SessionStart");
    turn.announced.clear();
    let prompt = |id: &str| json!({"hook_event_name": "UserPromptSubmit", "prompt_id": id});
    let stop = |id: Option<&str>| match id {
        Some(id) => json!({"hook_event_name": "Stop", "prompt_id": id}),
        None => json!({"hook_event_name": "Stop"}),
    };
    turn.signal(10, prompt("first"));
    turn.signal(20, stop(Some("first")));
    turn.signal(30, prompt("second"));
    assert_eq!(turn.signal(40, stop(Some("first"))), Kind::Working);
    assert_eq!(turn.signal(50, stop(None)), Kind::Working);
    assert_eq!(turn.woke(), 1, "only the first turn's Stop finished");
    assert_eq!(turn.signal(60, stop(Some("second"))), Kind::Idle);
    assert_eq!(turn.woke(), 2);
}

/// The vendor spins ◐/◑ about once a second while it works and sends no hook for an Esc: it shows
/// one ✳ within a second of the last spinner (`spikes/hooks-state/REPORT.md`).
#[test]
fn ts5_an_esc_in_the_terminal_ends_a_message_started_turn() {
    // Thinking: no tool call, so the star is read as idle at once.
    let mut turn = Turn::idle();
    turn.at(1_000, Observation::Delivered);
    turn.title(1_100, "✳ Claude Code");
    assert_eq!(turn.title(2_000, "◐ Claude Code"), Kind::Working);
    assert_eq!(turn.title(2_960, "◑ Claude Code"), Kind::Working);
    assert_eq!(turn.title(3_030, "✳ Claude Code"), Kind::Idle);
    assert_eq!(turn.woke(), 1, "one finish, one wake");

    // A tool call is running, so the star waits `STAR_HOLD` for a dialog before it reads as idle.
    let mut turn = Turn::idle();
    turn.at(1_000, Observation::Delivered);
    turn.title(1_100, "◐ Claude Code");
    turn.event(1_500, "PreToolUse");
    turn.title(2_000, "◑ Claude Code");
    assert_eq!(turn.title(2_070, "✳ Claude Code"), Kind::Working);
    assert_eq!(turn.tick(2_070 + STAR_HOLD), Kind::Idle);
    assert_eq!(turn.woke(), 1);
}

#[test]
fn ts4_no_wake_fires_while_a_compacting_turn_runs() {
    let mut turn = Turn::idle();
    turn.at(1_000, Observation::Delivered);
    turn.title(1_500, "◐ Claude Code");
    turn.event(2_000, "PreCompact");
    turn.title(2_500, "✳ Claude Code");
    turn.tick(10_000);
    turn.event(40_000, "PostCompact");
    turn.title(41_000, "✳ Claude Code");
    turn.tick(50_000);
    assert_eq!(turn.woke(), 0, "{:?}", turn.announced);
    assert!(!turn.announced.contains(&Kind::Idle));
    turn.event(60_000, "Stop");
    assert_eq!(turn.woke(), 1, "the wake fires once, at the Stop");
}
