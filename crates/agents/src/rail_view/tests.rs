use std::collections::VecDeque;
use std::sync::Arc;

use contracts::agent::NodeKind;

use crate::{Slot, rail};

use crate::tests::*;
#[test]
fn b32_owner_reads_see_external_attachment_while_a_peer_pins_an_older_snapshot() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = shared
        .rail()
        .insert(NodeKind::Agent, "receiver", None, None)
        .unwrap()
        .id;
    let agents = owner_agents(shared, dir.path());
    agents
        .with_terminal_owner("terminal", |owner| {
            assert!(owner.is_none());
            Ok(())
        })
        .unwrap();
    let peer = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
    peer.execute_batch("BEGIN; SELECT rootpage FROM sqlite_schema;")
        .unwrap();
    let writer = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
    writer
        .execute(
            "UPDATE nodes SET terminal_id = 'terminal', attempt = 7 WHERE id = ?",
            [&id],
        )
        .unwrap();
    agents
        .with_terminal_owner("terminal", |owner| {
            let owner = owner.unwrap();
            assert_eq!(owner.id, id);
            assert_eq!(owner.attempt.as_deref(), Some("7"));
            Ok(())
        })
        .unwrap();
    peer.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn b32_owner_read_leases_expire_and_rearm_independently_of_input() {
    for ongoing in [false, true] {
        let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let id = shared
            .rail()
            .insert(NodeKind::Agent, "receiver", None, None)
            .unwrap()
            .id;
        let agents = owner_agents(shared, dir.path());
        let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
        // The second burst must acquire a new lease after the first burst's
        // checkpoint completed, even when all intervening wakeups were coalesced.
        for _ in 0..2 {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
            loop {
                agents.with_terminal_owner("unowned", |_| Ok(())).unwrap();
                db.busy_timeout(std::time::Duration::from_millis(500))
                    .unwrap();
                db.execute("UPDATE nodes SET attempt = attempt + 1 WHERE id = ?", [&id])
                    .unwrap();
                db.busy_timeout(std::time::Duration::ZERO).unwrap();
                let (busy, frames, copied): (i64, i64, i64) = db
                    .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                    })
                    .unwrap();
                if busy != 0 && frames > copied && copied >= 0 {
                    break;
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "owner reads never shared a bounded WAL read lease"
                );
                std::thread::yield_now();
            }
            // Uncopied frames witness an active reader, unlike (-1, -1) for a competing
            // checkpoint. Further input must neither release nor renew that reader.
            db.busy_timeout(std::time::Duration::from_millis(500))
                .unwrap();
            let stop = std::sync::atomic::AtomicBool::new(false);
            std::thread::scope(|scope| {
                let input = ongoing.then(|| {
                    scope.spawn(|| {
                        while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                            agents.with_terminal_owner("unowned", |_| Ok(())).unwrap();
                        }
                    })
                });
                let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
                let checkpoint = loop {
                    let remaining = deadline.saturating_duration_since(std::time::Instant::now());
                    db.busy_timeout(remaining).unwrap();
                    let result = db.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    });
                    // The lease peer also checkpoints before each lease. SQLite skips
                    // the busy handler for a competing checkpoint and returns no counts.
                    // Retry only that collision, within the original checkpoint budget;
                    // a reader that outlives the budget must still fail this observation.
                    if !matches!(result, Ok((1, -1, -1))) || std::time::Instant::now() >= deadline {
                        break result;
                    }
                    std::thread::yield_now();
                };
                stop.store(true, std::sync::atomic::Ordering::Relaxed);
                if let Some(input) = input {
                    input.join().unwrap();
                }
                assert_eq!(checkpoint.unwrap(), (0, 0, 0), "ongoing input: {ongoing}");
            });
        }
    }
}

