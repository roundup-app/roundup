//! R16: one host, one observer, alternating immutable source revisions.
use std::collections::BTreeMap;
use std::future::Future;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::budget::{Budgets, Report, judge_all, load_per_cpu, median};
use crate::machine::{Class, Comparison};

pub type Error = Box<dyn std::error::Error>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Identity {
    pub host: String,
    pub boot: String,
    pub job: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Build {
    pub reference: String,
    pub daemon: PathBuf,
    pub rup: PathBuf,
    pub hashes: String,
}

/// External effects only. Production and deterministic fixtures use this same orchestration.
pub trait Environment {
    fn references(&mut self) -> impl Future<Output = Result<[String; 2], Error>>;
    fn identity(&mut self) -> Result<Identity, Error>;
    fn build(&mut self, reference: &str, side: &str) -> impl Future<Output = Result<Build, Error>>;
    fn measure(
        &mut self,
        build: &Build,
        turn: usize,
    ) -> impl Future<Output = Result<Report, Error>>;
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Invocation {
    pub side: String,
    pub identity: Identity,
    pub report: Report,
    pub exit: u8,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Skip {
    pub side: String,
    pub metric: String,
    pub load_per_cpu: f64,
    pub max_load_per_cpu: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Metric {
    pub metric: String,
    pub base: f64,
    pub head: f64,
    pub ceiling: f64,
    pub limit: Option<f64>,
    pub regressed: bool,
    pub over_limit: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Pair {
    pub mode: String,
    pub class: Class,
    pub identity: Identity,
    pub builds: [Build; 2],
    pub invocations: Vec<Invocation>,
    pub metrics: Vec<Metric>,
    pub skipped: Vec<Skip>,
    pub stored_misses: Vec<String>,
    pub passed: bool,
    pub clean: bool,
}

fn valid(report: &Report, budgets: &Budgets) -> Result<(), Error> {
    if report.cpus == 0
        || report.runs == 0
        || report.loads.len() != report.runs
        || report.loads.iter().any(|v| !v.is_finite() || *v < 0.0)
    {
        return Err("pair report: missing or invalid load input/count".into());
    }
    if report.metrics.values().any(|v| !v.is_finite() || *v < 0.0) {
        return Err("pair report: non-finite or negative metric".into());
    }
    for name in budgets.keys() {
        let value = report
            .metrics
            .get(name)
            .ok_or_else(|| format!("pair report: missing metric {name}"))?;
        let samples = report
            .per_run
            .get(name)
            .ok_or_else(|| format!("pair report: missing samples {name}"))?;
        if !value.is_finite()
            || *value < 0.0
            || samples.len() != report.runs
            || samples.iter().any(|v| !v.is_finite() || *v < 0.0)
            || median(samples) != *value
        {
            return Err(format!("pair report: invalid metric/samples {name}").into());
        }
    }
    Ok(())
}

/// A stored selection does no Git work. Pair builds both revisions before any sampling.
pub async fn collect(
    selection: Comparison,
    budgets: &Budgets,
    pairs: usize,
    env: &mut impl Environment,
) -> Result<Option<Pair>, Error> {
    let Comparison::Paired(class) = selection else {
        return Ok(None);
    };
    if pairs == 0 {
        return Err("pair invocation count must be positive".into());
    }
    let references = env.references().await?;
    for reference in &references {
        if reference.len() != 40 || !reference.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("pair: invalid Git reference {reference:?}").into());
        }
    }
    let identity = env.identity()?;
    if [&identity.host, &identity.boot, &identity.job]
        .iter()
        .any(|s| s.trim().is_empty())
    {
        return Err("pair: missing host/boot/job identity".into());
    }
    let builds = [
        env.build(&references[0], "base").await?,
        env.build(&references[1], "head").await?,
    ];
    if builds[0].daemon == builds[1].daemon || builds[0].rup == builds[1].rup {
        return Err("pair: builds do not have separate binary locations".into());
    }
    let mut invocations = Vec::new();
    for turn in 0..pairs {
        for (index, side) in ["base", "head"].into_iter().enumerate() {
            if builds[index].reference != references[index] {
                return Err(format!("{side}: build reference mismatch").into());
            }
            let mut report = env
                .measure(&builds[index], turn)
                .await
                .map_err(|e| format!("{side} {} measurement: {e}", references[index]))?;
            valid(&report, budgets)?;
            let after = env.identity()?;
            if after != identity {
                return Err(format!("{side}: host/boot/job identity changed").into());
            }
            if report.os != "linux" || report.cpus != class.machine.available_cpus.unwrap_or(0) {
                return Err(format!("{side}: report machine mismatch").into());
            }
            report.class = Some(class.clone());
            let outcome = judge_all(&report, budgets)?;
            report.skipped = outcome.skipped;
            let exit = u8::from(!outcome.misses.is_empty());
            invocations.push(Invocation {
                side: side.into(),
                identity: after,
                report,
                exit,
            });
        }
    }
    let mut result = Pair {
        mode: "paired".into(),
        class,
        identity,
        builds,
        invocations,
        metrics: Vec::new(),
        skipped: Vec::new(),
        stored_misses: Vec::new(),
        passed: true,
        clean: true,
    };
    judge(&mut result, budgets)?;
    Ok(Some(result))
}

/// Validate retained observations before deriving the paired verdict; also used on deserialized reports.
pub fn judge(pair: &mut Pair, budgets: &Budgets) -> Result<(), Error> {
    let base: Vec<_> = pair
        .invocations
        .iter()
        .filter(|i| i.side == "base")
        .collect();
    let head: Vec<_> = pair
        .invocations
        .iter()
        .filter(|i| i.side == "head")
        .collect();
    if base.is_empty()
        || base.len() != head.len()
        || base.len() + head.len() != pair.invocations.len()
    {
        return Err("pair: zero or unequal invocation counts".into());
    }
    for invocation in &pair.invocations {
        valid(&invocation.report, budgets)?;
        let first = &pair.invocations[0].report;
        if invocation.report.runs != first.runs
            || invocation.report.cpus != first.cpus
            || invocation.report.os != first.os
        {
            return Err("pair: invocation workload/machine mismatch".into());
        }
        if invocation.identity != pair.identity {
            return Err("pair: host/boot/job mismatch".into());
        }
    }
    pair.metrics.clear();
    pair.skipped.clear();
    pair.stored_misses.clear();
    for (name, budget) in budgets {
        let values = |side: &[&Invocation]| {
            median(
                &side
                    .iter()
                    .map(|i| i.report.metrics[name])
                    .collect::<Vec<_>>(),
            )
        };
        let base_value = values(&base);
        let head_value = values(&head);
        let ceiling = base_value * 1.10 + budget.noise;
        let mut skipped = false;
        if name != "rss_extra_mb" {
            for i in &pair.invocations {
                let load = load_per_cpu(&i.report.loads, i.report.cpus);
                if load > 2.0 {
                    skipped = true;
                    pair.skipped.push(Skip {
                        side: i.side.clone(),
                        metric: name.clone(),
                        load_per_cpu: load,
                        max_load_per_cpu: 2.0,
                    });
                }
            }
        }
        pair.metrics.push(Metric {
            metric: name.clone(),
            base: base_value,
            head: head_value,
            ceiling,
            limit: budget.limit,
            regressed: !skipped && head_value > ceiling,
            over_limit: budget.limit.is_some_and(|limit| head_value > limit),
        });
    }
    // Partial calibration remains a second, independent check, using head invocation medians.
    let report = Report {
        os: "linux".into(),
        class: Some(pair.class.clone()),
        cpus: head[0].report.cpus,
        runs: head.len(),
        loads: head.iter().map(|i| median(&i.report.loads)).collect(),
        metrics: budgets
            .keys()
            .map(|name| {
                (
                    name.clone(),
                    median(
                        &head
                            .iter()
                            .map(|i| i.report.metrics[name])
                            .collect::<Vec<_>>(),
                    ),
                )
            })
            .collect(),
        per_run: BTreeMap::new(),
        skipped: Vec::new(),
    };
    pair.stored_misses = judge_all(&report, budgets)?
        .misses
        .iter()
        .map(|(name, miss)| format!("{name}: {miss:?}"))
        .collect();
    pair.passed =
        pair.metrics.iter().all(|m| !m.regressed && !m.over_limit) && pair.stored_misses.is_empty();
    pair.clean = pair.skipped.is_empty();
    Ok(())
}

pub fn render(pair: &Pair) -> Vec<String> {
    let mut lines = vec![format!(
        "paired base {} head {} class {} host {:?}",
        pair.builds[0].reference, pair.builds[1].reference, pair.class.key, pair.identity
    )];
    lines.extend(pair.metrics.iter().map(|m| {
        format!(
            "{} base {} head {} ceiling {} limit {:?}: {}",
            m.metric,
            m.base,
            m.head,
            m.ceiling,
            m.limit,
            if m.regressed || m.over_limit {
                "FAIL"
            } else {
                "ok"
            }
        )
    }));
    lines.extend(pair.skipped.iter().map(|s| {
        format!(
            "{} {} not compared: load {} per cpu, above {}",
            s.side, s.metric, s.load_per_cpu, s.max_load_per_cpu
        )
    }));
    lines.extend(
        pair.stored_misses
            .iter()
            .map(|s| format!("FAIL stored {s}")),
    );
    if !pair.clean {
        lines.push(format!(
            "skipped {} regression tests; no clean regression verdict",
            pair.skipped.len()
        ));
    }
    lines
}
