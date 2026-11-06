//! Whether a keystroke report was built for the workload the runner asked for (X14's flood evidence).

use std::io;

use perf::webview::failure;
use serde_json::Value;

pub(crate) fn checked_workload(report: &Value, flood: bool) -> io::Result<()> {
    let expected = if flood { "flood" } else { "idle" };
    if report["workload"] != expected {
        return Err(failure(format!(
            "built workload does not match runner workload {expected}"
        )));
    }
    if flood && report.get("error").is_none() {
        let evidence = &report["flood"];
        let samples = evidence["samples"]
            .as_array()
            .ok_or_else(|| failure("missing flood activity samples"))?;
        if evidence["id"].as_str().is_none()
            || evidence["id"] == report["terminal_id"]
            || evidence["command"] != "/usr/bin/yes roundup-flood"
            || evidence["opened"] != true
            || samples.len() < 2
            || !samples.windows(2).all(|pair| {
                let [first, second] = pair else { return false };
                first["bytes"]
                    .as_u64()
                    .zip(second["bytes"].as_u64())
                    .is_some_and(|(a, b)| b >= a)
                    && first["at_ms"]
                        .as_f64()
                        .zip(second["at_ms"].as_f64())
                        .is_some_and(|(a, b)| a.is_finite() && b.is_finite() && a >= 0.0 && b >= a)
            })
            || !samples
                .first()
                .zip(samples.last())
                .is_some_and(|(first, last)| {
                    last["bytes"].as_u64() > first["bytes"].as_u64()
                        && last["at_ms"].as_f64() > first["at_ms"].as_f64()
                })
            || !samples
                .iter()
                .all(|sample| matches!(sample["state"].as_str(), Some("visible" | "folded")))
            || !evidence["bytes_per_second"]
                .as_f64()
                .is_some_and(|rate| rate.is_finite() && rate > 0.0)
        {
            return Err(failure(
                "invalid flood producer activity or Terminal identity",
            ));
        }
    }
    Ok(())
}
