//! R16 same-job comparison, through the production selection and judgment seams.
use perf::machine::{Machine, Provenance};
use std::collections::BTreeMap;

fn builder() -> Machine {
    perf::machine::parse(
        "ID=ubuntu\nVERSION_ID=24.04",
        "Architecture: x86_64\nModel name: AMD EPYC 7763 64-Core Processor",
        "0-3",
        "Cpus_allowed_list: 0-3",
        4,
    )
}

#[test]
fn r16_uncalibrated_builder_selects_pair() {
    let budgets =
        perf::gate::read_budgets(concat!(env!("CARGO_MANIFEST_DIR"), "/budgets.json").as_ref())
            .unwrap();
    let class = perf::machine::comparison(&builder(), &Provenance::new(), &budgets).unwrap();
    assert!(matches!(class, perf::machine::Comparison::Paired(_)));
    let mut unknown = builder();
    unknown.cpu_model = Some("other CPU".into());
    assert!(perf::machine::comparison(&unknown, &BTreeMap::new(), &budgets).is_err());
}

use perf::budget::{Budgets, Report};
use perf::machine::{Class, Comparison, LINUX_METRICS};
use perf::paired::{self, Build, Environment, Error, Identity};

fn budgets() -> Budgets {
    let mut budgets =
        perf::gate::read_budgets(concat!(env!("CARGO_MANIFEST_DIR"), "/budgets.json").as_ref())
            .unwrap();
    for b in budgets.values_mut() {
        b.baseline.clear();
    }
    budgets
}
fn class() -> Class {
    let Comparison::Paired(c) =
        perf::machine::comparison(&builder(), &Provenance::new(), &budgets()).unwrap()
    else {
        panic!()
    };
    c
}
fn report(value: f64) -> Report {
    let metrics: BTreeMap<_, _> = budgets().keys().map(|n| (n.clone(), value)).collect();
    Report {
        os: "linux".into(),
        class: None,
        cpus: 4,
        runs: 3,
        loads: vec![0.0; 3],
        per_run: metrics
            .iter()
            .map(|(n, v)| (n.clone(), vec![*v; 3]))
            .collect(),
        metrics,
        skipped: vec![],
    }
}
fn metric(report: &mut Report, name: &str, value: f64) {
    report.metrics.insert(name.into(), value);
    report.per_run.insert(name.into(), vec![value; report.runs]);
}
struct Fixture {
    events: Vec<String>,
    reports: std::collections::VecDeque<Report>,
    fail: Option<&'static str>,
    identities: usize,
}
impl Fixture {
    fn new(base: Report, head: Report) -> Self {
        Self {
            events: vec![],
            reports: [base, head].into(),
            fail: None,
            identities: 0,
        }
    }
}
impl Environment for Fixture {
    async fn references(&mut self) -> Result<[String; 2], Error> {
        self.events.push("refs".into());
        if self.fail == Some("refs") {
            return Err("missing merge-base origin/main".into());
        }
        Ok(["a".repeat(40), "b".repeat(40)])
    }
    fn identity(&mut self) -> Result<Identity, Error> {
        self.identities += 1;
        Ok(Identity {
            host: "same-host".into(),
            boot: if self.fail == Some("boot") && self.identities > 1 {
                "changed"
            } else {
                "same-boot"
            }
            .into(),
            job: "same-job".into(),
        })
    }
    async fn build(&mut self, reference: &str, side: &str) -> Result<Build, Error> {
        self.events.push(format!("build-{side}"));
        if self.fail == Some(side) {
            return Err(format!("build {reference} failed").into());
        }
        Ok(Build {
            reference: reference.into(),
            rupd: format!("/{side}/rupd").into(),
            rup: format!("/{side}/rup").into(),
            hashes: format!("{side}-hash"),
        })
    }
    async fn measure(&mut self, build: &Build, _: usize) -> Result<Report, Error> {
        self.events
            .push(format!("measure-{}", build.rupd.display()));
        if self.fail == Some("observer") {
            return Err("incompatible observer RPC".into());
        }
        self.reports
            .pop_front()
            .ok_or_else(|| "missing report".into())
    }
}
async fn pair(budgets: &Budgets, base: Report, head: Report) -> paired::Pair {
    paired::collect(
        Comparison::Paired(class()),
        budgets,
        1,
        &mut Fixture::new(base, head),
    )
    .await
    .unwrap()
    .unwrap()
}