#[test]
fn b32_agent_and_door_owner_facts_match_receiver_binding() {
    for kind in [NodeKind::Agent, NodeKind::Workstream] {
        let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let id = shared
            .rail()
            .insert(kind, "receiver", None, Some("terminal"))
            .unwrap()
            .id;
        let attempt = shared.rail().allocate_attempt(&id).unwrap();
        shared.mark_starting(&id, attempt);
        let agents = owner_agents(Arc::clone(&shared), dir.path());
        agents
            .with_terminal_owner("terminal", |owner| {
                let owner = owner.unwrap();
                assert_eq!(owner.id, id);
                assert_eq!(owner.attempt.as_deref(), Some("1"));
                assert_eq!(owner.status_revision.as_deref(), Some("1"));
                assert!(!owner.ended);
                Ok(())
            })
            .unwrap();
    }
}
#[test]
fn b32_repeated_owner_reads_bind_each_terminal_afresh() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    for terminal in ["first", "second"] {
        shared
            .rail()
            .insert(NodeKind::Agent, terminal, None, Some(terminal))
            .unwrap();
    }
    let agents = owner_agents(shared, dir.path());
    for (terminal, expected) in [
        ("first", Some("1")),
        ("missing", None),
        ("second", Some("2")),
        ("first", Some("1")),
        ("missing", None),
    ] {
        agents
            .with_terminal_owner(terminal, |owner| {
                assert_eq!(owner.map(|owner| owner.id.as_str()), expected);
                Ok(())
            })
            .unwrap();
    }
}
#[test]
fn b32_a_warm_owner_read_sees_an_attempt_committed_by_another_connection() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = shared
        .rail()
        .insert(NodeKind::Agent, "receiver", None, Some("terminal"))
        .unwrap()
        .id;
    let agents = owner_agents(Arc::clone(&shared), dir.path());
    agents
        .with_terminal_owner("terminal", |owner| {
            assert!(owner.unwrap().attempt.is_none());
            Ok(())
        })
        .unwrap();
    let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
    db.execute("UPDATE nodes SET attempt = 7 WHERE id = ?", [&id])
        .unwrap();
    agents
        .with_terminal_owner("terminal", |owner| {
            let owner = owner.unwrap();
            assert_eq!(owner.id, id);
            assert_eq!(owner.attempt.as_deref(), Some("7"));
            assert!(owner.ended);
            Ok(())
        })
        .unwrap();
}
#[test]
fn b32_a_warm_owner_read_rejects_ambiguity_then_recovers() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = shared
        .rail()
        .insert(NodeKind::Agent, "first", None, Some("terminal"))
        .unwrap()
        .id;
    let agents = owner_agents(Arc::clone(&shared), dir.path());
    agents
        .with_terminal_owner("terminal", |owner| {
            assert_eq!(owner.unwrap().id, id);
            Ok(())
        })
        .unwrap();
    let other = shared
        .rail()
        .insert(NodeKind::Agent, "second", None, Some("terminal"))
        .unwrap()
        .id;
    let error = agents
        .with_terminal_owner("terminal", |_| -> Result<(), rpc::RpcError> {
            panic!("must not record input for an ambiguous receiver")
        })
        .unwrap_err();
    assert_eq!(error.code, rpc::code::CONFLICT);
    shared.rail().detach_terminal(&other).unwrap();
    agents
        .with_terminal_owner("terminal", |owner| {
            assert_eq!(owner.unwrap().id, id);
            Ok(())
        })
        .unwrap();
}
#[test]
fn b32_owner_read_stops_at_the_second_receiver() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    for name in ["first", "second", "third"] {
        shared
            .rail()
            .insert(NodeKind::Agent, name, None, Some("terminal"))
            .unwrap();
    }
    let agents = owner_agents(shared, dir.path());
    let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
    // A third step must fail, so CONFLICT proves the query stopped at ambiguity
    // rather than scanning the remaining receivers before rejecting the input.
    db.execute_batch(
        "ALTER TABLE nodes RENAME TO receivers;
         CREATE VIEW nodes AS
         SELECT id, terminal_id,
                CASE WHEN id = 3 THEN json_extract('invalid', '$') ELSE attempt END AS attempt
         FROM receivers;",
    )
    .unwrap();
    let error = agents
        .with_terminal_owner("terminal", |_| -> Result<(), rpc::RpcError> {
            panic!("must not record input for an ambiguous receiver")
        })
        .unwrap_err();
    assert_eq!(error.code, rpc::code::CONFLICT);
}

