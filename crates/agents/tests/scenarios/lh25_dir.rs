//! LH25: the Daemon names a node's folder, and `terminal.open` starts the shell there.

use std::path::{Path, PathBuf};

use agents::worktree::Git;
use rpc::code;
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
}

/// A project with one commit and a linked git worktree beside it; no Worktree setting.
fn project() -> (Fixture, PathBuf, PathBuf, tempfile::TempDir) {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let project = std::fs::canonicalize(f.dir.path()).unwrap();
    std::fs::write(project.join("seed.txt"), "a\n").unwrap();
    git(&project, &["add", "-A"]);
    git(&project, &["commit", "-q", "-m", "seed"]);
    let lane = tempfile::tempdir().unwrap();
    let top = std::fs::canonicalize(lane.path()).unwrap().join("lane");
    git(
        &project,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "lane",
            &top.to_string_lossy(),
        ],
    );
    (f, project, top, lane)
}

async fn wrote(f: &Fixture, id: &str, path: &Path) {
    let payload = json!({"hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": {"file_path": path}});
    f.call(
        "agent.signal",
        json!({"id": id, "attempt": f.attempt(id).await, "payload": payload}),
    )
    .await
    .unwrap();
}

async fn folder(f: &Fixture, id: &str) -> PathBuf {
    let read = f.call("agent.dir", json!({"id": id})).await.unwrap();
    PathBuf::from(read["path"].as_str().unwrap())
}

#[tokio::test]
async fn lh25_the_folder_is_the_worktree_record_else_the_newest_write_checkout_else_the_project() {
    let (f, project, top, _lane) = project();
    let agent = f.spawn(None, None).await.unwrap().base.id;
    assert_eq!(folder(&f, &agent).await, project, "no write: the Project");

    let file = top.join("a.txt");
    std::fs::write(&file, "x").unwrap();
    wrote(&f, &agent, &file).await;
    assert_eq!(
        folder(&f, &agent).await,
        top,
        "a write in a linked worktree"
    );

    let own = project.join("b.txt");
    std::fs::write(&own, "x").unwrap();
    wrote(&f, &agent, &own).await;
    assert_eq!(
        folder(&f, &agent).await,
        top,
        "a main-checkout write is passed over"
    );

    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let recorded = f.spawn(None, None).await.unwrap();
    let path = recorded.worktree().expect("a Worktree record").path;
    assert_eq!(folder(&f, &recorded.base.id).await, PathBuf::from(path));
}

#[tokio::test]
async fn lh25_a_missing_checkout_falls_back() {
    let (f, project, top, lane) = project();
    let agent = f.spawn(None, None).await.unwrap().base.id;
    let file = top.join("a.txt");
    std::fs::write(&file, "x").unwrap();
    wrote(&f, &agent, &file).await;
    std::fs::remove_dir_all(lane.path().join("lane")).unwrap();

    assert_eq!(folder(&f, &agent).await, project);
}

#[tokio::test]
async fn lh25_an_unknown_node_is_not_found() {
    let f = Fixture::new();

    let err = f
        .call("agent.dir", json!({"id": "999"}))
        .await
        .unwrap_err();

    assert_eq!(err.code, code::NOT_FOUND);
}

async fn shell_cwd(f: &Fixture, owner: Value) -> PathBuf {
    let opened = f
        .call("terminal.open", json!({"workstream": owner}))
        .await
        .unwrap();
    let id = opened["terminal_id"].as_str().unwrap();
    let terminal = f
        .terminals
        .list()
        .await
        .into_iter()
        .find(|t| t.id == id)
        .unwrap();
    std::fs::canonicalize(terminal.cwd).unwrap()
}

#[tokio::test]
async fn lh25_terminal_open_starts_in_the_agents_folder() {
    let (f, _project, top, _lane) = project();
    let agent = f.spawn(None, None).await.unwrap().base.id;
    let file = top.join("a.txt");
    std::fs::write(&file, "x").unwrap();
    wrote(&f, &agent, &file).await;

    assert_eq!(shell_cwd(&f, json!(agent)).await, top);
}

#[tokio::test]
async fn lh25_a_project_owned_terminal_stays_in_the_project() {
    let (f, project, _top, _lane) = project();

    assert_eq!(shell_cwd(&f, Value::Null).await, project);
}
