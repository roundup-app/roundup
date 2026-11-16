use super::*;
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};

struct Clocked {
    now: Arc<AtomicI64>,
    adapter: ClaudeCode,
}

impl Clocked {
    fn new() -> Self {
        let now = Arc::new(AtomicI64::new(0));
        let clock = now.clone();
        let adapter = ClaudeCode::new(move || clock.load(Ordering::SeqCst));
        Self { now, adapter }
    }

    fn at(&mut self, ms: i64, observation: Observation) -> Option<Kind> {
        self.now.store(ms, Ordering::SeqCst);
        self.adapter.observe(observation);
        self.adapter.status().map(|s| s.kind)
    }

    fn signal(&mut self, ms: i64, event: &str) -> Option<Kind> {
        self.at(ms, Observation::Signal(json!({ "hook_event_name": event })))
    }

    fn title(&mut self, ms: i64, title: &str) -> Option<Kind> {
        self.at(ms, Observation::Title(title.into()))
    }
}

fn failure(a: &mut Clocked, ms: i64) -> Option<Status> {
    a.now.store(ms, Ordering::SeqCst);
    let payload = json!({"hook_event_name": "StopFailure", "error": "authentication_failed"});
    a.adapter.observe(Observation::Signal(payload)).changed
}

#[test]
fn u6909a_a_failure_with_no_prompted_turn_shows_nowhere() {
    let mut a = Clocked::new();
    a.signal(0, "SessionStart");
    a.title(100, "◐ Claude Code");
    a.title(300, "✳ Claude Code");
    assert_eq!(failure(&mut a, 400), None);
    assert_eq!(a.adapter.status().map(|s| s.kind), Some(Kind::Idle));
}

#[test]
fn u6909a_a_failure_that_ends_a_prompted_turn_still_shows() {
    let mut a = Clocked::new();
    a.signal(0, "UserPromptSubmit");
    let status = failure(&mut a, 100).unwrap();
    assert_eq!(status.kind, Kind::Error);
    assert!(
        status.label.contains("could not sign in"),
        "{}",
        status.label
    );

    let mut b = Clocked::new();
    b.signal(0, "SessionStart");
    assert_eq!(failure(&mut b, 100), None);
    b.signal(200, "UserPromptSubmit");
    assert_eq!(failure(&mut b, 300).unwrap().kind, Kind::Error);
}

#[test]
fn a2b_a_lone_spinner_after_stop_reads_idle() {
    let mut a = Clocked::new();
    a.signal(0, "UserPromptSubmit");
    assert_eq!(a.signal(100, "Stop"), Some(Kind::Idle));
    assert_eq!(a.title(1500, "◐ task"), Some(Kind::Working));
    assert_eq!(a.adapter.tick_at(), Some(1500 + SPINNER_HOLD));
    assert_eq!(
        a.at(1500 + SPINNER_HOLD - 1, Observation::Tick),
        Some(Kind::Working)
    );
    assert_eq!(
        a.at(1500 + SPINNER_HOLD, Observation::Tick),
        Some(Kind::Idle)
    );
    assert_eq!(a.adapter.tick_at(), None);
}

#[test]
fn a2b_alternating_spinners_keep_working() {
    let mut a = Clocked::new();
    a.signal(0, "UserPromptSubmit");
    a.signal(100, "Stop");
    let mut at = 1000;
    for glyph in ["◐", "◑", "◐", "◑", "◐"] {
        assert_eq!(a.title(at, glyph), Some(Kind::Working));
        assert_eq!(a.at(at + 960, Observation::Tick), Some(Kind::Working));
        at += 960;
    }
    assert_eq!(a.at(at + SPINNER_HOLD, Observation::Tick), Some(Kind::Idle));
}

#[test]
fn a2b_a_signal_drops_the_spinner_hold() {
    let mut a = Clocked::new();
    a.signal(0, "Stop");
    a.title(1000, "◐");
    assert!(a.adapter.tick_at().is_some());
    assert_eq!(a.signal(1100, "PostToolUse"), Some(Kind::Working));
    assert_eq!(a.adapter.tick_at(), None);
    assert_eq!(a.at(60_000, Observation::Tick), Some(Kind::Working));

    a.signal(61_000, "Stop");
    a.title(62_000, "◑");
    a.title(62_500, "✳");
    assert_eq!(a.adapter.tick_at(), None);
}

#[test]
fn dcl5_inactive_turn_stalls_but_live_background_work_does_not() {
    let mut a = Clocked::new();
    let ten = 10 * 60 * 1000;
    a.signal(0, "UserPromptSubmit");
    a.now.store(ten - 1, Ordering::SeqCst);
    assert!(
        !a.adapter.stalled(ten),
        "just under ten minutes is no stall"
    );
    a.now.store(ten, Ordering::SeqCst);
    assert!(a.adapter.stalled(ten));
    a.signal(ten, "PostToolUse");
    assert!(!a.adapter.stalled(ten), "activity clears the stall");
    // A foreground tool call that has not returned is running work.
    a.signal(ten, "PreToolUse");
    a.now.store(4 * ten, Ordering::SeqCst);
    assert!(!a.adapter.stalled(ten));
    // A Stop that leaves a background Agent open keeps Working: not a stall either.
    a.at(
        4 * ten,
        Observation::Signal(json!({"hook_event_name":"SubagentStart","agent_id":"b"})),
    );
    a.signal(4 * ten, "Stop");
    a.now.store(6 * ten, Ordering::SeqCst);
    assert!(!a.adapter.stalled(ten));
}
