//! U7186b: the compare endpoints and the file lists between any two (`scenarios/ui-agent-changes.md`).

use std::path::{Path, PathBuf};

use agents::worktree::Git;
use contracts::agent::{ChangedStatus, CompareEndpoint};

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn write(dir: &Path, name: &str, text: &str) {
    let path = dir.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn commit_all(dir: &Path) {
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
            "c",
        ],
    );
}

/// `main` with `seed.txt`, a branch `feat` one commit ahead and a second worktree on it.
fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(tmp.path()).unwrap();
    let repo = root.join("repo");
    std::fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    write(&repo, "seed.txt", "seed\n");
    write(&repo, "keep.txt", "keep\n");
    commit_all(&repo);
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
    write(&other, "seed.txt", "seed\nmore\n");
    commit_all(&other);
    (tmp, repo, other)
}

fn worktree(path: &Path, branch: &str) -> CompareEndpoint {
    CompareEndpoint::Worktree {
        path: path.display().to_string(),
        branch: branch.into(),
    }
}

fn head(branch: &str) -> CompareEndpoint {
    CompareEndpoint::Head {
        branch: branch.into(),
    }
}

fn listed(files: &contracts::agent::ChangedFiles) -> Vec<(String, ChangedStatus)> {
    files
        .files
        .iter()
        .map(|f| (f.path.clone(), f.status))
        .collect()
}

#[test]
fn u7186b_lists_every_worktree_state_and_every_branch_head() {
    let (_tmp, repo, other) = fixture();
    let refs = Git::from_env().compare_refs(&repo).unwrap().refs;
    let endpoints: Vec<_> = refs.iter().map(|r| r.endpoint.clone()).collect();
    assert_eq!(
        endpoints,
        [
            worktree(&other, "feat"),
            worktree(&repo, "main"),
            head("feat"),
            head("main")
        ]
    );
    assert!(refs.iter().all(|r| !r.label.is_empty()));
}

#[test]
fn u7186b_compares_worktree_with_worktree_head_with_head_and_worktree_with_head() {
    let (_tmp, repo, other) = fixture();
    write(&other, "new.txt", "new\n");
    write(&repo, "keep.txt", "kept\n");
    let git_ = Git::from_env();
    let compare = |from, to| -> Vec<(String, ChangedStatus)> {
        listed(&git_.compare_endpoints(&repo, &from, &to).unwrap())
    };
    // Worktree against worktree reads both working trees, uncommitted and untracked included.
    assert_eq!(
        compare(worktree(&repo, "main"), worktree(&other, "feat")),
        [
            ("keep.txt".to_owned(), ChangedStatus::Modified),
            ("new.txt".to_owned(), ChangedStatus::Added),
            ("seed.txt".to_owned(), ChangedStatus::Modified)
        ]
    );
    // Head against head reads only commits.
    assert_eq!(
        compare(head("main"), head("feat")),
        [("seed.txt".to_owned(), ChangedStatus::Modified)]
    );
    // Worktree against head: the untracked file and the uncommitted edit show.
    assert_eq!(
        compare(head("main"), worktree(&other, "feat")),
        [
            ("new.txt".to_owned(), ChangedStatus::Added),
            ("seed.txt".to_owned(), ChangedStatus::Modified)
        ]
    );
    let files = git_
        .compare_endpoints(&repo, &head("main"), &head("feat"))
        .unwrap();
    assert_eq!(files.files[0].line, Some(2));
    let file = git_
        .compare_endpoints_file(&repo, &head("main"), &worktree(&other, "feat"), "seed.txt")
        .unwrap();
    assert!(
        matches!(file.old, contracts::agent::FileContent::Text { ref text, .. } if text == "seed\n")
    );
    assert!(
        matches!(file.new, contracts::agent::FileContent::Text { ref text, .. } if text == "seed\nmore\n")
    );
}

#[test]
fn u7186b_changes_nothing_and_a_gone_endpoint_fails() {
    let (_tmp, repo, other) = fixture();
    write(&other, "new.txt", "new\n");
    let before = (
        git(&other, &["status", "--porcelain"]),
        git(&repo, &["branch", "-v"]),
    );
    let git_ = Git::from_env();
    git_.compare_endpoints(&repo, &head("main"), &worktree(&other, "feat"))
        .unwrap();
    assert_eq!(
        before,
        (
            git(&other, &["status", "--porcelain"]),
            git(&repo, &["branch", "-v"])
        )
    );
    for gone in [head("nope"), worktree(&repo.join("gone"), "feat")] {
        let err = git_
            .compare_endpoints(&repo, &head("main"), &gone)
            .unwrap_err();
        assert_eq!(err.message, "endpoint_missing");
    }
}
