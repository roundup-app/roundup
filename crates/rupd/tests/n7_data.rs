//! N7: real test launches own data and leave seeded App data untouched.
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[path = "support/rupd_harness.rs"]
mod rupd_harness;

fn snapshot(path: &Path) -> Vec<(PathBuf, Vec<u8>)> {
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

#[test]
fn n7_launch_sites_use_owned_data() {
    if std::env::var_os("N7_APP_DATA").is_none() {
        let home = tempfile::tempdir().unwrap();
        let app = home.path().join("app");
        std::fs::create_dir_all(app.join("projects/seed")).unwrap();
        std::fs::write(app.join("projects/seed/keep"), b"seeded App bytes\0").unwrap();
        let before = snapshot(home.path());
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "n7_launch_sites_use_owned_data", "--nocapture"])
            .env("N7_APP_DATA", &app)
            .env("ROUNDUP_DATA_DIR", &app)
            .env("HOME", home.path())
            .env("XDG_DATA_HOME", home.path().join("xdg"))
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(snapshot(home.path()), before);
        return;
    }
    let project = tempfile::tempdir().unwrap();
    let daemon = rupd_harness::start(
        Path::new(env!("CARGO_BIN_EXE_rupd")),
        project.path(),
        false,
        |command| {
            command.stderr(Stdio::null());
        },
    );
    let data = daemon.data.as_ref().unwrap().path().to_owned();
    assert!(data.is_absolute());
    assert!(!data.starts_with(project.path()));
    assert!(data.join("projects").is_dir());
    drop(daemon);
}
