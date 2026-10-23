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

/// Aggregate the collector's coherent latest revisions; source interpretation stays in the Adapter.
pub(crate) fn summarize(
    snapshot: contracts::project::Measurements,
    tree: Vec<RailNode>,
    params: contracts::project::MeasurementSummaryParams,
) -> Result<contracts::project::MeasurementSummary, RpcError> {
    use contracts::project::{MeasurementContributor, MeasurementSummary, MeasurementValue};
    if !tree
        .iter()
        .any(|node| node.id == params.home && node.kind == NodeKind::Workstream)
    {
        return Err(RpcError::not_found("Workstream"));
    }
    if params.offset > 0 && params.revision.is_none() {
        return Err(RpcError::new(
            rpc::code::INVALID_PARAMS,
            "Later pages require a measurement revision",
        ));
    }
    if params
        .revision
        .as_ref()
        .is_some_and(|revision| revision != &snapshot.revision)
    {
        return Err(RpcError::conflict(
            "Measurements changed; read again from offset zero",
        ));
    }
    // An Agent counts as running until its Status settles as done or error; a removed one is stopped.
    let running = |agent: &str| {
        tree.iter().any(|node| {
            node.id == agent
                && node
                    .status
                    .as_ref()
                    .is_some_and(|s| !matches!(s.kind, Kind::Done | Kind::Error))
        })
    };
    let mut contributors =
        std::collections::BTreeMap::<String, (String, TokenSum, Vec<String>)>::new();
    // A source can fail before retaining any fact. Keep that contributor and its failure visible.
    for source in &snapshot.sources {
        let Some(maker) = tree.iter().find(|node| node.id == source.agent) else {
            continue;
        };
        let mut node = maker;
        while node.kind != NodeKind::Workstream {
            let Some(parent) = tree
                .iter()
                .find(|parent| Some(&parent.id) == node.parent.as_ref())
            else {
                break;
            };
            node = parent;
        }
        if node.kind == NodeKind::Workstream && node.id == params.home {
            contributors
                .entry(source.agent.clone())
                .or_insert_with(|| (maker.name.clone(), TokenSum::default(), Vec::new()));
        }
    }
    let facts: Vec<_> = snapshot
        .contributions
        .iter()
        .chain(&snapshot.time_evidence)
        .filter(|fact| fact.home.as_ref() == Some(&params.home))
        .collect();
    let mut last_observed = None;
    for fact in snapshot
        .contributions
        .iter()
        .chain(&snapshot.time_evidence)
        .filter(|fact| fact.home.as_ref() == Some(&params.home))
    {
        last_observed = Some(last_observed.unwrap_or(i64::MIN).max(fact.observed));
        let row = contributors
            .entry(fact.agent.clone())
            .or_insert_with(|| (fact.maker.clone(), TokenSum::default(), Vec::new()));
        row.2.extend(fact.coverage.iter().cloned());
        if let MeasurementValue::Request { usage, .. } = &fact.value {
            row.1.add(usage);
        }
    }
    let mut causes: Vec<_> = snapshot.cause.iter().cloned().collect();
    let mut total = TokenSum::default();
    for (agent, (_, tokens, coverage)) in &mut contributors {
        if tokens.requests == 0 {
            // Positive absence of request evidence is unknown consumption, never a measured zero.
            tokens.add(&contracts::project::Consumed {
                input: None,
                output: None,
                cache_read: None,
                cache_write: None,
            });
            coverage.push("No retained request measurements for this contributor".into());
        }
        for source in snapshot
            .sources
            .iter()
            .filter(|source| &source.agent == agent)
        {
            coverage.extend(source.coverage.iter().cloned());
            coverage.extend(source.cause.iter().cloned());
            causes.extend(
                source
                    .cause
                    .iter()
                    .map(|cause| format!("{}: {cause}", source.source)),
            );
        }
        coverage.sort();
        coverage.dedup();
        for i in 0..5 {
            total.known[i] += tokens.known[i];
            total.missing[i] += tokens.missing[i];
        }
    }
    let mut ranked: Vec<_> = contributors.into_iter().collect();
    let category = match params.category {
        contracts::project::ConsumedCategory::Input => 0,
        contracts::project::ConsumedCategory::Output => 1,
        contracts::project::ConsumedCategory::CacheRead => 2,
        contracts::project::ConsumedCategory::CacheWrite => 3,
        contracts::project::ConsumedCategory::Total => 4,
    };
    ranked.sort_by(|(left, (_, a, _)), (right, (_, b, _))| {
        (a.missing[category] != 0)
            .cmp(&(b.missing[category] != 0))
            .then_with(|| b.known[category].cmp(&a.known[category]))
            .then_with(|| left.cmp(right))
    });
    let count = u32::try_from(ranked.len()).map_err(RpcError::internal)?;
    if params.offset > count {
        return Err(RpcError::new(
            rpc::code::INVALID_PARAMS,
            "Offset exceeds contributor count",
        ));
    }
    let next = params.offset.saturating_add(20);
    let mut coverage: Vec<_> = ranked
        .iter()
        .flat_map(|(_, (_, _, coverage))| coverage.iter().cloned())
        .collect();
    coverage.push(
        "Only retained observations are counted; earlier missing history is uncovered".into(),
    );
    coverage.sort();
    coverage.dedup();
    causes.sort();
    causes.dedup();
    let rows = ranked
        .into_iter()
        .skip(params.offset as usize)
        .take(20)
        .map(|(agent, (maker, tokens, coverage))| {
            Ok(MeasurementContributor {
                removed: !tree.iter().any(|node| node.id == agent),
                agent: agent.clone(),
                maker,
                tokens: tokens.finish()?,
                cost: cost_totals(
                    &facts
                        .iter()
                        .copied()
                        .filter(|fact| fact.agent == agent)
                        .collect::<Vec<_>>(),
                ),
                time: time_totals(
                    &facts
                        .iter()
                        .copied()
                        .filter(|fact| fact.agent == agent)
                        .collect::<Vec<_>>(),
                    &running,
                )?,
                coverage,
            })
        })
        .collect::<Result<Vec<_>, RpcError>>()?;
    Ok(MeasurementSummary {
        project: snapshot.project,
        home: params.home,
        revision: snapshot.revision,
        category: params.category,
        cause: (!causes.is_empty()).then(|| causes.join("; ")),
        last_observed,
        tokens: total.finish()?,
        cost: cost_totals(&facts),
        time: time_totals(&facts, &running)?,
        coverage,
        contributors: count,
        rows,
        next_offset: (next < count).then_some(next),
    })
}

