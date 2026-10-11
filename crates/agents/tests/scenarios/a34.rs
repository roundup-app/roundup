//! A34 `rail.remove` of a Workstream: its finished work goes, the rest moves to the Project root.

use std::path::{Path, PathBuf};

use agents::worktree::Git;
use contracts::agent::RailNode;
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

fn commit_file(dir: &Path, name: &str) {
    std::fs::write(dir.join(name), name).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-q", "-m", name]);
}

/// An Agent with a Worktree under `parent`, and where its work lives.
async fn agent(f: &Fixture, parent: &str) -> (String, PathBuf, String) {
    let node = f.spawn(Some(parent), None).await.unwrap();
    let worktree = node.worktree.expect("a Worktree");
    (node.id, worktree.path.into(), worktree.branch)
}

async fn git_fixture() -> (Fixture, String) {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let ws = f.workstream("team", None).await;
    (f, ws)
}

async fn stop(f: &Fixture, id: &str) {
    f.call("agent.stop", json!({"id": id})).await.unwrap();
}

async fn remove(f: &Fixture, id: &str) -> Value {
    f.call("rail.remove", json!({"id": id})).await.unwrap()
}

fn ids(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap().to_owned())
        .collect()
}

fn branches(f: &Fixture) -> String {
    git(f.dir.path(), &["branch", "--list"])
}

fn node<'a>(tree: &'a [RailNode], id: &str) -> Option<&'a RailNode> {
    tree.iter().find(|n| n.id == id)
}

#[tokio::test]
async fn a34_a_clean_exited_agent_goes_with_its_worktree_and_branch() {
    let (f, ws) = git_fixture().await;
    let (id, path, branch) = agent(&f, &ws).await;
    stop(&f, &id).await;

    let result = remove(&f, &ws).await;

    assert_eq!(ids(&result["removed"]), [id.clone()]);
    assert_eq!(result["kept"], json!([]));
    assert!(f.tree().await.is_empty());
    assert!(!path.exists());
    assert!(!branches(&f).contains(&branch));
}

