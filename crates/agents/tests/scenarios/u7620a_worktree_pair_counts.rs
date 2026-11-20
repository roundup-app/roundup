//! U7620a `agent.changedFiles` counts a worktree-to-worktree comparison in one git call (`scenarios/ui-changes-counts-worktrees.md`).

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use agents::worktree::Git;
use contracts::agent::{CompareEndpoint, LineCounts};

fn git(dir: &Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@t"])
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
}

fn write(dir: &Path, name: &str, bytes: &[u8]) {
    let path = dir.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// Two worktrees on `main` and `feat` that differ in many files of every state.
fn pair() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(tmp.path()).unwrap();
    let repo = root.join("repo");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    write(&repo, "removed.txt", b"x\ny\n");
    write(&repo, "image.bin", b"\0\x01");
    for n in 0..30 {
        write(&repo, &format!("dir/f{n}.txt"), b"a\nb\nc\n");
    }
    git(&repo, &["add", "-A"]);
    git(&repo, &["commit", "-q", "-m", "seed"]);
    let other = root.join("other");
    git(
        &repo,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "feat",
            other.to_str().unwrap(),
        ],
    );
    std::fs::remove_file(other.join("removed.txt")).unwrap();
    write(&other, "image.bin", b"\0\x02\x03");
    write(&other, "added.txt", b"1\n2\n3\n");
    for n in 0..30 {
        write(&other, &format!("dir/f{n}.txt"), b"a\nB\nc\nd\n");
    }
    (tmp, repo, other)
}

fn endpoint(path: &Path, branch: &str) -> CompareEndpoint {
    CompareEndpoint::Worktree {
        path: path.display().to_string(),
        branch: branch.into(),
    }
}

fn counts(git_env: &Git, repo: &Path, other: &Path) -> BTreeMap<String, Option<LineCounts>> {
    git_env
        .compare_endpoints(repo, &endpoint(repo, "main"), &endpoint(other, "feat"))
        .unwrap()
        .files
        .into_iter()
        .map(|file| (file.path, file.counts))
        .collect()
}

#[test]
fn u7620a_worktree_pair_counts_equal_git_for_every_file_state() {
    let (_tmp, repo, other) = pair();

    let listed = counts(&Git::from_env(), &repo, &other);

    let lc = |added, removed| Some(LineCounts { added, removed });
    assert_eq!(listed.len(), 33);
    assert_eq!(listed["added.txt"], lc(3, 0));
    assert_eq!(listed["removed.txt"], lc(0, 2));
    assert_eq!(listed["image.bin"], None);
    for n in 0..30 {
        assert_eq!(listed[&format!("dir/f{n}.txt")], lc(2, 1));
    }
}

#[test]
fn u7620a_a_worktree_pair_is_counted_in_one_git_call() {
    let (_tmp, repo, other) = pair();
    let tools = tempfile::tempdir().unwrap();
    let log = tools.path().join("calls");
    let wrapper = tools.path().join("git");
    let real = std::env::var("PATH")
        .unwrap()
        .split(':')
        .map(|dir| Path::new(dir).join("git"))
        .find(|candidate| candidate.is_file())
        .unwrap();
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\necho \"$@\" >> '{}'\nexec '{}' \"$@\"\n",
            log.display(),
            real.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(
        &wrapper,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    let mut path = OsString::from(tools.path());
    path.push(":");
    path.push(std::env::var_os("PATH").unwrap());

    counts(&Git::with_path(path), &repo, &other);

    let calls = std::fs::read_to_string(&log).unwrap();
    let numstat = calls.lines().filter(|c| c.contains("--no-index")).count();
    assert_eq!(numstat, 1, "{calls}");
}
