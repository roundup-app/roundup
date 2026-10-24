use super::*;

fn activity<'a>(read: &'a Value, kind: &str) -> Vec<&'a Value> {
    read["time_evidence"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["value"]["activity"]["kind"] == kind)
        .collect()
}

#[tokio::test(start_paused = true)]
async fn u3016c_other_observed_time_has_positive_sources() {
    let w = World::new();
    let id = w.agent(None);
    w.advance(3).await;
    w.signal(
        &id,
        json!({"hook_event_name":"UserPromptSubmit","prompt":"Fixture prompt"}),
    );
    w.advance(3).await;
    let working = w.read().await;
    let idle = activity(&working, "idle");
    assert_eq!(idle.len(), 1);
    assert_eq!(idle[0]["value"]["start"]["unix_ms"], 1000);
    assert_eq!(idle[0]["value"]["state"]["at"]["unix_ms"], 4000);
    assert_eq!(
        idle[0]["value"]["segments"][0]["end"]["monotonic_ns"],
        "3000000000"
    );
    assert!(working["contributions"].as_array().unwrap().is_empty());
    w.signal(&id, json!({"hook_event_name":"Stop"}));
    w.advance(1).await;
    let later = w.read().await;
    assert_eq!(activity(&later, "idle").len(), 2);
    assert_eq!(activity(&later, "idle")[0], idle[0]);
    assert_eq!(
        activity(&later, "idle")[1]["value"]["start"]["unix_ms"],
        7000
    );
    let (reopened, ctx) = w.reopen();
    let read = reopened
        .call(&ctx, "project.measurements", Value::Null)
        .await
        .unwrap();
    assert_eq!(activity(&read, "idle")[0], idle[0]);
    assert_eq!(
        activity(&read, "idle")[1]["value"]["state"]["kind"],
        "interrupted"
    );
}

#[tokio::test(start_paused = true)]
async fn u3016c_ready_before_acknowledgement_retains_idle_clock_points() {
    for closes_before_ack in [false, true] {
        let w = World::new();
        let home = w
            .agents
            .call(&w.ctx, "rail.createWorkstream", json!({"name":"original"}))
            .await
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let other = w
            .agents
            .call(&w.ctx, "rail.createWorkstream", json!({"name":"later"}))
            .await
            .unwrap()["id"]
            .clone();
        let id = crate::tests::running_agent(&w.agents.shared, Some(&home));
        w.agents
            .shared
            .observe(
                Actor::daemon(),
                &id,
                "1",
                Observation::Title("✳ Ready".into()),
            )
            .unwrap();
        w.advance(1).await;
        if closes_before_ack {
            w.signal(
                &id,
                json!({"hook_event_name":"UserPromptSubmit","prompt":"Fixture prompt"}),
            );
        }
        assert!(activity(&w.read().await, "idle").is_empty());
        w.agents
            .call(
                &w.ctx,
                "rail.move",
                json!({"id":id,"parent":other,"index":0}),
            )
            .await
            .unwrap();
        w.agents
            .call(&w.ctx, "rail.rename", json!({"id":id,"name":"later"}))
            .await
            .unwrap();
        w.signal(&id, json!({"hook_event_name":"SessionStart"}));
        w.advance(3).await;
        let read = w.read().await;
        let idle = activity(&read, "idle");
        assert_eq!(idle.len(), if closes_before_ack { 2 } else { 1 });
        assert_eq!(idle[0]["home"], home);
        assert_eq!(idle[0]["maker"], "a");
        assert_eq!(idle[0]["agent"], id);
        assert_eq!(idle[0]["attempt"], "1");
        assert_eq!(idle[0]["value"]["activity"]["status_revision"], "2");
        assert_eq!(idle[0]["value"]["start"]["unix_ms"], 1000);
        assert_eq!(
            idle[0]["value"]["segments"][0]["end"]["monotonic_ns"],
            if closes_before_ack {
                "1000000000"
            } else {
                "4000000000"
            }
        );
        assert_eq!(
            idle[0]["value"]["state"]["kind"],
            if closes_before_ack { "ended" } else { "active" }
        );
    }
}

