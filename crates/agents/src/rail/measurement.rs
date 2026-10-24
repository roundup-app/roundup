//! Project-owned attribution and replay positions share the existing Rail transaction owner.
use super::*;
use crate::measurement::Contribution;
use contracts::project::{Measurement, MeasurementSource, Measurements};
use contracts::{Actor, EventData};
use rpc::Bus;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::Instant;

struct Owner {
    agent: String,
    source: String,
    attempt: Option<String>,
    home: Option<String>,
    maker: String,
}

impl Rail {
    pub(crate) fn claim_measurement_observer(&self) -> Option<tokio::sync::OwnedSemaphorePermit> {
        self.measurement_observing.clone().try_acquire_owned().ok()
    }
    pub(crate) fn observe_measurement_owner(
        &mut self,
        id: &str,
        source: &str,
        cwd: &str,
        attempt: &str,
    ) {
        // Collection failure must not turn a successful conversation acknowledgement into
        // an Agent failure. The public read retains the cause while source collection retries.
        if let Err(error) = self.retain_measurement_owner(id, source, cwd, Some(attempt)) {
            self.measurement_failure = Some(error.message);
        }
    }

    pub(crate) fn retain_measurement_owner(
        &self,
        agent: &str,
        source: &str,
        cwd: &str,
        attempt: Option<&str>,
    ) -> Result<(), RpcError> {
        let tree = self.tree()?;
        let node = find(&tree, agent)?;
        let home = home(&tree, agent);
        self.db.execute("INSERT INTO measurement_owners(agent,source,cwd,attempt,home,maker) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(agent,source) DO UPDATE SET attempt=excluded.attempt,cwd=excluded.cwd",params![agent,source,cwd,attempt,home,node.name]).map_err(sql)?;
        if let Some(attempt) = attempt {
            self.db.execute("INSERT OR IGNORE INTO measurement_attempts(agent,source,attempt) VALUES(?1,?2,?3)",params![agent,source,attempt]).map_err(sql)?;
        }
        Ok(())
    }

    pub(crate) fn measurement_revision(&mut self) -> Result<String, RpcError> {
        let result = self
            .db
            .query_row("SELECT revision FROM measurement_state", [], |r| {
                r.get::<_, i64>(0)
            })
            .map(|r| r.to_string())
            .map_err(sql);
        match &result {
            Ok(revision) => self.measurement_revision = Some(revision.clone()),
            Err(error) => self.measurement_failure = Some(error.message.clone()),
        }
        result
    }

    pub(crate) fn measurement_status(&mut self) -> (Option<String>, Option<String>) {
        // Only a successful revision read reconciles a collector failure. Owner writes and
        // successful public reads cannot establish that passive collection has recovered.
        let result = self.measurement_revision();
        self.measurement_failure = result.err().map(|error| error.message);
        (
            self.measurement_revision.clone(),
            self.measurement_failure.clone(),
        )
    }

    pub(crate) fn record_interval_failure(&mut self, agent: &str, attempt: &str, cause: &str) {
        let save = || -> Result<(), RpcError> {
            let before = self.db.total_changes();
            self.db.execute("INSERT INTO measurement_positions(source,file,position,cause) SELECT source,'intervals','{}',?3 FROM measurement_attempts WHERE agent=?1 AND attempt=?2 ON CONFLICT(source,file) DO UPDATE SET cause=excluded.cause WHERE cause IS NOT excluded.cause",params![agent,attempt,cause]).map_err(sql)?;
            if self.db.total_changes() != before {
                self.db
                    .execute("UPDATE measurement_state SET revision=revision+1", [])
                    .map_err(sql)?;
            }
            Ok(())
        };
        if let Err(error) = save() {
            self.measurement_failure = Some(error.message);
        }
    }

