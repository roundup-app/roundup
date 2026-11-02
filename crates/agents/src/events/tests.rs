use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use contracts::terminal::ExitedEvent;
use contracts::{Actor, EventData, Kind};

use serde_json::{Value, json};

use tokio::time::Instant;

use crate::claude_code::ClaudeCode;
use crate::{Observation, Run, Slot};

use crate::tests::*;
#[tokio::test]
async fn a2703a_errors_use_rail_names() {
    for case in [
        "channel", "ended", "closing", "starting", "resuming", "cleanup", "missing",
    ] {
        let watched = Watched::named();
        let shared = &watched.shared;
        match case {
            "ended" => {
                if let Some(Slot::Running(run)) = shared.runs().get_mut("7013") {
                    run.ended = true;
                }
            }
            "closing" => {
                shared.runs().insert("7013".into(), Slot::Closing);
            }
            "starting" => {
                shared.mark_starting("7013", "1".into());
            }
            "resuming" => {
                shared.runs().insert(
                    "7013".into(),
                    Slot::Resuming {
                        mode: Default::default(),
                        attempt: "1".into(),
                        since: 0,
                        old: None,
                        conversation_id: "conversation".into(),
                        cwd: "/".into(),
                        prompt: None,
                        starred: false,
                        terminal_id: None,
                        parked: VecDeque::new(),
                        done: tokio::sync::oneshot::channel().0,
                    },
                );
            }
            "cleanup" => {
                shared.runs().insert(
                    "7013".into(),
                    Slot::ResumeCleanup {
                        old: None,
                        attempt: "1".into(),
                        terminal_id: "1".into(),
                        pending: false,
                        error: rpc::RpcError::internal("failed"),
                    },
                );
            }
            "missing" => {
                shared.runs().remove("7013");
            }
            _ => {}
        }
        let error = if case == "channel" {
            shared.channel_up(&Actor::user(), "7013").unwrap_err()
        } else {
            shared
                .observe(
                    Actor::daemon(),
                    "7013",
                    if case == "closing" { "" } else { "1" },
                    Observation::Tick,
                )
                .unwrap_err()
        };
        assert!(
            error.message.contains("sad") && !error.message.contains("7013"),
            "{case}: {error}"
        );
    }
    let watched = Watched::named();
    let error = watched
        .shared
        .observe(Actor::daemon(), "8013", "1", Observation::Tick)
        .unwrap_err();
    assert!(
        error.message.contains("an Agent that is gone") && !error.message.contains("8013"),
        "{error}"
    );
}

