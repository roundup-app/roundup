use std::io;

use serde_json::Value;

use crate::budget::{Budgets, Miss, Report, judge_all, median};

/// Frames slower than this mean the window was not drawn at full rate (behind other windows, occluded): the run says nothing about rendering.
const FRAME_LIMIT_MS: f64 = 25.0;

/// Required hop attribution, including the retained coarse input-to-dispatch span (`apps/desktop/src/perf/keystrokes.ts`, `hops`).
pub const HOPS: [&str; 13] = [
    "keydown_to_input",
    "input_to_dispatch",
    "input_to_encoded",
    "input_to_encoding",
    "encoding_to_encoded",
    "encoded_to_dispatch",
    "dispatch_to_echo_event",
    "dispatch_to_daemon",
    "daemon_to_write",
    "write_to_echo_read",
    "echo_read_to_event",
    "echo_event_to_parsed",
    "parsed_to_frame",
];

pub fn failure(message: impl Into<String>) -> io::Error {
    io::Error::other(message.into())
}

/// The `PERF <json>` line in what a Terminal printed, if it is complete.
pub fn perf_line(printed: &str) -> Option<&str> {
    marked_line(printed, "PERF ")
}

/// The line after `marker` (`PERF ` for the keystroke run, `FRAMES ` for the frame run of U3010e) in what a Terminal printed, if it is complete.
pub fn marked_line<'a>(printed: &'a str, marker: &str) -> Option<&'a str> {
    let start = printed.find(marker)?;
    let line = &printed[start + marker.len()..];

    line.find('\n').map(|end| &line[..end])
}

/// Invalid observations have no latency verdict; dropped keys are budget failures in `judge_runs`.
pub fn checked(report: &Value) -> io::Result<()> {
    if let Some(error) = report["error"].as_str() {
        return Err(failure(format!("the webview failed: {error}")));
    }

    let number = |name: &str| {
        report[name]
            .as_f64()
            .ok_or_else(|| failure(format!("the report has no {name}")))
    };
    let frame = number("frame_ms")?;
    for name in ["frame_ms", "p95", "dropped", "keys"] {
        let value = number(name)?;
        if !value.is_finite() || value < 0.0 {
            return Err(failure(format!("the report has invalid {name}: {value}")));
        }
    }
    let (Some(keys), Some(dropped), Some(samples)) = (
        report["keys"].as_u64(),
        report["dropped"].as_u64(),
        report["n"].as_u64(),
    ) else {
        return Err(failure(
            "invalid sample count: keys, dropped and n must be integers",
        ));
    };
    // Drops include warm-up keys, so they may exceed the missing measured samples.
    if samples == 0 || samples > keys || samples.saturating_add(dropped) < keys {
        return Err(failure(format!(
            "invalid sample count: {samples} rendered samples and {dropped} dropped keys do not account for {keys} measured keys"
        )));
    }

    let uncertainty = calibration(report)?;

    // R20: a report without every hop's p50/p95 cannot choose a repair.
    for hop in HOPS {
        let measured = &report["hops"][hop];
        if measured["n"].as_u64() != Some(samples)
            || !measured["p50"]
                .as_f64()
                .zip(measured["p95"].as_f64())
                .is_some_and(|(p50, p95)| {
                    let minimum = if matches!(hop, "dispatch_to_daemon" | "echo_read_to_event") {
                        -uncertainty
                    } else {
                        0.0
                    };
                    p50.is_finite() && p95.is_finite() && p50 >= minimum && p95 >= p50
                })
        {
            return Err(failure(format!(
                "invalid hop attribution for {hop}: expected {samples} samples with finite ordered p50/p95 within clock uncertainty"
            )));
        }
    }

    if frame > FRAME_LIMIT_MS {
        return Err(failure(format!(
            "frames took {frame:.1} ms on average: the window was not drawn at full rate; bring it to the front and rerun"
        )));
    }

    Ok(())
}

