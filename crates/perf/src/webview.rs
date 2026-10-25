use std::io;

use serde_json::Value;

/// Frames slower than this mean the window was not drawn at full rate (behind other windows, occluded): the run says nothing about rendering.
const FRAME_LIMIT_MS: f64 = 25.0;

/// Required hop attribution, including the retained coarse input-to-dispatch span (`apps/desktop/src/perf/keystrokes.ts`, `hops`).
pub const HOPS: [&str; 7] = [
    "keydown_to_input",
    "input_to_dispatch",
    "input_to_encoded",
    "encoded_to_dispatch",
    "dispatch_to_echo_event",
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
    if report["keys"].as_u64().is_none_or(|keys| keys == 0) || report["dropped"].as_u64().is_none()
    {
        return Err(failure(
            "keys and dropped must be integer counts, with keys above zero",
        ));
    }

    // R20: a report without every hop's p50/p95 cannot choose a repair.
    for hop in HOPS {
        let measured = &report["hops"][hop];
        if measured["n"].as_u64().is_none_or(|n| n == 0)
            || measured["p50"].as_f64().is_none()
            || measured["p95"].as_f64().is_none()
        {
            return Err(failure(format!(
                "the report has no hop attribution for {hop}"
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
