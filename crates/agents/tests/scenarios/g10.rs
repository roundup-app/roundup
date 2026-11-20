//! G10 which worktrees qualify, G11 what adoption never does, G12 nothing deletes an adopted
//! branch (`scenarios/worktrees.md`).

use std::path::{Path, PathBuf};

use agents::worktree::Git;
use contracts::agent::{Adoptable, RailNode, WorktreeState};
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

fn commit_file(dir: &Path, name: &str, text: &str) {
    std::fs::write(dir.join(name), text).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-q", "-m", name]);
}

/// A worktree of the Project outside its folder, on `branch`.
fn make_worktree(f: &Fixture, home: &Path, branch: &str) -> PathBuf {
    let path = home.join(branch.replace('/', "-"));
    git(
        f.dir.path(),
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            branch,
            &path.to_string_lossy(),
        ],
    );
    std::fs::canonicalize(path).unwrap()
}

/// The user's own worktree: branch `feature`, two commits the Base lacks, one untracked file.
fn dirty_ahead(f: &Fixture, home: &Path) -> PathBuf {
    let path = make_worktree(f, home, "feature");
    commit_file(&path, "one.txt", "1");
    commit_file(&path, "two.txt", "2");
    std::fs::write(path.join("loose.txt"), "wip").unwrap();
    path
}

/// Everything adoption must leave as it found it.
fn snapshot(f: &Fixture, path: &Path) -> [String; 4] {
    [
        git(f.dir.path(), &["for-each-ref"]),
        git(path, &["status", "--porcelain=v2"]),
        git(f.dir.path(), &["worktree", "list"]),
        std::fs::read_to_string(path.join("loose.txt")).unwrap_or_default(),
    ]
}

async fn rows(f: &Fixture) -> Vec<Adoptable> {
    serde_json::from_value(f.call("agent.adoptable", Value::Null).await.unwrap()).unwrap()
}

async fn adopt(f: &Fixture, path: &Path, branch: &str) -> Result<RailNode, rpc::RpcError> {
    let params = json!({"path": path.to_string_lossy(), "branch": branch});
    Ok(serde_json::from_value(f.call("agent.adopt", params).await?).unwrap())
}

fn assert_refused(err: &rpc::RpcError, code: i64, name: &str) {
    assert_eq!(err.code, code, "{}", err.message);
    assert!(
        err.message.starts_with(&format!("{name}: ")),
        "{}",
        err.message
    );
}

#[tokio::test]
async fn g10_adoptable_lists_qualifying_worktrees_and_refusals() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let home = tempfile::tempdir().unwrap();
    let ok = dirty_ahead(&f, home.path());
    let owned = make_worktree(&f, home.path(), "roundup/agent-9");
    let detached = make_worktree(&f, home.path(), "det");
    git(&detached, &["checkout", "-q", "--detach"]);
    let merging = make_worktree(&f, home.path(), "merging");
    let marker = git(&merging, &["rev-parse", "--git-path", "MERGE_HEAD"]);
    std::fs::write(merging.join(marker.trim()), "x").unwrap();
    let gone = make_worktree(&f, home.path(), "gone");
    std::fs::remove_dir_all(&gone).unwrap();
    let before = git(f.dir.path(), &["worktree", "list"]);

    let rows = rows(&f).await;
    let find = |path: &Path| {
        rows.iter()
            .find(|row| Path::new(&row.path) == path)
            .unwrap()
    };
    assert_eq!(rows.len(), 5, "the primary checkout is no row");
    let row = find(&ok);
    assert_eq!((row.ahead, row.dirty, row.refusal.clone()), (2, true, None));
    for (path, refusal) in [
        (&owned, "owned_branch"),
        (&detached, "detached_head"),
        (&merging, "operation_in_progress"),
        (&gone, "worktree_missing"),
    ] {
        assert_eq!(find(path).refusal.as_deref(), Some(refusal));
    }
    assert_eq!(git(f.dir.path(), &["worktree", "list"]), before);

    let err = adopt(&f, f.dir.path(), "main").await.unwrap_err();
    assert_refused(&err, code::INVALID_PARAMS, "primary_checkout");
    let err = adopt(&f, &home.path().join("nowhere"), "x")
        .await
        .unwrap_err();
    assert_refused(&err, code::INVALID_PARAMS, "not_registered");
    let other = tempfile::tempdir().unwrap();
    crate::common::init_repo(other.path());
    let err = adopt(&f, other.path(), "main").await.unwrap_err();
    assert_refused(&err, code::INVALID_PARAMS, "other_repository");
    let err = adopt(&f, &owned, "roundup/agent-9").await.unwrap_err();
    assert_refused(&err, code::INVALID_PARAMS, "owned_branch");
    let err = adopt(&f, &detached, "det").await.unwrap_err();
    assert_refused(&err, code::INVALID_PARAMS, "detached_head");
    let err = adopt(&f, &gone, "gone").await.unwrap_err();
    assert_refused(&err, code::NOT_FOUND, "worktree_missing");
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn g10_adopt_needs_the_branch_the_user_saw() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let home = tempfile::tempdir().unwrap();
    let path = dirty_ahead(&f, home.path());
    let before = snapshot(&f, &path);
    let err = adopt(&f, &path, "other").await.unwrap_err();
    assert_refused(&err, code::CONFLICT, "adopt_stale");
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);
}

