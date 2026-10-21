//! Passive collection runs on the existing Project/Adapter ownership, never on Agent turns.
use super::*;

pub(crate) const OBSERVATION_PERIOD: Duration = Duration::from_millis(500);

/// Only Adapter-interpreted facts cross back into Project storage.
pub(crate) struct Contribution {
    pub identity: String,
    pub revision: String,
    pub value: contracts::project::MeasurementValue,
    pub coverage: Vec<String>,
    pub related_request: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
pub(crate) struct Position {
    pub format: u32,
    pub incarnation: String,
    pub offset: u64,
    pub gap: Option<String>,
}

pub(crate) struct Batch {
    pub file: String,
    pub position: Position,
    pub contributions: Vec<Contribution>,
    pub cause: Option<String>,
}

impl Agents {
    /// Start the Daemon's passive observer after configuring the shared Project dependencies.
    pub fn observe_measurements(&self) {
        let (permit, mut seen) = {
            let mut rail = self.shared.rail();
            let Some(permit) = rail.claim_measurement_observer() else {
                return;
            };
            (permit, (rail.measurement_revision().ok(), None))
        };
        let me = Arc::downgrade(&self.shared);
        let launcher = self.launcher.clone();
        tokio::spawn(async move {
            let _permit = permit;
            loop {
                tokio::time::sleep(OBSERVATION_PERIOD).await;
                let Some(shared) = me.upgrade() else { break };
                let collecting = Arc::clone(&shared);
                let launcher = launcher.clone();
                let status = tokio::task::spawn_blocking(move || {
                    let mut rail = collecting.rail();
                    collecting
                        .timing
                        .lock()
                        .expect("measurement timing lock")
                        .sample();
                    rail.collect_measurements(&launcher, (collecting.clock)())
                })
                .await
                .expect("measurement observer worker");
                if seen != status {
                    seen = status;
                    if let Some(revision) = &seen.0 {
                        shared.bus.emit(
                            Actor::daemon(),
                            EventData::MeasurementsChanged {
                                revision: revision.clone(),
                            },
                        );
                    }
                }
            }
        });
    }
}

impl Agents {
    pub(crate) async fn listen_measurements(
        &self,
        id: &str,
        attempt: &str,
    ) -> Result<std::collections::BTreeMap<String, String>, RpcError> {
        let me = Arc::downgrade(&self.shared);
        let alive = me.clone();
        let failure = me.clone();
        let failed_agent = id.to_owned();
        let failed_attempt = attempt.to_owned();
        let agent = id.to_owned();
        let owner = agent.clone();
        let attempt = attempt.to_owned();
        let lifetime = attempt.clone();
        claude_code::measurement::listen(
            move |source, contributions| {
                let shared = me.upgrade().ok_or("Project closed")?;
                let mut rail = shared.rail();
                let before = rail.measurement_revision().map_err(|e| e.message)?;
                let acknowledged=matches!(shared.runs().get(&agent),Some(Slot::Running(run)) if run.attempt==attempt && run.session_started);
                if acknowledged && let Some((held,cwd))=rail.conversation(&agent).map_err(|e|e.message)? && held==source {
                    rail.retain_measurement_owner(&agent,&source,&cwd,Some(&attempt)).map_err(|e|e.message)?;
                }
                let result = rail.accept_intervals(
                    &agent,
                    &attempt,
                    &source,
                    contributions,
                    (shared.clock)(),
                );
                result.map_err(|e| e.message)?;
                let revision = rail.measurement_revision().map_err(|e| e.message)?;
                if revision != before {
                    shared
                        .bus
                        .emit(Actor::daemon(), EventData::MeasurementsChanged { revision });
                }
                Ok(())
            },
            move |cause| {
                if let Some(shared)=failure.upgrade() {
                    let mut rail=shared.rail();
                    rail.record_interval_failure(&failed_agent,&failed_attempt,&cause);
                }
            },
            move || {
                alive.upgrade().is_some_and(|shared| {
                    shared
                        .runs()
                        .get(&owner)
                        .is_some_and(|slot| slot.attempt() == lifetime)
                })
            },
        )
        .await
    }
}

#[cfg(test)]
mod time_tests {
    use super::*;
    use serde_json::json;

