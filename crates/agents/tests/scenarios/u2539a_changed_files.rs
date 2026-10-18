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
    assert_eq!(file("new.txt")["line"], json!(1));
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
    write(f.dir.path(), "pure.bin", "unique\0binary");
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;

    write(&path, "a.txt", "1\n2\n3\nfour\n5\n");
    std::fs::remove_file(path.join("gone.txt")).unwrap();
    write(&path, "bin.dat", "z\0w");
    git(&path, &["mv", "pure.bin", "renamed\tbinary\n.dat"]);
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
    assert_eq!(line("renamed\tbinary\n.dat"), Value::Null);
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

#[tokio::test]
async fn u2540a_compares_each_status_against_the_same_base() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "edit.txt", "old\n");
    write(f.dir.path(), "gone.txt", "gone\n");
    write(f.dir.path(), "old.txt", "rename body\n");
    commit_all(f.dir.path(), "seed");
    let base = git(f.dir.path(), &["rev-parse", "HEAD"]).trim().to_owned();
    let (id, path) = on(&f).await;
    // Advancing Base must not replace the common ancestor with Base's current tip.
    write(f.dir.path(), "edit.txt", "advanced Base\n");
    commit_all(f.dir.path(), "advance Base");
    write(&path, "committed.txt", "committed\n");
    commit_all(&path, "commit");
    git(&path, &["mv", "old.txt", "new.txt"]);
    write(&path, "added.txt", "staged\n");
    git(&path, &["add", "added.txt"]);
    write(&path, "added.txt", "current\n");
    write(&path, "edit.txt", "new\n");
    write(&path, "loose.txt", "loose\n");
    std::fs::remove_file(path.join("gone.txt")).unwrap();
    for (name, old, new, status) in [
        ("edit.txt", "old\n", "new\n", "modified"),
        ("gone.txt", "gone\n", "", "deleted"),
        ("new.txt", "rename body\n", "rename body\n", "renamed"),
        ("added.txt", "", "current\n", "added"),
        ("committed.txt", "", "committed\n", "added"),
        ("loose.txt", "", "loose\n", "untracked"),
    ] {
        let result = f
            .call("agent.compareFile", json!({"id": id, "path": name}))
            .await
            .unwrap();
        assert_eq!(result["base"], base);
        assert_eq!(result["status"], status);
        assert_eq!(result["old"]["text"].as_str().unwrap_or(""), old);
        assert_eq!(result["new"]["text"].as_str().unwrap_or(""), new);
        assert!(result["old"]["revision"].is_string());
        assert!(result["new"]["revision"].is_string());
        assert_eq!(result["newPath"], name);
        assert_eq!(
            result["oldPath"],
            if name == "new.txt" { "old.txt" } else { name }
        );
    }
}

#[tokio::test]
async fn u2540a_refuses_paths_outside_the_worktree() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let (id, path) = on(&f).await;
    let outside = tempfile::tempdir().unwrap();
    write(outside.path(), "secret", "outside");
    std::os::unix::fs::symlink(outside.path(), path.join("escape")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret"), path.join("link")).unwrap();
    for name in [
        "/etc/passwd",
        "../secret",
        "a/../../secret",
        "escape/secret",
        "link",
        ".git",
        ".roundup/secret",
        "./link",
        "",
    ] {
        let err = f
            .call("agent.compareFile", json!({"id": id, "path": name}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{name}: {err:?}");
    }
    assert_eq!(
        std::fs::read(outside.path().join("secret")).unwrap(),
        b"outside"
    );
}

#[tokio::test]
async fn u2540a_read_changes_nothing() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "a.txt", "old\n");
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;
    write(&path, "a.txt", "staged\n");
    git(&path, &["add", "a.txt"]);
    write(&path, "a.txt", "disk\n");
    let index = git(&path, &["rev-parse", "--git-path", "index"]);
    let snapshot = || {
        (
            std::fs::read(path.join(index.trim())).unwrap(),
            git(&path, &["symbolic-ref", "HEAD"]),
            git(&path, &["rev-parse", "HEAD", "main"]),
            std::fs::read(path.join("a.txt")).unwrap(),
            std::fs::read(f.dir.path().join("a.txt")).unwrap(),
        )
    };
    let before = snapshot();
    for _ in 0..2 {
        let result = f
            .call("agent.compareFile", json!({"id": id, "path": "a.txt"}))
            .await
            .unwrap();
        assert_eq!(result["new"]["text"], "disk\n");
    }
    assert_eq!(snapshot(), before);
}