#[test]
fn b32_a_warm_owner_read_recovers_after_schema_replacement() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let agents = owner_agents(Arc::clone(&shared), dir.path());
    agents
        .with_terminal_owner("terminal", |owner| {
            assert!(owner.is_none());
            Ok(())
        })
        .unwrap();
    let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
    db.execute_batch("DROP TABLE nodes").unwrap();
    let error = agents
        .with_terminal_owner("terminal", |_| -> Result<(), rpc::RpcError> {
            panic!("must not record input after an owner query fails")
        })
        .unwrap_err();
    assert_eq!(error.code, rpc::code::INTERNAL);
    assert!(shared.rail.try_lock().is_ok());
    assert!(shared.runs.try_lock().is_ok());
    db.execute_batch(
        "CREATE TABLE nodes (id INTEGER, terminal_id TEXT, attempt INTEGER);
         INSERT INTO nodes VALUES (42, 'terminal', 9);",
    )
    .unwrap();
    agents
        .with_terminal_owner("terminal", |owner| {
            let owner = owner.unwrap();
            assert_eq!(owner.id, "42");
            assert_eq!(owner.attempt.as_deref(), Some("9"));
            Ok(())
        })
        .unwrap();
}
#[test]
fn r16_owner_read_recovers_after_row_conversion_error() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    shared
        .rail()
        .insert(NodeKind::Agent, "receiver", None, Some("terminal"))
        .unwrap();
    let agents = owner_agents(shared, dir.path());
    let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
    db.execute("UPDATE nodes SET attempt = 'invalid'", [])
        .unwrap();
    let error = agents
        .with_terminal_owner("terminal", |_| -> Result<(), rpc::RpcError> {
            panic!("a failed owner conversion must not record input")
        })
        .unwrap_err();
    assert_eq!(error.code, rpc::code::INTERNAL);
    db.execute("UPDATE nodes SET attempt = 9", []).unwrap();
    agents
        .with_terminal_owner("terminal", |owner| {
            assert_eq!(owner.unwrap().attempt.as_deref(), Some("9"));
            Ok(())
        })
        .unwrap();
}