fn cost_totals(facts: &[&contracts::project::Measurement]) -> contracts::project::MeasurementCost {
    use bigdecimal::BigDecimal;
    use contracts::project::{MeasurementCost, MeasurementValue, ReferenceEstimate};
    let mut result = MeasurementCost::default();
    for fact in facts {
        match &fact.value {
            MeasurementValue::Money { reported } => result.reported.push(reported.clone()),
            MeasurementValue::Request { usage, cost } => {
                let Some(cost) = cost else {
                    result
                        .unavailable
                        .push(format!("{}: request cost evidence unavailable", fact.maker));
                    continue;
                };
                result.unavailable.extend(
                    cost.unavailable
                        .iter()
                        .map(|cause| format!("{}: {cause}", fact.maker)),
                );
                if let Some(reported) = &cost.reported {
                    result.reported.push(reported.clone());
                }
                let estimate = || -> Option<ReferenceEstimate> {
                    let mut rates = cost.reference.clone()?;
                    if rates.model.is_empty() {
                        rates.model = cost.model.clone().unwrap_or_default();
                    }
                    let rates = &rates;
                    if rates.per_tokens == 0 {
                        return None;
                    }
                    let mut missing = Vec::new();
                    let (five, hour) = if usage.cache_write == Some(0) {
                        (Some(0), Some(0))
                    } else if cost
                        .cache_write
                        .five_minute
                        .zip(cost.cache_write.one_hour)
                        .and_then(|(a, b)| a.checked_add(b))
                        == usage.cache_write
                    {
                        (cost.cache_write.five_minute, cost.cache_write.one_hour)
                    } else {
                        (None, None)
                    };
                    let mut amount = BigDecimal::from(0);
                    for (name, count, rate) in [
                        ("input", usage.input, &rates.input),
                        ("output", usage.output, &rates.output),
                        ("cache read", usage.cache_read, &rates.cache_read),
                        (
                            "five-minute cache write",
                            five,
                            &rates.cache_write_five_minute,
                        ),
                        ("one-hour cache write", hour, &rates.cache_write_one_hour),
                    ] {
                        match (count, rate.parse::<BigDecimal>()) {
                            (Some(count), Ok(rate)) if rate >= 0 => {
                                amount += BigDecimal::from(count) * rate
                            }
                            _ => missing.push(name.to_owned()),
                        }
                    }
                    Some(ReferenceEstimate {
                        amount: (amount / BigDecimal::from(rates.per_tokens))
                            .normalized()
                            .to_plain_string(),
                        missing,
                        rates: rates.clone(),
                    })
                };
                if let Some(estimate) = estimate() {
                    if let Some(existing) = result
                        .reference
                        .iter_mut()
                        .find(|e| e.rates == estimate.rates)
                    {
                        // Both values were constructed with BigDecimal in this function.
                        let sum = existing
                            .amount
                            .parse::<BigDecimal>()
                            .expect("constructed estimate")
                            + estimate
                                .amount
                                .parse::<BigDecimal>()
                                .expect("constructed estimate");
                        existing.amount = sum.normalized().to_plain_string();
                        existing.missing.extend(estimate.missing);
                        existing.missing.sort();
                        existing.missing.dedup();
                    } else {
                        result.reference.push(estimate);
                    }
                } else {
                    result.unavailable.push(format!("{}: reference estimate unavailable for this request (rate, token or cache-write class missing)",fact.maker));
                }
            }
            _ => {}
        }
    }
    if !facts
        .iter()
        .any(|f| matches!(f.value, MeasurementValue::Request { .. }))
    {
        result
            .unavailable
            .push("No retained request cost measurements".into());
    }
    let mut reported: Vec<contracts::project::ReportedMoney> = Vec::new();
    for money in result.reported {
        if let Some(previous) = reported.iter_mut().find(|previous| {
            money.currency.is_some()
                && previous.currency == money.currency
                && previous.source == money.source
                && previous.basis == money.basis
                && previous.scope == money.scope
        }) {
            match (
                previous.amount.parse::<BigDecimal>(),
                money.amount.parse::<BigDecimal>(),
            ) {
                (Ok(a), Ok(b)) => previous.amount = (a + b).normalized().to_plain_string(),
                _ => result
                    .unavailable
                    .push("Reported amount could not be reconciled".into()),
            }
        } else {
            reported.push(money);
        }
    }
    result.reported = reported;
    result.unavailable.sort();
    result.unavailable.dedup();
    result
}