/// R21 judges every observation; a median cannot hide one failed run. Invalid observations take exit 2 precedence.
pub fn judge_runs(reports: &[Value], limit_ms: f64) -> (u8, Vec<String>) {
    if reports.is_empty() || !limit_ms.is_finite() || limit_ms <= 0.0 {
        return (2, vec!["no runs or invalid keystroke budget".into()]);
    }
    let mut exit = 0;
    let mut failures = Vec::new();
    for (index, report) in reports.iter().enumerate() {
        let run = index + 1;
        if let Err(error) = checked(report) {
            exit = 2;
            failures.push(format!("run {run}: invalid observation: {error}"));
            continue;
        }
        // `checked` validated these fields at the report boundary.
        let p95 = report["p95"].as_f64().expect("checked p95");
        let dropped = report["dropped"].as_u64().expect("checked drops");
        if p95 >= limit_ms {
            exit = exit.max(1);
            failures.push(format!("run {run}: p95 {p95} ms, budget < {limit_ms} ms"));
        }
        if dropped != 0 {
            exit = exit.max(1);
            failures.push(format!("run {run}: {dropped} dropped keys, budget zero"));
        }
    }
    (exit, failures)
}

/// Recompute causal clock bounds from the retained exchanges, never from timer resolution alone.
fn calibration(report: &Value) -> io::Result<f64> {
    let invalid = || failure("invalid clock calibration evidence");
    let calibration = &report["calibration"];
    let number = |value: &Value| value.as_f64().filter(|n| n.is_finite()).ok_or_else(invalid);
    let resolution = number(&calibration["resolution_ms"])?;
    if resolution <= 0.0 || number(&report["timer_resolution_ms"])? != resolution {
        return Err(invalid());
    }
    let exchanges = calibration["exchanges"].as_array().ok_or_else(invalid)?;
    if exchanges.len() < 2 {
        return Err(invalid());
    }
    let mut low = f64::NEG_INFINITY;
    let mut high = f64::INFINITY;
    let mut previous = f64::NEG_INFINITY;
    for exchange in exchanges {
        let sent = number(&exchange["sent"])?;
        let daemon = number(&exchange["daemon"])?;
        let received = number(&exchange["received"])?;
        if sent < previous || received < sent {
            return Err(invalid());
        }
        previous = received;
        low = low.max(daemon - received - resolution);
        high = high.min(daemon - sent + resolution);
    }
    let offset = number(&calibration["offset_ms"])?;
    let uncertainty = number(&calibration["uncertainty_ms"])?;
    if low > high
        || uncertainty < 0.0
        || (offset - (low + high) / 2.0).abs() > 1e-6
        || (uncertainty - (high - low) / 2.0).abs() > 1e-6
        || (number(&report["hop_uncertainty_ms"])? - uncertainty).abs() > 1e-6
    {
        return Err(invalid());
    }
    Ok(uncertainty)
}

/// The two metrics SP4 adds beside K3's fields, each with the sample counts of its own kind.
pub const SWITCH_METRICS: [(&str, &str); 2] = [
    ("switcher_open_p95_ms", "switcher_open"),
    ("switch_p95_ms", "switch"),
];

/// SP6: more than this share of either kind of sample dropped leaves no verdict.
const DROPPED_SHARE: f64 = 0.05;

/// SP6: a report without a usable Switcher-open and switch reading is invalid (exit 2), never a pass.
pub fn checked_switch(report: &Value) -> io::Result<()> {
    if let Some(error) = report["error"].as_str() {
        return Err(failure(format!("the webview failed: {error}")));
    }
    match report["frame_ms"].as_f64() {
        Some(frame) if frame.is_finite() && frame <= FRAME_LIMIT_MS => {}
        Some(frame) => {
            return Err(failure(format!(
                "frames took {frame:.1} ms on average: the window was not drawn at full rate; bring it to the front and rerun"
            )));
        }
        None => return Err(failure("the report has no frame_ms")),
    }
    for (metric, kind) in SWITCH_METRICS {
        match report[metric].as_f64() {
            Some(value) if value.is_finite() && value >= 0.0 => {}
            _ => return Err(failure(format!("the report has no valid {metric}"))),
        }
        let (Some(n), Some(dropped)) =
            (report[kind]["n"].as_u64(), report[kind]["dropped"].as_u64())
        else {
            return Err(failure(format!("the report has no {kind} sample counts")));
        };
        let total = n.saturating_add(dropped);
        if n == 0 || dropped as f64 > DROPPED_SHARE * total as f64 {
            return Err(failure(format!(
                "{dropped} of {total} {kind} samples dropped, above {}%",
                DROPPED_SHARE * 100.0
            )));
        }
    }
    Ok(())
}

