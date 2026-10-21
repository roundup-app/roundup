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

    #[tokio::test]
    async fn u3016b_token_totals_reconcile_by_source() {
        use contracts::project::{Consumed, MeasurementValue};
        let w = World::new();
        let home = w
            .agents
            .shared
            .rail()
            .insert(NodeKind::Workstream, "Measured work", None, None)
            .unwrap()
            .id;
        let a = w.agent(Some(&home));
        let b = w.agent(Some(&home));
        for (agent, input, output, cache_read, cache_write) in
            [(&a, 100, 20, 400, 50), (&b, 200, 30, 0, 0)]
        {
            let fact = contracts::project::Measurement {
                identity: format!("request:{agent}"),
                source: format!("source:{agent}"),
                source_revision: "1".into(),
                agent: agent.clone(),
                attempt: Some("1".into()),
                home: Some(home.clone()),
                maker: agent.clone(),
                observed: 1000,
                value: MeasurementValue::Request {
                    usage: Consumed {
                        input: Some(input),
                        output: Some(output),
                        cache_read: Some(cache_read),
                        cache_write: Some(cache_write),
                    },
                    cost: None,
                },
                coverage: vec![],
            };
            let db = rusqlite::Connection::open(w.dir.path().join("agents.db")).unwrap();
            db.execute("INSERT INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'[]')",rusqlite::params![fact.identity,fact.source_revision,fact.source,fact.agent,fact.attempt,fact.home,fact.maker,fact.observed,serde_json::to_string(&fact.value).unwrap()]).unwrap();
        }
        let read = w
            .agents
            .call(
                &w.ctx,
                "project.measurementSummary",
                json!({"home":home,"category":"total","offset":0}),
            )
            .await
            .unwrap();
        assert_eq!(
            read["tokens"],
            json!({"input":{"known":"300","missing":0},"output":{"known":"50","missing":0},"cache_read":{"known":"400","missing":0},"cache_write":{"known":"50","missing":0},"total":{"known":"800","missing":0}})
        );
        assert_eq!(read["contributors"], 2);
        assert_eq!(read["rows"][0]["agent"], a);
        assert_eq!(read["rows"][0]["tokens"]["total"]["known"], "570");
        assert_eq!(read["rows"][1]["agent"], b);
        assert_eq!(read["rows"][1]["tokens"]["total"]["known"], "230");
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
    async fn u3016c_clock_gaps_and_late_intervals_are_honest_sources() {
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
        // Late observations for another Attempt and duplicate acknowledgements cannot replace facts.
        w.agents
            .shared
            .observe(Actor::daemon(), &id, "0", Observation::Stopped)
            .unwrap();
        w.signal(&id, json!({"hook_event_name":"SessionStart"}));
        let duplicate = w.read().await;
        assert_eq!(duplicate["time_evidence"], read["time_evidence"]);
        // Reopen uses the real Project store. No runtime Decision or program is restored.
        let bus = Bus::new();
        let terms = Arc::new(Terminals::open(w.dir.path(), bus.clone()).unwrap());
        let reopened = Agents::open_with(
            w.dir.path(),
            bus.clone(),
            terms,
            w.agents.launcher.clone(),
            worktree::Git::from_env(),
        )
        .unwrap();
        let ctx = Ctx {
            actor: Actor::user(),
            bus,
            touches: w.ctx.touches.clone(),
        };
        let read = reopened
            .call(&ctx, "project.measurements", Value::Null)
            .await
            .unwrap();
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
    async fn u3016d_reconnect_reconciles_without_double_counting_time_sources() {
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
        assert_eq!(activity(&recovered, "decision").len(), 1);
        assert_eq!(
            activity(&recovered, "decision")[0]["value"]["state"]["kind"],
            "ended"
        );
        let repeated = w.read().await;
        assert_eq!(repeated["time_evidence"], recovered["time_evidence"]);
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
        let bus = Bus::new();
        let terminals = Arc::new(Terminals::open(w.dir.path(), bus.clone()).unwrap());
        let reopened = Agents::open_with(
            w.dir.path(),
            bus.clone(),
            terminals,
            w.agents.launcher.clone(),
            worktree::Git::from_env(),
        )
        .unwrap();
        let ctx = Ctx {
            actor: Actor::user(),
            bus,
            touches: w.ctx.touches.clone(),
        };
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