#[tokio::test]
async fn g11_adopt_keeps_dirty_work_and_branch_untouched() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let home = tempfile::tempdir().unwrap();
    let path = dirty_ahead(&f, home.path());
    let before = snapshot(&f, &path);
    let node = adopt(&f, &path, "feature").await.unwrap();
    let worktree = node.worktree().unwrap();
    assert_eq!(
        (
            worktree.path.as_str(),
            worktree.branch.as_str(),
            worktree.base.as_str(),
            worktree.adopted
        ),
        (path.to_str().unwrap(), "feature", "main", true)
    );
    let terminals = f.terminals.list().await;
    assert_eq!(terminals.len(), 1);
    assert_eq!(Path::new(&terminals[0].cwd), path);
    assert_eq!(snapshot(&f, &path), before);
}

#[tokio::test]
async fn g11_adopted_state_counts_against_the_recorded_base() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let home = tempfile::tempdir().unwrap();
    let path = dirty_ahead(&f, home.path());
    let node = adopt(&f, &path, "feature").await.unwrap();
    commit_file(f.dir.path(), "later.txt", "x");
    let state = f
        .call("agent.worktreeState", json!({"id": node.id}))
        .await
        .unwrap();
    let state: WorktreeState = serde_json::from_value(state).unwrap();
    assert_eq!((state.ahead, state.behind, state.dirty), (2, 1, true));
    assert_eq!(f.tree().await[0].worktree().unwrap().base, "main");
}

#[tokio::test]
async fn g11_restart_and_interrupted_adoption_keep_everything() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let home = tempfile::tempdir().unwrap();
    let path = dirty_ahead(&f, home.path());
    adopt(&f, &path, "feature").await.unwrap();
    let before = snapshot(&f, &path);
    let f = f.reopen();
    let tree = f.tree().await;
    let worktree = tree[0].worktree().unwrap();
    assert!(worktree.adopted);
    assert_eq!(worktree.base, "main");
    assert_eq!(snapshot(&f, &path), before);
}

#[tokio::test]
async fn g12_discard_keeps_a_dirty_adopted_worktree_and_its_commits() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let home = tempfile::tempdir().unwrap();
    let path = dirty_ahead(&f, home.path());
    let node = adopt(&f, &path, "feature").await.unwrap();
    let before = snapshot(&f, &path);
    assert_eq!(
        f.call("agent.discard", json!({"id": node.id}))
            .await
            .unwrap(),
        Value::Null
    );
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);
}

#[tokio::test]
async fn g12_remove_stop_and_workstream_removal_keep_adopted_branches() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let home = tempfile::tempdir().unwrap();
    let path = dirty_ahead(&f, home.path());
    let node = adopt(&f, &path, "feature").await.unwrap();
    let before = snapshot(&f, &path);
    f.call("agent.stop", json!({"id": node.id})).await.unwrap();
    assert_eq!(snapshot(&f, &path), before);
    f.call("rail.remove", json!({"id": node.id})).await.unwrap();
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);

    let clean = make_worktree(&f, home.path(), "clean");
    let node = adopt(&f, &clean, "clean").await.unwrap();
    f.call("rail.remove", json!({"id": node.id})).await.unwrap();
    assert!(clean.exists());
    git(f.dir.path(), &["rev-parse", "--verify", "refs/heads/clean"]);
}

#[tokio::test]
async fn g12_failed_start_after_adoption_deletes_nothing() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let home = tempfile::tempdir().unwrap();
    let path = dirty_ahead(&f, home.path());
    let before = snapshot(&f, &path);
    // A start that cannot happen: the Project's launcher refuses a parent that is no node.
    let params = json!({"path": path.to_string_lossy(), "branch": "feature", "parent": "999"});
    assert!(f.call("agent.adopt", params).await.is_err());
    assert!(f.tree().await.is_empty());
    assert_eq!(snapshot(&f, &path), before);
}
