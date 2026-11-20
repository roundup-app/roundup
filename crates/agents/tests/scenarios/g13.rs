//! G13 the Project's program adopts inside its directory, G15 a path held only by ended Agents is
//! adopted again (`scenarios/worktrees.md`). G14's callers are the Daemon's (`crates/rupd`).

use std::path::{Path, PathBuf};

use agents::AdoptBy;
use agents::worktree::Git;
use contracts::agent::{AdoptParams, Adoptable, RailNode, RailVisibility};
use rpc::code;
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// A worktree on `branch` inside the program's directory `trees` of the Project.
fn tree_in(f: &Fixture, trees: &Path, branch: &str) -> PathBuf {
    std::fs::create_dir_all(trees).unwrap();
    let path = trees.join(branch);
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

fn program(trees: &Path) -> AdoptBy {
    AdoptBy::Program {
        dir: trees.to_owned(),
    }
}

async fn adopt(
    f: &Fixture,
    by: AdoptBy,
    path: &Path,
    branch: &str,
) -> Result<RailNode, rpc::RpcError> {
    let params: AdoptParams = serde_json::from_value(
        json!({"path": path.to_string_lossy(), "branch": branch, "visibility": "internal"}),
    )
    .unwrap();
    f.agents.adopt_by(&f.ctx(), by, params).await
}

fn refused(err: &rpc::RpcError, name: &str) {
    assert_eq!(err.code, code::INVALID_PARAMS, "{}", err.message);
    assert!(
        err.message.starts_with(&format!("{name}: ")),
        "{}",
        err.message
    );
}

#[tokio::test]
async fn g13_program_adopts_inside_its_directory_with_launch_fields() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let trees = f.dir.path().join("trees");
    let path = tree_in(&f, &trees, "job");
    let node = adopt(&f, program(&trees), &path, "job").await.unwrap();
    assert!(node.worktree().unwrap().adopted);
    assert_eq!(node.base.visibility, RailVisibility::Internal);
    assert_eq!(f.tree().await.len(), 1);
}

#[tokio::test]
async fn g13_outside_and_linked_out_paths_are_refused() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let trees = f.dir.path().join("trees");
    std::fs::create_dir_all(&trees).unwrap();
    let beside = tree_in(&f, &f.dir.path().join("beside"), "beside");
    let away = tempfile::tempdir().unwrap();
    let out = tree_in(&f, away.path(), "out");
    std::os::unix::fs::symlink(&out, trees.join("link")).unwrap();
    let before = [
        git(f.dir.path(), &["for-each-ref"]),
        git(f.dir.path(), &["worktree", "list"]),
    ];
    for (path, branch) in [(beside, "beside"), (trees.join("link"), "out")] {
        let err = adopt(&f, program(&trees), &path, branch).await.unwrap_err();
        refused(&err, "outside_program_directory");
    }
    assert!(f.tree().await.is_empty());
    assert_eq!(
        [
            git(f.dir.path(), &["for-each-ref"]),
            git(f.dir.path(), &["worktree", "list"])
        ],
        before
    );
}

#[tokio::test]
async fn g15_build_fix_review_take_turns_in_one_worktree() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let trees = f.dir.path().join("trees");
    let path = tree_in(&f, &trees, "job");
    for _ in 0..3 {
        let node = adopt(&f, program(&trees), &path, "job").await.unwrap();
        let err = adopt(&f, program(&trees), &path, "job").await.unwrap_err();
        assert_eq!(err.code, code::CONFLICT, "{}", err.message);
        assert!(
            err.message.starts_with("worktree_in_use: "),
            "{}",
            err.message
        );
        f.call("agent.stop", json!({"id": node.id})).await.unwrap();
    }
    let tree = f.tree().await;
    assert_eq!(tree.len(), 3);
    assert!(
        tree.iter()
            .all(|node| node.worktree().is_some_and(|w| w.adopted))
    );
}

#[tokio::test]
async fn g15_ended_node_keeps_history_and_branch() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let trees = f.dir.path().join("trees");
    let path = tree_in(&f, &trees, "job");
    let first = adopt(&f, program(&trees), &path, "job").await.unwrap();
    f.call("agent.stop", json!({"id": first.id})).await.unwrap();
    let before = git(f.dir.path(), &["rev-parse", "refs/heads/job"]);
    adopt(&f, program(&trees), &path, "job").await.unwrap();
    let tree = f.tree().await;
    let kept = tree.iter().find(|node| node.id == first.id).unwrap();
    assert_eq!(kept.worktree().unwrap().path, path.to_string_lossy());
    assert!(path.exists());
    assert_eq!(git(f.dir.path(), &["rev-parse", "refs/heads/job"]), before);
    // The user's pick keeps G10: any node that records the path still makes it owned.
    let err = f
        .agents
        .adopt_by(
            &f.ctx(),
            AdoptBy::User,
            serde_json::from_value(json!({"path": path.to_string_lossy(), "branch": "job"}))
                .unwrap(),
        )
        .await
        .unwrap_err();
    refused(&err, "owned_branch");
}

#[tokio::test]
async fn g15_row_changed_equals_git_diff_stat() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let trees = f.dir.path().join("trees");
    let path = tree_in(&f, &trees, "job");
    std::fs::write(path.join("a.txt"), "a").unwrap();
    git(&path, &["add", "a.txt"]);
    git(&path, &["commit", "-q", "-m", "a"]);
    std::fs::write(path.join("README.md"), "changed\n").unwrap();
    std::fs::write(path.join("loose.txt"), "untracked").unwrap();
    let rows: Vec<Adoptable> = serde_json::from_value::<Value>(
        serde_json::to_value(
            f.agents
                .adoptable_by(&f.ctx(), program(&trees))
                .await
                .unwrap(),
        )
        .unwrap(),
    )
    .and_then(serde_json::from_value)
    .unwrap();
    let stat = git(&path, &["diff", "--stat", "main"]);
    let files = stat.lines().count() - 1;
    assert_eq!(usize::try_from(rows[0].changed).unwrap(), files);
    assert!(files >= 1);
}
