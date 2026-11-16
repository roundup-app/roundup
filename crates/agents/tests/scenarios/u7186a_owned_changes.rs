//! U7186a: what an Agent's recorded file writes leave changed (`scenarios/ui-agent-changes.md`).

use std::path::{Path, PathBuf};

use agents::claude_code::toolcall::written_path;
use agents::worktree::Git;
use serde_json::json;

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

fn write(dir: &Path, name: &str, text: &str) -> String {
    let path = dir.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, text).unwrap();
    path.display().to_string()
}

fn commit_all(dir: &Path, message: &str) {
    git(dir, &["add", "-A"]);
    git(
        dir,
        &[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-q",
            "-m",
            message,
        ],
    );
}

/// A repository on `main` with one seed commit; canonical so macOS `/tmp` links match.
fn repo(default: &str) -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let dir = std::fs::canonicalize(tmp.path()).unwrap();
    git(&dir, &["init", "-q", "-b", default]);
    write(&dir, "seed.txt", "seed\n");
    commit_all(&dir, "seed");
    (tmp, dir)
}

/// A git worktree of `dir` on the new branch `branch`, in a temporary directory of its own.
fn linked(dir: &Path, branch: &str) -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let tree = std::fs::canonicalize(tmp.path()).unwrap().join("wt");
    git(
        dir,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            branch,
            &tree.display().to_string(),
        ],
    );
    (tmp, tree)
}

fn paths(group: &contracts::agent::OwnedGroup) -> Vec<&str> {
    group.files.iter().map(|file| file.path.as_str()).collect()
}

#[test]
fn u7186a_edits_come_from_file_writing_tool_calls_for_every_adapter() {
    let post = |tool: &str, input: serde_json::Value| json!({"hook_event_name": "PostToolUse", "tool_name": tool, "tool_input": input});
    for (tool, key) in [
        ("Write", "file_path"),
        ("Edit", "file_path"),
        ("MultiEdit", "file_path"),
        ("NotebookEdit", "notebook_path"),
    ] {
        assert_eq!(
            written_path(&post(tool, json!({key: "/a/b.rs"}))).as_deref(),
            Some("/a/b.rs")
        );
    }
    assert_eq!(
        written_path(&post("Read", json!({"file_path": "/a/b.rs"}))),
        None
    );
    assert_eq!(
        written_path(&post("Bash", json!({"command": "touch /a/b"}))),
        None
    );
    let pre = json!({"hook_event_name": "PreToolUse", "tool_name": "Write", "tool_input": {"file_path": "/a"}});
    assert_eq!(written_path(&pre), None);
}

#[test]
fn u7186a_a_file_changed_by_another_hand_is_not_owned() {
    let (_tmp, dir) = repo("main");
    let mine = write(&dir, "mine.txt", "1\n");
    write(&dir, "theirs.txt", "2\n");
    let groups = Git::from_env().owned_groups(&[mine]);
    assert_eq!(groups.len(), 1);
    assert_eq!(paths(&groups[0]), ["mine.txt"]);
}

#[test]
fn u7186a_an_own_worktree_lists_commits_and_uncommitted_files_against_the_merge_base() {
    let (_tmp, dir) = repo("main");
    let (_trees, tree) = linked(&dir, "own/x");
    let written = write(&tree, "a.txt", "a\n");
    commit_all(&tree, "a");
    write(&tree, "b.txt", "b\n");
    let groups = Git::from_env().owned_groups(&[written]);
    assert_eq!(groups.len(), 1);
    assert_eq!(
        (groups[0].branch.as_str(), groups[0].base.as_str()),
        ("own/x", "main")
    );
    assert_eq!(paths(&groups[0]), ["a.txt", "b.txt"]);
}

#[test]
fn u7186a_the_shared_checkout_lists_only_files_the_agent_edited() {
    let (_tmp, dir) = repo("main");
    let mine = write(&dir, "seed.txt", "changed\n");
    write(&dir, "other.txt", "x\n");
    let groups = Git::from_env().owned_groups(&[mine]);
    assert_eq!(paths(&groups[0]), ["seed.txt"]);
}

#[test]
fn u7186a_a_branch_in_the_shared_checkout_lists_only_files_the_agent_edited() {
    let (_tmp, dir) = repo("main");
    git(&dir, &["checkout", "-q", "-b", "feat"]);
    write(&dir, "theirs.txt", "t\n");
    commit_all(&dir, "theirs");
    let mine = write(&dir, "mine.txt", "m\n");
    write(&dir, "scratch.txt", "s\n");
    let groups = Git::from_env().owned_groups(&[mine]);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].branch, "feat");
    assert_eq!(paths(&groups[0]), ["mine.txt"]);
}

#[test]
fn u7186a_a_merged_branch_and_a_reverted_file_list_nothing() {
    let (_tmp, dir) = repo("main");
    git(&dir, &["checkout", "-q", "-b", "own/x"]);
    let written = write(&dir, "a.txt", "a\n");
    commit_all(&dir, "a");
    git(&dir, &["checkout", "-q", "main"]);
    git(&dir, &["merge", "-q", "--ff-only", "own/x"]);
    git(&dir, &["checkout", "-q", "own/x"]);
    assert!(
        Git::from_env()
            .owned_groups(&[written])
            .iter()
            .all(|g| g.files.is_empty())
    );
    git(&dir, &["checkout", "-q", "main"]);
    let seed = write(&dir, "seed.txt", "changed\n");
    write(&dir, "seed.txt", "seed\n");
    assert!(
        Git::from_env()
            .owned_groups(&[seed])
            .iter()
            .all(|g| g.files.is_empty())
    );
}

#[test]
fn u7186a_several_repos_and_branches_return_one_group_each() {
    let (_t1, one) = repo("main");
    let (_t2, two) = repo("main");
    let first = write(&one, "a.txt", "a\n");
    let second = write(&two, "b.txt", "b\n");
    let (_trees, tree) = linked(&one, "own/y");
    let third = write(&tree, "c.txt", "c\n");
    let groups = Git::from_env().owned_groups(&[second, third, first]);
    let keys: Vec<_> = groups
        .iter()
        .map(|g| (g.repo.clone(), g.branch.clone()))
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted);
    assert_eq!(groups.len(), 3);
    assert!(
        groups
            .iter()
            .any(|g| g.branch == "own/y" && g.repo == one.display().to_string())
    );
}

#[test]
fn u7186a_the_default_branch_is_the_repository_default() {
    let (_tmp, dir) = repo("master");
    let mine = write(&dir, "seed.txt", "changed\n");
    let groups = Git::from_env().owned_groups(&[mine]);
    assert_eq!(
        (groups[0].branch.as_str(), groups[0].base.as_str()),
        ("master", "master")
    );
    assert_eq!(paths(&groups[0]), ["seed.txt"]);
}

#[test]
fn u7186a_changes_nothing_and_skips_a_missing_repo() {
    let (_tmp, dir) = repo("main");
    let mine = write(&dir, "new.txt", "n\n");
    let before = git(&dir, &["status", "--porcelain=v2", "--branch"]);
    let gone = tempfile::tempdir().unwrap();
    let ghost = gone.path().join("repo/x.txt").display().to_string();
    let groups = Git::from_env().owned_groups(&[ghost, mine]);
    assert_eq!(groups.len(), 1);
    assert_eq!(git(&dir, &["status", "--porcelain=v2", "--branch"]), before);
    assert!(Git::from_env().owned_groups(&[]).is_empty());
}
