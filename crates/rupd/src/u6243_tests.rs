//! U6243a: a real Daemon over public RPC, a fake `claude`, hook Signals and the injected Agents
//! clock. No step is an Agent's own report: hooks and the clock only (U6243c).
use std::sync::atomic::Ordering;
use std::time::Duration;

use proptest::prelude::*;

use super::*;
use crate::dcl5_tests::{Run, call};
use crate::facts::STALL_MS;
use crate::workstream_state::{TELL_PERIOD, Told, told_of};

#[derive(Clone, Debug)]
enum Step {
    Hook(usize, &'static str),
    /// The clock passes `STALL_MS` and one `TELL_PERIOD`, with no event.
    Clock,
}

fn step() -> impl Strategy<Value = Step> {
    prop_oneof![
        (
            0..3usize,
            prop::sample::select(vec![
                "UserPromptSubmit",
                "PreToolUse",
                "PostToolUse",
                "Stop",
                "SessionEnd",
            ])
        )
            .prop_map(|(who, hook)| Step::Hook(who, hook)),
        Just(Step::Clock),
    ]
}

async fn fresh(run: &Run) -> Told {
    let rail = call(&run.daemon, "rail.tree", Value::Null).await;
    told_of(&serde_json::from_value::<Vec<contracts::agent::RailNode>>(rail).unwrap())
}

fn told(run: &Run) -> Told {
    run.daemon
        .rail_told
        .get()
        .expect("the watcher started with the first request")
        .told
        .lock()
        .unwrap()
        .clone()
}

/// Lets the watcher judge what the step sent.
async fn settle() {
    for _ in 0..5 {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn tells(events: &mut tokio::sync::broadcast::Receiver<contracts::Event>) -> usize {
    let mut count = 0;
    while let Ok(event) = events.try_recv() {
        count += usize::from(matches!(event.data, contracts::EventData::RailChanged));
    }
    count
}

async fn walk(steps: Vec<Step>) {
    let run = Run::start().await;
    let kids = [run.spawn("one").await, run.spawn("two").await];
    let ids = [run.door.clone(), kids[0].clone(), kids[1].clone()];
    let mut events = run.daemon.bus.subscribe();
    settle().await;
    tells(&mut events);
    let mut last = fresh(&run).await;
    assert_eq!(told(&run), last);
    for step in steps {
        match step {
            Step::Hook(who, hook) => run.signal(&ids[who], hook).await,
            Step::Clock => {
                run.now.fetch_add(STALL_MS + 1, Ordering::SeqCst);
                tokio::time::advance(TELL_PERIOD).await;
            }
        }
        settle().await;
        let now = fresh(&run).await;
        let count = tells(&mut events);
        assert_eq!(count, usize::from(now != last), "{step:?}");
        assert_eq!(told(&run), now, "{step:?}");
        last = now;
    }
    run.daemon.stop_terminals().await.unwrap();
}

fn on_paused_clock(steps: Vec<Step>) {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .start_paused(true)
        .build()
        .unwrap()
        .block_on(walk(steps));
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 12, ..ProptestConfig::default() })]
    #[test]
    fn u6243a_derived_rail_values_tell_exactly_on_change(steps in prop::collection::vec(step(), 1..10)) {
        on_paused_clock(steps);
    }
}

/// The seed: the last working child ends, and the Workstream reads idle by the next read.
#[test]
fn u6243a_the_last_working_child_ending_is_told_once() {
    on_paused_clock(vec![
        Step::Hook(1, "UserPromptSubmit"),
        Step::Hook(1, "SessionEnd"),
    ]);
}