#[tokio::test]
async fn a34_an_agent_with_no_worktree_goes() {
    let f = Fixture::running("sleep 30");
    let ws = f.workstream("team", None).await;
    let id = f.spawn(Some(&ws), None).await.unwrap().id;
    stop(&f, &id).await;

    let result = remove(&f, &ws).await;

    assert_eq!(ids(&result["removed"]), [id]);
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn a34_a_running_agent_moves_to_the_project_root() {
    let (f, ws) = git_fixture().await;
    let (id, path, _) = agent(&f, &ws).await;

    let result = remove(&f, &ws).await;

    assert_eq!(result["removed"], json!([]));
    assert_eq!(result["kept"][0]["id"], json!(id));
    assert_eq!(result["kept"][0]["reason"], json!("running"));
    let tree = f.tree().await;
    assert_eq!(node(&tree, &id).unwrap().parent, None);
    assert!(node(&tree, &ws).is_none());
    assert!(path.exists());
}

#[tokio::test]
async fn a34_an_agent_ahead_of_the_base_is_kept() {
    let (f, ws) = git_fixture().await;
    let (id, path, branch) = agent(&f, &ws).await;
    commit_file(&path, "agent.txt");
    stop(&f, &id).await;
    let head = git(f.dir.path(), &["rev-parse", &branch]);

    let result = remove(&f, &ws).await;

    assert_eq!(result["kept"][0]["reason"], json!("ahead"));
    assert_eq!(node(&f.tree().await, &id).unwrap().parent, None);
    assert!(path.join("agent.txt").exists());
    assert_eq!(git(f.dir.path(), &["rev-parse", &branch]), head);
}

#[tokio::test]
async fn a34_a_dirty_agent_is_kept_and_untouched() {
    let (f, ws) = git_fixture().await;
    let (id, path, branch) = agent(&f, &ws).await;
    std::fs::write(path.join("loose.txt"), "x").unwrap();
    stop(&f, &id).await;

    let result = remove(&f, &ws).await;

    assert_eq!(result["kept"][0]["reason"], json!("dirty"));
    assert_eq!(node(&f.tree().await, &id).unwrap().parent, None);
    assert_eq!(
        std::fs::read_to_string(path.join("loose.txt")).unwrap(),
        "x"
    );
    assert!(branches(&f).contains(&branch));
}

/// The recheck after a stop (G5) is `end_with`'s `require_landed`, which G5's own test covers; here
/// an Agent that writes when stopped is never stopped by the removal, because it still runs.
#[tokio::test]
async fn a34_an_agent_that_writes_while_stopping_is_kept() {
    let f = Fixture::in_git_project(
        "trap 'echo late > late.txt; exit' HUP TERM\necho up > up\nwhile :; do sleep 0.1; done",
        Git::from_env(),
    );
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let ws = f.workstream("team", None).await;
    let (id, path, branch) = agent(&f, &ws).await;
    crate::common::until_file(&path.join("up")).await;

    let result = remove(&f, &ws).await;

    assert_eq!(result["kept"][0]["reason"], json!("running"));
    assert_eq!(node(&f.tree().await, &id).unwrap().parent, None);
    assert!(!path.join("late.txt").exists());
    assert!(branches(&f).contains(&branch));
}

#[tokio::test]
async fn a34_nested_subagents_are_judged_one_by_one() {
    let (f, ws) = git_fixture().await;
    let (parent, ppath, _) = agent(&f, &ws).await;
    let child = f.spawn_as(&parent, Some(&parent)).await.unwrap();
    let child_path: PathBuf = child.worktree.clone().unwrap().path.into();
    commit_file(&child_path, "child.txt");
    stop(&f, &child.id).await;
    stop(&f, &parent).await;

    let result = remove(&f, &ws).await;

    assert_eq!(ids(&result["removed"]), [parent.clone()]);
    assert_eq!(ids(&result["kept"]), [child.id.clone()]);
    let tree = f.tree().await;
    assert_eq!(node(&tree, &child.id).unwrap().parent, None);
    assert!(node(&tree, &parent).is_none());
    assert!(!ppath.exists());
    assert!(child_path.exists());
}

#[tokio::test]
async fn a34_the_result_lists_removed_and_kept_with_reasons() {
    let (f, ws) = git_fixture().await;
    let (gone, _, _) = agent(&f, &ws).await;
    let (ahead, apath, _) = agent(&f, &ws).await;
    let (running, _, _) = agent(&f, &ws).await;
    commit_file(&apath, "a.txt");
    stop(&f, &gone).await;
    stop(&f, &ahead).await;

    let result = remove(&f, &ws).await;

    assert_eq!(result["removed"][0]["id"], json!(gone));
    assert_eq!(result["removed"][0]["kind"], json!("agent"));
    assert_eq!(ids(&result["kept"]), [ahead, running]);
    assert_eq!(result["kept"][0]["reason"], json!("ahead"));
    assert_eq!(result["kept"][1]["reason"], json!("running"));
    assert!(result["kept"][1]["name"].is_string());
    assert_eq!(f.tree().await.len(), 2);
}

#[tokio::test]
async fn a34_a_failed_removal_changes_nothing() {
    let (f, ws) = git_fixture().await;
    let (broken, _, branch) = agent(&f, &ws).await;
    let (clean, _, _) = agent(&f, &ws).await;
    stop(&f, &broken).await;
    stop(&f, &clean).await;
    git(
        f.dir.path(),
        &["update-ref", "-d", &format!("refs/heads/{branch}")],
    );
    let before = f.tree().await;

    let err = f.call("rail.remove", json!({"id": ws})).await.unwrap_err();

    assert!(!err.message.is_empty());
    assert_eq!(f.tree().await, before);
}

#[tokio::test]
async fn a34_other_workstreams_are_untouched() {
    let (f, ws) = git_fixture().await;
    let other = f.workstream("other", None).await;
    let (mine, _, _) = agent(&f, &ws).await;
    let (theirs, tpath, _) = agent(&f, &other).await;
    stop(&f, &mine).await;
    stop(&f, &theirs).await;

    remove(&f, &ws).await;

    let tree = f.tree().await;
    assert_eq!(
        node(&tree, &theirs).unwrap().parent.as_deref(),
        Some(other.as_str())
    );
    assert!(tpath.exists());
}
