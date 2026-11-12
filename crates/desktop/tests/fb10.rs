//! FB10: the stamp follows a commit when the branch ref is packed (`scenarios/feedback-facts.md`).
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

fn packed_repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["commit", "-q", "--allow-empty", "-m", "one"]);
    git(dir.path(), &["pack-refs", "--all"]);
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
fn fb10_rerun_paths_watch_the_refs_directory_for_a_packed_ref() {
    let repo = packed_repo();
    let paths = build_stamp::rerun_paths(repo.path());
    assert!(paths.iter().all(|p| p.exists()), "{paths:?}");
    assert!(paths.iter().any(|p| p.ends_with(".git/refs/heads")));
    assert!(paths.iter().any(|p| p.ends_with("packed-refs")));
}

#[test]
fn fb10_the_stamp_follows_a_commit_after_pack_refs() {
    let repo = packed_repo();
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
    git(&tree, &["pack-refs", "--all"]);
    for dir in [repo.path(), tree.as_path()] {
        let before = build_stamp::stamp(dir);
        assert_eq!(before, head(dir));
        git(dir, &["commit", "-q", "--allow-empty", "-m", "next"]);
        let loose = build_stamp::rerun_paths(dir)
            .into_iter()
            .any(|p| p.ends_with("refs/heads/main") || p.ends_with("refs/heads/side"));
        assert!(loose, "the commit created the watched loose ref");
        let after = build_stamp::stamp(dir);
        assert_eq!(after, head(dir));
        assert_ne!(before, after);
    }
}
