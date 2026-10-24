//! Scenario R11 (`scenarios/perf.md`): what the keystroke runner accepts from the webview.

use perf::webview::{checked, judge_runs, perf_line};
use serde_json::json;

fn hops() -> serde_json::Value {
    let hop = json!({ "n": 1000, "p50": 1.0, "p95": 2.0 });
    let mut all = serde_json::Map::new();
    for name in perf::webview::HOPS {
        all.insert(name.into(), hop.clone());
    }
    all.into()
}

fn report(frame_ms: f64, dropped: u64) -> serde_json::Value {
    json!({ "p95": 9.0, "frame_ms": frame_ms, "dropped": dropped, "keys": 1000, "hops": hops() })
}

#[test]
fn r11_the_perf_line_is_found_once_complete_among_echoed_keys() {
    assert_eq!(perf_line("aaaPERF {\"p95\":9}"), None);
    assert_eq!(perf_line("aaaPERF {\"p95\":9}\nrest"), Some("{\"p95\":9}"));
}

#[test]
fn r11_a_throttled_window_is_refused_naming_the_frame_time() {
    let err = checked(&report(500.0, 0)).unwrap_err().to_string();

    assert!(err.contains("500.0 ms") && err.contains("front"));
}

#[test]
fn r11_a_failure_the_webview_reported_is_refused_with_its_message() {
    let err = checked(&json!({ "error": "the + terminal button did not appear" }))
        .unwrap_err()
        .to_string();

    assert!(err.contains("+ terminal button"));
}

#[test]
fn r11_the_frame_time_limit_is_25_ms_inclusive() {
    assert!(checked(&report(25.0, 0)).is_ok());
    assert!(checked(&report(25.1, 0)).is_err());
}

#[test]
fn r21_each_run_must_meet_the_latency_and_drop_budget() {
    for (p95, dropped, expected, reason) in [
        (15.999, 0, 0, ""),
        (16.0, 0, 1, "p95 16"),
        (16.001, 0, 1, "p95 16.001"),
        (9.0, 1, 1, "1 dropped"),
    ] {
        let mut middle = report(16.7, dropped);
        middle["p95"] = json!(p95);
        let (exit, failures) = judge_runs(&[report(16.7, 0), middle, report(16.7, 0)], 16.0);
        assert_eq!(exit, expected);
        if expected != 0 {
            assert!(
                failures
                    .iter()
                    .any(|message| message.contains("run 2") && message.contains(reason)),
                "{failures:?}"
            );
        }
    }
}

#[test]
fn r21_invalid_observation_never_has_a_latency_verdict() {
    for invalid in [
        json!({"error": "missing PERF line"}),
        report(25.1, 0),
        json!({"p95": 1}),
        json!({"frame_ms": 16, "keys": 1000, "dropped": 0, "p95": -1, "hops": hops()}),
    ] {
        let (exit, failures) = judge_runs(&[report(16.7, 0), invalid], 16.0);
        assert_eq!(exit, 2);
        assert!(failures.iter().any(|message| message.contains("run 2")));
    }
    assert_eq!(judge_runs(&[], 16.0).0, 2);
}

#[test]
fn u3010e_the_frames_line_is_found_by_its_own_marker() {
    assert_eq!(
        perf::webview::marked_line("x\nFRAMES {\"exit\":2}\nrest", "FRAMES "),
        Some("{\"exit\":2}")
    );
    assert_eq!(
        perf::webview::marked_line("PERF {\"p95\":9}\n", "FRAMES "),
        None
    );
}

#[test]
fn r20_hop_report_accounts_for_the_echo_round_trip() {
    for name in perf::webview::HOPS {
        let mut missing = report(16.7, 0);
        missing["hops"][name] = json!({ "n": 0, "p50": null, "p95": null });
        let err = checked(&missing).unwrap_err().to_string();
        assert!(
            err.contains("hop attribution") && err.contains(name),
            "{err}"
        );

        let mut absent = report(16.7, 0);
        absent["hops"].as_object_mut().unwrap().remove(name);
        assert!(checked(&absent).is_err());
    }
    let mut no_hops = report(16.7, 0);
    no_hops.as_object_mut().unwrap().remove("hops");
    let (exit, failures) = judge_runs(&[no_hops], 16.0);
    assert_eq!(exit, 2);
    assert!(failures[0].contains("hop attribution"));
}
