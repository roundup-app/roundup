//! Recorded samples prove gates, never a native Mac measurement.
use perf::idle::{guard, parse_footprint};

#[test]
fn r24_window_and_host_guards_precede_side_effects() {
    for (allow, host, message) in [(None, "macos", "window"), (Some("0"), "macos", "window"), (Some("1"), "linux", "linux")] {
        let mut effects = 0;
        let result = guard(allow, host).map(|()| effects += 1);
        assert!(result.unwrap_err().contains(message));
        assert_eq!(effects, 0);
    }
}

#[test]
fn r24_samples_preserve_footprint_units_and_interval_accounting() {
    assert_eq!(parse_footprint("phys_footprint: 1.5 MiB\nphys_footprint_peak: 9 GiB").unwrap(), 1_572_864);
    assert_eq!(parse_footprint("phys_footprint: 2000000 bytes").unwrap(), 2_000_000);
    for raw in ["RSS: 42 MB", "phys_footprint_peak: 1 MB", "phys_footprint: NaN MB", "phys_footprint: -1 B"] {
        assert!(parse_footprint(raw).is_err(), "{raw}");
    }
}
