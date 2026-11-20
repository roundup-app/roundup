//! U7672a `agent.changedFiles` and `agent.compareFile` compare the remote's main with a Compare
//! target (`scenarios/ui-changes-remote-main.md`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use agents::worktree::Git;
use rpc::code;
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned()
}

fn write(dir: &Path, name: &str, text: &str) {
    let path = dir.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn commit_all(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// A project with an origin on `main`, one Agent in its own Worktree.
async fn origin_fixture() -> (Fixture, String, PathBuf, tempfile::TempDir) {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "seed.txt", "a\nb\n");
    commit_all(f.dir.path(), "seed");
    let origin = tempfile::tempdir().unwrap();
    git(origin.path(), &["init", "-q", "--bare", "-b", "main"]);
    let url = origin.path().display().to_string();
    git(f.dir.path(), &["remote", "add", "origin", &url]);
    git(f.dir.path(), &["push", "-q", "origin", "main"]);
    git(f.dir.path(), &["fetch", "-q", "origin"]);
    git(f.dir.path(), &["remote", "set-head", "origin", "main"]);
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path = node.worktree().expect("a Worktree").path.into();
    (f, node.base.id, path, origin)
}

async fn changed(f: &Fixture, id: &str, to: Option<&str>) -> Result<Value, rpc::RpcError> {
    let params = to.map_or(json!({"id": id}), |to| json!({"id": id, "to": to}));
    f.call("agent.changedFiles", params).await
}

fn names(files: &Value) -> Vec<&str> {
    files["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file["path"].as_str().unwrap())
        .collect()
}

/// The branch grows a commit, a staged, an unstaged and an untracked file.
fn dirty(path: &Path) {
    write(path, "committed.txt", "x\n");
    commit_all(path, "committed");
    write(path, "staged.txt", "x\ny\n");
    git(path, &["add", "staged.txt"]);
    write(path, "seed.txt", "a\nchanged\n");
    write(path, "loose.txt", "x\n");
    write(path, ".roundup/note.txt", "x\n");
}

#[tokio::test]
async fn u7672a_tree_lists_committed_staged_unstaged_and_untracked_files() {
    let (f, id, path, _origin) = origin_fixture().await;
    dirty(&path);
    for to in [None, Some("tree")] {
        let files = changed(&f, &id, to).await.unwrap();
        assert_eq!(
            names(&files),
            ["committed.txt", "loose.txt", "seed.txt", "staged.txt"]
        );
    }
}

#[tokio::test]
async fn u7672a_branch_lists_only_what_its_commits_changed() {
    let (f, id, path, _origin) = origin_fixture().await;
    dirty(&path);
    let files = changed(&f, &id, Some("branch")).await.unwrap();
    assert_eq!(names(&files), ["committed.txt"]);
    // The new side is HEAD's commit, never the disk.
    write(&path, "committed.txt", "edited on disk\n");
    let read = f
        .call(
            "agent.compareFile",
            json!({"id": id, "path": "committed.txt", "to": "branch"}),
        )
        .await
        .unwrap();
    assert_eq!(read["new"]["text"], "x\n");
    let read = f
        .call(
            "agent.compareFile",
            json!({"id": id, "path": "committed.txt", "to": "tree"}),
        )
        .await
        .unwrap();
    assert_eq!(read["new"]["text"], "edited on disk\n");
}

#[tokio::test]
async fn u7672a_a_commit_landing_on_remote_main_after_the_branch_point_is_never_listed() {
    let (f, id, path, _origin) = origin_fixture().await;
    write(&path, "mine.txt", "m\n");
    commit_all(&path, "mine");
    write(f.dir.path(), "landed.txt", "l\n");
    commit_all(f.dir.path(), "landed");
    git(f.dir.path(), &["push", "-q", "origin", "main"]);
    git(&path, &["fetch", "-q", "origin"]);
    for to in ["tree", "branch"] {
        let files = changed(&f, &id, Some(to)).await.unwrap();
        assert_eq!(names(&files), ["mine.txt"], "{to}");
    }
    let read = f
        .call(
            "agent.compareFile",
            json!({"id": id, "path": "landed.txt", "to": "branch"}),
        )
        .await;
    assert!(read.is_err() || read.unwrap()["status"].is_null());
}

#[tokio::test]
async fn u7672a_counts_equal_git_numstat_for_tree_and_branch() {
    let (f, id, path, _origin) = origin_fixture().await;
    dirty(&path);
    let base = git(&path, &["merge-base", "origin/main", "HEAD"]);
    for (to, end) in [("tree", None), ("branch", Some("HEAD"))] {
        let mut args = vec!["diff", "--numstat", &base];
        args.extend(end);
        let mut expected: BTreeMap<String, (u64, u64)> = git(&path, &args)
            .lines()
            .map(|row| {
                let mut parts = row.split('\t');
                let (a, r) = (parts.next().unwrap(), parts.next().unwrap());
                (
                    parts.next().unwrap().to_owned(),
                    (a.parse().unwrap(), r.parse().unwrap()),
                )
            })
            .collect();
        if end.is_none() {
            expected.insert("loose.txt".into(), (1, 0));
        }
        let files = changed(&f, &id, Some(to)).await.unwrap();
        for file in files["files"].as_array().unwrap() {
            let path = file["path"].as_str().unwrap();
            let counts = (
                file["counts"]["added"].as_u64().unwrap(),
                file["counts"]["removed"].as_u64().unwrap(),
            );
            assert_eq!(expected.remove(path), Some(counts), "{to} {path}");
        }
        assert!(expected.is_empty(), "{to}: {expected:?}");
    }
}

#[tokio::test]
async fn u7672a_without_a_remote_from_is_the_local_default_branch() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path: PathBuf = node.worktree().expect("a Worktree").path.into();
    write(&path, "mine.txt", "m\n");
    commit_all(&path, "mine");
    let files = changed(&f, &node.base.id, Some("branch")).await.unwrap();
    assert_eq!(names(&files), ["mine.txt"]);
}

#[tokio::test]
async fn u7672a_a_shared_checkout_has_no_tree_or_branch_target() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let plain = f.spawn(None, None).await.unwrap();
    for to in ["tree", "branch"] {
        let err = changed(&f, &plain.id, Some(to)).await.unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND);
        assert!(err.message.starts_with("no_worktree: "), "{}", err.message);
    }
}