#[tokio::test(start_paused = true)]
async fn u3016c_startup_evidence_ends_on_acknowledgement() {
    let w = World::new();
    let id = crate::tests::running_agent(&w.agents.shared, None);
    w.advance(3).await;
    assert!(
        w.read().await["time_evidence"]
            .as_array()
            .unwrap()
            .is_empty(),
        "an unacknowledged launch supplies no retained Attempt"
    );
    w.signal(&id, json!({"hook_event_name":"SessionStart"}));
    let acknowledged = w.read().await;
    let startup = activity(&acknowledged, "startup")[0];
    assert_eq!(startup["value"]["start"]["unix_ms"], 1000);
    assert_eq!(startup["value"]["state"]["at"]["unix_ms"], 4000);
    assert_eq!(
        startup["value"]["segments"][0]["end"]["monotonic_ns"],
        "3000000000"
    );
    assert_eq!(startup["agent"], id);
    assert_eq!(startup["attempt"], "1");
    w.signal(
        &id,
        json!({"hook_event_name":"UserPromptSubmit","prompt":"Fixture prompt"}),
    );
    w.advance(2).await;
    w.signal(&id, json!({"hook_event_name":"SessionStart"}));
    let later = w.read().await;
    assert_eq!(activity(&later, "startup"), vec![startup]);
}

#[tokio::test(start_paused = true)]
async fn u3016c_other_time_evidence_preserves_identity_and_gaps() {
    let w = World::new();
    let id = w.agent(None);
    w.advance(1).await;
    w.adjustment.store(-5000, Ordering::SeqCst);
    w.advance(1).await;
    tokio::time::advance(Duration::from_secs(60)).await;
    let read = w.read().await;
    let fact = activity(&read, "attempt")[0];
    assert_eq!(fact["value"]["segments"].as_array().unwrap().len(), 3);
    assert!(
        fact["coverage"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c.as_str().unwrap().contains("uncovered"))
    );
    for segment in fact["value"]["segments"].as_array().unwrap() {
        assert!(
            segment["end"]["monotonic_ns"]
                .as_str()
                .unwrap()
                .parse::<u128>()
                .unwrap()
                >= segment["start"]["monotonic_ns"]
                    .as_str()
                    .unwrap()
                    .parse::<u128>()
                    .unwrap()
        );
    }
    let idle = activity(&read, "idle")[0];
    assert_eq!(idle["value"]["segments"], fact["value"]["segments"]);
    assert_eq!(idle["agent"], id);
    assert_eq!(idle["attempt"], "1");
    // Late observations for another Attempt and duplicate acknowledgements cannot replace facts.
    w.agents
        .shared
        .observe(Actor::daemon(), &id, "0", Observation::Stopped)
        .unwrap();
    w.signal(&id, json!({"hook_event_name":"SessionStart"}));
    let duplicate = w.read().await;
    assert_eq!(duplicate["time_evidence"], read["time_evidence"]);
    // Reopen uses the real Project store. No runtime program is restored.
    let (reopened, ctx) = w.reopen();
    let read = reopened
        .call(&ctx, "project.measurements", Value::Null)
        .await
        .unwrap();
    let retained_idle = activity(&read, "idle")[0];
    assert_eq!(retained_idle["identity"], idle["identity"]);
    assert_eq!(
        retained_idle["value"]["segments"],
        idle["value"]["segments"]
    );
    assert_eq!(retained_idle["value"]["state"]["kind"], "interrupted");
    let retained = activity(&read, "attempt")[0];
    assert_eq!(retained["identity"], fact["identity"]);
    assert_eq!(retained["value"]["segments"], fact["value"]["segments"]);
    assert_eq!(retained["value"]["state"]["kind"], "interrupted");
    assert!(
        retained["coverage"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c.as_str().unwrap().contains("outage"))
    );
}

