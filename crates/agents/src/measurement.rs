//! Passive collection runs on the existing Project/Adapter ownership, never on Agent turns.
use super::*;

pub(crate) const OBSERVATION_PERIOD: Duration = Duration::from_millis(500);

/// Only Adapter-interpreted facts cross back into Project storage.
pub(crate) struct Contribution {
    pub identity: String,
    pub revision: String,
    pub value: contracts::project::MeasurementValue,
    pub coverage: Vec<String>,
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
        tokio::spawn(async move {
            let _permit = permit;
            loop {
                tokio::time::sleep(OBSERVATION_PERIOD).await;
                let Some(shared) = me.upgrade() else { break };
                let collecting = Arc::clone(&shared);
                let status = tokio::task::spawn_blocking(move || {
                    let mut rail = collecting.rail();
                    collecting
                        .timing
                        .lock()
                        .expect("measurement timing lock")
                        .sample();
                    rail.measurement_status()
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
        let observed = Arc::clone(&self.shared.events.observed);
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
                if acknowledged && let Some((parked,cwd))=rail.conversation(&agent).map_err(|e|e.message)? && parked==source {
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
            async move {
                loop {
                    // Register before the authoritative read; a replacement or teardown in
                    // between that read and the await must not strand the receiver.
                    let changed = observed.notified();
                    if !alive.upgrade().is_some_and(|shared| {
                        shared.runs().get(&owner).is_some_and(|slot| slot.attempt() == lifetime)
                    }) {
                        break;
                    }
                    changed.await;
                }
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
            let (dir, bus, shared) = crate::tests::shared_over_temp_dir(Arc::new(move || {
                1000 + i64::try_from(begun.elapsed().as_millis()).unwrap()
                    + adjust.load(Ordering::SeqCst)
            }));
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
    async fn z3799b_interval_receiver_closes_with_its_attempt_or_project() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for ending in ["removed", "replaced", "project closed"] {
            let (dir, _, shared) = crate::tests::shared_over_temp_dir(Arc::new(|| 1000));
            let agents = crate::tests::owner_agents(shared, dir.path());
            agents.shared.mark_starting("receiver", "1".into());
            let env = agents.listen_measurements("receiver", "1").await.unwrap();
            let endpoint = url::Url::parse(&env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"]).unwrap();
            let mut connection = tokio::net::TcpStream::connect((
                endpoint.host_str().unwrap(),
                endpoint.port().unwrap(),
            ))
            .await
            .unwrap();
            connection
                .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .await
                .unwrap();
            let mut response = Vec::new();
            while !response.ends_with(b"\r\n\r\n") {
                response.push(connection.read_u8().await.unwrap());
            }
            assert!(response.starts_with(b"HTTP/1.1 404"));
            // The response proves Axum is serving this Attempt before its lifetime ends.
            let mut retained = Some(agents);
            match ending {
                "project closed" => {
                    retained.take();
                }
                "replaced" => retained
                    .as_ref()
                    .unwrap()
                    .shared
                    .mark_starting("receiver", "2".into()),
                _ => retained
                    .as_ref()
                    .unwrap()
                    .shared
                    .release_closing("receiver", false),
            }
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(2), connection.read_u8())
                    .await
                    .unwrap()
                    .unwrap_err()
                    .kind(),
                std::io::ErrorKind::UnexpectedEof,
            );
        }
    }

    mod evidence_tests;
}
