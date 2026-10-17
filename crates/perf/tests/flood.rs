use std::time::Duration;

#[tokio::test]
async fn x14_flood_leaves_rail_events_unlagged_and_cleans_up() {
    let report = perf::flood::observe(Duration::from_secs(180)).await;
    assert!(report.error.is_none(), "{report:?}");
    assert_eq!(report.chunks.len(), 10);
    assert!(report.chunks.values().all(|n| *n > report.capacity));
    assert_eq!(report.lagged, 0, "{report:?}");
    assert_eq!(report.markers_received, report.markers_emitted);
    assert!(report.passed(), "{report:?}");
    assert!(report.cleaned_up);
    assert_eq!(report.stopped, 10);
}

fn isolated() -> perf::flood::Observation {
    perf::flood::Observation {
        capacity: 4,
        chunks: (0..10).map(|n| (n.to_string(), 5)).collect(),
        markers_emitted: vec!["a".into(), "b".into()],
        markers_received: vec!["a".into(), "b".into()],
        cleaned_up: true,
        stopped: 10,
        ..Default::default()
    }
}

#[test]
fn x14_counter_threshold_requires_every_terminal_beyond_capacity() {
    let mut report = isolated();
    assert!(report.passed());
    report.chunks.insert("3".into(), 4);
    assert!(!report.passed());
    report.chunks.remove("3");
    assert!(!report.passed());
}

#[test]
fn x14_missing_or_reordered_markers_fail_acceptance() {
    let mut report = isolated();
    report.markers_received.reverse();
    assert!(!report.passed());
    report.markers_received.pop();
    assert!(!report.passed());
}

#[test]
fn x14_structured_lag_fails_acceptance() {
    let mut lag = isolated();
    lag.lagged = 1;
    lag.lag_errors = 1;
    assert!(!lag.passed());
}

#[tokio::test]
async fn x14_timeout_retains_incomplete_collection_and_runs_cleanup() {
    let report = perf::flood::observe(Duration::from_secs(2)).await;
    assert!(
        report
            .error
            .as_deref()
            .is_some_and(|e| e.contains("timed out"))
    );
    assert!(report.cleaned_up, "{report:?}");
    assert!(!report.chunks.is_empty());
    assert_eq!(report.stopped, report.chunks.len());
    assert!(!report.passed());
}

#[test]
fn x14_observer_error_or_cleanup_failure_cannot_pass() {
    let mut error = isolated();
    error.error = Some("startup failed".into());
    assert!(!error.passed());
    let mut cleanup = isolated();
    cleanup.cleaned_up = false;
    assert!(!cleanup.passed());
}

#[test]
fn x14_startup_failure_is_retained_with_nonzero_exit() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("report.json");
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_perf"))
        .args(["--flood", "--out"])
        .arg(&out)
        .env("TMPDIR", dir.path().join("missing"))
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(2));
    let report: serde_json::Value = serde_json::from_slice(&std::fs::read(out).unwrap()).unwrap();
    assert_eq!(report["passed"], false);
    assert!(report["flood"]["error"].is_string());
    assert_eq!(report["flood"]["chunks"], serde_json::json!({}));
}
