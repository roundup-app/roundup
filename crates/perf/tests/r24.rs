//! Recorded samples prove gates, never a native Mac measurement.
use perf::idle::{guard, parse_footprint};

#[test]
fn r24_samples_preserve_footprint_units_and_interval_accounting() {
    assert_eq!(
        parse_footprint("phys_footprint: 2000000").unwrap(),
        2_000_000
    );
    assert_eq!(
        parse_footprint("phys_footprint: 1.5 MiB\nphys_footprint_peak: 9 GiB").unwrap(),
        1_572_864
    );
    assert_eq!(
        parse_footprint("phys_footprint: 2000000 bytes").unwrap(),
        2_000_000
    );
    for raw in [
        "RSS: 42 MB",
        "phys_footprint_peak: 1 MB",
        "phys_footprint: NaN MB",
        "phys_footprint: -1 B",
    ] {
        assert!(parse_footprint(raw).is_err(), "{raw}");
    }
}

use perf::idle::{
    Interval, Journal, Member, Phase, STATES, Settings, State, conclude, membership, same_members,
};
use std::collections::BTreeMap;
fn member(pid: u32, name: &str, responsible: Option<u32>) -> Member {
    Member {
        pid,
        started: 42,
        parent: Some(1),
        name: name.into(),
        role: String::new(),
        responsible,
    }
}
fn settings() -> Settings {
    Settings {
        hashes: BTreeMap::from([
            ("app".into(), "a".into()),
            ("rupd".into(), "b".into()),
            ("rup".into(), "c".into()),
        ]),
        release: "release unwind".into(),
        renderer: "webgl".into(),
        terminal: "selected".into(),
        project: "/isolated".into(),
        width: 1000,
        height: 700,
        scale: 2.0,
        physical_width: 2000,
        physical_height: 1400,
        display_power: "AC, low power off, 60Hz".into(),
    }
}
fn provenance() -> BTreeMap<String, String> {
    [
        "commit",
        "hardware",
        "macos",
        "display_power",
        "tools",
        "commands",
        "release",
        "evidence",
        "clock_correlation",
    ]
    .map(|k| (k.into(), "synthetic; not native evidence".into()))
    .into()
}
fn phases() -> Vec<Phase> {
    [10, 1]
        .into_iter()
        .flat_map(|count| {
            STATES.map(|state| Phase {
                count,
                state,
                settings: settings(),
                members: vec![member(1, "roundup", Some(1))],
                absent_roles: vec![],
                settle_s: 5.0,
                intervals: (0..60)
                    .map(|n| Interval {
                        start_s: f64::from(n),
                        end_s: f64::from(n + 1),
                        cpu: BTreeMap::from([(1, 0.1)]),
                        idlew: BTreeMap::from([(1, 1)]),
                    })
                    .collect(),
                footprint_bytes: BTreeMap::from([(
                    1,
                    if count == 10 {
                        290_000_000
                    } else {
                        209_000_000
                    },
                )]),
                errors: vec![],
                raw: "fixture".into(),
            })
        })
        .collect()
}
#[test]
fn r24_tree_membership_excludes_unrelated_and_vendor_children() {
    let mut inventory = vec![
        member(1, "roundup", Some(1)),
        member(2, "rupd", Some(1)),
        member(3, "com.apple.WebKit.WebContent", Some(1)),
        member(4, "com.apple.WebKit.WebContent", Some(1)),
        member(5, "com.apple.WebKit.GPU", Some(99)),
        member(6, "claude", Some(1)),
    ];
    inventory[4].parent = Some(99);
    inventory[5].parent = Some(1);
    let selected = membership(&inventory, 1, 2).unwrap();
    assert_eq!(
        selected.iter().map(|p| p.pid).collect::<Vec<_>>(),
        [1, 2, 3, 4]
    );
    let mut reused = selected.clone();
    reused[2].started += 1;
    assert!(same_members(&selected, &reused).is_err());
    assert!(same_members(&selected, &selected[..3]).is_err());
    inventory[4].responsible = None;
    assert!(
        membership(&inventory, 1, 2)
            .unwrap_err()
            .contains("unresolved")
    );
}
#[test]
fn r24_idle_limits_apply_per_process_and_phase() {
    assert_eq!(conclude(phases(), provenance(), vec![]).exit, 0);
    for (cpu, expected) in [(0.0, 1), (0.3, 1)] {
        let mut p = phases();
        p[1].members
            .push(member(2, "com.apple.WebKit.GPU", Some(1)));
        p[1].footprint_bytes.insert(1, 140_000_000);
        p[1].footprint_bytes.insert(2, 150_000_000);
        for interval in &mut p[1].intervals {
            interval.cpu.insert(1, cpu);
            interval.cpu.insert(2, 0.2);
            interval.idlew.insert(1, 0);
            interval.idlew.insert(2, if cpu == 0.0 { 2 } else { 0 });
        }
        assert_eq!(conclude(p, provenance(), vec![]).exit, expected);
    }
    for (cpu, wake, expected) in [(0.499, 1, 0), (0.5, 1, 1), (0.1, 2, 1)] {
        let mut p = phases();
        for row in &mut p[4].intervals {
            row.cpu.insert(1, cpu);
            row.idlew.insert(1, wake);
        }
        assert_eq!(conclude(p, provenance(), vec![]).exit, expected);
    }
    let mut p = phases();
    for row in &mut p[0].intervals {
        row.cpu.insert(1, 50.0);
        row.idlew.insert(1, 100);
    }
    assert_eq!(
        conclude(p, provenance(), vec![]).exit,
        0,
        "focused has no invented numeric ceiling"
    );
}
#[test]
fn r24_memory_aims_compare_matching_states() {
    let report = conclude(phases(), provenance(), vec![]);
    assert_eq!(report.pairs[0].extra_bytes_per_agent, 9_000_000.0);
    for (ten, one, expected) in [
        (300_000_000, 220_000_000, 1),
        (299_000_000, 209_000_000, 1),
        (100_000_000, 109_000_000, 0),
    ] {
        let mut p = phases();
        p[0].footprint_bytes.insert(1, ten);
        p[3].footprint_bytes.insert(1, one);
        let report = conclude(p, provenance(), vec![]);
        assert_eq!(report.exit, expected);
        if ten == 100_000_000 {
            assert_eq!(report.pairs[0].extra_bytes_per_agent, -1_000_000.0);
        }
    }
    let mut p = phases();
    p[3].settings
        .hashes
        .insert("app".into(), "different".into());
    assert_eq!(conclude(p, provenance(), vec![]).exit, 2);
    let mut p = phases();
    p.pop();
    assert_eq!(conclude(p, provenance(), vec![]).exit, 2);
}
#[test]
fn r24_report_retains_failures_and_observer_errors() {
    let mut p = phases();
    p[0].footprint_bytes.insert(1, 400_000_000);
    p[4].intervals[0].cpu.insert(1, 60.0);
    for reason in [
        "missing tool /usr/bin/top: status 1 stderr denied",
        "launch failure",
        "output during phase",
        "PID reused",
        "parse error",
    ] {
        let report = conclude(p.clone(), provenance(), vec![reason.into()]);
        assert_eq!(report.exit, 2);
        assert!(report.findings.iter().any(|f| f.exit == 1));
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains(reason));
        assert!(json.contains("provisional"));
        assert!(json.contains("pending"));
    }
    assert_eq!(conclude(p, BTreeMap::new(), vec![]).exit, 2);
    for defect in ["duration", "gap", "pid", "nan", "settle", "activity"] {
        let mut p = phases();
        match defect {
            "duration" => {
                p[1].intervals.pop();
            }
            "gap" => p[1].intervals[1].start_s = 1.5,
            "pid" => {
                p[1].intervals[1].cpu.clear();
            }
            "nan" => {
                p[1].intervals[1].cpu.insert(1, f64::NAN);
            }
            "settle" => p[1].settle_s = 4.9,
            _ => p[1].errors.push("non-idle Agent/output".into()),
        }
        assert_eq!(conclude(p, provenance(), vec![]).exit, 2, "{defect}");
    }
}

