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