#[tokio::test(start_paused = true)]
async fn a2_a_parked_star_reads_idle_when_star_hold_has_passed_and_not_before() {
    let mut w = Watched::start();
    w.signal("PreToolUse");
    assert_eq!(w.next_kind().await, Kind::Working);
    let star = Instant::now();

    w.star();

    // An observation window: no Status may change while the star is parked.
    tokio::time::sleep(HOLD - Duration::from_millis(1)).await;
    assert!(!w.has_news());
    assert_eq!(w.next_kind().await, Kind::Idle);
    assert_eq!(star.elapsed().as_millis(), HOLD.as_millis());
}
#[tokio::test(start_paused = true)]
async fn a2_a_second_star_during_a_hold_keeps_the_first_stars_deadline() {
    let mut w = Watched::start();
    w.signal("PreToolUse");
    assert_eq!(w.next_kind().await, Kind::Working);
    let star = Instant::now();
    w.star();
    tokio::time::sleep(HOLD / 2).await;

    w.star();

    assert_eq!(w.next_kind().await, Kind::Idle);
    assert_eq!(star.elapsed().as_millis(), HOLD.as_millis());
}
#[tokio::test(start_paused = true)]
async fn a2_an_exit_ends_the_watch_without_waiting_out_a_parked_star() {
    let w = Watched::start();
    w.signal("PreToolUse");
    w.star();
    let star = Instant::now();

    w.send(EventData::TerminalExited(ExitedEvent {
        id: "1".into(),
        code: Some(0),
    }));

    tokio::time::timeout(PATIENCE, w.watcher)
        .await
        .expect("the watch ends")
        .unwrap();
    assert!(star.elapsed() < HOLD);
}
/// `watch` only starts once an Agent is `Running`, so in production a non-Signal Observation
/// never reaches a `Starting` id; reached directly here, it must still answer the way
/// `agent.signal` answers any other unknown id, not pretend the id is already registered.
#[test]
fn a14_a_non_signal_observation_for_a_starting_id_is_still_not_found() {
    let (_dir, _bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
    shared.runs().insert(
        "1".into(),
        Slot::Starting {
            attempt: "1".into(),
            since: 0,
            named: false,
            parked: VecDeque::new(),
        },
    );

    let err = shared
        .observe(Actor::daemon(), "1", "1", Observation::Tick)
        .unwrap_err();

    assert_eq!(err.code, rpc::code::NOT_FOUND);
}
/// A parked Signal whose `rail.rename` fails (a SQLite trigger refuses the update) must not panic while `finish_starting` still holds `rail` and `runs`: a panic
/// there would poison both mutexes, so every later `rail()`/`runs()` call would panic too.
#[test]
fn a14_a_failed_rail_write_for_a_parked_signal_does_not_poison_the_locks() {
    let (dir, _bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = shared
        .rail()
        .insert(contracts::agent::NodeKind::Agent, "new-agent", None, None)
        .unwrap()
        .id;
    shared.mark_starting(&id, "1".into());
    if let Some(Slot::Starting { parked, .. }) = shared.runs().get_mut(&id) {
        parked.push_back((
            Actor::daemon(),
            json!({"hook_event_name": "UserPromptSubmit", "prompt": "fix the build"}),
        ));
    }
    let db = refuse_rail_writes(dir.path());

    let prompts = shared.finish_starting(&id, "1", |named| Run {
        yolo: false,
        startup_context: true,
        input_started: true,
        attempt: "1".into(),
        status_revision: 1,
        closing: false,
        ended: false,
        adapter: ClaudeCode::starting(|| 0),
        prompt: None,
        first_pending: false,
        first_completion: None,
        first_prompt: None,
        steer: None,
        session_started: None,
        starred: false,
        interrupt: None,
        named,
        terminal_id: "1".into(),
        cwd: "/".into(),
    });

    db.execute_batch("DROP TRIGGER fail_write").unwrap();
    assert_eq!(prompts.unwrap(), Vec::<String>::new());
    // Neither lock was poisoned by the failed write: both can still be acquired.
    assert!(matches!(shared.runs().get(&id), Some(Slot::Running(_))));
    shared.rail().tree().unwrap();
}
/// A21: a parked `SessionStart` whose conversation save fails must abort `finish_starting`
/// outright (never apply it, never drain anything after it) rather than log and continue as
/// a failed rename does; and it must put `id` back as `Running` so the caller's own
/// failed-spawn cleanup (which only removes an Attempt it still finds in `runs`) still runs.
#[test]
fn a21_a_failed_parked_save_reinserts_so_the_caller_can_clean_up() {
    let (dir, _bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = shared
        .rail()
        .insert(contracts::agent::NodeKind::Agent, "new-agent", None, None)
        .unwrap()
        .id;
    shared.mark_starting(&id, "1".into());
    if let Some(Slot::Starting { parked, .. }) = shared.runs().get_mut(&id) {
        parked.push_back((
            Actor::daemon(),
            json!({
                "hook_event_name": "SessionStart",
                "session_id": "11111111-1111-1111-1111-111111111111",
            }),
        ));
        // Never reached if the save aborts the drain as it must.
        parked.push_back((Actor::daemon(), json!({"hook_event_name": "Stop"})));
    }
    let db = refuse_rail_writes(dir.path());

    let result = shared.finish_starting(&id, "1", |named| Run {
        yolo: false,
        startup_context: true,
        input_started: true,
        attempt: "1".into(),
        status_revision: 1,
        closing: false,
        ended: false,
        adapter: ClaudeCode::starting(|| 0),
        prompt: None,
        first_pending: false,
        first_completion: None,
        first_prompt: None,
        steer: None,
        session_started: None,
        starred: false,
        interrupt: None,
        named,
        terminal_id: "1".into(),
        cwd: "/".into(),
    });

    db.execute_batch("DROP TRIGGER fail_write").unwrap();
    assert!(result.is_err());
    let runs = shared.runs();
    let Some(Slot::Running(run)) = runs.get(&id) else {
        panic!("put back as Running for the caller's cleanup to find")
    };
    // The Stop parked after the SessionStart was never drained: the abort is immediate.
    assert_eq!(run.adapter.status().unwrap().kind, Kind::Working);
}
/// Keep all 20,000 interleavings using one reusable late-observer thread. The
/// build rendezvous checks lock exclusion before releasing the actual late Signal.
#[test]
fn a14_a_signal_released_once_the_agent_is_registered_never_outruns_the_parked_one() {
    let (_dir, bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let mut events = bus.subscribe();
    let (observe, observations) = mpsc::sync_channel::<String>(0);
    let (about, arriving) = mpsc::sync_channel(0);
    let (done, completed) = mpsc::sync_channel(0);
    let late_shared = Arc::clone(&shared);
    thread::scope(move |scope| {
        scope.spawn(move || {
            let shared = late_shared;
            for id in observations {
                assert!(matches!(
                    shared.rail.try_lock(),
                    Err(std::sync::TryLockError::WouldBlock)
                ));
                assert!(matches!(
                    shared.runs.try_lock(),
                    Err(std::sync::TryLockError::WouldBlock)
                ));
                about.send(()).unwrap();
                shared
                    .observe(
                        Actor::daemon(),
                        &id,
                        "1",
                        Observation::Signal(json!({"hook_event_name":"Stop", "tool_name":"Bash"})),
                    )
                    .unwrap();
                done.send(()).unwrap();
            }
        });
        for i in 0..20_000 {
            let id = i.to_string();
            shared.runs().insert(
                id.clone(),
                Slot::Starting {
                    attempt: "1".into(),
                    since: 0,
                    named: false,
                    parked: VecDeque::from([(
                        Actor::daemon(),
                        json!({"hook_event_name":"PreToolUse", "tool_name":"Bash"}),
                    )]),
                },
            );
            shared
                .finish_starting(&id, "1", |named| {
                    observe.send(id.clone()).unwrap();
                    arriving.recv().unwrap();
                    Run {
                        yolo: false,
                        startup_context: true,
                        input_started: true,
                        attempt: "1".into(),
                        status_revision: 1,
                        closing: false,
                        ended: false,
                        adapter: ClaudeCode::starting(|| 0),
                        prompt: None,
                        first_pending: false,
                        first_completion: None,
                        first_prompt: None,
                        session_started: None,
                        starred: false,
                        steer: None,
                        interrupt: None,
                        named,
                        terminal_id: id.clone(),
                        cwd: "/".into(),
                    }
                })
                .unwrap();
            completed.recv().unwrap();
            let mut kinds = vec![];
            while let Ok(event) = events.try_recv() {
                if let EventData::AgentStatus(s) = event.data
                    && s.id == id
                {
                    kinds.push(s.status.kind);
                }
            }
            assert_eq!(kinds, [Kind::Working, Kind::Idle], "trial {i}");
            shared.runs().remove(&id);
        }
        drop(observe);
    });
}
#[tokio::test]
async fn b37_a7_old_title_tick_exit_and_signal_do_not_change_a_new_run() {
    let mut watched = Watched::start();
    {
        let mut runs = watched.shared.runs();
        let Some(Slot::Running(run)) = runs.get_mut("1") else {
            panic!("Running")
        };
        run.attempt = "2".into();
        run.terminal_id = "new-terminal".into();
    }
    for observation in [
        Observation::Title("old title".into()),
        Observation::Tick,
        Observation::Exit { code: Some(1) },
        Observation::Signal(json!({"hook_event_name":"Stop"})),
        Observation::Signal(json!({"hook_event_name":"StopFailure"})),
    ] {
        // A20: ignored, never an error to the sender.
        let ignored = watched
            .shared
            .observe(Actor::daemon(), "1", "1", observation)
            .unwrap();
        assert_eq!(ignored, None);
    }
    assert!(watched.events.try_recv().is_err());
    let runs = watched.shared.runs();
    let Some(Slot::Running(run)) = runs.get("1") else {
        panic!("Running")
    };
    assert_eq!(run.attempt, "2");
    assert_eq!(run.terminal_id, "new-terminal");
    assert!(!run.ended);
    assert_eq!(run.adapter.status().unwrap().kind, Kind::Working);
}
#[tokio::test]
async fn a7_status_revisions_order_transitions_even_when_the_clock_ties() {
    let (_dir, bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    shared.rail().allocate_attempt(&id).unwrap();
    let mut events = bus.subscribe();
    for (index, event) in [
        "UserPromptSubmit",
        "Stop",
        "StopFailure",
        "UserPromptSubmit",
    ]
    .iter()
    .enumerate()
    {
        shared
            .observe(
                Actor::daemon(),
                &id,
                "1",
                Observation::Signal(json!({"hook_event_name":event})),
            )
            .unwrap();
        let status = loop {
            if let EventData::AgentStatus(status) = events.try_recv().unwrap().data {
                break status;
            }
        };
        assert_eq!(status.status_revision, (index + 2).to_string());
        assert_eq!(status.status.since, 0);
        let node = shared.node(&id).unwrap();
        assert_eq!(node.attempt.as_deref(), Some(status.attempt.as_str()));
        assert_eq!(
            node.status_revision.as_deref(),
            Some(status.status_revision.as_str())
        );
        assert_eq!(node.status, Some(status.status));
    }
}

#[tokio::test]
async fn a21_a_failed_save_after_spawn_returned_errors_settles_error_and_stops_the_terminal() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    let (killed, mut kills) = tokio::sync::mpsc::unbounded_channel();
    let agents = owner_agents(shared, dir.path()).with_terminal_kills(move |id| {
        killed.send(id).unwrap();
        async { Ok(()) }
    });
    let db = refuse_rail_writes(dir.path());
    let result = agents.shared.observe(Actor::daemon(), &id, "1", Observation::Signal(json!({
        "hook_event_name":"SessionStart", "session_id":"11111111-1111-1111-1111-111111111111", "source":"startup"
    })));
    assert!(result.is_err());
    let node = agents.shared.node(&id).unwrap();
    assert_eq!(node.status.as_ref().unwrap().kind, Kind::Error);
    assert!(
        node.status
            .unwrap()
            .label
            .contains("cannot save conversation")
    );
    assert!(!node.can_resume);
    assert_eq!(
        tokio::time::timeout(PATIENCE, kills.recv())
            .await
            .unwrap()
            .as_deref(),
        Some("1")
    );
    db.execute_batch("DROP TRIGGER fail_write").unwrap();
}

#[tokio::test]
async fn u5483c_final_text_protection_follows_attempt_identity() {
    let (_dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    shared.rail().allocate_attempt(&id).unwrap();
    for (text, expected) in [
        (json!("Should I publish three pages or five"), "present"),
        (json!("All done"), "present"),
        (json!(""), "empty"),
        (Value::Null, "unknown"),
    ] {
        for payload in [
            json!({"hook_event_name":"UserPromptSubmit", "prompt_id":"current"}),
            json!({"hook_event_name":"Stop", "prompt_id":"current", "last_assistant_message":text}),
        ] {
            shared
                .observe(Actor::daemon(), &id, "1", Observation::Signal(payload))
                .unwrap();
        }
        let node = serde_json::to_value(shared.node(&id).unwrap()).unwrap();
        let evidence = &node["final_text"];
        assert_eq!(evidence["attempt"], "1");
        assert_eq!(evidence["finished"], node["status"]["finished"]);
        assert_eq!(evidence["turn"], "current");
        assert_eq!(evidence["kind"], expected);
        shared
            .observe(
                Actor::daemon(),
                &id,
                "0",
                Observation::Signal(json!({"hook_event_name":"Stop", "last_assistant_message":""})),
            )
            .unwrap();
        assert_eq!(
            serde_json::to_value(shared.node(&id).unwrap()).unwrap()["final_text"],
            *evidence
        );
    }
}

#[tokio::test]
async fn u5483c_resuming_clears_only_the_previous_turn() {
    let (_dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    shared.rail().allocate_attempt(&id).unwrap();
    for payload in [
        json!({"hook_event_name":"UserPromptSubmit", "prompt_id":"first"}),
        json!({"hook_event_name":"Stop", "prompt_id":"first", "last_assistant_message":"A long statement\nShould I publish three pages or five"}),
        json!({"hook_event_name":"UserPromptSubmit", "prompt_id":"second"}),
        json!({"hook_event_name":"Stop", "prompt_id":"first", "last_assistant_message":""}),
    ] {
        shared
            .observe(Actor::daemon(), &id, "1", Observation::Signal(payload))
            .unwrap();
    }
    let resumed = serde_json::to_value(shared.node(&id).unwrap()).unwrap();
    assert_eq!(resumed["status"]["kind"], "working");
    assert_eq!(resumed["final_text"]["kind"], "unknown");
    shared.observe(Actor::daemon(), &id, "1", Observation::Signal(json!({"hook_event_name":"Stop", "prompt_id":"second", "last_assistant_message":""}))).unwrap();
    let completed = serde_json::to_value(shared.node(&id).unwrap()).unwrap();
    assert_eq!(
        completed["final_text"],
        json!({"attempt":"1", "turn":"second", "finished":"2", "kind":"empty"})
    );
}

#[tokio::test]
async fn u5483c_final_text_survives_ticks_and_done() {
    let (_dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    shared.rail().allocate_attempt(&id).unwrap();
    for observation in [
        Observation::Signal(json!({"hook_event_name":"UserPromptSubmit", "prompt_id":"first"})),
        Observation::Signal(
            json!({"hook_event_name":"Stop", "prompt_id":"first", "last_assistant_message":"Should I publish three pages or five"}),
        ),
        Observation::Tick,
        Observation::Exit { code: Some(0) },
    ] {
        shared
            .observe(Actor::daemon(), &id, "1", observation)
            .unwrap();
    }
    let node = serde_json::to_value(shared.node(&id).unwrap()).unwrap();
    assert_eq!(node["status"]["kind"], "done");
    assert_eq!(
        node["final_text"],
        json!({"attempt":"1", "turn":"first", "finished":"1", "kind":"present"})
    );
}

#[tokio::test]
async fn u5483c_late_final_text_refreshes_rail_without_a_status_change() {
    let (_dir, bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    shared.rail().allocate_attempt(&id).unwrap();
    shared
        .observe(
            Actor::daemon(),
            &id,
            "1",
            Observation::Signal(
                json!({"hook_event_name":"UserPromptSubmit", "prompt_id":"current"}),
            ),
        )
        .unwrap();
    shared
        .observe(
            Actor::daemon(),
            &id,
            "1",
            Observation::Title("✳ idle".into()),
        )
        .unwrap();
    let before = shared.node(&id).unwrap();
    let mut events = bus.subscribe();
    shared.observe(Actor::daemon(), &id, "1", Observation::Signal(json!({"hook_event_name":"Stop", "prompt_id":"current", "last_assistant_message":"Should I publish three pages or five"}))).unwrap();
    let after = shared.node(&id).unwrap();
    assert_eq!(after.status_revision, before.status_revision);
    assert_eq!(
        serde_json::to_value(after).unwrap()["final_text"]["kind"],
        "present"
    );
    assert!(matches!(
        events.try_recv().unwrap().data,
        EventData::RailChanged
    ));
}

#[tokio::test]
async fn u5483c_empty_text_without_turn_identity_remains_unknown() {
    let (_dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    shared.rail().allocate_attempt(&id).unwrap();
    shared
        .observe(
            Actor::daemon(),
            &id,
            "1",
            Observation::Signal(json!({"hook_event_name":"Stop", "last_assistant_message":""})),
        )
        .unwrap();
    assert!(shared.node(&id).unwrap().final_text.is_none());
}
