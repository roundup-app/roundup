//! U7693a, U7693b: `agent.remoteMain` and `agent.fetchRemoteMain`
//! (`scenarios/ui-changes-remote-moved.md`), against temporary repositories with an origin.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use agents::worktree::Git;
use rpc::{Module, code};
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
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

fn commit(dir: &Path, name: &str) {
    std::fs::write(dir.join(name), format!("{name}\n")).unwrap();
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", name]);
}

/// A bare origin and a repository that pushed `main` to it and fetched.
struct Pair {
    root: tempfile::TempDir,
    origin: PathBuf,
    work: PathBuf,
}

impl Pair {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let work = root.path().join("work");
        std::fs::create_dir_all(&work).unwrap();
        git(&work, &["init", "-q", "-b", "main"]);
        commit(&work, "seed.txt");
        Self::around(root, work)
    }

    /// Give `work`, which holds a commit on `main`, a bare origin that has it.
    fn around(root: tempfile::TempDir, work: PathBuf) -> Self {
        let origin = root.path().join("origin");
        std::fs::create_dir_all(&origin).unwrap();
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);
        git(
            &work,
            &["remote", "add", "origin", &origin.display().to_string()],
        );
        git(&work, &["push", "-q", "origin", "main"]);
        git(&work, &["fetch", "-q", "origin"]);
        git(&work, &["remote", "set-head", "origin", "main"]);
        Self { root, origin, work }
    }

    /// A commit pushed to the origin by someone else, after the clone.
    fn push_elsewhere(&self, name: &str) {
        let other = self.root.path().join(format!("other-{name}"));
        git(
            self.root.path(),
            &[
                "clone",
                "-q",
                &self.origin.display().to_string(),
                &other.display().to_string(),
            ],
        );
        commit(&other, name);
        git(&other, &["push", "-q", "origin", "main"]);
    }

    /// Refs, index and config as a call leaves them.
    fn state(&self) -> String {
        [
            git(&self.work, &["for-each-ref"]),
            git(&self.work, &["status", "--porcelain"]),
            std::fs::read_to_string(self.work.join(".git/config")).unwrap(),
            self.work.join(".git/FETCH_HEAD").exists().to_string(),
        ]
        .join("\n--\n")
    }
}

#[test]
fn u7693a_a_commit_pushed_after_the_clone_reads_as_moved_and_an_unmoved_remote_as_current() {
    let pair = Pair::new();
    let runner = Git::from_env();
    assert_eq!(
        runner.remote_main(&pair.work).unwrap(),
        contracts::agent::RemoteMain::Current
    );
    pair.push_elsewhere("late.txt");
    let before = pair.state();
    assert_eq!(
        runner.remote_main(&pair.work).unwrap(),
        contracts::agent::RemoteMain::Moved
    );
    assert_eq!(
        pair.state(),
        before,
        "a read changes no ref, file, FETCH_HEAD or config"
    );
}

#[test]
fn u7693a_no_origin_or_no_origin_head_answers_none_and_runs_no_network_call() {
    let pair = Pair::new();
    let bin = Wrapper::new(Duration::ZERO);
    let runner = Git::with_path(bin.path());
    git(&pair.work, &["remote", "set-head", "origin", "-d"]);
    assert_eq!(
        runner.remote_main(&pair.work).unwrap(),
        contracts::agent::RemoteMain::None
    );
    git(&pair.work, &["remote", "remove", "origin"]);
    assert_eq!(
        runner.remote_main(&pair.work).unwrap(),
        contracts::agent::RemoteMain::None
    );
    let log = bin.log();
    assert!(
        !log.contains("ls-remote") && !log.contains("fetch"),
        "{log}"
    );
}

/// A `git` first on `PATH` that records `GIT_TERMINAL_PROMPT`, `GIT_SSH_COMMAND` and its
/// arguments, and sleeps on `ls-remote` and `fetch`.
struct Wrapper {
    dir: tempfile::TempDir,
}