fn time_totals(
    facts: &[&contracts::project::Measurement],
    running: &dyn Fn(&str) -> bool,
) -> Result<contracts::project::MeasurementTime, RpcError> {
    use contracts::project::{Execution, MeasurementValue, TimeState, TimedActivity};
    let ns = |s: &str| s.parse::<u128>().map_err(RpcError::internal);
    let mut totals = [0_u128; 6];
    let mut first = None::<i64>;
    let mut last = None::<i64>;
    let mut unknown_start = false;
    let mut active = false;
    let mut adjusted = false;
    let mut coverage = Vec::new();
    for attempt in facts {
        let MeasurementValue::Observed {
            activity: TimedActivity::Attempt,
            clock_lifetime,
            start,
            segments,
            state,
        } = &attempt.value
        else {
            continue;
        };
        if *state == TimeState::Active {
            if running(&attempt.agent) {
                active = true;
            } else {
                coverage.push("Attempt end unknown after its Agent stopped".into());
            }
        }
        unknown_start |= start.is_none();
        let Some(begin) = start
            .as_ref()
            .or_else(|| segments.first().map(|s| &s.start))
        else {
            continue;
        };
        let Some(end) = segments.last().map(|s| &s.end) else {
            continue;
        };
        first = Some(first.unwrap_or(i64::MAX).min(begin.unix_ms));
        last = Some(last.unwrap_or(i64::MIN).max(end.unix_ms));
        let bounds = ns(&begin.monotonic_ns)?..ns(&end.monotonic_ns)?;
        let wall = (i128::from(end.unix_ms) - i128::from(begin.unix_ms)) * 1_000_000;
        let clock_adjusted = bounds
            .end
            .checked_sub(bounds.start)
            .map(|duration| {
                i128::try_from(duration).map(|duration| (wall - duration).abs() > 250_000_000)
            })
            .transpose()
            .map_err(RpcError::internal)?
            .unwrap_or(true);
        adjusted |= clock_adjusted;
        if bounds.start >= bounds.end {
            continue;
        }
        let mut partition = rangemap::RangeMap::new();
        // The residual is explicitly unmeasured, including discontinuities between samples.
        partition.insert(bounds.clone(), 5_usize);
        let mut evidence = Vec::new();
        for fact in facts
            .iter()
            .filter(|f| f.agent == attempt.agent && f.attempt == attempt.attempt)
        {
            match &fact.value {
                MeasurementValue::Observed {
                    activity,
                    clock_lifetime: clock,
                    segments,
                    ..
                } if clock == clock_lifetime => {
                    let category = match activity {
                        TimedActivity::Decision { .. } => 0,
                        TimedActivity::Coordination { .. } => 2,
                        TimedActivity::Startup | TimedActivity::Idle { .. } => 4,
                        TimedActivity::Attempt => continue,
                    };
                    for segment in segments {
                        evidence.push((
                            category,
                            ns(&segment.start.monotonic_ns)?..ns(&segment.end.monotonic_ns)?,
                        ));
                    }
                }
                MeasurementValue::Interval {
                    category,
                    start_unix_ns,
                    end_unix_ns,
                    ..
                } => {
                    if clock_adjusted {
                        coverage.push("Source wall intervals cannot be aligned during a wall-clock adjustment; retained evidence remains available, duration is unmeasured".into());
                        continue;
                    }
                    let source_start = start_unix_ns.parse::<i128>().map_err(RpcError::internal)?;
                    let source_end = end_unix_ns.parse::<i128>().map_err(RpcError::internal)?;
                    // Align only inside continuously sampled segments. Wall-clock jumps/outages
                    // must not turn source endpoints into execution through an uncovered gap.
                    for segment in segments {
                        let wall_start = i128::from(segment.start.unix_ms) * 1_000_000;
                        let wall_end = i128::from(segment.end.unix_ms) * 1_000_000;
                        let left = source_start.max(wall_start);
                        let right = source_end.min(wall_end);
                        if left < right {
                            let anchor = ns(&segment.start.monotonic_ns)?;
                            let left = anchor
                                + u128::try_from(left - wall_start).map_err(RpcError::internal)?;
                            let right = (anchor
                                + u128::try_from(right - wall_start)
                                    .map_err(RpcError::internal)?)
                            .min(ns(&segment.end.monotonic_ns)?);
                            evidence.push((
                                if *category == Execution::Tool { 1 } else { 3 },
                                left..right,
                            ));
                        }
                    }
                }
                _ => {}
            }
        }
        // Lower priority first; RangeMap overwrites overlaps and unions equal categories.
        evidence.sort_by_key(|(priority, _)| std::cmp::Reverse(*priority));
        for (category, range) in evidence {
            let range = range.start.max(bounds.start)..range.end.min(bounds.end);
            if range.start < range.end {
                partition.insert(range, category);
            }
        }
        for (range, category) in partition.iter() {
            totals[*category] += range.end - range.start;
        }
        coverage.extend(attempt.coverage.iter().cloned());
        if *state == TimeState::Interrupted {
            coverage.push("Attempt end unknown after an observation outage".into());
        }
    }
    if unknown_start {
        coverage.push(
            "Historical Attempt start unavailable; summed time covers observed bounds only".into(),
        );
    }
    if totals[5] > 0 {
        coverage.push("Unmeasured duration has no positive category evidence".into());
    }
    coverage.sort();
    coverage.dedup();
    let elapsed = if unknown_start || adjusted {
        if adjusted {
            coverage.push("Wall-clock adjustment makes elapsed time unavailable".into());
        }
        None
    } else {
        match (first, last) {
            (Some(first), Some(last)) if last >= first => {
                Some(((i128::from(last) - i128::from(first)) * 1_000_000).to_string())
            }
            (None, None) if facts.is_empty() => Some("0".into()),
            _ => {
                coverage.push("No comparable observed Attempt start/end; summed time covers retained bounds only".into());
                None
            }
        }
    };
    Ok(contracts::project::MeasurementTime {
        elapsed_ns: elapsed,
        summed_ns: totals.iter().sum::<u128>().to_string(),
        execution_ns: totals[3].to_string(),
        tools_ns: totals[1].to_string(),
        human_ns: totals[0].to_string(),
        coordination_ns: totals[2].to_string(),
        other_ns: totals[4].to_string(),
        unmeasured_ns: totals[5].to_string(),
        active,
        coverage,
    })
}