    struct World {
        agents: Arc<Agents>,
        ctx: Ctx,
        dir: tempfile::TempDir,
        adjustment: Arc<std::sync::atomic::AtomicI64>,
    }

    impl World {
        fn new() -> Self {
            let begun = Instant::now();
            let adjustment = Arc::new(std::sync::atomic::AtomicI64::new(0));
            let adjust = adjustment.clone();
            let (dir, bus, mut shared) = crate::tests::shared_over_temp_dir(Arc::new(move || {
                1000 + i64::try_from(begun.elapsed().as_millis()).unwrap()
                    + adjust.load(Ordering::SeqCst)
            }));
            Arc::get_mut(&mut shared)
                .unwrap()
                .decisions
                .set_proof(Some("time-test".into()));
            let agents = Arc::new(Agents {
                shared,
                dir: dir.path().into(),
                launcher: Launcher::new(
                    "false",
                    dir.path().join("config"),
                    dir.path().join("rup"),
                    None,
                ),
            });
            let ctx = Ctx {
                actor: Actor::user(),
                bus,
                touches: Arc::new(provenance::Touches::in_memory().unwrap()),
            };
            Self {
                agents,
                ctx,
                dir,
                adjustment,
            }
        }
        fn agent(&self, parent: Option<&str>) -> String {
            let id = crate::tests::running_agent(&self.agents.shared, parent);
            self.signal(&id,json!({"hook_event_name":"SessionStart","session_id":format!("11111111-1111-4111-8111-{:012}",id.parse::<u64>().unwrap())}));
            id
        }
        fn signal(&self, id: &str, payload: Value) {
            self.agents
                .shared
                .observe(Actor::daemon(), id, "1", Observation::Signal(payload))
                .unwrap();
        }
        async fn read(&self) -> Value {
            self.agents
                .call(&self.ctx, "project.measurements", Value::Null)
                .await
                .unwrap()
        }
        fn reopen(&self) -> (Agents, Ctx) {
            let bus = Bus::new();
            let terms = Arc::new(Terminals::open(self.dir.path(), bus.clone()).unwrap());
            let agents = Agents::open_with(
                self.dir.path(),
                bus.clone(),
                terms,
                self.agents.launcher.clone(),
                worktree::Git::from_env(),
            )
            .unwrap();
            let ctx = Ctx {
                actor: Actor::user(),
                bus,
                touches: self.ctx.touches.clone(),
            };
            (agents, ctx)
        }
        async fn advance(&self, seconds: u64) {
            for _ in 0..seconds {
                tokio::time::advance(Duration::from_secs(1)).await;
                self.read().await;
            }
        }
        async fn ask<'a>(
            &'a self,
            id: &str,
        ) -> std::pin::Pin<Box<impl std::future::Future<Output = Result<Value, RpcError>> + 'a>>
        {
            let agents = self.agents.clone();
            let ctx = Ctx {
                actor: Actor {
                    kind: ActorKind::Agent,
                    id: id.into(),
                    parent: None,
                },
                bus: self.ctx.bus.clone(),
                touches: self.ctx.touches.clone(),
            };
            let mut call = Box::pin(async move {
                agents.call(&ctx,"agent.ask",json!({"question":"Continue?","answers":[{"label":"Yes","description":"Continue"}]})).await
            });
            assert!(
                std::future::poll_fn(|cx| std::task::Poll::Ready(call.as_mut().poll(cx)))
                    .await
                    .is_pending()
            );
            call
        }
        fn stop(&self, id: &str) {
            self.agents
                .shared
                .observe(Actor::daemon(), id, "1", Observation::Stopped)
                .unwrap();
            self.agents
                .shared
                .observe(
                    Actor::daemon(),
                    id,
                    "1",
                    Observation::Exit { code: Some(0) },
                )
                .unwrap();
        }
    }

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
            let id = crate::tests::running_agent(&w.agents.shared, None);
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
            w.signal(&id, json!({"hook_event_name":"SessionStart"}));
            w.advance(3).await;
            let read = w.read().await;
            let idle = activity(&read, "idle");
            assert_eq!(idle.len(), 1);
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
    async fn u3016c_decisions_retain_answer_cancel_and_attempt_end() {
        let w = World::new();
        let first = w.agent(None);
        let second = w.agent(None);
        w.advance(6).await;
        let question = w.ask(&first).await;
        w.advance(2).await;
        let opened = w.read().await;
        let decision = activity(&opened, "decision")[0]["value"]["activity"]["decision"]
            .as_str()
            .unwrap();
        let ctx = Ctx {
            actor: Actor::user(),
            bus: w.ctx.bus.clone(),
            touches: w.ctx.touches.clone(),
        };
        w.agents
            .shared
            .answer(
                &ctx,
                serde_json::from_value(json!({"id":decision,"answer":"Yes","proof":null})).unwrap(),
            )
            .unwrap_err();
        w.agents
            .shared
            .answer(
                &ctx,
                serde_json::from_value(json!({"id":decision,"answer":"Yes","proof":"time-test"}))
                    .unwrap(),
            )
            .unwrap();
        question.await.unwrap();
        w.agents
            .shared
            .observe(
                Actor::daemon(),
                &second,
                "1",
                Observation::Title("✳ Ready".into()),
            )
            .unwrap();
        w.advance(1).await;
        let read = w.read().await;
        let wait = activity(&read, "decision")[0];
        assert_eq!(wait["value"]["start"]["unix_ms"], 7000);
        assert_eq!(wait["value"]["state"]["at"]["unix_ms"], 9000);
        assert!(
            read["contributions"].as_array().unwrap().is_empty(),
            "Status is not model execution"
        );
        let unanswered = w.ask(&first).await;
        w.advance(1).await;
        drop(unanswered);
        let cancelled = w.read().await;
        assert!(
            activity(&cancelled, "decision")
                .iter()
                .all(|f| f["value"]["state"]["kind"] == "ended")
        );
        let interrupted = w.ask(&first).await;
        w.stop(&first);
        assert!(interrupted.await.is_err());
        let stopped = w.read().await;
        assert!(
            activity(&stopped, "decision")
                .iter()
                .all(|f| f["value"]["state"]["kind"] == "ended")
        );
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
        // Reopen uses the real Project store. No runtime Decision or program is restored.
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
        let pending = w.ask(&id).await;
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
        assert_eq!(activity(&moved, "decision")[0]["home"], other);
        assert_eq!(activity(&moved, "decision")[0]["maker"], "renamed");
        w.agents.shared.rail().remove(&home).unwrap();
        let erased = w.read().await;
        assert!(
            activity(&erased, "attempt").is_empty(),
            "active sampling cannot replay an explicitly erased identity"
        );
        w.stop(&id);
        drop(pending);
        w.agents.shared.rail().remove(&id).unwrap();
        let removed = w.read().await;
        assert_eq!(activity(&removed, "idle")[0]["agent"], id);
        assert_eq!(activity(&removed, "idle")[0]["home"], other);
        assert_eq!(activity(&removed, "decision")[0]["agent"], id);
        assert_eq!(activity(&removed, "decision")[0]["home"], other);
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
        assert!(activity(&isolated, "decision").is_empty());
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
        // Passive timing must not fail an acknowledged Signal or a delivered answer.
        w.signal(
            &id,
            json!({"hook_event_name":"UserPromptSubmit","prompt":"Fixture prompt"}),
        );
        w.signal(&id, json!({"hook_event_name":"Stop"}));
        w.signal(&id, json!({"hook_event_name":"SessionStart"}));
        let question = w.ask(&id).await;
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

        let decision = w.agents.shared.decisions.list()[0].id.clone();
        w.agents
            .shared
            .answer(
                &w.ctx,
                serde_json::from_value(json!({"id":decision,"answer":"Yes","proof":"time-test"}))
                    .unwrap(),
            )
            .unwrap();
        question.await.unwrap();
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
        assert_eq!(activity(&recovered, "decision").len(), 1);
        assert_eq!(
            activity(&recovered, "decision")[0]["value"]["state"]["kind"],
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
}