impl Wrapper {
    fn new(sleep: Duration) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let real = std::process::Command::new("sh")
            .args(["-c", "command -v git"])
            .output()
            .unwrap();
        let real = String::from_utf8_lossy(&real.stdout).trim().to_owned();
        let script = format!(
            "#!/bin/sh\necho \"$GIT_TERMINAL_PROMPT|$GIT_SSH_COMMAND|$*\" >> '{log}'\ncase \" $* \" in *\" ls-remote \"*|*\" fetch \"*) sleep {secs};; esac\nexec '{real}' \"$@\"\n",
            log = dir.path().join("log").display(),
            secs = sleep.as_secs_f32(),
        );
        let bin = dir.path().join("git");
        std::fs::write(&bin, script).unwrap();
        std::os::unix::fs::PermissionsExt::set_mode(
            &mut std::fs::metadata(&bin).unwrap().permissions(),
            0o755,
        );
        std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755))
            .unwrap();
        Self { dir }
    }

    fn path(&self) -> std::ffi::OsString {
        let mut path = std::ffi::OsString::from(self.dir.path());
        path.push(":");
        path.push(std::env::var_os("PATH").unwrap_or_default());
        path
    }

    fn log(&self) -> String {
        std::fs::read_to_string(self.dir.path().join("log")).unwrap_or_default()
    }
}

/// A project with an origin on `main` and one Agent in its own Worktree.
async fn agent_fixture(runner: Git) -> (Fixture, String, PathBuf, Pair) {
    let f = Fixture::in_git_project("sleep 30", runner);
    // The Fixture's project is the pair's working repository.
    let project = f.dir.path().to_path_buf();
    git(&project, &["config", "user.name", "t"]);
    git(&project, &["config", "user.email", "t@t"]);
    commit(&project, "seed.txt");
    let pair = Pair::around(tempfile::tempdir().unwrap(), project);
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path = node.worktree().expect("a Worktree").path.into();
    (f, node.base.id, path, pair)
}

#[tokio::test]
async fn u7693a_no_call_prompts_or_blocks_another_git_read() {
    let bin = Wrapper::new(Duration::from_millis(1500));
    let (f, id, _, pair) = agent_fixture(Git::with_path(bin.path())).await;
    pair.push_elsewhere("late.txt");
    let probe = async {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let start = Instant::now();
        f.call("agent.changedFiles", json!({"id": id}))
            .await
            .unwrap();
        start.elapsed()
    };
    let (read, fetch, waited) = tokio::join!(
        f.call("agent.remoteMain", json!({"id": id})),
        f.call("agent.fetchRemoteMain", json!({"id": id})),
        probe
    );
    read.unwrap();
    fetch.unwrap();
    assert!(
        waited < Duration::from_millis(1000),
        "changedFiles waited {waited:?}"
    );
    let network: Vec<_> = bin
        .log()
        .lines()
        .filter(|line| line.contains("ls-remote origin") || line.contains(" fetch "))
        .map(str::to_owned)
        .collect();
    assert_eq!(network.len(), 2, "{network:?}");
    for line in network {
        assert!(
            line.starts_with("0|") && line.contains("-o BatchMode=yes|"),
            "{line}"
        );
    }
}

#[tokio::test]
async fn u7693a_an_agent_call_is_refused_and_the_tool_list_does_not_move() {
    let bin = Wrapper::new(Duration::ZERO);
    let (f, id, _, _pair) = agent_fixture(Git::with_path(bin.path())).await;
    let before = bin.log();
    for method in ["agent.remoteMain", "agent.fetchRemoteMain"] {
        let mut ctx = f.ctx();
        ctx.actor = contracts::Actor {
            kind: contracts::ActorKind::Agent,
            id: id.clone(),
            parent: None,
        };
        let error = f
            .agents
            .call(&ctx, method, json!({"id": id}))
            .await
            .unwrap_err();
        assert_eq!(error.code, code::FORBIDDEN, "{method}");
        let listed = contracts::methods::metadata();
        let row = listed.iter().find(|m| m.name == method).unwrap();
        assert!(matches!(row.mcp, contracts::methods::McpChoice::None(_)));
    }
    assert_eq!(bin.log(), before, "no git command ran");
}