#[tokio::test]
async fn u7672a_compare_file_keeps_its_limit_and_takes_no_endpoint() {
    let (f, id, path, _origin) = origin_fixture().await;
    write(&path, "big.txt", &"x".repeat(4 * 1024 * 1024 + 1));
    let err = f
        .call(
            "agent.compareFile",
            json!({"id": id, "path": "big.txt", "to": "tree"}),
        )
        .await
        .unwrap_err();
    assert!(err.message.contains("4 MiB"), "{}", err.message);
    let err = f
        .call(
            "agent.compareFile",
            json!({"id": id, "path": "seed.txt", "from": {"kind": "head", "branch": "main"}}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    let err = changed_with(
        &f,
        json!({"id": id, "from": {"kind": "head", "branch": "main"}}),
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
}

async fn changed_with(f: &Fixture, params: Value) -> Result<Value, rpc::RpcError> {
    f.call("agent.changedFiles", params).await
}

#[tokio::test]
async fn u7672a_changes_nothing() {
    let (f, id, path, _origin) = origin_fixture().await;
    dirty(&path);
    let before = (
        git(&path, &["status", "--porcelain", "-uall"]),
        git(&path, &["rev-parse", "HEAD"]),
        git(&path, &["branch", "-a"]),
    );
    for to in ["tree", "branch"] {
        changed(&f, &id, Some(to)).await.unwrap();
        f.call(
            "agent.compareFile",
            json!({"id": id, "path": "seed.txt", "to": to}),
        )
        .await
        .unwrap();
    }
    let after = (
        git(&path, &["status", "--porcelain", "-uall"]),
        git(&path, &["rev-parse", "HEAD"]),
        git(&path, &["branch", "-a"]),
    );
    assert_eq!(before, after);
}
