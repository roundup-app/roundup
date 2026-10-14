use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn snapshot(path: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut entries = Vec::new();
    fn visit(root: &Path, path: &Path, entries: &mut Vec<(PathBuf, Vec<u8>)>) {
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            entries.push((
                path.strip_prefix(root).unwrap().to_owned(),
                if path.is_file() {
                    std::fs::read(&path).unwrap()
                } else {
                    Vec::new()
                },
            ));
            if path.is_dir() {
                visit(root, &path, entries);
            }
        }
    }
    visit(path, path, &mut entries);
    entries.sort();
    entries
}

// Each test re-enters in a separate executable so inherited environment is exercised
// without mutating the parallel test runner's environment.
pub fn isolated(test: &str) -> bool {
    if std::env::var_os("N7_APP_DATA").is_some() {
        return false;
    }
    let home = tempfile::tempdir().unwrap();
    let run = tempfile::tempdir().unwrap();
    let app = home.path().join("app");
    for path in [
        app.clone(),
        home.path().join(".local/share/dev.roundup.app"),
        home.path()
            .join("Library/Application Support/dev.roundup.app"),
        home.path().join("xdg/dev.roundup.app"),
    ] {
        std::fs::create_dir_all(path.join("projects/seed")).unwrap();
        std::fs::write(path.join("projects/seed/keep"), b"seeded App bytes\0").unwrap();
    }
    let before = snapshot(home.path());
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", test, "--nocapture"])
        .env("N7_APP_DATA", &app)
        .env("ROUNDUP_DATA_DIR", &app)
        .env("HOME", home.path())
        .env("XDG_DATA_HOME", home.path().join("xdg"))
        .env("TMPDIR", run.path())
        .status()
        .unwrap();
    assert!(status.success());
    assert_eq!(snapshot(home.path()), before);
    assert!(
        snapshot(run.path()).is_empty(),
        "owned temporary directories leaked"
    );
    true
}

pub fn assert_exited(pid: u32) {
    assert!(
        !Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success(),
        "Daemon was not reaped"
    );
}