#[test]
fn u7693b_fetch_updates_only_the_remote_main_ref_and_counts_the_commits() {
    let pair = Pair::new();
    let runner = Git::from_env();
    assert_eq!(runner.fetch_remote_main(&pair.work).unwrap().commits, 0);
    git(&pair.origin, &["branch", "side", "main"]);
    pair.push_elsewhere("late.txt");
    let other = pair.root.path().join("other-late.txt");
    git(&other, &["tag", "v1"]);
    git(&other, &["push", "-q", "origin", "v1"]);
    git(&other, &["push", "-q", "origin", "main:side"]);
    let (head, files) = (
        git(&pair.work, &["rev-parse", "HEAD"]),
        git(&pair.work, &["ls-files"]),
    );
    assert_eq!(runner.fetch_remote_main(&pair.work).unwrap().commits, 1);
    let refs = git(&pair.work, &["for-each-ref", "--format=%(refname)"]);
    assert_eq!(
        refs, "refs/heads/main\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/main",
        "no other branch or tag"
    );
    let new = git(&pair.origin, &["rev-parse", "main"]);
    assert_eq!(git(&pair.work, &["rev-parse", "origin/main"]), new);
    assert_eq!(git(&pair.work, &["rev-parse", "HEAD"]), head);
    assert_eq!(git(&pair.work, &["ls-files"]), files);
    assert!(
        !pair.work.join("late.txt").exists(),
        "no pull, merge or rebase"
    );
}

fn paths(files: &Value) -> Vec<&str> {
    files["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn u7693b_after_a_fetch_the_comparison_stops_listing_others_commits() {
    let (f, id, path, pair) = agent_fixture(Git::from_env()).await;
    pair.push_elsewhere("late.txt");
    // The Agent's branch took the newer main by URL, so `origin/main` stayed behind.
    git(
        &path,
        &["fetch", "-q", &pair.origin.display().to_string(), "main"],
    );
    git(&path, &["merge", "-q", "--ff-only", "FETCH_HEAD"]);
    let listed = |to: &'static str| f.call("agent.changedFiles", json!({"id": id, "to": to}));
    for to in ["tree", "branch"] {
        assert_eq!(paths(&listed(to).await.unwrap()), ["late.txt"], "{to}");
    }
    let moved = f.call("agent.remoteMain", json!({"id": id})).await.unwrap();
    assert_eq!(moved["kind"], "moved");
    let fetched = f
        .call("agent.fetchRemoteMain", json!({"id": id}))
        .await
        .unwrap();
    assert_eq!(fetched["commits"], 1);
    for to in ["tree", "branch"] {
        assert!(paths(&listed(to).await.unwrap()).is_empty(), "{to}");
    }
}

#[test]
fn u7693b_both_calls_fail_with_their_cause_and_a_failed_fetch_changes_nothing() {
    let pair = Pair::new();
    let runner = Git::from_env();
    git(
        &pair.work,
        &["remote", "set-url", "origin", "/nonexistent/remote"],
    );
    let before = pair.state();
    for error in [
        runner.remote_main(&pair.work).unwrap_err(),
        runner.fetch_remote_main(&pair.work).unwrap_err(),
    ] {
        assert!(error.message.starts_with("remote_unreachable: "), "{error}");
        assert!(
            error
                .message
                .contains("does not appear to be a git repository"),
            "{error}"
        );
    }
    assert_eq!(pair.state(), before);
    // A remote that stays silent ends at the limit.
    git(
        &pair.work,
        &[
            "remote",
            "set-url",
            "origin",
            &pair.origin.display().to_string(),
        ],
    );
    let before = pair.state();
    let wrapper = Wrapper::new(Duration::from_secs(5));
    let slow = Git::with_path(wrapper.path()).with_network_limit(Duration::from_millis(300));
    for error in [
        slow.remote_main(&pair.work).unwrap_err(),
        slow.fetch_remote_main(&pair.work).unwrap_err(),
    ] {
        assert!(error.message.starts_with("remote_unreachable: "), "{error}");
        assert!(error.message.contains("300 ms"), "{error}");
    }
    assert_eq!(pair.state(), before);
}
