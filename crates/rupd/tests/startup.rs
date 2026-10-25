//! R3696c: a real cold start retains numeric attribution before its first ping.
use std::path::Path;

#[path = "support/rupd_harness.rs"]
mod rupd_harness;

#[test]
fn r3696c_cold_start_reports_runtime_and_store_phases() {
    let project = tempfile::tempdir().unwrap();
    let log = project.path().join("startup.log");
    let _daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        false,
        |command| {
            command.stderr(std::fs::File::create(&log).unwrap());
        },
    );
    let text = std::fs::read_to_string(log).unwrap();
    let phases: serde_json::Value = serde_json::from_str(
        text.lines()
            .find_map(|line| line.strip_prefix("rupd: startup "))
            .expect("the real Daemon must retain startup attribution"),
    )
    .unwrap();
    let runtime: f64 = text
        .lines()
        .find_map(|line| line.strip_prefix("rupd: runtime_ms "))
        .expect("runtime creation must be measured before async main")
        .parse()
        .unwrap();
    assert!(runtime.is_finite() && runtime >= 0.0);
    for phase in [
        "storage_ms",
        "base_ms",
        "agents_ms",
        "services_ms",
        "messages_ms",
    ] {
        let millis = phases[phase]
            .as_f64()
            .unwrap_or_else(|| panic!("missing numeric phase {phase}: {text}"));
        assert!(
            millis.is_finite() && millis >= 0.0,
            "invalid {phase}: {text}"
        );
    }
}