#[test]
fn b32_recording_failure_releases_lifecycle_locks() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let agents = owner_agents(Arc::clone(&shared), dir.path());
    let error = agents
        .with_terminal_owner("terminal", |_| -> Result<(), rpc::RpcError> {
            Err(rpc::RpcError::conflict("record failed"))
        })
        .unwrap_err();
    assert_eq!(error.message, "record failed");
    assert!(shared.rail.try_lock().is_ok());
    assert!(shared.runs.try_lock().is_ok());
}
#[test]
fn b32_pending_resume_binds_the_new_attempt_not_the_ended_run() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = shared
        .rail()
        .insert(NodeKind::Workstream, "door", None, Some("old-terminal"))
        .unwrap()
        .id;
    shared.rail().allocate_attempt(&id).unwrap();
    let attempt = shared.rail().allocate_attempt(&id).unwrap();
    let (done, _wait) = tokio::sync::oneshot::channel();
    shared.runs().insert(
        id.clone(),
        Slot::Resuming {
            mode: contracts::agent::ResumeMode::Normal,
            attempt,
            since: 0,
            old: None,
            conversation_id: "conversation".into(),
            cwd: "/".into(),
            prompt: None,
            starred: false,
            terminal_id: Some("unacknowledged-terminal".into()),
            parked: VecDeque::new(),
            done,
        },
    );
    let agents = owner_agents(shared, dir.path());
    agents
        .with_terminal_owner("old-terminal", |owner| {
            let owner = owner.unwrap();
            assert_eq!(owner.attempt.as_deref(), Some("2"));
            assert_eq!(owner.status_revision.as_deref(), Some("1"));
            assert!(!owner.ended);
            Ok(())
        })
        .unwrap();
    agents
        .with_terminal_owner("unacknowledged-terminal", |owner| {
            assert!(owner.is_none());
            Ok(())
        })
        .unwrap();
}
#[test]
fn b32_closed_receiver_cannot_be_revived_by_an_attached_terminal() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = shared
        .rail()
        .insert(NodeKind::Agent, "receiver", None, Some("terminal"))
        .unwrap()
        .id;
    shared.rail().allocate_attempt(&id).unwrap();
    shared.runs().insert(id, Slot::Closing);
    let agents = owner_agents(shared, dir.path());
    agents
        .with_terminal_owner("terminal", |owner| {
            let owner = owner.unwrap();
            assert_eq!(owner.attempt.as_deref(), Some("1"));
            assert!(owner.status_revision.is_none());
            assert!(owner.ended);
            Ok(())
        })
        .unwrap();
}
#[tokio::test]
async fn b32_running_and_failed_owner_facts_match_existing_rail_binding() {
    let watched = Watched::start();
    watched
        .shared
        .rail()
        .insert(NodeKind::Agent, "receiver", None, Some("1"))
        .unwrap();
    watched.shared.rail().allocate_attempt("1").unwrap();
    let agents = owner_agents(Arc::clone(&watched.shared), watched._dir.path());
    for failed in [false, true] {
        if failed {
            let mut runs = watched.shared.runs();
            let Some(Slot::Running(run)) = runs.get_mut("1") else {
                unreachable!()
            };
            run.adapter.fail("failed".into());
            run.status_revision += 1;
        }
        let node = watched.shared.node("1").unwrap();
        agents
            .with_terminal_owner("1", |owner| {
                let owner = owner.unwrap();
                assert_eq!(owner.attempt, node.attempt);
                assert_eq!(owner.status_revision, node.status_revision);
                assert_eq!(owner.ended, failed);
                Ok(())
            })
            .unwrap();
    }
    assert!(matches!(
        agents.prompt("1", "after fatal failure").await,
        Err(crate::PromptError::NotFound { .. })
    ));
    watched.watcher.abort();
}
#[test]
fn b32_concurrent_attach_invalidates_an_unowned_read() {
    owner_transition(
        false,
        |shared, id, _| {
            shared.rail().attach_terminal(id, "terminal").unwrap();
        },
        Some(("1", "1")),
    );
}
#[test]
fn b32_concurrent_detach_invalidates_an_owned_read() {
    owner_transition(
        true,
        |shared, id, _| {
            shared.rail().detach_terminal(id).unwrap();
        },
        None,
    );
}
#[test]
fn b32_concurrent_reassignment_returns_the_new_receiver() {
    owner_transition(
        true,
        |shared, id, _| {
            let mut rail = shared.rail();
            rail.detach_terminal(id).unwrap();
            let next = rail
                .insert(NodeKind::Workstream, "door", None, Some("terminal"))
                .unwrap()
                .id;
            rail.allocate_attempt(&next).unwrap();
        },
        Some(("2", "1")),
    );
}
#[test]
fn b32_concurrent_removal_leaves_no_receiver() {
    owner_transition(
        true,
        |shared, id, _| {
            let mut rail = shared.rail();
            let mut runs = shared.runs();
            rail.remove(id).unwrap();
            runs.remove(id);
        },
        None,
    );
}
#[test]
fn b32_concurrent_reopen_unlinks_terminal_ownership() {
    owner_transition(
        true,
        |shared, _, path| {
            let mut rail = shared.rail();
            let mut runs = shared.runs();
            *rail = rail::Rail::open(&path.join("agents.db")).unwrap();
            runs.clear();
        },
        None,
    );
}
#[test]
fn b32_concurrent_attempt_change_fences_the_old_receiver() {
    owner_transition(
        true,
        |shared, id, _| {
            let mut rail = shared.rail();
            let attempt = rail.allocate_attempt(id).unwrap();
            shared.mark_starting(id, attempt);
        },
        Some(("1", "2")),
    );
}

#[test]
fn a2681a_stopping_attempt_hides_parts() {
    let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
    let id = running_agent(&shared, None);
    let conversation = "11111111-1111-1111-1111-111111111111";
    let cwd = dir.path().canonicalize().unwrap();
    let key: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let path = dir
        .path()
        .join("projects")
        .join(key)
        .join(format!("{conversation}.jsonl"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, "{}\n").unwrap();
    shared
        .rail()
        .save_conversation(&id, conversation, &cwd.to_string_lossy())
        .unwrap();
    if let Some(Slot::Running(run)) = shared.runs().get_mut(&id) {
        run.ended = true;
    }
    shared
        .rail_view
        .launcher
        .refresh_overview(&cwd, conversation);
    assert!(
        shared.node(&id).unwrap().overview.is_some(),
        "fixture must have visible parts before stopping"
    );
    if let Some(Slot::Running(run)) = shared.runs().get_mut(&id) {
        run.closing = true;
    }
    assert!(shared.node(&id).unwrap().overview.is_none());
}