fn journal_rows() -> Vec<serde_json::Value> {
    use serde_json::json;
    vec![
        json!({"source":"start","body":{"pid":1}}),
        json!({"source":"native","body":{"focused":true,"visible":true,"minimized":false,"width":2000,"height":1400,"scale":2}}),
        json!({"source":"application","body":{"hidden":false}}),
        json!({"source":"webview","body":{"seq":1,"at_ms":1,"cause":"initial","visibility":"visible","focused":true,"project":"/isolated","terminal":"selected","renderer":"webgl","width":1000,"height":700}}),
        json!({"source":"checkpoint","body":{"web_seq":1}}),
        json!({"source":"end","body":"App exited"}),
    ]
}
fn journal_raw(mut rows: Vec<serde_json::Value>) -> String {
    rows.iter_mut()
        .enumerate()
        .map(|(n, row)| {
            row["v"] = 1.into();
            row["seq"] = (n + 1).into();
            if row.get("at_us").is_none() {
                row["at_us"] = if n < 4 { 0 } else { 100_000_000 }.into();
            }
            format!("{row}\n")
        })
        .collect()
}
#[test]
fn r24_phase_protocol_rejects_incomplete_or_active_samples() {
    use serde_json::json;
    let raw = journal_raw(journal_rows());
    let journal = Journal::parse(&raw, 0.1, 1, true).unwrap();
    assert!(
        journal
            .phase(State::Focused, 5.0, 65.0, &settings())
            .is_ok()
    );
    assert!(
        journal
            .phase(State::Hidden, 5.0, 65.0, &settings())
            .is_err()
    );
    for defect in [
        "transition",
        "selection",
        "renderer",
        "resize",
        "sequence",
        "partial",
        "checkpoint",
        "loss",
    ] {
        let mut rows = journal_rows();
        match defect {
            "transition" => rows.insert(
                4,
                json!({"at_us":10_000_000,"source":"window-event","body":{"focused":false}}),
            ),
            "selection" | "renderer" | "resize" => {
                let mut row = rows[3].clone();
                row["at_us"] = 70_000_000.into();
                row["body"]["seq"] = 2.into();
                row["body"]["at_ms"] = 10_000.into();
                // Receipt after the sample cannot hide a transition whose renderer time overlaps it.
                match defect {
                    "selection" => row["body"]["terminal"] = "other".into(),
                    "renderer" => row["body"]["renderer"] = "dom".into(),
                    _ => row["body"]["width"] = 999.into(),
                }
                rows.insert(4, row);
                rows[5]["body"]["web_seq"] = 2.into();
            }
            "sequence" => rows[3]["body"]["seq"] = 2.into(),
            "checkpoint" => {
                rows.remove(4);
            }
            "loss" => rows.insert(
                4,
                json!({"at_us":10_000_000,"source":"error","body":"lost event"}),
            ),
            _ => (),
        }
        let mut raw = journal_raw(rows);
        if defect == "partial" {
            raw.pop();
        }
        let result = Journal::parse(&raw, 0.1, 1, true)
            .and_then(|j| j.phase(State::Focused, 5.0, 65.0, &settings()));
        assert!(result.is_err(), "{defect}");
    }
    use contracts::common::Kind::{Idle, Working};
    assert!(perf::idle::activity(1, &[Idle, Idle], &[(10, 10)], &[]).is_ok());
    assert!(perf::idle::activity(1, &[Idle, Idle], &[(10, 11)], &[]).is_err());
    assert!(perf::idle::activity(1, &[Idle, Idle], &[(10, 10)], &[Working, Idle]).is_err());
    assert!(perf::idle::activity(1, &[Idle], &[(10, 10)], &[]).is_err());
    let mut p = phases();
    p.swap(1, 2);
    assert_eq!(conclude(p, provenance(), vec![]).exit, 2);
}

