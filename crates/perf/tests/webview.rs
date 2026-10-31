//! Scenario R11 (`scenarios/perf.md`): what the keystroke runner accepts from the webview.

use perf::webview::{checked, judge_runs, perf_line};
use serde_json::json;

fn hops() -> serde_json::Value {
    let hop = json!({ "n": 1000, "p50": 0.0, "p95": 0.0 });
    let mut all = serde_json::Map::new();
    for name in perf::webview::HOPS {
        all.insert(name.into(), hop.clone());
    }
    all.into()
}

fn report(frame_ms: f64, dropped: u64) -> serde_json::Value {
    json!({ "n": 1000, "p95": 9.0, "frame_ms": frame_ms, "dropped": dropped, "keys": 1000, "hops": hops(),
        "timer_resolution_ms": 0.001, "hop_uncertainty_ms": 0.501,
        "calibration": {"offset_ms": 100, "uncertainty_ms": 0.501, "resolution_ms": 0.001,
        "exchanges": [{"sent": 0, "daemon": 100.5, "received": 1}, {"sent": 1000, "daemon": 1100.5, "received": 1001}]} })
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
        json!({"n": 1000, "frame_ms": 16, "keys": 1000, "dropped": 0, "p95": -1, "hops": hops()}),
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
    for name in [
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
    ] {
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
}

#[test]
fn r20_invalid_hop_distributions_cannot_authorize_a_latency_verdict() {
    for name in perf::webview::HOPS {
        for invalid in [
            json!({"n": 1, "p50": 1, "p95": 2}),
            json!({"n": 1001, "p50": 1, "p95": 2}),
            json!({"n": 999.5, "p50": 1, "p95": 2}),
            json!({"n": 1000, "p50": -1, "p95": 2}),
            json!({"n": 1000, "p50": -2, "p95": -1}),
            json!({"n": 1000, "p50": 3, "p95": 2}),
            json!({"n": 1000, "p50": null, "p95": 2}),
            json!({"n": 1000, "p50": 1, "p95": "2"}),
        ] {
            let mut invalid_report = report(16.7, 0);
            invalid_report["hops"][name] = invalid;
            let (exit, failures) = judge_runs(&[report(16.7, 0), invalid_report], 16.0);
            assert_eq!(exit, 2, "accepted invalid {name}: {failures:?}");
            assert!(
                failures
                    .iter()
                    .any(|message| message.contains("run 2") && message.contains(name)),
                "{failures:?}"
            );
        }
    }
}

#[test]
fn r20_missing_measured_keys_cannot_be_silently_skipped() {
    for invalid_n in [
        json!(null),
        json!(-1),
        json!(0),
        json!(999),
        json!(1001),
        json!(999.5),
    ] {
        let mut invalid_report = report(16.7, 0);
        invalid_report["n"] = invalid_n;
        let (exit, failures) = judge_runs(&[invalid_report], 16.0);
        assert_eq!(exit, 2, "accepted an inconsistent sample count");
        assert!(failures[0].contains("sample count"), "{failures:?}");
    }

    // A rendered subset is still a valid observation when the rest were dropped;
    // it must retain a budget failure rather than turn into an observer error.
    let mut dropped = report(16.7, 1);
    dropped["n"] = json!(999);
    for name in perf::webview::HOPS {
        dropped["hops"][name]["n"] = json!(999);
    }
    assert_eq!(judge_runs(&[dropped], 16.0).0, 1);
}

#[test]
fn r20_invalid_calibration_cannot_authorize_a_latency_verdict() {
    let valid = report(16.7, 0)["calibration"].clone();
    let mut cases = vec![
        json!(null),
        json!({"offset_ms": 10, "uncertainty_ms": 0, "exchanges": []}),
    ];
    for field in ["offset_ms", "uncertainty_ms", "resolution_ms"] {
        let mut forged = valid.clone();
        forged[field] = json!(99);
        cases.push(forged);
    }
    for exchange in [
        json!({"sent": 1002, "daemon": 1100.5, "received": 1001}),
        json!({"sent": 1000, "daemon": 9100.5, "received": 1001}),
        json!({"sent": 1000, "daemon": null, "received": 1001}),
    ] {
        let mut forged = valid.clone();
        forged["exchanges"][1] = exchange;
        cases.push(forged);
    }
    for calibration in cases {
        let mut invalid = report(16.7, 0);
        invalid["calibration"] = calibration;
        assert_eq!(judge_runs(&[invalid], 16.0).0, 2);
    }
}

mod switch {
    use perf::gate::read_budgets;
    use perf::webview::judge_switch;
    use serde_json::{Value, json};
    use std::path::Path;

    fn budgets() -> perf::budget::Budgets {
        read_budgets(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("keystroke-budgets.json")
                .as_path(),
        )
        .unwrap()
    }

    fn run(open: f64, switch: f64) -> Value {
        json!({
            "frame_ms": 16.7, "switcher_open_p95_ms": open, "switch_p95_ms": switch,
            "switcher_open": {"n": 100, "dropped": 0}, "switch": {"n": 100, "dropped": 0},
        })
    }

    fn judge(reports: &[Value]) -> (u8, Vec<String>) {
        judge_switch(reports, &budgets(), "macos", &[0.1], 8)
    }

    #[test]
    fn sp5_budgets() {
        let budgets = budgets();
        assert_eq!(budgets["switcher_open_p95_ms"].limit, Some(80.0));
        assert_eq!(budgets["switch_p95_ms"].limit, Some(32.0));
        assert_eq!(budgets["keystroke_p95_ms"].limit, Some(16.0));
        assert!(budgets["switcher_open_p95_ms"].baseline.is_empty());
        assert!(budgets["switch_p95_ms"].baseline.is_empty());
        assert_eq!(judge(&[run(80.0, 32.0)]).0, 0);
        let (exit, failures) = judge(&[run(80.1, 32.0)]);
        assert_eq!(exit, 1);
        assert!(
            failures[0].contains("switcher_open_p95_ms")
                && failures[0].contains("80.1")
                && failures[0].contains("80")
        );
        let (exit, failures) = judge(&[run(10.0, 32.1)]);
        assert_eq!((exit, failures.len()), (1, 1));
        assert!(failures[0].contains("switch_p95_ms"));
    }

    #[test]
    fn sp5_a_baseline_makes_ten_percent_over_it_fail() {
        let mut budgets = budgets();
        budgets
            .get_mut("switch_p95_ms")
            .unwrap()
            .baseline
            .insert("macos".into(), 20.0);
        let judge = |value| judge_switch(&[run(10.0, value)], &budgets, "macos", &[0.1], 8);
        assert_eq!(judge(22.0).0, 0);
        let (exit, failures) = judge(22.1);
        assert_eq!(exit, 1);
        assert!(failures[0].contains("baseline 20"));
    }

    #[test]
    fn sp6_report_validation() {
        let mut errored = run(10.0, 10.0);
        errored["error"] = json!("boom");
        let mut slow = run(10.0, 10.0);
        slow["frame_ms"] = json!(25.1);
        let mut no_open = run(10.0, 10.0);
        no_open
            .as_object_mut()
            .unwrap()
            .remove("switcher_open_p95_ms");
        let mut no_switch = run(10.0, 10.0);
        no_switch.as_object_mut().unwrap().remove("switch_p95_ms");
        let mut dropped = run(10.0, 10.0);
        dropped["switch"] = json!({"n": 94, "dropped": 6});
        for bad in [errored, slow, no_open, no_switch, dropped] {
            // An over-limit run beside it never turns exit 2 into exit 1.
            assert_eq!(judge(&[run(90.0, 10.0), bad]).0, 2);
        }
        let mut edge = run(10.0, 10.0);
        edge["switcher_open"] = json!({"n": 95, "dropped": 5});
        assert_eq!(judge(&[edge]).0, 0);
        // The median over runs decides, not the worst run.
        assert_eq!(
            judge(&[run(70.0, 10.0), run(90.0, 10.0), run(75.0, 10.0)]).0,
            0
        );
        assert_eq!(judge(&[]).0, 2);
        // R7: a budgeted metric the runs did not measure is an error.
        let mut budgets = budgets();
        budgets.remove("switch_p95_ms");
        assert_eq!(
            judge_switch(&[run(1.0, 1.0)], &budgets, "macos", &[0.1], 8).0,
            2
        );
    }
}