#[tokio::test]
async fn r16_uncalibrated_builder_uses_same_job_pair() {
    let mut env = Fixture::new(report(0.1), report(0.1));
    env.reports.extend([report(0.1), report(0.1)]);
    let result = paired::collect(Comparison::Paired(class()), &budgets(), 2, &mut env)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        env.events,
        [
            "refs",
            "build-base",
            "build-head",
            "measure-/base/rupd",
            "measure-/head/rupd",
            "measure-/base/rupd",
            "measure-/head/rupd"
        ]
    );
    assert!(result.passed && result.clean);
    assert_eq!(result.invocations.len(), 4);
    // Invocation medians, not pooled raw samples: the second base invocation is larger.
    let mut result = result;
    for (i, value) in [(0, 0.1), (2, 0.3)] {
        metric(&mut result.invocations[i].report, "hook_loop_ms", value);
    }
    metric(&mut result.invocations[1].report, "hook_loop_ms", 0.2);
    metric(&mut result.invocations[3].report, "hook_loop_ms", 0.2);
    paired::judge(&mut result, &budgets()).unwrap();
    assert_eq!(
        result
            .metrics
            .iter()
            .find(|m| m.metric == "hook_loop_ms")
            .unwrap()
            .base,
        0.2
    );
}

#[tokio::test]
async fn r16_paired_regression_edges() {
    for (name, budget) in budgets() {
        let mut head = report(0.1);
        let ceiling = 0.1 * 1.10 + budget.noise;
        metric(&mut head, &name, ceiling);
        assert!(
            pair(&budgets(), report(0.1), head).await.passed,
            "{name} boundary"
        );
        let mut head = report(0.1);
        metric(&mut head, &name, ceiling.next_up());
        let result = pair(&budgets(), report(0.1), head).await;
        assert!(!result.passed, "{name} next up");
        assert!(
            result
                .metrics
                .iter()
                .any(|m| m.metric == name && m.regressed)
        );
    }
}

#[tokio::test]
async fn r16_paired_absolute_limits_hold() {
    for (name, budget) in budgets() {
        let Some(limit) = budget.limit else { continue };
        let mut base = report(0.1);
        metric(&mut base, &name, limit * 2.0);
        let mut head = report(0.1);
        metric(&mut head, &name, limit);
        let result = pair(&budgets(), base, head).await;
        assert!(
            result.passed,
            "{name} at limit; base miss must not block comparison"
        );
        assert_eq!(result.invocations[0].exit, 1);
        let mut base = report(0.1);
        metric(&mut base, &name, limit * 2.0);
        let mut head = report(0.1);
        metric(&mut head, &name, limit.next_up());
        let result = pair(&budgets(), base, head).await;
        assert!(!result.passed, "{name}");
        assert!(
            result
                .metrics
                .iter()
                .any(|m| m.metric == name && m.over_limit)
        );
    }
}

#[tokio::test]
async fn r16_calibrated_class_keeps_stored_baseline() {
    let mut budgets = budgets();
    for metric in LINUX_METRICS {
        budgets
            .get_mut(metric)
            .unwrap()
            .baseline
            .insert("linux-7763".into(), 0.01);
    }
    let provenance = BTreeMap::from([("linux-7763".into(), "measured provenance".into())]);
    let selection = perf::machine::comparison(&builder(), &provenance, &budgets).unwrap();
    let Comparison::Stored(ref selected) = selection else {
        panic!("must use stored calibration")
    };
    let mut head = report(0.1);
    head.class = Some(selected.clone());
    assert!(
        !perf::budget::judge_all(&head, &budgets)
            .unwrap()
            .misses
            .is_empty()
    );
    // The same 0.1 head passes a 0.1 pair; stored selection must never request those builds.
    assert!(
        pair(&self::budgets(), report(0.1), report(0.1))
            .await
            .passed
    );
    let mut env = Fixture::new(report(0.1), report(0.1));
    assert!(
        paired::collect(selection, &budgets, 1, &mut env)
            .await
            .unwrap()
            .is_none()
    );
    assert!(env.events.is_empty());
}

