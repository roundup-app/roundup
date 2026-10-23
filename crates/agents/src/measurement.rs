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
        let mut idle = Vec::new();
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
                        TimedActivity::Startup => 4,
                        TimedActivity::Idle { .. } => {
                            for segment in segments {
                                idle.push(
                                    ns(&segment.start.monotonic_ns)?
                                        ..ns(&segment.end.monotonic_ns)?,
                                );
                            }
                            continue;
                        }
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
        // Idle is excluded even when late source evidence overlaps it; it is not a category.
        for range in idle {
            if range.start < range.end {
                partition.remove(range);
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

    fn point(seconds: u64) -> Value {
        json!({"unix_ms":1000+seconds*1000,"monotonic_ns":(seconds*1_000_000_000).to_string()})
    }
    fn attempt(start: u64, end: u64, active: bool) -> Value {
        json!({"kind":"observed","activity":{"kind":"attempt"},"clock_lifetime":"test","start":point(start),"segments":[{"start":point(start),"end":point(end)}],"state":if active {json!({"kind":"active"})} else {json!({"kind":"ended","at":point(end)})}})
    }

    #[tokio::test(start_paused = true)]
    async fn u3016c_idle_and_stopped_time_are_not_agent_time() {
        let w = World::new();
        let home = w.home();
        let id = w.agent(Some(&home));
        w.signal(
            &id,
            json!({"hook_event_name":"UserPromptSubmit","prompt":"work"}),
        );
        w.advance(2).await;
        w.signal(&id, json!({"hook_event_name":"Stop"}));
        w.advance(5).await;
        w.signal(
            &id,
            json!({"hook_event_name":"UserPromptSubmit","prompt":"tools"}),
        );
        w.advance(3).await;
        w.agents
            .shared
            .observe(Actor::daemon(), &id, "1", Observation::Stopped)
            .unwrap();
        for (category, start, end) in [("agent", 0, 2), ("tool", 7, 10)] {
            w.fact(&home, &id, category, &json!({"kind":"interval","category":category,"clock":"source-wall","start_unix_ns":((start+1)*1_000_000_000_u64).to_string(),"end_unix_ns":((end+1)*1_000_000_000_u64).to_string()}).to_string());
        }
        for _ in 0..2 {
            let read = w.summary(&home, "total").await;
            assert_eq!(read["time"]["elapsed_ns"], "10000000000");
            assert_eq!(read["time"]["summed_ns"], "5000000000");
            assert_eq!(read["time"]["execution_ns"], "2000000000");
            assert_eq!(read["time"]["tools_ns"], "3000000000");
            for category in ["human_ns", "coordination_ns", "other_ns", "unmeasured_ns"] {
                assert_eq!(read["time"][category], "0", "{category}");
            }
            assert_eq!(read["time"]["active"], false);
            w.advance(10).await;
        }
    }

    mod summary_tests;

    mod evidence_tests;
}
