//! Passive collection runs on the existing Project/Adapter ownership, never on Agent turns.
use super::*;

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
        let mut seen = {
            let mut rail = self.shared.rail();
            if !rail.claim_measurement_observer() {
                return;
            }
            rail.measurement_revision()
                .expect("Project measurement storage")
        };
        let me = Arc::downgrade(&self.shared);
        let launcher = self.launcher.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(500)).await;
                let Some(shared) = me.upgrade() else { break };
                let collecting = Arc::clone(&shared);
                let launcher = launcher.clone();
                let revision = tokio::task::spawn_blocking(move || {
                    let mut rail = collecting.rail();
                    rail.collect_measurements(&launcher, (collecting.clock)());
                    rail.measurement_revision()
                })
                .await
                .expect("measurement observer worker")
                .expect("Project measurement storage");
                if seen != revision {
                    seen = revision.clone();
                    shared
                        .bus
                        .emit(Actor::daemon(), EventData::MeasurementsChanged { revision });
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

    #[tokio::test(start_paused = true)]
    async fn u3016c_elapsed_and_parallel_time_are_distinct_sources() {
        let (dir, bus, shared) = crate::tests::shared_over_temp_dir(Arc::new(|| 1000));
        let first = crate::tests::running_agent(&shared, None);
        let second = crate::tests::running_agent(&shared, None);
        let agents = Agents {
            shared: shared.clone(),
            dir: dir.path().to_owned(),
            launcher: Launcher::new(
                "false",
                dir.path().join("config"),
                dir.path().join("rup"),
                None,
            ),
        };
        for id in [&first, &second] {
            shared.observe(Actor::daemon(), id, "1", Observation::Signal(json!({"hook_event_name":"SessionStart","session_id":"11111111-1111-4111-8111-111111111111"}))).unwrap();
        }
        tokio::time::advance(Duration::from_secs(1)).await;
        shared
            .observe(Actor::daemon(), &first, "1", Observation::Stopped)
            .unwrap();
        let touches = Arc::new(provenance::Touches::open(&dir.path().join("touches.db")).unwrap());
        let ctx = Ctx {
            actor: Actor::user(),
            bus,
            touches,
        };
        let read = agents
            .call(&ctx, "project.measurements", Value::Null)
            .await
            .unwrap();
        let facts: Vec<_> = read["contributions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["value"]["kind"] == "observed")
            .collect();
        assert_eq!(
            facts.len(),
            2,
            "acknowledged parallel Attempts have their own retained lifetimes"
        );
        assert!(
            facts
                .iter()
                .any(|c| c["agent"] == first && c["value"]["state"] == "ended")
        );
        assert!(
            facts
                .iter()
                .any(|c| c["agent"] == second && c["value"]["state"] == "active")
        );
    }
}