#[test]
fn r24_nonuniform_delta_samples_discard_initial_accounting() {
    let mut samples = perf::idle::TopSamples::default();
    for second in 0..=61 {
        let done = samples
            .push(f64::from(second), "Processes: 1 total")
            .unwrap();
        if done {
            assert_eq!(second, 61);
            break;
        }
        for line in [
            "PID COMMAND %CPU IDLEW",
            if second == 0 {
                "1 roundup NaN lifetime"
            } else {
                "1 roundup 0.1 1"
            },
        ] {
            samples.push(f64::from(second), line).unwrap();
        }
    }
    let collected = samples.finish().unwrap();
    assert_eq!(collected.len(), 60);
    assert_eq!(collected[0].cpu[&1], 0.1);
    assert_eq!(collected[59].end_s, 60.0);
    assert!(perf::idle::TopSamples::default().finish().is_err());
    let (cpu, idlew) =
        perf::idle::parse_top("Processes: 1 total\nPID COMMAND %CPU IDLEW\n1 roundup 0.4 1\n")
            .unwrap();
    let mut p = phases();
    // A worked 60-second example: 20s at .4%, 40s at .1%; one wake each interval.
    p[1].intervals = (0..40)
        .map(|n| {
            let start = if n < 20 {
                f64::from(n)
            } else {
                20.0 + f64::from(n - 20) * 2.0
            };
            let dt = if n < 20 { 1.0 } else { 2.0 };
            Interval {
                start_s: start,
                end_s: start + dt,
                cpu: if n < 20 {
                    cpu.clone()
                } else {
                    BTreeMap::from([(1, 0.1)])
                },
                idlew: idlew.clone(),
            }
        })
        .collect();
    let report = conclude(p, provenance(), vec![]);
    assert_eq!(report.exit, 0);
    assert!((report.values[1].cpu_one_core_percent - 0.2).abs() < 1e-9);
    assert!((report.values[1].wakeups_per_second[&1] - 2.0 / 3.0).abs() < 1e-9);
    for raw in [
        "PID COMMAND %CPU IDLEW\n1 roundup NaN 0",
        "PID COMMAND %CPU IDLEW\n1 roundup 0 N/A",
        "PID COMMAND %CPU\n1 roundup 0",
        "PID COMMAND %CPU IDLEW\n1 roundup -1 0",
    ] {
        assert!(perf::idle::parse_top(raw).is_err());
    }
}

