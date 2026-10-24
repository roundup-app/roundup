//! N7: direct launch failure must preserve seeded App data and reap the Daemon.
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

fn snapshot(root: &Path) -> BTreeMap<std::path::PathBuf, Vec<u8>> {
    fn visit(root: &Path, dir: &Path, out: &mut BTreeMap<std::path::PathBuf, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            out.insert(
                path.strip_prefix(root).unwrap().to_owned(),
                if path.is_dir() {
                    vec![]
                } else {
                    std::fs::read(&path).unwrap()
                },
            );
            if path.is_dir() {
                visit(root, &path, out);
            }
        }
    }
    let mut out = BTreeMap::new();
    visit(root, root, &mut out);
    out
}

#[test]
fn n7_launch_sites_use_owned_data() {
    let dir = tempfile::tempdir().unwrap();
    let seed = dir.path().join("app-data");
    std::fs::create_dir_all(seed.join("projects/project-seeded")).unwrap();
    std::fs::write(seed.join("projects/project-seeded/db"), b"seed bytes").unwrap();
    let before = snapshot(&seed);
    let log = dir.path().join("log");
    let daemon = dir.path().join("rupd");
    std::fs::write(&daemon, "#!/bin/sh\nprintf '%s\\n' \"$ROUNDUP_DATA_DIR\" > \"$N7_LOG\"\nmkdir -p \"$ROUNDUP_DATA_DIR/projects/project-new\"\nexit 1\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&daemon, std::fs::Permissions::from_mode(0o755)).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_perf"))
        .args([
            "--runs",
            "1",
            "--budgets",
            concat!(env!("CARGO_MANIFEST_DIR"), "/budgets.json"),
            "--rupd",
        ])
        .arg(&daemon)
        .env("ROUNDUP_DATA_DIR", &seed)
        .env("N7_LOG", &log)
        .output()
        .unwrap();
    assert!(!out.status.success());
    let data = std::fs::read_to_string(log)
        .unwrap_or_else(|err| panic!("{err}: {}", String::from_utf8_lossy(&out.stderr)));
    assert!(Path::new(data.trim()).is_absolute());
    assert_ne!(Path::new(data.trim()), seed);
    assert!(!Path::new(data.trim()).exists());
    assert_eq!(snapshot(&seed), before);
}

const CLASSES: [&str; 5] = [
    "linux-9v45",
    "linux-7763",
    "linux-9v74",
    "linux-8573c",
    "linux-8370c",
];

/// Budgets and provenance that give every known Linux class a baseline, so launch cleanup is observed on whichever class runs the test.
fn every_class_budgets(dir: &Path) -> std::path::PathBuf {
    let src = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut budgets: serde_json::Value =
        serde_json::from_slice(&std::fs::read(src.join("budgets.json")).unwrap()).unwrap();
    for budget in budgets.as_object_mut().unwrap().values_mut() {
        let Some(baseline) = budget.get_mut("baseline").and_then(|b| b.as_object_mut()) else {
            continue;
        };
        let Some(value) = baseline.get("linux-boxd").cloned() else {
            continue;
        };
        for key in CLASSES {
            baseline.insert(key.into(), value.clone());
        }
    }
    let path = dir.join("budgets.json");
    std::fs::write(&path, serde_json::to_vec(&budgets).unwrap()).unwrap();
    let classes: serde_json::Value = [
        "linux-9v45",
        "linux-7763",
        "linux-9v74",
        "linux-8573c",
        "linux-8370c",
    ]
    .into_iter()
    .map(|key| (key.to_string(), serde_json::Value::from("test")))
    .collect::<serde_json::Map<_, _>>()
    .into();
    std::fs::write(
        dir.join("classes.json"),
        serde_json::to_vec(&classes).unwrap(),
    )
    .unwrap();
    path
}

#[test]
fn n7_launch_sites_clean_on_success_and_failure() {
    use std::os::unix::fs::PermissionsExt;
    let bin = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_owned();
    let rupd = bin.join("rupd");
    let rup = bin.join("rup");
    assert!(
        rupd.is_file() && rup.is_file(),
        "build rupd and rup before testing real launches"
    );
    for fail_hook in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let seed = dir.path().join("app-data");
        std::fs::create_dir_all(seed.join("projects/project-existing")).unwrap();
        std::fs::write(seed.join("projects/project-existing/db"), b"original bytes").unwrap();
        let before = snapshot(&seed);
        let log = dir.path().join("launches");
        let wrapper = dir.path().join("rupd");
        std::fs::write(&wrapper, "#!/bin/sh\nprintf '%s %s\\n' \"$ROUNDUP_DATA_DIR\" \"$$\" >> \"$N7_LOG\"\nexec \"$N7_DAEMON\" \"$@\"\n").unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
        let failing_rup = dir.path().join("rup");
        std::fs::write(&failing_rup, "#!/bin/sh\nexit 1\n").unwrap();
        std::fs::set_permissions(&failing_rup, std::fs::Permissions::from_mode(0o755)).unwrap();
        let report = dir.path().join("report.json");
        let budgets = every_class_budgets(dir.path());
        let out = Command::new(env!("CARGO_BIN_EXE_perf"))
            .args(["--runs", "1", "--calls", "1", "--budgets"])
            .arg(&budgets)
            .arg("--rupd")
            .arg(&wrapper)
            .arg("--rup")
            .arg(if fail_hook { &failing_rup } else { &rup })
            .arg("--out")
            .arg(&report)
            .env("ROUNDUP_DATA_DIR", &seed)
            .env("N7_LOG", &log)
            .env("N7_DAEMON", &rupd)
            .env("HOME", dir.path())
            .env("XDG_DATA_HOME", dir.path().join("xdg"))
            .output()
            .unwrap();
        if fail_hook {
            assert!(!out.status.success());
            assert!(
                String::from_utf8_lossy(&out.stderr).contains("rup signal exited"),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
        } else {
            assert!(report.is_file(), "{}", String::from_utf8_lossy(&out.stderr));
        }
        let launches = std::fs::read_to_string(log).unwrap();
        assert_eq!(
            launches.lines().count(),
            2,
            "both one_run and hook_loop must launch"
        );
        for row in launches.lines() {
            let (data, pid) = row.rsplit_once(' ').unwrap();
            assert!(Path::new(data).is_absolute());
            assert_ne!(Path::new(data), seed);
            assert!(!Path::new(data).exists(), "data survived cleanup: {data}");
            let mut system = sysinfo::System::new();
            let pid = sysinfo::Pid::from_u32(pid.parse().unwrap());
            system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
            assert!(system.process(pid).is_none(), "Daemon not reaped");
        }
        assert_eq!(snapshot(&seed), before);
        assert!(!dir.path().join(".local/share/dev.roundup.app").exists());
        assert!(!dir.path().join("xdg/dev.roundup.app").exists());
        assert!(
            !dir.path()
                .join("Library/Application Support/dev.roundup.app")
                .exists()
        );
    }
}

#[test]
fn n7_zero_calls_fails_before_launch() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("launched");
    let daemon = dir.path().join("rupd");
    std::fs::write(&daemon, "#!/bin/sh\necho launched > \"$N7_LOG\"\nexit 1\n").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&daemon, std::fs::Permissions::from_mode(0o755)).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_perf"))
        .args([
            "--runs",
            "1",
            "--calls",
            "0",
            "--budgets",
            concat!(env!("CARGO_MANIFEST_DIR"), "/budgets.json"),
            "--rupd",
        ])
        .arg(daemon)
        .env("N7_LOG", &log)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("calls must be positive"));
    assert!(!log.exists());
}