#[tokio::test(start_paused = true)]
async fn u3016a_moves_and_removal_keep_recorded_attribution_time_sources() {
    let w = World::new();
    let home = w
        .agents
        .call(&w.ctx, "rail.createWorkstream", json!({"name":"same"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let other = w
        .agents
        .call(&w.ctx, "rail.createWorkstream", json!({"name":"other"}))
        .await
        .unwrap()["id"]
        .clone();
    let id = w.agent(Some(&home));
    w.advance(1).await;
    let first = w.read().await;
    w.agents
        .call(
            &w.ctx,
            "rail.move",
            json!({"id":id,"parent":other,"index":0}),
        )
        .await
        .unwrap();
    w.agents
        .call(&w.ctx, "rail.rename", json!({"id":id,"name":"renamed"}))
        .await
        .unwrap();
    w.advance(1).await;
    let moved = w.read().await;
    let attempt = activity(&moved, "attempt")[0];
    assert_eq!(attempt["home"], home);
    assert_eq!(attempt["maker"], "a");
    assert_eq!(activity(&moved, "startup")[0]["home"], home);
    assert_eq!(activity(&moved, "idle")[0]["home"], home);
    w.signal(
        &id,
        json!({"hook_event_name":"UserPromptSubmit","prompt":"Fixture prompt"}),
    );
    w.signal(&id, json!({"hook_event_name":"Stop"}));
    let phases = w.read().await;
    assert_eq!(activity(&phases, "idle")[1]["home"], other);
    assert_eq!(activity(&phases, "idle")[1]["maker"], "renamed");
    assert_eq!(
        attempt["value"]["start"],
        first["time_evidence"][0]["value"]["start"]
    );
    assert!(
        attempt["coverage"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s.as_str().unwrap().contains("unsplittable"))
    );
    w.agents.shared.rail().remove(&home).unwrap();
    let erased = w.read().await;
    assert!(
        activity(&erased, "attempt").is_empty(),
        "active sampling cannot replay an explicitly erased identity"
    );
    w.stop(&id);
    w.agents.shared.rail().remove(&id).unwrap();
    let removed = w.read().await;
    assert_eq!(activity(&removed, "idle")[0]["agent"], id);
    assert_eq!(activity(&removed, "idle")[0]["home"], other);
    let another = World::new();
    another
        .agents
        .call(
            &another.ctx,
            "rail.createWorkstream",
            json!({"name":"same"}),
        )
        .await
        .unwrap();
    another.agent(None);
    let isolated = another.read().await;
    assert_ne!(isolated["project"], removed["project"]);
}

#[tokio::test(start_paused = true)]
async fn u3016d_other_time_retention_recovers() {
    let w = World::new();
    let mut events = w.ctx.bus.subscribe();
    let id = w.agent(None);
    let good = w.read().await;
    let good_revision = good["revision"].as_str().unwrap();
    assert!(std::iter::from_fn(|| events.try_recv().ok()).any(
        |e| matches!(e.data,EventData::MeasurementsChanged{revision} if revision==good_revision)
    ));
    let db = rusqlite::Connection::open(w.dir.path().join("agents.db")).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_measurement BEFORE INSERT ON measurement_revisions BEGIN SELECT RAISE(ABORT,'retention refused'); END;").unwrap();
    // Passive timing must not fail an acknowledged Signal.
    w.signal(
        &id,
        json!({"hook_event_name":"UserPromptSubmit","prompt":"Fixture prompt"}),
    );
    w.signal(&id, json!({"hook_event_name":"Stop"}));
    w.signal(&id, json!({"hook_event_name":"SessionStart"}));
    w.advance(1).await;
    let failed = w.read().await;
    assert!(
        failed["cause"]
            .as_str()
            .unwrap()
            .contains("retention refused")
    );
    assert_eq!(failed["time_evidence"], good["time_evidence"]);
    assert_ne!(failed["revision"], good["revision"]);
    let source = failed["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|source| source["source"] == format!("roundup:{id}"))
        .unwrap();
    assert!(
        source["cause"]
            .as_str()
            .unwrap()
            .contains("retention refused")
    );
    let original_source = good["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|source| source["source"] == format!("roundup:{id}"))
        .unwrap();
    assert_eq!(source["last_good"], original_source["last_good"]);
    assert!(std::iter::from_fn(||events.try_recv().ok()).any(|e|matches!(e.data,EventData::MeasurementsChanged {revision} if revision==failed["revision"])));

    db.execute_batch("DROP TRIGGER refuse_measurement").unwrap();
    let recovered = w.read().await;
    assert!(recovered["cause"].is_null());
    assert_eq!(activity(&recovered, "attempt").len(), 1);
    assert_eq!(activity(&recovered, "startup").len(), 1);
    assert_eq!(activity(&recovered, "idle").len(), 2);
    assert_eq!(
        activity(&recovered, "idle")[0]["value"]["state"]["kind"],
        "ended"
    );
    let repeated = w.read().await;
    assert_eq!(repeated["time_evidence"], recovered["time_evidence"]);
    w.stop(&id);
    let ended = w.read().await;
    let (reopened, ctx) = w.reopen();
    let read = reopened
        .call(&ctx, "project.measurements", Value::Null)
        .await
        .unwrap();
    assert_eq!(read["time_evidence"], ended["time_evidence"]);
    assert!(read["cause"].is_null());
}
#[tokio::test(start_paused = true)]
async fn u3016c_unknown_historical_starts_remain_unknown_sources() {
    let w = World::new();
    let id = crate::tests::running_agent(&w.agents.shared, None);
    // Absence of a launch observation cannot be reconstructed from a later ack.
    w.agents
        .shared
        .timing
        .lock()
        .unwrap()
        .abandon_attempt(&id, "1");
    w.signal(&id, json!({"hook_event_name":"SessionStart"}));
    let read = w.read().await;
    let fact = activity(&read, "attempt")[0];
    assert!(fact["value"]["start"].is_null());
    assert!(activity(&read, "startup")[0]["value"]["start"].is_null());
    assert_eq!(fact["attempt"], "1");
    assert!(
        fact["coverage"]
            .as_array()
            .unwrap()
            .iter()
            .any(|gap| gap.as_str().unwrap().contains("start unknown"))
    );
}
#[tokio::test(start_paused = true)]
async fn u3016d_initial_time_collection_failure_is_not_empty_success_after_reopen() {
    let w = World::new();
    let db = rusqlite::Connection::open(w.dir.path().join("agents.db")).unwrap();
    db.execute_batch("CREATE TRIGGER refuse_measurement BEFORE INSERT ON measurement_revisions BEGIN SELECT RAISE(ABORT,'retention refused'); END;").unwrap();
    let id = w.agent(None);
    let failed = w.read().await;
    assert!(failed["time_evidence"].as_array().unwrap().is_empty());
    let (reopened, ctx) = w.reopen();
    let read = reopened
        .call(&ctx, "project.measurements", Value::Null)
        .await
        .unwrap();
    let source = read["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|source| source["source"] == format!("roundup:{id}"))
        .unwrap();
    assert!(source["last_good"].is_null());
    assert!(
        source["cause"]
            .as_str()
            .unwrap()
            .contains("retention refused")
    );
    assert!(read["time_evidence"].as_array().unwrap().is_empty());
    db.execute_batch("DROP TRIGGER refuse_measurement").unwrap();
    let recovered = w.read().await;
    assert!(recovered["cause"].is_null());
    let startup = activity(&recovered, "startup");
    assert_eq!(startup.len(), 1);
    assert_eq!(startup[0]["value"]["start"]["unix_ms"], 1000);
    assert_eq!(startup[0]["value"]["state"]["kind"], "ended");
}
#[tokio::test(start_paused = true)]
async fn u3016d_reads_do_not_feed_back_measurement_notifications() {
    let w = World::new();
    w.agent(None);
    let initial = w.read().await;
    let mut events = w.ctx.bus.subscribe();
    for _ in 0..4 {
        tokio::time::advance(OBSERVATION_PERIOD / 5).await;
        assert_eq!(w.read().await["revision"], initial["revision"]);
    }
    assert!(events.try_recv().is_err());
    tokio::time::advance(OBSERVATION_PERIOD / 5).await;
    let observed = w.read().await;
    assert_ne!(observed["revision"], initial["revision"]);
    assert!(matches!(
        events.try_recv().unwrap().data,
        EventData::MeasurementsChanged { .. }
    ));
}