#[test]
fn r24_window_and_host_guards_precede_side_effects() {
    assert!(guard(Some("1"), "linux").unwrap_err().contains("linux"));
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let forbidden = dir.path().join("forbidden");
    for name in ["cargo", "pnpm", "uname"] {
        let path = dir.path().join(name);
        std::fs::write(
            &path,
            format!(
                "#!/bin/sh\ntouch {}\nexit 83\n",
                shlex::try_quote(forbidden.to_str().unwrap()).unwrap()
            ),
        )
        .unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let direct = std::process::Command::new(env!("CARGO_BIN_EXE_perf-idle"))
        .env_remove("ROUNDUP_ALLOW_WINDOW")
        .arg("--out")
        .arg(dir.path().join("report.json"))
        .output()
        .unwrap();
    assert_eq!(direct.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&direct.stderr).contains("window"));
    assert!(!dir.path().join("report.json").exists());
    let mut paths = vec![dir.path().to_owned()];
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
    let recipe = std::process::Command::new("just")
        .arg("perf-idle")
        .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .env_remove("ROUNDUP_ALLOW_WINDOW")
        .env("PATH", std::env::join_paths(paths).unwrap())
        .output()
        .unwrap();
    assert!(!recipe.status.success());
    assert!(String::from_utf8_lossy(&recipe.stderr).contains("window"));
    assert!(!forbidden.exists());
}