async fn comparison_fixture() -> (Fixture, String, std::path::PathBuf) {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "same", "same\n");
    commit_all(f.dir.path(), "seed");
    let (id, path) = on(&f).await;
    (f, id, path)
}

#[tokio::test]
async fn u2540a_binary_content_has_a_revision_without_text() {
    let (f, id, path) = comparison_fixture().await;
    std::fs::write(path.join("binary"), b"a\0b").unwrap();
    let result = f
        .call("agent.compareFile", json!({"id": id, "path": "binary"}))
        .await
        .unwrap();
    assert_eq!(result["new"]["kind"], "binary");
    assert!(result["new"].get("text").is_none());
    assert!(
        result["new"]["revision"]
            .as_str()
            .unwrap()
            .starts_with("sha256:")
    );
}

#[tokio::test]
async fn u2540a_refresh_identifies_changed_content_without_changing_old_context() {
    let (f, id, path) = comparison_fixture().await;
    let params = json!({"id": id, "path": "same"});
    let same = f.call("agent.compareFile", params.clone()).await.unwrap();
    assert_eq!(same["old"], same["new"]);
    assert_eq!(same["status"], Value::Null);
    write(&path, "same", "different\n");
    let changed = f.call("agent.compareFile", params).await.unwrap();
    assert_ne!(changed["new"]["revision"], same["new"]["revision"]);
    assert_eq!(changed["old"], same["old"]);
}

#[tokio::test]
async fn u2540a_missing_file_is_not_found() {
    let (f, id, _) = comparison_fixture().await;
    assert_eq!(
        f.call("agent.compareFile", json!({"id": id, "path": "missing"}))
            .await
            .unwrap_err()
            .code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn u2540a_oversized_content_fails_explicitly() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let bytes = vec![b'x'; 4 * 1024 * 1024 + 1];
    std::fs::write(f.dir.path().join("old-large"), &bytes).unwrap();
    commit_all(f.dir.path(), "large Base file");
    let (id, path) = on(&f).await;
    std::fs::remove_file(path.join("old-large")).unwrap();
    std::fs::write(path.join("new-large"), &bytes).unwrap();
    for name in ["old-large", "new-large"] {
        assert!(
            f.call("agent.compareFile", json!({"id": id, "path": name}))
                .await
                .unwrap_err()
                .message
                .contains("4 MiB")
        );
    }
}

#[tokio::test]
async fn u2540a_missing_worktree_is_not_found() {
    let (f, id, path) = comparison_fixture().await;
    std::fs::remove_dir_all(path).unwrap();
    assert_eq!(
        f.call("agent.compareFile", json!({"id": id, "path": "same"}))
            .await
            .unwrap_err()
            .code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn u2540a_unassigned_worktree_is_not_found() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let plain = f.spawn(None, None).await.unwrap();
    assert_eq!(
        f.call("agent.compareFile", json!({"id": plain.id, "path": "same"}))
            .await
            .unwrap_err()
            .code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn u2540a_comparison_uses_only_the_selected_agents_worktree() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    write(f.dir.path(), "same", "base\n");
    commit_all(f.dir.path(), "seed");
    let (one, first) = on(&f).await;
    let (two, second) = on(&f).await;
    write(f.dir.path(), "same", "project\n");
    write(&first, "same", "first\n");
    write(&second, "same", "second\n");
    for (id, text) in [(one, "first\n"), (two, "second\n")] {
        let result = f
            .call("agent.compareFile", json!({"id": id, "path": "same"}))
            .await
            .unwrap();
        assert_eq!(result["old"]["text"], "base\n");
        assert_eq!(result["new"]["text"], text);
    }
}
