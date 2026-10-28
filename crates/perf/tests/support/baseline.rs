use std::{collections::BTreeSet, path::Path, process::Command};

use perf::budget::Budgets;
use serde::Deserialize;

const BUDGETS: &str = "crates/perf/budgets.json";
const PAIRS: &str = "crates/perf/baseline-pairs.json";

#[derive(Clone, Debug, Deserialize, PartialEq)]
struct Observation {
    metric: String,
    class: String,
    measurement: f64,
    unit: String,
    reference: String,
    command: String,
    host: String,
    session: String,
    report: String,
}

#[derive(Deserialize)]
struct Pair {
    metric: String,
    class: String,
    // Absence must be written as null, never inferred from a missing field.
    #[serde(deserialize_with = "Option::deserialize")]
    old: Option<f64>,
    #[serde(deserialize_with = "Option::deserialize")]
    new: Option<f64>,
    before: Observation,
    after: Observation,
}

pub fn validate(
    base: &str,
    head: &str,
    read: impl Fn(&str) -> Result<String, String>,
) -> Result<(), String> {
    let base: Budgets = serde_json::from_str(base).map_err(|e| format!("base budgets: {e}"))?;
    let head: Budgets = serde_json::from_str(head).map_err(|e| format!("head budgets: {e}"))?;
    let keys: BTreeSet<_> = base
        .iter()
        .chain(&head)
        .flat_map(|(metric, budget)| budget.baseline.keys().map(move |class| (metric, class)))
        .collect();
    let mut pairs = None;
    for (metric, class) in keys {
        let old = base
            .get(metric)
            .and_then(|b| b.baseline.get(class))
            .copied();
        let new = head
            .get(metric)
            .and_then(|b| b.baseline.get(class))
            .copied();
        if old == new {
            continue;
        }
        let context = format!("{metric}/{class}");
        if pairs.is_none() {
            let text = read(PAIRS).map_err(|e| format!("{context}: missing pair: {e}"))?;
            pairs = Some(
                serde_json::from_str::<Vec<Pair>>(&text)
                    .map_err(|e| format!("{context}: {PAIRS}: {e}"))?,
            );
        }
        let matching: Vec<_> = pairs
            .as_ref()
            .unwrap()
            .iter()
            .filter(|p| &p.metric == metric && &p.class == class && p.old == old && p.new == new)
            .collect();
        if matching.len() != 1 {
            return Err(format!(
                "{context}: expected one pair matching old/new baseline values"
            ));
        }
        let pair = matching[0];
        validate_pair(pair, &read).map_err(|e| format!("{context}: {e}"))?;
    }
    Ok(())
}

fn validate_pair(
    pair: &Pair,
    read: &impl Fn(&str) -> Result<String, String>,
) -> Result<(), String> {
    let before = &pair.before;
    let after = &pair.after;
    for (name, a, b) in [
        ("metric", before.metric.as_str(), after.metric.as_str()),
        ("class", &before.class, &after.class),
        ("unit", &before.unit, &after.unit),
        ("command", &before.command, &after.command),
        ("host", &before.host, &after.host),
        ("session", &before.session, &after.session),
    ] {
        if a.trim().is_empty() || a != b {
            return Err(format!("missing or mismatched {name}"));
        }
    }
    if before.metric != pair.metric || before.class != pair.class {
        return Err("mismatched metric/class".into());
    }
    let unit = if pair.metric.ends_with("_ms") {
        "ms"
    } else if pair.metric.ends_with("_mb") {
        "MB"
    } else {
        return Err("unknown metric unit".into());
    };
    if before.unit != unit {
        return Err("mismatched unit".into());
    }
    if before.report == after.report {
        return Err("before and after require distinct reports".into());
    }
    for observation in [before, after] {
        if !observation.measurement.is_finite() || observation.measurement < 0.0 {
            return Err("invalid measurement".into());
        }
        if observation.reference.len() != 40
            || !observation.reference.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("reference must be a full commit id".into());
        }
        if observation.report.is_empty() {
            return Err("missing report path".into());
        }
        let text =
            read(&observation.report).map_err(|e| format!("report {}: {e}", observation.report))?;
        // A retained report repeats the observation facts and may include raw samples,
        // hashes, statuses and paths. A path alone cannot prove a shared host/session.
        let report: Observation = serde_json::from_str(&text)
            .map_err(|e| format!("report {}: {e}", observation.report))?;
        if report != *observation {
            return Err(format!(
                "report {} mismatches observation",
                observation.report
            ));
        }
    }
    Ok(())
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| format!("git {args:?}: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

pub fn validate_git(root: &Path, base: &str, head: &str) -> Result<(), String> {
    let base = git(root, &["show", &format!("{base}:{BUDGETS}")])?;
    let budgets = git(root, &["show", &format!("{head}:{BUDGETS}")])?;
    validate(&base, &budgets, |path| {
        git(root, &["show", &format!("{head}:{path}")])
    })
}

pub fn committed(root: &Path) -> Result<(), String> {
    let base = match std::env::var("BASE").ok().filter(|b| !b.is_empty()) {
        Some(base) => base,
        None => {
            let head = git(root, &["rev-parse", "HEAD"])?;
            let main = git(root, &["rev-parse", "origin/main"])?;
            if head == main {
                "HEAD^1".into()
            } else {
                git(root, &["merge-base", "origin/main", "HEAD"])?
                    .trim()
                    .into()
            }
        }
    };
    validate_git(root, &base, "HEAD")
}
