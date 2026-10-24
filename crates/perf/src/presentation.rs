//! U3010d: consume native presentation evidence without starting an App or window.
use clap::Parser;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Parser)]
struct Args {
    /// Native instrument export normalized as documented in docs/motion-native-runbook.md.
    #[arg(long)]
    input: PathBuf,
    #[arg(long)]
    out: PathBuf,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Stage {
    Presentation,
}

#[derive(Deserialize, Serialize)]
struct Source {
    stage: Stage,
    tool: String,
    trace: String,
    schema: String,
    /// Must identify the WKWebView surface AND display, not just the host App pid.
    target: String,
    /// Hitch-only exports cannot supply an interval distribution.
    all_frames: bool,
}

#[derive(Deserialize, Serialize)]
struct Evidence {
    source: Source,
    revision: String,
    workload: String,
    refresh_hz: f64,
    resolution_ns: u64,
    /// Trace-relative start of the protocol's 60-second sample, excluding warmup.
    sample_start_ns: u64,
    /// Actual presentation instants, not frame lifetimes, vsync ticks or callbacks.
    timestamps_ns: Vec<u64>,
}

fn analyze(bytes: &[u8]) -> (u8, Value) {
    let evidence = match serde_json::from_slice::<Evidence>(bytes) {
        Ok(evidence) => evidence,
        Err(error) => {
            return (
                2,
                json!({"status":"unmeasured", "verdict":"invalid", "exit":2, "reason":error.to_string()}),
            );
        }
    };
    let invalid = |reason: &str| {
        (
            2,
            json!({"status":"unmeasured", "verdict":"invalid", "exit":2, "reason":reason, "evidence":evidence}),
        )
    };
    if !evidence.source.all_frames
        || [
            &evidence.source.tool,
            &evidence.source.trace,
            &evidence.source.schema,
            &evidence.source.target,
        ]
        .iter()
        .any(|s| s.trim().is_empty())
    {
        return invalid(
            "native provenance must identify a complete presentation export, its tool, trace, schema and WKWebView surface/display",
        );
    }
    if evidence.revision.len() != 40
        || !evidence.revision.bytes().all(|c| c.is_ascii_hexdigit())
        || !["layers", "todos", "glyphs"].contains(&evidence.workload.as_str())
    {
        return invalid("name the immutable revision and one protocol workload");
    }
    if !evidence.refresh_hz.is_finite()
        || evidence.refresh_hz <= 0.0
        || evidence.resolution_ns == 0
        || evidence.resolution_ns as f64 > 1_000_000_000.0 / evidence.refresh_hz
    {
        return invalid(
            "instrument resolution must be positive and no coarser than the fixed display period",
        );
    }
    let Some(end) = evidence.sample_start_ns.checked_add(60_000_000_000) else {
        return invalid("sample window overflows the native clock");
    };
    let timestamps = &evidence.timestamps_ns;
    if timestamps.len() < 2 || timestamps.windows(2).any(|pair| pair[1] <= pair[0]) {
        return invalid(
            "presentation timestamps must be strictly increasing; no sorting or gap repair is performed",
        );
    }
    if timestamps[0] > evidence.sample_start_ns || timestamps[timestamps.len() - 1] < end {
        return invalid(
            "native presentations must bracket the entire 60-second sample; a partial export cannot pass",
        );
    }
    // Include intervals crossing either boundary so cropping cannot hide a late frame.
    let intervals: Vec<f64> = timestamps
        .windows(2)
        .filter(|pair| pair[1] > evidence.sample_start_ns && pair[0] < end)
        .map(|pair| (pair[1] - pair[0]) as f64 / 1_000_000.0)
        .collect();
    let mut sorted = intervals.clone();
    sorted.sort_by(f64::total_cmp);
    let percentile = |share: f64| sorted[(share * sorted.len() as f64).ceil() as usize - 1];
    let period = 1000.0 / evidence.refresh_hz;
    let long_count = intervals.iter().filter(|&&ms| ms > 1.5 * period).count();
    let long_rate = long_count as f64 / intervals.len() as f64;
    let (p50, p95, p99, max) = (
        percentile(0.5),
        percentile(0.95),
        percentile(0.99),
        percentile(1.0),
    );
    let meets = p95 <= 1.5 * period && p99 <= 3.0 * period && long_rate <= 0.05 && max <= 50.0;
    // This consumer judges one stage only: it cannot certify workload validity or paired regressions.
    let exit = if meets { 2 } else { 1 };
    (
        exit,
        json!({
            "stage":"presentation", "status":"measured", "meets_thresholds":meets,
            "verdict":if meets {"incomplete"} else {"fail"}, "exit":exit,
            "scope":"native presentation intervals only; scheduling, idle, other stages, run validity and same-machine paired regressions remain separate evidence",
            "period_ms":period, "sample_end_ns":end,
            "sample":{"n":intervals.len(), "intervals":intervals, "p50":p50, "p95":p95, "p99":p99, "max":max, "long_count":long_count, "long_rate":long_rate},
            "evidence":evidence,
        }),
    )
}

fn write_report(path: &Path, report: &Value) -> std::io::Result<()> {
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    serde_json::to_writer_pretty(file, report).map_err(std::io::Error::other)
}

fn main() -> ExitCode {
    let args = Args::parse();
    let (exit, report) = match std::fs::read(&args.input) {
        Ok(bytes) => analyze(&bytes),
        Err(error) => (
            2,
            json!({"exit":2,"status":"unmeasured","verdict":"invalid","reason":error.to_string()}),
        ),
    };
    if let Err(error) = write_report(&args.out, &report) {
        eprintln!("perf-presentation: {error}");
        return ExitCode::from(2);
    }
    ExitCode::from(exit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence() -> Value {
        json!({
            "source": {"stage":"presentation", "tool":"Instruments 26", "trace":"layers.trace", "schema":"native frame presentations", "target":"roundup WKWebView surface 7, display 1", "all_frames":true},
            "revision":"0123456789abcdef0123456789abcdef01234567",
            "workload":"layers", "refresh_hz":120.0, "resolution_ns":1_000,
            "sample_start_ns":10_000_000_000_u64,
            "timestamps_ns": (0..=7202_u64).map(|i| 9_990_000_000 + i * 8_333_333).collect::<Vec<_>>()
        })
    }

    #[test]
    fn u3010d_native_presentations_are_measured_independently_of_callbacks() {
        let report = analyze(&serde_json::to_vec(&evidence()).unwrap()).1;
        assert_eq!(report["status"], "measured");
        assert_eq!(report["meets_thresholds"], true);
        assert_eq!(report["sample"]["p95"], 8.333333);
        assert_eq!(report["sample"]["n"], 7201);
        // A single native stage never completes the three-pair, multi-stage acceptance.
        assert_eq!(report["exit"], 2);
        assert_eq!(report["verdict"], "incomplete");
    }
    #[test]
    fn u3010d_a_native_presentation_budget_miss_is_retained_as_failure() {
        let mut input = evidence();
        let mut timestamps: Vec<u64> =
            serde_json::from_value(input["timestamps_ns"].clone()).unwrap();
        // Remove presentations across 66 ms; callback scheduling can still be perfect.
        timestamps.drain(400..407);
        input["timestamps_ns"] = json!(timestamps);
        let (exit, report) = analyze(&serde_json::to_vec(&input).unwrap());
        assert_eq!(exit, 1);
        assert_eq!(report["sample"]["max"], 66.666664);
        assert_eq!(report["meets_thresholds"], false);
        assert_eq!(report["evidence"], input);
    }

    #[test]
    fn u3010d_incomplete_or_unsupported_native_exports_never_measure_presentation() {
        let original = evidence();
        let mut defects = Vec::new();
        for (field, value) in [
            ("refresh_hz", json!(0)),
            ("resolution_ns", json!(20_000_000)),
            ("resolution_ns", json!(0)),
            ("revision", json!("main")),
            ("timestamps_ns", json!([])),
            (
                "timestamps_ns",
                json!([10_000_000_000_u64, 70_000_000_000_u64, 69_000_000_000_u64]),
            ),
            (
                "timestamps_ns",
                json!([10_000_000_000_u64, 10_000_000_000_u64, 70_000_000_000_u64]),
            ),
            (
                "timestamps_ns",
                json!([10_100_000_000_u64, 70_000_000_000_u64]),
            ),
            (
                "timestamps_ns",
                json!([9_000_000_000_u64, 69_000_000_000_u64]),
            ),
        ] {
            let mut input = original.clone();
            input[field] = value;
            defects.push(input);
        }
        for (field, value) in [
            ("all_frames", json!(false)),
            ("stage", json!("scheduling")),
            ("target", json!("")),
        ] {
            let mut input = original.clone();
            input["source"][field] = value;
            defects.push(input);
        }
        for input in defects {
            let (exit, report) = analyze(&serde_json::to_vec(&input).unwrap());
            assert_eq!(exit, 2, "{input}");
            assert_eq!(report["status"], "unmeasured", "{input}");
            assert!(report.get("sample").is_none());
            assert!(report.get("meets_thresholds").is_none());
        }
    }

    #[test]
    fn u3010d_cropping_the_native_window_cannot_hide_a_late_presentation() {
        let mut input = evidence();
        let mut timestamps: Vec<u64> =
            serde_json::from_value(input["timestamps_ns"].clone()).unwrap();
        // The gap ends outside the sample but begins inside it.
        let end = *timestamps.last().unwrap();
        timestamps.truncate(timestamps.len() - 7);
        timestamps.push(end);
        input["timestamps_ns"] = json!(timestamps);
        let (exit, report) = analyze(&serde_json::to_vec(&input).unwrap());
        assert_eq!(exit, 1);
        assert!(report["sample"]["max"].as_f64().unwrap() > 50.0);
    }
    #[test]
    fn u3010d_a_previous_native_report_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("native.json");
        let original = b"retained failed observation";
        std::fs::write(&path, original).unwrap();
        let error = write_report(&path, &json!({"exit":2})).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }
}