    pub(crate) fn accept_intervals(
        &mut self,
        agent: &str,
        attempt: &str,
        source: &str,
        contributions: Vec<Contribution>,
        now: i64,
    ) -> Result<(), RpcError> {
        for node in self.tree()? {
            if node.id != agent
                && self
                    .conversation(&node.id)?
                    .is_some_and(|(parked, _)| parked == source)
            {
                return Err(RpcError::conflict("interval source ownership is ambiguous"));
            }
        }
        let owner=self.db.query_row("SELECT agent,source,attempt,home,maker FROM measurement_owners WHERE agent=?1 AND source=?3 AND disabled=0 AND unresolved=0 AND EXISTS(SELECT 1 FROM measurement_attempts WHERE agent=?1 AND source=?3 AND attempt=?2)",params![agent,attempt,source],|r|Ok(Owner {agent:r.get(0)?,source:r.get(1)?,attempt:r.get(2)?,home:r.get(3)?,maker:r.get(4)?})).optional().map_err(sql)?.ok_or_else(||RpcError::conflict("interval ownership is unresolved"))?;
        let tree = self.tree()?;
        let mut owner = owner;
        owner.attempt = Some(attempt.to_owned());
        if let Some(node) = tree.iter().find(|n| n.id == agent) {
            owner.home = home(&tree, agent);
            owner.maker = node.name.clone();
        }
        let tx = self.db.transaction().map_err(sql)?;
        let before = tx.total_changes();
        tx.execute("UPDATE measurement_positions SET cause=NULL WHERE source=?1 AND file='intervals' AND cause IS NOT NULL",[source]).map_err(sql)?;
        for contribution in contributions {
            accept(&tx, &owner, contribution, owner.attempt.as_deref(), now)?;
        }
        if tx.total_changes() != before {
            tx.execute("INSERT INTO measurement_positions(source,file,position,last_good) VALUES(?1,'intervals','{}',?2) ON CONFLICT(source,file) DO UPDATE SET last_good=excluded.last_good,cause=NULL",params![owner.source,now]).map_err(sql)?;
            tx.execute("UPDATE measurement_state SET revision=revision+1", [])
                .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    pub(crate) fn measurements(&mut self, project: &Path) -> Result<Measurements, RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        let revision = match tx.query_row("SELECT revision FROM measurement_state", [], |r| {
            r.get::<_, i64>(0)
        }) {
            Ok(revision) => revision.to_string(),
            Err(error) => {
                let error = sql(error);
                self.measurement_failure = Some(error.message.clone());
                return Err(error);
            }
        };
        self.measurement_revision = Some(revision.clone());
        let contributions = {
            let mut query=tx.prepare("SELECT identity,source,source_revision,agent,attempt,home,maker,observed,value,coverage FROM measurement_revisions WHERE revision IN (SELECT MAX(revision) FROM measurement_revisions GROUP BY identity) ORDER BY identity").map_err(sql)?;
            let rows = query
                .query_map([], |r| {
                    Ok((
                        (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?),
                        (r.get(5)?, r.get(6)?, r.get(7)?),
                        (r.get::<_, String>(8)?, r.get::<_, String>(9)?),
                    ))
                })
                .map_err(sql)?;
            rows.map(|r| {
                let (
                    (identity, source, source_revision, agent, attempt),
                    (home, maker, observed),
                    (value, coverage),
                ) = r.map_err(sql)?;
                Ok(Measurement {
                    identity,
                    source,
                    source_revision,
                    agent,
                    attempt,
                    home,
                    maker,
                    observed,
                    value: serde_json::from_str(&value).map_err(RpcError::internal)?,
                    coverage: serde_json::from_str(&coverage).map_err(RpcError::internal)?,
                })
            })
            .collect::<Result<Vec<_>, RpcError>>()?
        };
        let (time_evidence, contributions): (Vec<_>, Vec<_>) =
            contributions.into_iter().partition(|fact| {
                matches!(
                    fact.value,
                    contracts::project::MeasurementValue::Observed { .. }
                )
            });
        let mut sources = {
            let mut query=tx.prepare("SELECT o.source,o.agent,MAX(p.last_good),GROUP_CONCAT(p.cause,'; ') FROM measurement_owners o LEFT JOIN measurement_positions p ON p.source=o.source WHERE o.disabled=0 GROUP BY o.source ORDER BY o.source").map_err(sql)?;
            query.query_map([],|r|Ok(MeasurementSource {source:r.get(0)?,agent:r.get(1)?,last_good:r.get(2)?,cause:r.get(3)?,coverage:vec!["earlier missing history uncovered; execution spans unavailable unless emitted to this Attempt's collector; roundup lifetimes and waits are in time_evidence; vendor intervals use source wall time".into()]})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?
        };
        {
            let mut query = tx.prepare("SELECT source,agent,observed,(SELECT GROUP_CONCAT(cause,'; ') FROM measurement_positions p WHERE p.source=m.source) FROM measurement_revisions m WHERE revision IN (SELECT MAX(revision) FROM measurement_revisions WHERE source LIKE 'roundup:%' GROUP BY source) UNION ALL SELECT p.source,SUBSTR(p.source,9),NULL,GROUP_CONCAT(p.cause,'; ') FROM measurement_positions p WHERE p.source LIKE 'roundup:%' AND NOT EXISTS(SELECT 1 FROM measurement_revisions m WHERE m.source=p.source) GROUP BY p.source ORDER BY source").map_err(sql)?;
            sources.extend(query.query_map([], |r| Ok(MeasurementSource {source:r.get(0)?,agent:r.get(1)?,last_good:r.get(2)?,cause:r.get(3)?,coverage:vec!["roundup-observed lifetimes and blocking waits; end unknown after interruption; placement fixed at start".into()]})).map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?);
        }
        tx.commit().map_err(sql)?;
        Ok(Measurements {
            project: project.to_string_lossy().into_owned(),
            cause: self.measurement_failure.clone(),
            revision,
            contributions,
            time_evidence,
            sources,
        })
    }
}

fn home(tree: &[RailNode], id: &str) -> Option<String> {
    let mut node = tree.iter().find(|n| n.id == id)?;
    loop {
        if node.kind == NodeKind::Workstream {
            return Some(node.id.clone());
        }
        node = tree.iter().find(|n| Some(&n.id) == node.parent.as_ref())?;
    }
}

fn accept(
    db: &Connection,
    owner: &Owner,
    contribution: Contribution,
    attempt: Option<&str>,
    now: i64,
) -> Result<(), RpcError> {
    if db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM measurement_erased WHERE identity=?1)",
            [&contribution.identity],
            |r| r.get::<_, bool>(0),
        )
        .map_err(sql)?
    {
        return Ok(());
    }
    let existing:Option<(String,Option<String>,String)>=db.query_row("SELECT agent,home,maker FROM measurement_revisions WHERE identity=?1 ORDER BY revision LIMIT 1",[&contribution.identity],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(sql)?;
    if existing
        .as_ref()
        .is_some_and(|(agent, _, _)| agent != &owner.agent)
    {
        return Err(RpcError::conflict(
            "measurement identity already belongs to another Agent",
        ));
    }
    let (home, maker) = existing
        .as_ref()
        .map_or((&owner.home, &owner.maker), |(_, home, maker)| {
            (home, maker)
        });
    db.execute("INSERT OR IGNORE INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![contribution.identity,contribution.revision,owner.source,owner.agent,attempt,home,maker,now,serde_json::to_string(&contribution.value).map_err(RpcError::internal)?,serde_json::to_string(&contribution.coverage).map_err(RpcError::internal)?]).map_err(sql)?;
    Ok(())
}

/// One Project's local observation clock and active facts. This connection never takes
/// Rail/Attempt/Decision locks, so passive retention cannot reenter a lifecycle owner.
pub(crate) struct Timing {
    db: Connection,
    bus: Bus,
    clock: crate::Clock,
    monotonic: Arc<dyn Fn() -> u128 + Send + Sync>,
    lifetime: String,
    active: HashMap<String, Measurement>,
    launches: HashMap<String, Measurement>,
    failures: HashMap<String, String>,
}

/// Ends only a measured blocking call. Dropping it never controls the operation.
pub struct MeasurementWait {
    timing: Arc<Mutex<Timing>>,
    identity: String,
}

impl Drop for MeasurementWait {
    fn drop(&mut self) {
        self.timing
            .lock()
            .expect("measurement timing lock")
            .end(&self.identity);
    }
}

impl Timing {
    pub(crate) fn open(path: &Path, bus: Bus, clock: crate::Clock) -> Result<Self, OpenError> {
        let db = Connection::open(path)?;
        // A busy measurement store reports a collection failure; it cannot hold up an
        // acknowledgement/answer waiting for a writer in the Agent lifecycle.
        db.busy_timeout(Duration::ZERO)?;
        let mut nonce = [0; 16];
        getrandom::fill(&mut nonce).map_err(|e| std::io::Error::other(e.to_string()))?;
        let begun = Instant::now();
        let mut timing = Self {
            db,
            bus,
            clock,
            monotonic: Arc::new(move || begun.elapsed().as_nanos()),
            lifetime: nonce.iter().map(|b| format!("{b:02x}")).collect(),
            active: HashMap::new(),
            launches: HashMap::new(),
            failures: HashMap::new(),
        };
        timing.interrupt()?;
        Ok(timing)
    }

    pub(crate) fn set_monotonic(&mut self, clock: impl Fn() -> u128 + Send + Sync + 'static) {
        self.monotonic = Arc::new(clock);
    }

    pub(crate) fn set_clock(&mut self, clock: crate::Clock) {
        self.clock = clock;
    }

    fn point(&self) -> contracts::project::ClockPoint {
        contracts::project::ClockPoint {
            unix_ms: (self.clock)(),
            monotonic_ns: (self.monotonic)().to_string(),
        }
    }

    fn interrupt(&mut self) -> Result<(), OpenError> {
        use contracts::project::{MeasurementValue, TimeState};
        let facts = {
            let mut query = self.db.prepare("SELECT identity,source,source_revision,agent,attempt,home,maker,observed,value,coverage FROM measurement_revisions WHERE revision IN (SELECT MAX(revision) FROM measurement_revisions GROUP BY identity)")?;
            query
                .query_map([], |r| {
                    Ok(Measurement {
                        identity: r.get(0)?,
                        source: r.get(1)?,
                        source_revision: r.get(2)?,
                        agent: r.get(3)?,
                        attempt: r.get(4)?,
                        home: r.get(5)?,
                        maker: r.get(6)?,
                        observed: r.get(7)?,
                        value: serde_json::from_str(&r.get::<_, String>(8)?).map_err(|e| {
                            rusqlite::Error::FromSqlConversionFailure(
                                8,
                                rusqlite::types::Type::Text,
                                Box::new(e),
                            )
                        })?,
                        coverage: serde_json::from_str(&r.get::<_, String>(9)?).map_err(|e| {
                            rusqlite::Error::FromSqlConversionFailure(
                                9,
                                rusqlite::types::Type::Text,
                                Box::new(e),
                            )
                        })?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        for mut fact in facts {
            if let MeasurementValue::Observed { state, .. } = &mut fact.value
                && *state == TimeState::Active
            {
                *state = TimeState::Interrupted;
                fact.coverage.push(
                    "outage: last observation retained; end unknown; clock lifetimes incomparable"
                        .into(),
                );
                self.persist(&mut fact)
                    .map_err(|e| std::io::Error::other(e.message))?;
            }
        }
        Ok(())
    }

    pub(crate) fn begin(
        &mut self,
        agent: &str,
        attempt: &str,
        activity: contracts::project::TimedActivity,
    ) -> Option<String> {
        let identity = match &activity {
            contracts::project::TimedActivity::Attempt => {
                format!("roundup:attempt:{agent}:{attempt}")
            }
            contracts::project::TimedActivity::Startup => {
                format!("roundup:startup:{agent}:{attempt}")
            }
            contracts::project::TimedActivity::Idle { status_revision } => {
                format!("roundup:idle:{agent}:{attempt}:{status_revision}")
            }
            contracts::project::TimedActivity::Decision { decision } => {
                format!("roundup:decision:{}:{decision}", self.lifetime)
            }
            contracts::project::TimedActivity::Coordination { message } => format!(
                "roundup:coordination:{}:{agent}:{attempt}:{message}",
                self.lifetime
            ),
        };
        if self.active.contains_key(&identity) {
            return Some(identity);
        }
        let result = if let Some(mut fact) = self.launches.remove(&identity) {
            self.progress(&mut fact, false);
            if let Err(error) = self.persist(&mut fact) {
                self.record_failure(&identity, &fact.source, error.message);
            }
            Ok(Some(fact))
        } else {
            self.begin_fact(&identity, agent, attempt, activity, true)
        };
        match result {
            Ok(Some(fact)) => {
                self.active.insert(identity.clone(), fact);
                Some(identity)
            }
            Ok(None) => None,
            Err(e) => {
                self.record_failure(&identity, &format!("roundup:{agent}"), e.message);
                None
            }
        }
    }

    pub(crate) fn prepare_attempt(&mut self, agent: &str, attempt: &str) {
        for (kind, activity) in [
            ("attempt", contracts::project::TimedActivity::Attempt),
            ("startup", contracts::project::TimedActivity::Startup),
        ] {
            let identity = format!("roundup:{kind}:{agent}:{attempt}");
            match self.begin_fact(&identity, agent, attempt, activity, false) {
                Ok(Some(fact)) => {
                    self.launches.insert(identity, fact);
                }
                Ok(None) => {}
                Err(error) => {
                    self.record_failure(&identity, &format!("roundup:{agent}"), error.message)
                }
            }
        }
    }

    pub(crate) fn abandon_attempt(&mut self, agent: &str, attempt: &str) {
        self.launches
            .retain(|_, fact| fact.agent != agent || fact.attempt.as_deref() != Some(attempt));
    }

    pub(crate) fn acknowledge_attempt(&mut self, agent: &str, attempt: &str) {
        use contracts::project::{MeasurementValue, TimeState, TimedActivity};
        let phases: Vec<_> = self
            .launches
            .iter()
            .filter(|(_, fact)| {
                fact.agent == agent
                    && fact.attempt.as_deref() == Some(attempt)
                    && matches!(
                        fact.value,
                        MeasurementValue::Observed {
                            activity: TimedActivity::Idle { .. },
                            ..
                        }
                    )
            })
            .map(|(identity, _)| identity.clone())
            .collect();
        for identity in phases {
            let mut fact = self
                .launches
                .remove(&identity)
                .expect("provisional idle phase");
            let active = matches!(
                fact.value,
                MeasurementValue::Observed {
                    state: TimeState::Active,
                    ..
                }
            );
            if active {
                self.progress(&mut fact, false);
            }
            let failed = if let Err(error) = self.persist(&mut fact) {
                self.record_failure(&identity, &fact.source, error.message);
                true
            } else {
                false
            };
            if active || failed {
                self.active.insert(identity, fact);
            }
        }
        self.begin(agent, attempt, TimedActivity::Attempt);
        if let Some(identity) = self.begin(agent, attempt, TimedActivity::Startup) {
            self.end(&identity);
        }
    }

    pub(crate) fn observe_status(
        &mut self,
        event: &contracts::agent::StatusEvent,
        acknowledged: bool,
    ) {
        use contracts::project::{MeasurementValue, TimeState, TimedActivity};
        let idle: Vec<_> = self
            .active
            .iter()
            .chain(self.launches.iter())
            .filter(|(_, fact)| {
                fact.agent == event.id
                    && fact.attempt.as_deref() == Some(&event.attempt)
                    && matches!(
                        fact.value,
                        MeasurementValue::Observed {
                            activity: TimedActivity::Idle { .. },
                            state: TimeState::Active,
                            ..
                        }
                    )
            })
            .map(|(identity, _)| identity.clone())
            .collect();
        if event.status.kind == contracts::Kind::Idle {
            if idle.is_empty() {
                let activity = TimedActivity::Idle {
                    status_revision: event.status_revision.clone(),
                };
                if acknowledged {
                    self.begin(&event.id, &event.attempt, activity);
                } else {
                    let identity = format!(
                        "roundup:idle:{}:{}:{}",
                        event.id, event.attempt, event.status_revision
                    );
                    match self.begin_fact(&identity, &event.id, &event.attempt, activity, false) {
                        Ok(Some(fact)) => {
                            self.launches.insert(identity, fact);
                        }
                        Ok(None) => {}
                        Err(error) => self.record_failure(
                            &identity,
                            &format!("roundup:{}", event.id),
                            error.message,
                        ),
                    }
                }
            }
        } else {
            for identity in idle {
                if let Some(mut fact) = self.launches.remove(&identity) {
                    self.progress(&mut fact, true);
                    self.launches.insert(identity, fact);
                } else {
                    self.end(&identity);
                }
            }
        }
    }

    fn begin_fact(
        &mut self,
        identity: &str,
        agent: &str,
        attempt: &str,
        activity: contracts::project::TimedActivity,
        retain: bool,
    ) -> Result<Option<Measurement>, RpcError> {
        use contracts::project::{MeasurementValue, ObservedSegment, TimeState};
        // Never resurrect an explicitly erased fact, or replace an earlier lifetime.
        let exists = self.db.query_row("SELECT EXISTS(SELECT 1 FROM measurement_revisions WHERE identity=?1 UNION SELECT 1 FROM measurement_erased WHERE identity=?1)",[identity],|r|r.get::<_,bool>(0)).map_err(sql)?;
        if exists {
            return Ok(None);
        }
        let tree = super::load_nodes(&self.db, false)?;
        let node = find(&tree, agent)?;
        let point = self.point();
        let start = if retain
            && matches!(
                activity,
                contracts::project::TimedActivity::Attempt
                    | contracts::project::TimedActivity::Startup
            ) {
            None
        } else {
            Some(point.clone())
        };
        let mut fact = Measurement {
            identity: identity.into(), source: format!("roundup:{agent}"), source_revision: "0".into(),
            agent: agent.into(), attempt: Some(attempt.into()), home:home(&tree,agent), maker:node.name.clone(), observed:point.unix_ms,
            value: MeasurementValue::Observed {activity,clock_lifetime:self.lifetime.clone(),start,segments:vec![ObservedSegment{start:point.clone(),end:point}],state:TimeState::Active},
            coverage:vec!["local observed lifetime/phase/wait, not execution; placement fixed at start; unsplittable across Home moves; gaps over 2 seconds or clock disagreement are uncovered".into()],
        };
        if matches!(&fact.value, MeasurementValue::Observed { start: None, .. }) {
            fact.coverage.push(
                "Attempt launch start unknown; segments begin at first acknowledged observation"
                    .into(),
            );
        }
        if retain && let Err(error) = self.persist(&mut fact) {
            self.record_failure(&fact.identity, &fact.source, error.message);
        }
        Ok(Some(fact))
    }

    fn persist(&mut self, fact: &mut Measurement) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        let erased = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM measurement_erased WHERE identity=?1)",
                [&fact.identity],
                |r| r.get::<_, bool>(0),
            )
            .map_err(sql)?;
        let home_erased = if let Some(home) = &fact.home {
            !tx.query_row("SELECT EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=?1 AND kind='workstream')",[home],|r|r.get::<_,bool>(0)).map_err(sql)?
        } else {
            false
        };
        if erased || home_erased {
            tx.execute(
                "INSERT OR IGNORE INTO measurement_erased(identity) VALUES(?1)",
                [&fact.identity],
            )
            .map_err(sql)?;
            tx.commit().map_err(sql)?;
            self.failures.remove(&fact.identity);
            return Ok(());
        }
        fact.source_revision = tx
            .query_row("SELECT revision+1 FROM measurement_state", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(sql)?
            .to_string();
        tx.execute("INSERT INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![fact.identity,fact.source_revision,fact.source,fact.agent,fact.attempt,fact.home,fact.maker,fact.observed,serde_json::to_string(&fact.value).map_err(RpcError::internal)?,serde_json::to_string(&fact.coverage).map_err(RpcError::internal)?]).map_err(sql)?;
        tx.execute(
            "DELETE FROM measurement_positions WHERE source=?1 AND file=?2",
            params![fact.source, fact.identity],
        )
        .map_err(sql)?;
        tx.execute("UPDATE measurement_state SET revision=revision+1", [])
            .map_err(sql)?;
        tx.commit().map_err(sql)?;
        self.bus.emit(
            Actor::daemon(),
            EventData::MeasurementsChanged {
                revision: fact.source_revision.clone(),
            },
        );
        self.failures.remove(&fact.identity);
        Ok(())
    }

    fn record_failure(&mut self, identity: &str, source: &str, cause: String) {
        self.failures.insert(identity.into(), cause.clone());
        let save = || -> Result<Option<String>, RpcError> {
            let tx = self.db.unchecked_transaction().map_err(sql)?;
            let changed=tx.execute("INSERT INTO measurement_positions(source,file,position,cause) VALUES(?1,?2,'{}',?3) ON CONFLICT(source,file) DO UPDATE SET cause=excluded.cause WHERE cause IS NOT excluded.cause",params![source,identity,cause]).map_err(sql)?;
            let revision = if changed > 0 {
                tx.execute("UPDATE measurement_state SET revision=revision+1", [])
                    .map_err(sql)?;
                Some(
                    tx.query_row("SELECT revision FROM measurement_state", [], |r| {
                        r.get::<_, i64>(0)
                    })
                    .map_err(sql)?
                    .to_string(),
                )
            } else {
                None
            };
            tx.commit().map_err(sql)?;
            Ok(revision)
        };
        // A locked/unwritable database may prevent retaining its own failure. The
        // original cause stays in memory and pending facts retry on the next sample.
        if let Ok(Some(revision)) = save() {
            self.bus
                .emit(Actor::daemon(), EventData::MeasurementsChanged { revision });
        }
    }

    pub(crate) fn sample(&mut self) {
        let mut launches = std::mem::take(&mut self.launches);
        for fact in launches.values_mut() {
            if matches!(
                fact.value,
                contracts::project::MeasurementValue::Observed {
                    state: contracts::project::TimeState::Active,
                    ..
                }
            ) {
                self.progress(fact, false);
            }
        }
        self.launches = launches;
        let identities: Vec<_> = self.active.keys().cloned().collect();
        for identity in identities {
            self.advance(&identity, false);
        }
    }

    pub(crate) fn end_attempt(&mut self, agent: &str, attempt: &str) {
        self.abandon_attempt(agent, attempt);
        let identities: Vec<_> = self
            .active
            .iter()
            .filter(|(_, f)| f.agent == agent && f.attempt.as_deref() == Some(attempt))
            .map(|(id, _)| id.clone())
            .collect();
        for identity in identities {
            self.end(&identity);
        }
    }

    fn end(&mut self, identity: &str) {
        self.advance(identity, true);
    }

    fn advance(&mut self, identity: &str, ended: bool) {
        use contracts::project::{MeasurementValue, TimeState};
        let Some(mut fact) = self.active.remove(identity) else {
            return;
        };
        if let MeasurementValue::Observed { state, .. } = &fact.value
            && *state != TimeState::Active
        {
            if let Err(error) = self.persist(&mut fact) {
                self.record_failure(&fact.identity, &fact.source, error.message);
                self.active.insert(identity.into(), fact);
            }
            return;
        }
        if !self.progress(&mut fact, ended) {
            self.active.insert(identity.into(), fact);
            return;
        }
        let failed = if let Err(error) = self.persist(&mut fact) {
            self.record_failure(&fact.identity, &fact.source, error.message);
            true
        } else {
            false
        };
        if !ended || failed {
            self.active.insert(identity.into(), fact);
        }
    }

    fn progress(&self, fact: &mut Measurement, ended: bool) -> bool {
        use contracts::project::{MeasurementValue, ObservedSegment, TimeState};
        let point = self.point();
        if let MeasurementValue::Observed {
            segments, state, ..
        } = &mut fact.value
        {
            let last = &mut segments.last_mut().expect("observed start").end;
            let delta = point
                .monotonic_ns
                .parse::<u128>()
                .expect("local monotonic offset")
                .checked_sub(last.monotonic_ns.parse().expect("stored monotonic offset"));
            // A subscriber reads after every change. Sampling each such read would
            // generate another notification indefinitely; share the observer's cadence.
            if !ended
                && !self.failures.contains_key(&fact.identity)
                && delta
                    .is_some_and(|delta| delta < crate::measurement::OBSERVATION_PERIOD.as_nanos())
            {
                return false;
            }
            let wall_delta = i128::from(point.unix_ms) - i128::from(last.unix_ms);
            let comparable = delta.is_some_and(|d| {
                d <= 2_000_000_000
                    && (wall_delta - i128::try_from(d / 1_000_000).expect("bounded delta")).abs()
                        <= 250
            });
            if comparable {
                *last = point.clone();
            } else {
                fact.coverage.push(format!("uncovered observation gap: wall {}..{}, monotonic {}..{}; sleep, clock adjustment or observer unavailable",last.unix_ms,point.unix_ms,last.monotonic_ns,point.monotonic_ns));
                segments.push(ObservedSegment {
                    start: point.clone(),
                    end: point.clone(),
                });
            }
            if ended {
                *state = TimeState::Ended { at: point.clone() };
            }
        }
        fact.observed = point.unix_ms;
        true
    }

    pub(crate) fn failure(&self) -> Option<String> {
        if self.failures.is_empty() {
            None
        } else {
            Some(
                self.failures
                    .values()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join("; "),
            )
        }
    }
}

impl crate::Agents {
    /// Records a blocking routing await for an authenticated, live initiating Agent.
    /// The Message identity grants no authority. A failed retention never fails delivery.
    pub fn observe_coordination(&self, agent: &str, message: u32) -> Option<MeasurementWait> {
        let runs = self.shared.runs();
        let Some(crate::Slot::Running(run)) = runs.get(agent) else {
            return None;
        };
        if run.ended || run.closing || !run.session_started {
            return None;
        }
        let timing = Arc::clone(&self.shared.timing);
        let identity = timing.lock().expect("measurement timing lock").begin(
            agent,
            &run.attempt,
            contracts::project::TimedActivity::Coordination { message },
        )?;
        Some(MeasurementWait { timing, identity })
    }
}

pub(crate) fn decision_wait(
    timing: &Arc<Mutex<Timing>>,
    agent: &str,
    attempt: &str,
    decision: &str,
) -> Option<MeasurementWait> {
    let identity = timing.lock().expect("measurement timing lock").begin(
        agent,
        attempt,
        contracts::project::TimedActivity::Decision {
            decision: decision.into(),
        },
    )?;
    Some(MeasurementWait {
        timing: Arc::clone(timing),
        identity,
    })
}
