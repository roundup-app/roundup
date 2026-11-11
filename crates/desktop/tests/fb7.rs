//! FB7: the build id is the commit the App was built from (`scenarios/feedback-facts.md`).
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

#[path = "../build_stamp.rs"]
mod build_stamp;

use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@t"])
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?}");
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["commit", "-q", "--allow-empty", "-m", "one"]);
    dir
}

fn head(dir: &Path) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .unwrap();
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

#[test]
fn fb7_the_stamp_follows_head_after_a_commit() {
    let repo = repo();
    let tree = tempfile::tempdir().unwrap();
    let tree = tree.path().join("wt");
    git(
        repo.path(),
        &["worktree", "add", "-q", tree.to_str().unwrap()],
    );
    for dir in [repo.path(), tree.as_path()] {
        let before = build_stamp::stamp(dir);
        assert_eq!(before, head(dir));
        git(dir, &["commit", "-q", "--allow-empty", "-m", "next"]);
        let after = build_stamp::stamp(dir);
        assert_eq!(after, head(dir));
        assert_ne!(before, after);
    }
}

#[test]
fn fb7_no_git_checkout_stamps_empty_and_builds() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(build_stamp::stamp(dir.path()), "");
    assert!(build_stamp::rerun_paths(dir.path()).is_empty());
}

#[test]
fn fb7_rerun_paths_are_the_resolved_head_and_its_ref() {
    let repo = repo();
    let tree = tempfile::tempdir().unwrap();
    let tree = tree.path().join("wt");
    git(
        repo.path(),
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "side",
            tree.to_str().unwrap(),
        ],
    );
    let names = |dir: &Path| -> Vec<String> {
        build_stamp::rerun_paths(dir)
            .iter()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect()
    };
    let main = names(repo.path());
    assert_eq!(main.len(), 2, "{main:?}");
    assert!(main[0].ends_with(".git/HEAD") && main[1].ends_with(".git/refs/heads/main"));
    let side = names(&tree);
    assert_eq!(side.len(), 2, "{side:?}");
    assert!(side[0].ends_with(".git/worktrees/wt/HEAD"), "{side:?}");
    assert!(side[1].ends_with(".git/refs/heads/side"), "{side:?}");
}
