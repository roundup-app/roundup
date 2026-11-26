//! U7960a, U7960b: the comparison base is kept until HEAD or remote main moves, and the change is
//! read in one diff (`scenarios/perf.md`).

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use agents::worktree::{Git, Worktree};
use contracts::agent::CompareTarget;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@t"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn write(dir: &Path, name: &str, text: &str) {
    std::fs::write(dir.join(name), text).unwrap();
}

/// A `git` on `PATH` that logs each command line to `log` and runs the real one.
fn counting(wrappers: &Path, log: &Path) -> Git {
    let real = String::from_utf8(
        std::process::Command::new("sh")
            .args(["-c", "command -v git"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let wrapper = wrappers.join("git");
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho \"$*\" >> '{}'\nexec '{}' \"$@\"\n",
            log.display(),
            real.trim()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    Git::with_path(format!(
        "{}:{}",
        wrappers.display(),
        std::env::var("PATH").unwrap()
    ))
}

fn runs(log: &Path, word: &str) -> usize {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter(|line| line.split_whitespace().any(|part| part == word))
        .count()
}

/// A clone of a bare origin whose main holds `a`, with `origin/HEAD` set.
fn clone_of_origin(root: &Path) -> std::path::PathBuf {
    let (origin, work) = (root.join("origin.git"), root.join("work"));
    git(root, &["init", "-q", "--bare", "-b", "main", "origin.git"]);
    git(root, &["clone", "-q", origin.to_str().unwrap(), "work"]);
    write(&work, "a", "1\n");
    git(&work, &["add", "."]);
    git(&work, &["commit", "-q", "-m", "one"]);
    git(&work, &["push", "-q", "origin", "HEAD:main"]);
    git(&work, &["fetch", "-q"]);
    git(&work, &["remote", "set-head", "origin", "main"]);
    git(&work, &["checkout", "-q", "-b", "feature"]);
    work
}

#[test]
fn u7960a_base_is_reused_until_head_or_remote_main_moves() {
    let (root, wrappers) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let work = clone_of_origin(root.path());
    let log = wrappers.path().join("log");
    let g = counting(wrappers.path(), &log);
    let read = |g: &Git| {
        let base = g
            .compare_file(&work, "a", CompareTarget::Tree)
            .unwrap()
            .base;
        assert_eq!(base, git(&work, &["merge-base", "origin/main", "HEAD"]));
        runs(&log, "merge-base")
    };
    // The hand-run merge-base above is not logged: the wrapper sees only the Daemon's own.
    assert_eq!(read(&g), 1);
    assert_eq!(read(&g), 1);
    write(&work, "b", "2\n");
    git(&work, &["add", "."]);
    git(&work, &["commit", "-q", "-m", "two"]);
    assert_eq!(read(&g), 2);
    let other = root.path().join("other");
    git(root.path(), &["clone", "-q", "origin.git", "other"]);
    write(&other, "c", "3\n");
    git(&other, &["add", "."]);
    git(&other, &["commit", "-q", "-m", "three"]);
    git(&other, &["push", "-q", "origin", "HEAD:main"]);
    git(&work, &["fetch", "-q"]);
    assert_eq!(read(&g), 3);
    g.changed_files(&worktree(&work), CompareTarget::Tree)
        .unwrap();
    assert_eq!(runs(&log, "merge-base"), 3);
}

fn worktree(path: &Path) -> Worktree {
    Worktree {
        path: path.to_path_buf(),
        branch: "feature".into(),
        base: String::new(),
        adopted: false,
    }
}

#[test]
fn u7960b_changed_files_same_answer_in_fewer_runs() {
    let (root, wrappers) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let work = clone_of_origin(root.path());
    let numbered: String = (1..=30).map(|n| format!("line {n}\n")).collect();
    write(&work, "edit.txt", &numbered);
    write(&work, "gone.txt", "x\ny\n");
    write(&work, "moved.txt", &numbered);
    std::fs::write(work.join("image.bin"), b"\0\x01\x02").unwrap();
    git(&work, &["add", "."]);
    git(&work, &["commit", "-q", "-m", "seed"]);
    git(&work, &["push", "-q", "origin", "HEAD:main"]);
    git(&work, &["fetch", "-q"]);
    write(
        &work,
        "edit.txt",
        &numbered.replace("line 20\n", "twenty\n"),
    );
    git(&work, &["rm", "-q", "gone.txt"]);
    git(&work, &["mv", "moved.txt", "moved_to.txt"]);
    std::fs::write(work.join("image.bin"), b"\0\x03\x04\x05").unwrap();
    write(&work, "added.txt", "n\n");
    git(&work, &["add", "added.txt"]);
    write(&work, "loose.txt", "a\nb\n");
    let log = wrappers.path().join("log");
    let g = counting(wrappers.path(), &log);
    let files = g
        .changed_files(&worktree(&work), CompareTarget::Tree)
        .unwrap()
        .files;
    let row = |f: &contracts::agent::ChangedFile| {
        (
            f.path.clone(),
            format!("{:?}", f.status),
            f.line,
            f.counts.as_ref().map(|c| (c.added, c.removed)),
            f.from.clone(),
            f.blob.is_some(),
        )
    };
    let got: Vec<_> = files.iter().map(row).collect();
    let want = |p: &str, s: &str, l, c, from: Option<&str>, b| {
        (p.to_owned(), s.to_owned(), l, c, from.map(str::to_owned), b)
    };
    assert_eq!(
        got,
        vec![
            want("added.txt", "Added", Some(1), Some((1, 0)), None, true),
            want("edit.txt", "Modified", Some(20), Some((1, 1)), None, true),
            want("gone.txt", "Deleted", None, Some((0, 2)), None, false),
            want("image.bin", "Modified", None, None, None, true),
            want("loose.txt", "Untracked", Some(1), Some((2, 0)), None, true),
            want(
                "moved_to.txt",
                "Renamed",
                Some(1),
                Some((0, 0)),
                Some("moved.txt"),
                true
            ),
        ]
    );
    assert_eq!(
        files[2].blob, None,
        "a deleted file has no blob on its To side"
    );
    assert_eq!(runs(&log, "diff"), 1);
}

/// Not run: the reading U7960c records in `docs/perf.md`.
#[test]
#[ignore = "measurement, not a check"]
fn u7960c_measure_open() {
    let root = tempfile::tempdir().unwrap();
    let work = clone_of_origin(root.path());
    let text: String = (1..=200).map(|n| format!("line {n}\n")).collect();
    for n in 0..30 {
        write(&work, &format!("f{n}.txt"), &text);
    }
    git(&work, &["add", "."]);
    git(&work, &["commit", "-q", "-m", "seed"]);
    git(&work, &["push", "-q", "origin", "HEAD:main"]);
    git(&work, &["fetch", "-q"]);
    for n in 0..30 {
        match n % 6 {
            0 => write(
                &work,
                &format!("f{n}.txt"),
                &text.replace("line 9\n", "nine\n"),
            ),
            1 => std::fs::remove_file(work.join(format!("f{n}.txt"))).unwrap(),
            2 => {
                git(&work, &["mv", &format!("f{n}.txt"), &format!("r{n}.txt")]);
            }
            3 => write(&work, &format!("new{n}.txt"), &text),
            _ => write(
                &work,
                &format!("f{n}.txt"),
                &text.replace("line 50\n", "fifty\n"),
            ),
        }
    }
    let g = Git::from_env();
    for _ in 0..5 {
        let start = std::time::Instant::now();
        let files = g
            .changed_files(&worktree(&work), CompareTarget::Tree)
            .unwrap();
        let list = start.elapsed();
        let start = std::time::Instant::now();
        g.compare_file(&work, "f0.txt", CompareTarget::Tree)
            .unwrap();
        println!(
            "U7960c files={} list={list:?} first={:?}",
            files.files.len(),
            start.elapsed()
        );
    }
}