/// Keystroke runs, plus (SP6) the Switcher-open and switch metrics outside a flood: a run that did not measure them is an error.
pub fn judge_idle(
    reports: &[Value],
    limit_ms: f64,
    budgets: &Budgets,
    loads: &[f64],
    flood: bool,
) -> (u8, Vec<String>) {
    let (mut exit, mut failures) = judge_runs(reports, limit_ms);
    if !flood {
        let cpus = std::thread::available_parallelism().map_or(1, |n| n.get());
        let (switch_exit, more) = judge_switch(reports, budgets, std::env::consts::OS, loads, cpus);
        exit = if exit == 2 || switch_exit == 2 {
            2
        } else {
            exit.max(switch_exit)
        };
        failures.extend(more);
    }
    (exit, failures)
}

/// SP6: each metric is the median over the runs of the run's p95, judged against its limit and its baseline for `baseline_key`.
/// Exit 2 for an invalid run or a budgeted metric the runs did not measure, exit 1 naming the metric, its value and its limit or baseline.
pub fn judge_switch(
    reports: &[Value],
    budgets: &Budgets,
    os: &str,
    loads: &[f64],
    cpus: usize,
) -> (u8, Vec<String>) {
    if reports.is_empty() {
        return (2, vec!["no runs".into()]);
    }
    let invalid: Vec<String> = reports
        .iter()
        .enumerate()
        .filter_map(|(index, report)| {
            checked_switch(report)
                .err()
                .map(|error| format!("run {}: invalid observation: {error}", index + 1))
        })
        .collect();
    if !invalid.is_empty() {
        return (2, invalid);
    }

    let mut per_run = std::collections::BTreeMap::new();
    for (metric, _) in SWITCH_METRICS {
        per_run.insert(
            metric.to_string(),
            reports
                .iter()
                .map(|report| report[metric].as_f64().expect("checked metric"))
                .collect::<Vec<f64>>(),
        );
    }
    let metrics = per_run
        .iter()
        .map(|(name, values)| (name.clone(), median(values)))
        .collect();
    let result = Report {
        os: os.to_string(),
        class: None,
        cpus,
        runs: reports.len(),
        loads: loads.to_vec(),
        metrics,
        per_run,
        skipped: vec![],
    };
    // Keystroke latency has its own judgement (`judge_runs`); it is not a switch metric.
    let budgets: Budgets = budgets
        .iter()
        .filter(|(name, _)| SWITCH_METRICS.iter().any(|(metric, _)| metric == name))
        .map(|(name, budget)| (name.clone(), budget.clone()))
        .collect();
    for (metric, _) in SWITCH_METRICS {
        if !budgets.contains_key(metric) {
            return (
                2,
                vec![format!(
                    "budget {metric:?} is missing from the budgets file"
                )],
            );
        }
    }
    let outcome = match judge_all(&result, &budgets) {
        Ok(outcome) => outcome,
        Err(error) => return (2, vec![error]),
    };
    let failures: Vec<String> = outcome
        .misses
        .iter()
        .map(|(name, miss)| {
            let value = result.metrics[name];
            match miss {
                Miss::OverLimit { limit } => format!("{name} {value} ms, over its limit {limit} ms"),
                Miss::Regressed { baseline, ceiling } => format!(
                    "{name} {value} ms, over {ceiling:.3} ms: more than 10% over its baseline {baseline} ms"
                ),
            }
        })
        .collect();
    (u8::from(!failures.is_empty()), failures)
}