#[tokio::test]
async fn r16_partial_calibration_keeps_applicable_stored_metric() {
    let mut budgets = budgets();
    budgets
        .get_mut("cold_plugin_materialization_ms")
        .unwrap()
        .baseline
        .insert("linux-7763".into(), 0.01);
    let selection = perf::machine::comparison(
        &builder(),
        &BTreeMap::from([("linux-7763".into(), "Q11 only".into())]),
        &budgets,
    )
    .unwrap();
    let result = paired::collect(
        selection,
        &budgets,
        1,
        &mut Fixture::new(report(0.1), report(0.1)),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!result.passed);
    assert!(result.metrics.iter().all(|m| !m.regressed));
    assert!(result.stored_misses[0].contains("cold_plugin_materialization_ms"));
}

#[tokio::test]
async fn r16_paired_load_skips_are_loud() {
    for side in [0, 1] {
        let mut base = report(0.1);
        let mut head = report(0.2);
        if side == 0 {
            base.loads = vec![8.0001; 3];
        } else {
            head.loads = vec![8.0001; 3];
        }
        metric(&mut head, "rss_extra_mb", 0.1);
        let result = pair(&budgets(), base, head).await;
        assert!(result.passed && !result.clean);
        let text = paired::render(&result).join("\n");
        assert!(text.contains(if side == 0 {
            "base hook_loop_ms not compared"
        } else {
            "head hook_loop_ms not compared"
        }));
        assert!(text.contains("skipped 8 regression tests"));
        assert!(text.contains("above 2"));
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(
            json["skipped"][0]["side"],
            if side == 0 { "base" } else { "head" }
        );
    }
}

#[tokio::test]
async fn r16_paired_memory_is_compared_at_any_load() {
    let mut base = report(0.1);
    let mut head = report(0.1);
    base.loads = vec![1000.0; 3];
    head.loads = vec![1000.0; 3];
    metric(&mut head, "rss_extra_mb", 1.0);
    let result = pair(&budgets(), base, head).await;
    assert!(!result.passed);
    assert!(
        result
            .metrics
            .iter()
            .any(|m| m.metric == "rss_extra_mb" && m.regressed)
    );
    assert!(result.skipped.iter().all(|s| s.metric != "rss_extra_mb"));
}

#[tokio::test]
async fn r16_pair_report_identifies_both_references() {
    let result = pair(&budgets(), report(0.1), report(0.11)).await;
    let json = serde_json::to_string(&result).unwrap();
    let restored: paired::Pair = serde_json::from_str(&json).unwrap();
    let text = paired::render(&restored).join("\n");
    assert!(text.contains(&"a".repeat(40)) && text.contains(&"b".repeat(40)));
    assert!(text.contains("base 0.1 head 0.11"));
    assert_eq!(restored.mode, "paired");
    assert_eq!(
        restored.invocations[0].report.per_run["hook_loop_ms"],
        [0.1; 3]
    );
}

#[tokio::test]
async fn r16_invalid_pair_is_an_observer_error() {
    for fail in ["refs", "base", "head", "observer", "boot"] {
        let mut env = Fixture::new(report(0.1), report(0.1));
        env.fail = Some(fail);
        assert!(
            paired::collect(Comparison::Paired(class()), &budgets(), 1, &mut env)
                .await
                .is_err(),
            "{fail}"
        );
    }
    for invalid in ["metric", "load", "nan", "negative", "samples"] {
        let mut bad = report(0.1);
        match invalid {
            "metric" => {
                bad.metrics.remove("hook_loop_ms");
            }
            "load" => bad.loads.clear(),
            "nan" => metric(&mut bad, "hook_loop_ms", f64::NAN),
            "negative" => metric(&mut bad, "hook_loop_ms", -1.0),
            _ => {
                bad.per_run.get_mut("hook_loop_ms").unwrap().pop();
            }
        }
        assert!(
            paired::collect(
                Comparison::Paired(class()),
                &budgets(),
                1,
                &mut Fixture::new(bad, report(0.1))
            )
            .await
            .is_err(),
            "{invalid}"
        );
    }
    let mut env = Fixture::new(report(0.1), report(0.1));
    assert!(
        paired::collect(Comparison::Paired(class()), &budgets(), 0, &mut env)
            .await
            .is_err()
    );
    let mut result = pair(&budgets(), report(0.1), report(0.1)).await;
    result.invocations.pop();
    assert!(paired::judge(&mut result, &budgets()).is_err());
}
