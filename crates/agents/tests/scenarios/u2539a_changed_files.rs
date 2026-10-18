//! U2539a `agent.changedFiles` lists what the Agent changed against its Base (`scenarios/ui-worktree-changes.md`).

use std::path::Path;

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
    String::from_utf8_lossy(&output.stdout).into_owned()
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

async fn changed(f: &Fixture, id: &str) -> Result<Value, rpc::RpcError> {
    f.call("agent.changedFiles", json!({"id": id})).await
}

async fn on(f: &Fixture) -> (String, std::path::PathBuf) {
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path = node.worktree.expect("a Worktree").path.into();
    (node.id, path)
}

#[tokio::test]
async fn u2539a_lists_committed_staged_unstaged_and_untracked_files() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "kept.txt", "a\nb\nc\n");
    write(f.dir.path(), "unstaged.txt", "a\nb\n");
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;

    write(&path, "committed.txt", "x");
    commit_all(&path, "committed");
    write(&path, "dir/staged.txt", "x");
    git(&path, &["add", "dir/staged.txt"]);
    write(&path, "unstaged.txt", "a\nchanged\n");
    write(&path, "loose.txt", "x");
    write(&path, ".roundup/note.txt", "x");

    let files = changed(&f, &id).await.unwrap();

    let names: Vec<(&str, &str)> = files["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| {
            (
                file["path"].as_str().unwrap(),
                file["status"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        names,
        [
            ("committed.txt", "added"),
            ("dir/staged.txt", "added"),
            ("loose.txt", "untracked"),
            ("unstaged.txt", "modified"),
        ]
    );
}

#[tokio::test]
async fn u2539a_a_reverted_change_is_not_listed() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "a.txt", "one\n");
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;

    write(&path, "a.txt", "two\n");
    commit_all(&path, "change");
    write(&path, "a.txt", "one\n");
    commit_all(&path, "revert");

    assert_eq!(changed(&f, &id).await.unwrap(), json!({"files": []}));
}

#[tokio::test]
async fn u2539a_reports_each_status() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(
        f.dir.path(),
        "old.txt",
        "a long enough body\nfor rename detection\nto work on\n",
    );
    write(f.dir.path(), "gone.txt", "bye\n");
    write(f.dir.path(), "edit.txt", "one\n");
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;

    git(&path, &["mv", "old.txt", "new.txt"]);
    std::fs::remove_file(path.join("gone.txt")).unwrap();
    write(&path, "edit.txt", "two\n");
    write(&path, "added.txt", "x");
    git(&path, &["add", "added.txt"]);
    write(&path, "loose.txt", "x");

    let files = changed(&f, &id).await.unwrap();

    let file = |path: &str| {
        files["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["path"] == path)
            .unwrap()
            .clone()
    };
    assert_eq!(file("new.txt")["status"], "renamed");
    assert_eq!(file("new.txt")["from"], "old.txt");
    assert_eq!(file("gone.txt")["status"], "deleted");
    assert_eq!(file("edit.txt")["status"], "modified");
    assert_eq!(file("added.txt")["status"], "added");
    assert_eq!(file("loose.txt")["status"], "untracked");
}

#[tokio::test]
async fn u2539a_line_is_the_first_changed_line() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "a.txt", "1\n2\n3\n4\n5\n");
    write(f.dir.path(), "gone.txt", "bye\n");
    write(f.dir.path(), "bin.dat", "x\0y");
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;

    write(&path, "a.txt", "1\n2\n3\nfour\n5\n");
    std::fs::remove_file(path.join("gone.txt")).unwrap();
    write(&path, "bin.dat", "z\0w");
    write(&path, "new.txt", "x\ny\n");
    write(&path, "new.bin", "x\0y");

    let files = changed(&f, &id).await.unwrap();

    let line = |name: &str| {
        files["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["path"] == name)
            .unwrap()["line"]
            .clone()
    };
    assert_eq!(line("a.txt"), json!(4));
    assert_eq!(line("gone.txt"), Value::Null);
    assert_eq!(line("bin.dat"), Value::Null);
    assert_eq!(line("new.txt"), json!(1));
    assert_eq!(line("new.bin"), Value::Null);
}

#[tokio::test]
async fn u2539a_changes_nothing() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let (id, path) = on(&f).await;
    write(&path, "staged.txt", "x");
    git(&path, &["add", "staged.txt"]);
    write(&path, "loose.txt", "x");
    let before = (
        git(&path, &["status", "--porcelain=v2"]),
        git(f.dir.path(), &["rev-parse", "main"]),
        git(&path, &["rev-parse", "HEAD"]),
    );

    changed(&f, &id).await.unwrap();

    assert_eq!(
        before,
        (
            git(&path, &["status", "--porcelain=v2"]),
            git(f.dir.path(), &["rev-parse", "main"]),
            git(&path, &["rev-parse", "HEAD"]),
        )
    );
}

#[tokio::test]
async fn u2539a_no_worktree_and_missing_worktree_fail_as_g3_does() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let plain = f.spawn(None, None).await.unwrap();
    let err = changed(&f, &plain.id).await.unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(err.message.starts_with("no_worktree: "), "{}", err.message);

    let (id, path) = on(&f).await;
    std::fs::remove_dir_all(&path).unwrap();
    let err = changed(&f, &id).await.unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(
        err.message
            .starts_with(&format!("worktree_missing: {}", path.display())),
        "{}",
        err.message
    );
}
