//! MC57: tests start their own core. No test source connects to the `herdr-core` on `PATH`, the
//! user's, by `connect_local` or by naming the program; a test uses `Conn::spawn` of the test-support
//! core or `Conn::over` a pipe.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::path::{Path, PathBuf};

fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            sources(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// A file is test code when it sits in `tests/`, is named `*tests.rs`, or is the `tests` module.
fn is_test_file(path: &Path) -> bool {
    let name = path.file_name().unwrap().to_string_lossy();
    path.components().any(|c| c.as_os_str() == "tests") || name.ends_with("tests.rs")
}

#[test]
fn mc57_no_test_reaches_the_users_core() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut files = Vec::new();
    sources(&root, &mut files);
    let this = Path::new(file!()).file_name().unwrap().to_owned();
    let mut hits = Vec::new();
    for path in files.iter().filter(|p| is_test_file(p)) {
        if path.file_name() == Some(&this) {
            continue;
        }
        let text = std::fs::read_to_string(path).unwrap();
        for (n, line) in text.lines().enumerate() {
            if line.contains("connect_local(") || line.contains("Command::new(\"herdr-core\")") {
                hits.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
            }
        }
    }
    assert!(
        hits.is_empty(),
        "a test connects to the user's core:\n{}",
        hits.join("\n")
    );
}
