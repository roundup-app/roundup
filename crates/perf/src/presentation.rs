//! U3010d: consume native presentation evidence without starting an App or window.
use clap::Parser;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
struct Args {
    /// Native instrument export normalized as documented in docs/motion-native-runbook.md.
    #[arg(long)]
    input: PathBuf,
    #[arg(long)]
    out: PathBuf,
}

fn analyze(_bytes: &[u8]) -> Value {
    json!({"exit":2, "status":"unmeasured"})
}

fn main() -> ExitCode {
    let args = Args::parse();
    let result = std::fs::read(&args.input).map(|bytes| analyze(&bytes));
    let report = result
        .unwrap_or_else(|error| json!({"exit":2,"status":"unmeasured","reason":error.to_string()}));
    if let Err(error) = std::fs::write(
        &args.out,
        serde_json::to_vec_pretty(&report).expect("report JSON"),
    ) {
        eprintln!("perf-presentation: {error}");
        return ExitCode::from(2);
    }
    ExitCode::from(report["exit"].as_u64().expect("report exit") as u8)
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
        let report = analyze(&serde_json::to_vec(&evidence()).unwrap());
        assert_eq!(report["status"], "measured");
        assert_eq!(report["meets_thresholds"], true);
        assert_eq!(report["sample"]["p95"], 8.333333);
        assert_eq!(report["sample"]["n"], 7200);
        // A single native stage never completes the three-pair, multi-stage acceptance.
        assert_eq!(report["exit"], 2);
        assert_eq!(report["verdict"], "incomplete");
    }
}
