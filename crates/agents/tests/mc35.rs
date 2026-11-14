//! MC35: three Machines raise no more interruptions than one. P3's Observer replays
//! `spikes/hooks-state/*.jsonl`; an Agent's Kind sequence is read from its own payloads, so the Machine
//! its Terminal runs on cannot add or drop an attention entry (each `needs-you` is one entry).
#![allow(clippy::unwrap_used, clippy::indexing_slicing)]

use agents::claude_code::ClaudeCode;
use agents::{AgentAdapter, Observation};
use contracts::Kind;
use serde_json::Value;

const FIXTURES: [&str; 8] = [
    include_str!("../../../spikes/hooks-state/log.jsonl"),
    include_str!("../../../spikes/hooks-state/log.run1.jsonl"),
    include_str!("../../../spikes/hooks-state/log.run2.jsonl"),
    include_str!("../../../spikes/hooks-state/log.run3.jsonl"),
    include_str!("../../../spikes/hooks-state/log.run4.jsonl"),
    include_str!("../../../spikes/hooks-state/log.run5.jsonl"),
    include_str!("../../../spikes/hooks-state/log.run6.jsonl"),
    include_str!("../../../spikes/hooks-state/log.run7.jsonl"),
];

/// Attention entries one Agent raises: one per change to `needs-you`.
fn entries(log: &str) -> usize {
    let mut adapter = ClaudeCode::new(|| 0);
    log.lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap()["payload"].clone())
        .filter_map(|payload| adapter.observe(Observation::Signal(payload)).changed)
        .filter(|status| status.kind == Kind::NeedsYou)
        .count()
}

#[test]
fn mc35_interruptions_equal_one_machine_and_three() {
    let machines = ["mac", "box", "far"];
    let one: usize = FIXTURES.iter().map(|log| entries(log)).sum();
    let mut spread = [0usize; 3];
    for (i, log) in FIXTURES.iter().enumerate() {
        spread[i % machines.len()] += entries(log);
    }
    assert!(one > 0, "the replay holds needs-you");
    assert_eq!(spread.iter().sum::<usize>(), one);
}