#[derive(Default)]
struct TokenSum {
    known: [u128; 5],
    missing: [usize; 5],
    requests: usize,
}

impl TokenSum {
    fn add(&mut self, usage: &contracts::project::Consumed) {
        self.requests += 1;
        let categories = [
            usage.input,
            usage.output,
            usage.cache_read,
            usage.cache_write,
        ];
        for (index, value) in categories.into_iter().enumerate() {
            if let Some(value) = value {
                self.known[index] += u128::from(value);
                self.known[4] += u128::from(value);
            } else {
                self.missing[index] += 1;
            }
        }
        self.missing[4] += usize::from(categories.iter().any(Option::is_none));
    }
    fn finish(&self) -> Result<contracts::project::ConsumedTotals, RpcError> {
        use contracts::project::{ConsumedSubtotal, ConsumedTotals};
        let subtotal = |index: usize| -> Result<ConsumedSubtotal, RpcError> {
            Ok(ConsumedSubtotal {
                known: self.known[index].to_string(),
                missing: u32::try_from(self.missing[index]).map_err(RpcError::internal)?,
            })
        };
        Ok(ConsumedTotals {
            input: subtotal(0)?,
            output: subtotal(1)?,
            cache_read: subtotal(2)?,
            cache_write: subtotal(3)?,
            total: subtotal(4)?,
        })
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
        fn request(&self, home: &str, agent: &str, identity: &str, usage: [Option<u64>; 4]) {
            let value = json!({"kind":"request", "usage": {
                "input": usage[0], "output": usage[1], "cache_read": usage[2], "cache_write":usage[3]
            }, "cost":null}).to_string();
            self.fact(home, agent, identity, &value);
        }
        fn fact(&self, home: &str, agent: &str, identity: &str, value: &str) {
            let mut db = rusqlite::Connection::open(self.dir.path().join("agents.db")).unwrap();
            let tx = db.transaction().unwrap();
            tx.execute("INSERT OR IGNORE INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES(?1,?2,'fixture',?3,'1',?4,?5,1000,?2,'[]')",rusqlite::params![identity,value,agent,home,format!("Maker {agent}")]).unwrap();
            tx.execute("UPDATE measurement_state SET revision=revision+1", [])
                .unwrap();
            tx.commit().unwrap();
        }
        fn home(&self) -> String {
            self.agents
                .shared
                .rail()
                .insert(NodeKind::Workstream, "Measured work", None, None)
                .unwrap()
                .id
        }
        async fn summary(&self, home: &str, category: &str) -> Value {
            self.agents
                .call(
                    &self.ctx,
                    "project.measurementSummary",
                    json!({"home":home, "category":category}),
                )
                .await
                .unwrap()
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

    #[tokio::test]
    async fn u3016c_time_categories_use_observed_intervals() {
        let w = World::new();
        let home = w.home();
        let db = rusqlite::Connection::open(w.dir.path().join("agents.db")).unwrap();
        let point = |seconds: u64| json!({"unix_ms":1000+seconds*1000,"monotonic_ns":(seconds*1_000_000_000).to_string()});
        let observed = |activity: Value, start, end| json!({"kind":"observed","activity":activity,"clock_lifetime":"test","start":point(start),"segments":[{"start":point(start),"end":point(end)}],"state":{"kind":"ended","at":point(end)}});
        let mut facts = vec![
            ("a", observed(json!({"kind":"attempt"}), 0, 10)),
            ("b", observed(json!({"kind":"attempt"}), 0, 10)),
            (
                "a",
                observed(json!({"kind":"decision","decision":"question"}), 6, 8),
            ),
            (
                "a",
                observed(json!({"kind":"coordination","message":1}), 8, 9),
            ),
        ];
        for (agent, category, start, end) in [
            ("a", "agent", 0, 10),
            ("b", "agent", 0, 10),
            ("a", "tool", 2, 6),
            ("a", "tool", 3, 5),
        ] {
            facts.push((agent,json!({"kind":"interval","category":category,"clock":"source-wall","start_unix_ns":((start+1)*1_000_000_000_u64).to_string(),"end_unix_ns":((end+1)*1_000_000_000_u64).to_string()})));
        }
        for (i, (agent, value)) in facts.iter().enumerate() {
            db.execute("INSERT INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES(?1,'1','fixture',?2,'1',?3,?2,11000,?4,'[]')",rusqlite::params![format!("time-{i}"),agent,home,value.to_string()]).unwrap();
        }
        let read = w.summary(&home, "total").await;
        assert_eq!(read["time"]["elapsed_ns"], "10000000000");
        assert_eq!(read["time"]["summed_ns"], "20000000000");
        assert_eq!(read["time"]["execution_ns"], "13000000000");
        assert_eq!(read["time"]["tools_ns"], "4000000000");
        assert_eq!(read["time"]["human_ns"], "2000000000");
        assert_eq!(read["time"]["coordination_ns"], "1000000000");
        assert_eq!(read["time"]["other_ns"], "0");
        assert_eq!(read["time"]["unmeasured_ns"], "0");
    }

    fn point(seconds: u64) -> Value {
        json!({"unix_ms":1000+seconds*1000,"monotonic_ns":(seconds*1_000_000_000).to_string()})
    }
    fn attempt(start: u64, end: u64, active: bool) -> Value {
        json!({"kind":"observed","activity":{"kind":"attempt"},"clock_lifetime":"test","start":point(start),"segments":[{"start":point(start),"end":point(end)}],"state":if active {json!({"kind":"active"})} else {json!({"kind":"ended","at":point(end)})}})
    }

    #[tokio::test]
    async fn u3016c_elapsed_and_parallel_time_are_distinct() {
        let w = World::new();
        let home = w.home();
        let live = w.agent(Some(&home));
        w.fact(&home, "a", "first", &attempt(0, 10, false).to_string());
        w.fact(&home, "b", "parallel", &attempt(0, 10, false).to_string());
        w.fact(&home, &live, "resumed", &attempt(15, 20, true).to_string());
        let read = w.summary(&home, "total").await;
        assert_eq!(read["time"]["elapsed_ns"], "20000000000");
        assert_eq!(read["time"]["summed_ns"], "25000000000");
        assert_eq!(read["time"]["active"], true);
        assert_eq!(read["time"]["unmeasured_ns"], "25000000000");
    }

    #[tokio::test]
    async fn u3016i_unknown_attempt_end_stops_the_clock_once_its_agent_stops() {
        let w = World::new();
        let home = w.home();
        let live = w.agent(Some(&home));
        w.fact(&home, &live, "open", &attempt(0, 10, true).to_string());
        let read = w.summary(&home, "total").await;
        assert_eq!(read["time"]["active"], true);
        w.signal(
            &live,
            json!({"hook_event_name":"SessionEnd","reason":"done"}),
        );
        let read = w.summary(&home, "total").await;
        assert_eq!(read["time"]["active"], false);
        assert!(read["time"]["coverage"].to_string().contains("end unknown"));
    }

    #[tokio::test]
    async fn u3016c_clock_gaps_and_late_intervals_are_honest() {
        let w = World::new();
        let home = w.home();
        let mut a = attempt(0, 10, false);
        a["segments"] =
            json!([{"start":point(0),"end":point(2)},{"start":point(8),"end":point(10)}]);
        w.fact(&home, "a", "first", &a.to_string());
        let execution = json!({"kind":"interval","category":"agent","clock":"source wall","start_unix_ns":"1000000000","end_unix_ns":"11000000000"});
        w.fact(&home, "a", "execution", &execution.to_string());
        w.fact(&home, "a", "execution", &execution.to_string());
        let read = w.summary(&home, "total").await;
        assert_eq!(read["time"]["execution_ns"], "4000000000");
        assert_eq!(read["time"]["unmeasured_ns"], "6000000000");
        let (reopened, ctx) = w.reopen();
        let read = reopened
            .call(&ctx, "project.measurementSummary", json!({"home":home}))
            .await
            .unwrap();
        assert_eq!(read["time"]["execution_ns"], "4000000000");
        a["segments"][1]["end"]["unix_ms"] = json!(9000);
        w.fact(&home, "a", "first", &a.to_string());
        let read = w.summary(&home, "total").await;
        assert_eq!(read["time"]["elapsed_ns"], Value::Null);
        assert_eq!(read["time"]["execution_ns"], "0");
        assert_eq!(read["time"]["summed_ns"], "10000000000");
    }

    #[tokio::test]
    async fn u3016b_token_totals_reconcile_by_source() {
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
        w.request(&home, &a, "a", [Some(100), Some(20), Some(400), Some(50)]);
        w.request(&home, &b, "b", [Some(200), Some(30), Some(0), Some(0)]);
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

    #[tokio::test]
    async fn u3016b_cost_basis_and_missing_coverage_are_explicit() {
        let w = World::new();
        let home = w.home();
        w.request(
            &home,
            "a",
            "priced",
            [Some(100), Some(20), Some(400), Some(50)],
        );
        w.request(&home, "b", "unknown", [Some(1); 4]);
        let db = rusqlite::Connection::open(w.dir.path().join("agents.db")).unwrap();
        let cost = json!({"model":"opaque","cache_write":{"five_minute":30,"one_hour":20},"reported":{"scope":"request","amount":"0.001","currency":"EUR","source":"fixture","basis":"source estimate"},"reference":{"version":"v1","date":"2026-10-21","currency":"USD","source":"https://example.com/rates","basis":"fixture per category","per_tokens":1000000,"input":"3","output":"15","cache_read":"0.3","cache_write_five_minute":"3.75","cache_write_one_hour":"6"},"unavailable":[]});
        db.execute("UPDATE measurement_revisions SET value=json_set(value,'$.cost',json(?1)) WHERE identity='priced'",[cost.to_string()]).unwrap();
        let read = w.summary(&home, "total").await;
        assert_eq!(read["cost"]["reference"][0]["amount"], "0.0009525");
        assert_eq!(read["cost"]["reference"][0]["rates"]["version"], "v1");
        assert_eq!(read["cost"]["reported"][0]["amount"], "0.001");
        assert_eq!(read["cost"]["reported"][0]["currency"], "EUR");
        assert!(!read["cost"]["unavailable"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn u3016b_partial_consumption_keeps_exact_subtotals() {
        let w = World::new();
        let home = w.home();
        w.request(
            &home,
            "unknown",
            "partial",
            [Some(u64::MAX), None, Some(0), Some(0)],
        );
        w.request(&home, "zero", "zero", [Some(0); 4]);
        let read = w.summary(&home, "output").await;
        assert_eq!(
            read["tokens"]["input"],
            json!({"known":"18446744073709551615", "missing":0})
        );
        assert_eq!(read["tokens"]["output"], json!({"known":"0", "missing":1}));
        assert_eq!(
            read["tokens"]["total"],
            json!({"known":"18446744073709551615", "missing":1})
        );
        assert_eq!(read["rows"][0]["agent"], "zero");
        assert_eq!(read["rows"][1]["agent"], "unknown");
        assert_eq!(read["rows"][1]["maker"], "Maker unknown");
        assert_eq!(read["rows"][1]["removed"], true);
    }

    #[tokio::test]
    async fn u3016e_category_rank_uses_latest_recorded_home_contributions() {
        let w = World::new();
        let home = w.home();
        let other = w.home();
        w.request(
            &home,
            "a",
            "one",
            [Some(100), Some(20), Some(400), Some(50)],
        );
        w.request(&home, "b", "two", [Some(200), Some(30), Some(0), Some(0)]);
        // An updated request replaces the older contribution; another Home is excluded.
        w.request(&home, "b", "two", [Some(200), Some(40), Some(0), Some(0)]);
        w.request(&other, "a", "later", [Some(999); 4]);
        let read = w.summary(&home, "output").await;
        assert_eq!(read["tokens"]["output"]["known"], "60");
        assert_eq!(read["tokens"]["total"]["known"], "810");
        assert_eq!(read["rows"][0]["agent"], "b");
        assert_eq!(read["rows"][1]["agent"], "a");
        assert_eq!(read["contributors"], 2);
    }

    #[tokio::test]
    async fn u3016e_pages_keep_all_contributors_at_one_revision() {
        let w = World::new();
        let home = w.home();
        let expected: Vec<_> = (0..1005).map(|i| format!("former-{i:04}")).collect();
        for agent in &expected {
            w.request(&home, agent, agent, [Some(3), Some(0), Some(0), Some(0)]);
        }
        let measured = std::time::Instant::now();
        let mut page = w.summary(&home, "total").await;
        assert_eq!(page["contributors"], 1005);
        assert_eq!(page["tokens"]["total"]["known"], "3015");
        let revision = page["revision"].clone();
        let mut ids = Vec::new();
        loop {
            let rows = page["rows"].as_array().unwrap();
            assert!(rows.len() <= 20);
            ids.extend(
                rows.iter()
                    .map(|row| row["agent"].as_str().unwrap().to_owned()),
            );
            if page["next_offset"].is_null() {
                break;
            }
            page = w
                .agents
                .call(
                    &w.ctx,
                    "project.measurementSummary",
                    json!({"home":home,"offset":page["next_offset"],"revision":revision}),
                )
                .await
                .unwrap();
            assert_eq!(page["revision"], revision);
        }
        eprintln!(
            "U3016e: 1,005 contributors, 51 coherent public pages: {:?}",
            measured.elapsed()
        );
        assert_eq!(ids, expected);
        w.request(&home, "new", "new", [Some(1); 4]);
        let stale = w
            .agents
            .call(
                &w.ctx,
                "project.measurementSummary",
                json!({"home":home,"offset":20,"revision":revision}),
            )
            .await
            .unwrap_err();
        assert_eq!(stale.code, rpc::code::CONFLICT);
    }

    #[tokio::test]
    async fn u3016e_unbound_pages_and_missing_workstreams_are_refused() {
        let w = World::new();
        let home = w.home();
        for params in [
            json!({"home":home,"offset":20}),
            json!({"home":home,"offset":1,"revision":"0"}),
            json!({"home":home,"category":"money"}),
        ] {
            assert_eq!(
                w.agents
                    .call(&w.ctx, "project.measurementSummary", params)
                    .await
                    .unwrap_err()
                    .code,
                rpc::code::INVALID_PARAMS
            );
        }
        assert_eq!(
            w.agents
                .call(
                    &w.ctx,
                    "project.measurementSummary",
                    json!({"home":"missing"})
                )
                .await
                .unwrap_err()
                .code,
            rpc::code::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn u3016d_summary_keeps_a_source_failure_before_first_measurement() {
        let w = World::new();
        let home = w.home();
        let id = w.agent(Some(&home));
        let db = rusqlite::Connection::open(w.dir.path().join("agents.db")).unwrap();
        db.execute("DELETE FROM measurement_revisions", []).unwrap();
        db.execute("INSERT INTO measurement_positions(source,file,position,last_good,cause) VALUES(?1,'fixture','{}',NULL,'fixture collection refused')", [format!("roundup:{id}")]).unwrap();
        let summary = w.summary(&home, "total").await;
        assert!(
            summary["cause"]
                .as_str()
                .unwrap()
                .contains("fixture collection refused")
        );
        assert_eq!(summary["rows"][0]["agent"], id);
        assert_eq!(
            summary["tokens"]["input"],
            json!({"known":"0", "missing":1})
        );
        assert_eq!(summary["last_observed"], Value::Null);
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
