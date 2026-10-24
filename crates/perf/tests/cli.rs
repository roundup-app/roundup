//! R10 (`scenarios/perf.md`) and R3696c startup attribution.

use std::process::Command;

fn perf() -> Command {
    Command::new(env!("CARGO_BIN_EXE_perf"))
}

#[test]
fn r10_a_missing_budgets_file_exits_2_naming_it() {
    let out = perf()
        .args(["--budgets", "/nonexistent/budgets.json"])
        .output()
        .unwrap();

    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("budgets.json"));
}

#[test]
fn r10_a_missing_rupd_exits_2_naming_it() {
    let budgets = concat!(env!("CARGO_MANIFEST_DIR"), "/budgets.json");
    let out = perf()
        .args([
            "--budgets",
            budgets,
            "--runs",
            "1",
            "--rupd",
            "/nonexistent/rupd",
        ])
        .output()
        .unwrap();

    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("rupd"));
}

#[test]
fn r3696c_startup_diagnostics_survive_an_observer_failure() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let daemon = dir.path().join("rupd");
    std::fs::write(
        &daemon,
        "#!/bin/sh\nprintf 'store open failed before bind\\n' >&2\nexit 1\n",
    )
    .unwrap();
    std::fs::set_permissions(&daemon, std::fs::Permissions::from_mode(0o700)).unwrap();
    let report = dir.path().join("evidence/perf.json");
    let out = perf()
        .args([
            "--budgets",
            concat!(env!("CARGO_MANIFEST_DIR"), "/budgets.json"),
            "--runs",
            "1",
        ])
        .arg("--rupd")
        .arg(&daemon)
        .arg("--out")
        .arg(&report)
        .output()
        .unwrap();

    assert_eq!(out.status.code(), Some(2));
    let log = report.with_extension("startup-1.log");
    assert_eq!(
        std::fs::read_to_string(&log).unwrap(),
        "store open failed before bind\n"
    );
    assert!(String::from_utf8_lossy(&out.stderr).contains(&*log.to_string_lossy()));
}
