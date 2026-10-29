//! G1 the `worktrees` setting, and G2 spawn provisions a Worktree (`scenarios/worktrees.md`).

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use agents::worktree::Git;
use contracts::agent::{NodeKind, RailNode};
use contracts::project::{ProjectSettings, Worktrees};
use rpc::code;
use serde_json::{Value, json};

use crate::common::Fixture;

async fn set_worktrees(f: &Fixture, on: bool, check: Option<&str>) {
    f.call("project.setWorktrees", json!({"on": on, "check": check}))
        .await
        .unwrap();
}

async fn project_get(f: &Fixture) -> ProjectSettings {
    let value = f.call("project.get", Value::Null).await.unwrap();
    serde_json::from_value(value).unwrap()
}

async fn spawn_in(
    f: &Fixture,
    cwd: &Path,
    parent: Option<&str>,
) -> Result<RailNode, rpc::RpcError> {
    let params = json!({"cwd": cwd.to_string_lossy(), "prompt": Value::Null, "parent": parent});
    let node = f.call("agent.spawn", params).await?;
    Ok(serde_json::from_value(node).unwrap())
}

async fn start_door(f: &Fixture, id: &str) -> Result<RailNode, rpc::RpcError> {
    let node = f.call("rail.startDoor", json!({"id": id})).await?;
    Ok(serde_json::from_value(node).unwrap())
}

fn git_output(project: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(project)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// `git branch` and `git worktree list`, to compare before and after a failed call (G2, P5).
fn git_state(project: &Path) -> (String, String) {
    (
        git_output(project, &["branch", "--list"]),
        git_output(project, &["worktree", "list"]),
    )
}

fn real_git() -> String {
    String::from_utf8(
        std::process::Command::new("sh")
            .arg("-c")
            .arg("command -v git")
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned()
}

/// A `git` named `git` in `dir`, running `script` with the real one's path as `$REAL`, put in
/// front of the real `PATH`.
fn wrapped_git(dir: &Path, script: &str) -> Git {
    let wrapper = dir.join("git");
    std::fs::write(
        &wrapper,
        format!("#!/bin/sh\nREAL='{}'\n{script}\n", real_git()),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    Git::with_path(format!(
        "{}:{}",
        dir.display(),
        std::env::var("PATH").unwrap()
    ))
}

/// `git` on `PATH` that fails `git worktree add` and passes every other command to the real one.
fn failing_git(dir: &Path) -> Git {
    wrapped_git(
        dir,
        "if [ \"$1\" = worktree ] && [ \"$2\" = add ]; then echo fake failure >&2; exit 1; fi\nexec \"$REAL\" \"$@\"",
    )
}

/// `git` on `PATH` that fails any command that starts while another is still running, as two
/// concurrent `git` commands on one repository can (`index.lock`).
fn exclusive_git(dir: &Path) -> Git {
    let busy = dir.join("busy");
    wrapped_git(
        dir,
        &format!(
            "mkdir '{busy}' 2>/dev/null || {{ echo concurrent git >&2; exit 1; }}\nsleep 0.05\n\"$REAL\" \"$@\"\ncode=$?\nrmdir '{busy}'\nexit $code",
            busy = busy.display()
        ),
    )
}

fn failing_commands_git(dir: &Path, conditions: &str) -> Git {
    wrapped_git(
        dir,
        &format!("if {conditions}; then echo fake failure >&2; exit 1; fi\nexec \"$REAL\" \"$@\""),
    )
}

/// `git rev-parse --git-path`, the step after `git worktree add` that locates `info/exclude`.
const GIT_PATH_FAILS: &str = "[ \"$1\" = rev-parse ] && [ \"$2\" = --git-path ]";

async fn terminal_cwd(f: &Fixture, node: &RailNode) -> String {
    f.terminals
        .list()
        .await
        .into_iter()
        .find(|t| Some(&t.id) == node.terminal_id.as_ref())
        .unwrap()
        .cwd
}

#[tokio::test]
async fn g5_rejected_slow_precheck_keeps_the_live_door_watched() {
    use std::sync::Arc;
    use std::time::Duration;
    let guard = tempfile::tempdir().unwrap();
    let parked = guard.path().join("parked");
    let release = guard.path().join("release");
    let git = wrapped_git(
        guard.path(),
        &format!(
            "if [ \"$1\" = status ]; then echo parked > '{}'; while [ ! -e '{}' ]; do sleep 0.01; done; fi\nexec \"$REAL\" \"$@\"",
            parked.display(),
            release.display()
        ),
    );
    let f = Arc::new(Fixture::in_git_project(
        "echo ready > ready\nwhile read line; do if [ \"$line\" = exit ]; then exit 0; fi; printf '\\033]0;◐ Claude Code\\007'; done",
        git,
    ));
    set_worktrees(&f, true, None).await;
    let id = f.workstream("workstream", None).await;
    let node = start_door(&f, &id).await.unwrap();
    let path = PathBuf::from(node.worktree.unwrap().path);
    crate::common::until_file(&path.join("ready")).await;
    std::fs::remove_file(path.join("ready")).unwrap();
    std::fs::write(path.join("dirty"), "keep").unwrap();
    f.call(
        "agent.signal",
        json!({"id":id,"attempt":node.attempt,"payload":{"hook_event_name":"Stop"}}),
    )
    .await
    .unwrap();
    let removing = {
        let f = Arc::clone(&f);
        let id = id.clone();
        tokio::spawn(async move { f.call("rail.remove", json!({"id":id})).await })
    };
    crate::common::until_file(&parked).await;
    let mut titles = f
        .terminals
        .subscribe(node.terminal_id.as_ref().unwrap())
        .unwrap();
    f.terminals
        .write(node.terminal_id.as_ref().unwrap(), b"title\n")
        .await
        .unwrap();
    let mut title_received = false;
    let observed = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if matches!(titles.recv().await.unwrap().as_ref(), contracts::EventData::TerminalTitle(title) if title.title.starts_with('◐')) {
                title_received = true;
                break;
            }
        }
        loop {
            if f.tree().await[0].status.as_ref().unwrap().kind == contracts::Kind::Working {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    std::fs::write(release, "go").unwrap();
    let refused = removing.await.unwrap().unwrap_err();
    assert!(refused.message.starts_with("worktree_unlanded:"));
    f.terminals
        .write(node.terminal_id.as_ref().unwrap(), b"exit\n")
        .await
        .unwrap();
    assert!(
        observed.is_ok(),
        "a rejected removal must not revoke its live watcher; title_received={title_received}; tree={:?}; terminal={:?}",
        f.tree().await,
        f.terminals.snapshot(node.terminal_id.as_ref().unwrap())
    );
    f.until(|tree| tree[0].status.as_ref().unwrap().kind == contracts::Kind::Done)
        .await;
}

#[path = "worktrees/provisioning.rs"]
mod provisioning;

#[path = "worktrees/recovery.rs"]
mod recovery;

// G2542a–G2542d: prepared directories (`scenarios/worktrees.md`).
mod prepared {
    use std::collections::BTreeMap;
    use std::time::Duration;

    use super::*;
    use crate::prepared_support::*;

    fn count(path: &Path) -> usize {
        std::fs::read_to_string(path).map_or(0, |text| text.lines().count())
    }

    async fn until_lines(path: &Path, lines: usize) -> String {
        for _ in 0..500 {
            if count(path) >= lines {
                return std::fs::read_to_string(path).unwrap();
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("{} never reached {lines} lines", path.display());
    }

    /// Whether a process still runs; a zombie is gone.
    fn alive(pid: &str) -> bool {
        let out = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", pid.trim()])
            .output()
            .unwrap();
        out.status.success() && !String::from_utf8_lossy(&out.stdout).trim().starts_with('Z')
    }

    fn launch_counter(logs: &Path) -> (PathBuf, String) {
        let launches = logs.join("launches");
        let script = format!("echo launch >> '{}'; exec sleep 30", launches.display());
        (launches, script)
    }

    async fn remove(f: &Fixture, id: &str) {
        f.call("rail.remove", json!({"id": id})).await.unwrap();
    }

    fn branches(project: &Path) -> String {
        git(project, &["branch", "--list", "roundup/*"])
    }

    fn head(dir: &Path) -> String {
        git(dir, &["rev-parse", "--abbrev-ref", "HEAD"])
    }

    fn project_with_dir(script: &str, git: Git) -> (Fixture, PathBuf) {
        let f = Fixture::in_git_project(script, git);
        commit_sources(f.dir.path());
        let dir = parked_dir(f.dir.path(), "a");
        (f, dir)
    }

    #[tokio::test]
    async fn g2542a_readiness_precedes_launch() {
        let logs = tempfile::tempdir().unwrap();
        let order = logs.path().join("order");
        let script = format!("echo launch >> '{}'; exec sleep 30", order.display());
        let (f, dir) = project_with_dir(&script, Git::from_env());
        let readiness = format!(
            "echo \"readiness $(git rev-parse --abbrev-ref HEAD) $(pwd -P)\" >> '{}'",
            order.display()
        );
        enroll(&f, &[&dir], &readiness, 5000).await.unwrap();
        let commit = git(f.dir.path(), &["rev-parse", "HEAD"]);

        let node = f.spawn(None, None).await.unwrap();

        let lines = until_lines(&order, 2).await;
        let mut lines = lines.lines();
        assert_eq!(
            lines.next().unwrap(),
            format!("readiness roundup/agent-{} {}", node.id, dir.display()),
            "readiness ran in the enrolled directory, already on the Agent branch"
        );
        assert_eq!(lines.next().unwrap(), "launch");
        let worktree = node.worktree.expect("a Worktree");
        assert_eq!(PathBuf::from(&worktree.path), dir);
        assert_eq!(git(&dir, &["rev-parse", "HEAD"]), commit);
        assert_eq!(head(&dir), worktree.branch);
    }

    #[tokio::test]
    async fn g2542a_changed_environment_and_failed_readiness_block_launch() {
        let logs = tempfile::tempdir().unwrap();
        let (launches, script) = launch_counter(logs.path());
        let (f, dir) = project_with_dir(&script, Git::from_env());
        std::fs::write(dir.join(".env"), "ok").unwrap();
        let pid = logs.path().join("pid");
        let check = "case \"$(cat .env)\" in ok) exit 0;; \
            short) i=1; while [ $i -le 30 ]; do echo \"line $i\"; i=$((i+1)); done; exit 3;; \
            big) head -c 40000 /dev/zero | tr '\\0' x; echo; echo last-line; exit 3;; esac";
        enroll(&f, &[&dir], check, 5000).await.unwrap();

        let first = f.spawn(None, None).await.unwrap();
        until_lines(&launches, 1).await;
        remove(&f, &first.id).await;

        // A changed environment fails readiness on the next assignment: nothing launches.
        std::fs::write(dir.join(".env"), "short").unwrap();
        let err = f.spawn(None, None).await.unwrap_err();
        let lines: Vec<&str> = err.message.lines().collect();
        assert!(
            lines[0].starts_with("prepared_failed: phase=readiness path="),
            "{}",
            err.message
        );
        assert!(lines[0].contains(&dir.display().to_string()));
        assert!(lines[0].contains("status=3"));
        assert_eq!(lines.len() - 1, 20, "the last 20 lines");
        assert_eq!(lines.last(), Some(&"line 30"));
        assert_eq!(lines[1], "line 11");
        assert_eq!(count(&launches), 1);
        assert!(f.tree().await.is_empty(), "no Agent was left behind");
        assert_eq!(branches(f.dir.path()), "");
        let parked = std::process::Command::new("git")
            .current_dir(&dir)
            .args(["symbolic-ref", "-q", "HEAD"])
            .status()
            .unwrap();
        assert!(
            !parked.success(),
            "the failed directory is parked, detached"
        );

        // Fixed environment, still unavailable until an explicit preparation succeeds.
        std::fs::write(dir.join(".env"), "ok").unwrap();
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(
            err.message.starts_with("no_prepared_directory"),
            "{}",
            err.message
        );
        assert!(err.message.contains("unavailable"));
        assert_eq!(count(&launches), 1);
        f.call(
            "project.prepareDirectory",
            json!({"path": dir.to_string_lossy()}),
        )
        .await
        .unwrap();
        let again = f.spawn(None, None).await.unwrap();
        until_lines(&launches, 2).await;
        remove(&f, &again.id).await;

        // Output is capped at 16 KiB.
        std::fs::write(dir.join(".env"), "big").unwrap();
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(err.message.len() < 16 * 1024 + 300, "{}", err.message.len());
        assert!(err.message.ends_with("last-line"));
        std::fs::write(dir.join(".env"), "ok").unwrap();
        f.call(
            "project.prepareDirectory",
            json!({"path": dir.to_string_lossy()}),
        )
        .await
        .unwrap();

        // A readiness command that outlives its timeout is killed and launches nothing.
        let slow = format!("echo $$ > '{}'; sleep 10", pid.display());
        enroll(&f, &[&dir], &slow, 300).await.unwrap();
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(
            err.message.contains("reason=timeout after 300 ms"),
            "{}",
            err.message
        );
        assert!(!alive(&std::fs::read_to_string(&pid).unwrap()));
        assert_eq!(count(&launches), 2);

        // Cancelling the start stops readiness and launches nothing; the directory stays parked.
        enroll(&f, &[&dir], check, 5000).await.unwrap();
        f.call(
            "project.prepareDirectory",
            json!({"path": dir.to_string_lossy()}),
        )
        .await
        .unwrap();
        let hang = format!("echo $$ > '{}'; sleep 10", pid.display());
        enroll(&f, &[&dir], &hang, 60_000).await.unwrap();
        let cancelled = tokio::time::timeout(Duration::from_millis(400), f.spawn(None, None)).await;
        assert!(cancelled.is_err(), "the start was still waiting");
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!alive(&std::fs::read_to_string(&pid).unwrap()));
        assert_eq!(count(&launches), 2);
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(
            err.message.starts_with("no_prepared_directory"),
            "{}",
            err.message
        );
    }

    /// One Project with a single ecosystem's real dependencies in its enrolled directory.
    async fn ecosystem_runs_without_install(prepare: fn(&Path), smoke: &str) {
        let logs = tempfile::tempdir().unwrap();
        let installs = logs.path().join("installs");
        let marker = logs.path().join("smoke-ok");
        let shims = installer_shims(logs.path(), &installs);
        let path = format!("export PATH='{}':\"$PATH\"", shims.display());
        let script = format!(
            "{path}; {smoke} && echo ok >> '{}'; exec sleep 30",
            marker.display()
        );
        let (f, dir) = project_with_dir(&script, Git::from_env());
        prepare(&dir);
        pad(&dir, 300);
        let readiness = format!("{path}; {smoke}");
        enroll(&f, &[&dir], &readiness, 10_000).await.unwrap();
        let before = ignored_snapshot(&dir);

        let first = f.spawn(None, None).await.unwrap();
        until_lines(&marker, 1).await;
        remove(&f, &first.id).await;
        let second = f.spawn(None, None).await.unwrap();
        until_lines(&marker, 2).await;
        remove(&f, &second.id).await;

        assert_eq!(
            ignored_snapshot(&dir),
            before,
            "dependency roots are untouched"
        );
        assert_eq!(count(&installs), 0, "no installer ran");
    }

    #[tokio::test]
    async fn g2542b_prepared_ecosystems_run_without_install_or_copy() {
        ecosystem_runs_without_install(
            |dir| {
                prepare_node(dir);
                prepare_env(dir);
            },
            &format!("{SMOKE_NODE} && {SMOKE_ENV}"),
        )
        .await;
        ecosystem_runs_without_install(
            |dir| {
                prepare_rust(dir);
                prepare_env(dir);
            },
            &format!("{SMOKE_RUST} && {SMOKE_ENV}"),
        )
        .await;
        ecosystem_runs_without_install(
            |dir| {
                prepare_python(dir);
                prepare_env(dir);
            },
            &format!("{SMOKE_PYTHON} && {SMOKE_ENV}"),
        )
        .await;
    }

    fn contents(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
        if root.is_file() {
            return BTreeMap::from([(root.to_owned(), std::fs::read(root).unwrap())]);
        }
        snapshot(root)
            .into_keys()
            .filter(|path| path.is_file())
            .map(|path| {
                let bytes = std::fs::read(&path).unwrap();
                (path, bytes)
            })
            .collect()
    }

    #[tokio::test]
    async fn g2542b_reassignment_preserves_ignored_paths() {
        let logs = tempfile::tempdir().unwrap();
        let (launches, script) = launch_counter(logs.path());
        let (f, dir) = project_with_dir(&script, Git::from_env());
        prepare_all(&dir, 300);
        enroll(&f, &[&dir], &smoke_all(), 10_000).await.unwrap();
        let before = ignored_snapshot(&dir);
        let bytes: Vec<_> = IGNORED.iter().map(|n| contents(&dir.join(n))).collect();
        let env_before = std::fs::read(dir.join(".env")).unwrap();

        for round in 1..=3 {
            let node = f.spawn(None, None).await.unwrap();
            until_lines(&launches, round).await;
            // A new target commit each time: tracked files switch, ignored paths stay.
            std::fs::write(dir.join("untracked-agent-file.txt"), "agent work").unwrap();
            f.call("agent.discard", json!({"id": node.id}))
                .await
                .unwrap();
            std::fs::write(f.dir.path().join(format!("round{round}.txt")), "x").unwrap();
            git(f.dir.path(), &["add", "-A"]);
            git(
                f.dir.path(),
                &["commit", "-q", "-m", &format!("round {round}")],
            );
        }

        assert_eq!(ignored_snapshot(&dir), before);
        let after: Vec<_> = IGNORED.iter().map(|n| contents(&dir.join(n))).collect();
        assert_eq!(after, bytes);
        assert_eq!(std::fs::read(dir.join(".env")).unwrap(), env_before);
    }

    /// Everything in `dir` but git's own files and roundup's data folder, with its bytes.
    fn tree_bytes(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
        let mut found = BTreeMap::new();
        let mut pending = vec![dir.to_owned()];
        while let Some(folder) = pending.pop() {
            for entry in std::fs::read_dir(&folder).unwrap() {
                let path = entry.unwrap().path();
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                if name == ".git" || name == ".roundup" {
                    continue;
                }
                if path.is_dir() {
                    pending.push(path);
                } else {
                    found.insert(path.clone(), std::fs::read(&path).unwrap());
                }
            }
        }
        found
    }

    fn refs(project: &Path) -> (String, String) {
        (
            git(project, &["for-each-ref"]),
            git(project, &["worktree", "list"]),
        )
    }

    fn detached(dir: &Path) -> bool {
        !std::process::Command::new("git")
            .current_dir(dir)
            .args(["symbolic-ref", "-q", "HEAD"])
            .status()
            .unwrap()
            .success()
    }

    #[tokio::test]
    async fn g2542c_exclusive_assignment_and_enrollment_guards() {
        let logs = tempfile::tempdir().unwrap();
        let (launches, script) = launch_counter(logs.path());
        let (f, dir) = project_with_dir(&script, Git::from_env());
        let project = f.dir.path().to_owned();
        let outside = tempfile::tempdir().unwrap();
        let prepared = project.join(".roundup/prepared");

        let make = |name: &str| parked_dir(&project, name);
        let outside_dir = outside.path().join("elsewhere");
        git(
            &project,
            &[
                "worktree",
                "add",
                "-q",
                "--detach",
                &outside_dir.to_string_lossy(),
            ],
        );
        let link = prepared.join("link");
        std::os::unix::fs::symlink(&dir, &link).unwrap();
        let escape = prepared.join("escape");
        std::os::unix::fs::symlink(&outside_dir, &escape).unwrap();
        let plain = prepared.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let other = prepared.join("other");
        std::fs::create_dir_all(&other).unwrap();
        git(&other, &["init", "-q", "-b", "main"]);
        let owned = make("owned");
        git(&owned, &["switch", "-q", "-c", "roundup/agent-99"]);
        let ahead = make("ahead");
        git(&ahead, &["switch", "-q", "-c", "feature"]);
        git(
            &ahead,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "x",
            ],
        );
        let loose = make("loose");
        git(
            &loose,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "loose",
            ],
        );
        let staged = make("staged");
        std::fs::write(staged.join("new.txt"), "s").unwrap();
        git(&staged, &["add", "new.txt"]);
        let unstaged = make("unstaged");
        std::fs::write(unstaged.join("README.md"), "changed\n").unwrap();
        let untracked = make("untracked");
        std::fs::write(untracked.join("scratch.txt"), "u").unwrap();
        let busy = make("busy");
        let git_dir = git(&busy, &["rev-parse", "--absolute-git-dir"]);
        std::fs::write(Path::new(&git_dir).join("MERGE_HEAD"), "x\n").unwrap();
        let dotted = prepared.join("b/../a");
        std::fs::create_dir_all(prepared.join("b")).unwrap();

        let rejected: Vec<(&Path, &str)> = vec![
            (&project, "primary_checkout"),
            (&outside_dir, "outside_project"),
            (&link, "symlink_escape"),
            (&escape, "symlink_escape"),
            (&plain, "not_a_worktree_root"),
            (&other, "other_repository"),
            (&owned, "owned_branch"),
            (&ahead, "unlanded_commits"),
            (&loose, "unlanded_commits"),
            (&staged, "uncommitted_work"),
            (&unstaged, "uncommitted_work"),
            (&untracked, "uncommitted_work"),
            (&busy, "git_operation_in_progress"),
        ];
        for (path, reason) in rejected {
            let (before_refs, before_bytes) = (refs(&project), tree_bytes(path));
            let err = enroll(&f, &[path], "true", 1000)
                .await
                .expect_err(&format!("{reason} {}", path.display()));
            assert!(err.message.contains(reason), "{reason}: {}", err.message);
            assert_eq!(refs(&project), before_refs, "{reason}");
            assert_eq!(tree_bytes(path), before_bytes, "{reason}");
        }
        let err = enroll(&f, &[&dir, &dir], "true", 1000).await.unwrap_err();
        assert!(err.message.contains("duplicate_path"), "{}", err.message);
        let err = enroll(&f, &[&dir, &dotted], "true", 1000)
            .await
            .unwrap_err();
        assert!(err.message.contains("duplicate_path"), "{}", err.message);
        let none = f.call("project.getPrepared", Value::Null).await.unwrap();
        assert_eq!(
            none["enrolled"],
            json!([]),
            "a rejected enrollment saves nothing"
        );

        // One available directory, two simultaneous starts: one launches.
        enroll(&f, &[&dir], "true", 5000).await.unwrap();
        let workstream = f.workstream("w", None).await;
        let (a, b) = tokio::join!(f.spawn(None, None), f.spawn(None, None));
        let (won, lost) = match (a, b) {
            (Ok(won), Err(lost)) | (Err(lost), Ok(won)) => (won, lost),
            other => panic!("exactly one start wins: {other:?}"),
        };
        assert!(
            lost.message.starts_with("no_prepared_directory"),
            "{}",
            lost.message
        );
        until_lines(&launches, 1).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(count(&launches), 1);

        // A recorded Agent holds the directory even when it has stopped and git reports clean.
        f.call("agent.stop", json!({"id": won.id})).await.unwrap();
        assert_eq!(git(&dir, &["status", "--porcelain"]), "");
        let (before_refs, before_bytes) = (refs(&project), tree_bytes(&dir));
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(
            err.message.starts_with("no_prepared_directory"),
            "{}",
            err.message
        );
        let err = f
            .call("rail.startDoor", json!({"id": workstream}))
            .await
            .unwrap_err();
        assert!(
            err.message.starts_with("no_prepared_directory"),
            "{}",
            err.message
        );
        assert_eq!(refs(&project), before_refs);
        assert_eq!(tree_bytes(&dir), before_bytes);
        assert_eq!(count(&launches), 1);
    }

    fn commit_in(dir: &Path, message: &str) {
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

    #[tokio::test]
    async fn g2542d_release_keeps_work_and_ignored_files() {
        let logs = tempfile::tempdir().unwrap();
        let (launches, script) = launch_counter(logs.path());
        let ready = logs.path().join("ready");
        let (f, dir) = project_with_dir(&script, Git::from_env());
        let project = f.dir.path().to_owned();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::write(dir.join("node_modules/dep.js"), "dep").unwrap();
        std::fs::write(dir.join(".env"), "TOKEN=x").unwrap();
        let readiness = format!("echo ready >> '{}'", ready.display());
        enroll(&f, &[&dir], &readiness, 5000).await.unwrap();
        let ignored = ignored_snapshot(&dir);
        let registered =
            || git(&project, &["worktree", "list"]).contains(&dir.display().to_string());

        // Clean removal: the Agent branch and node go, the directory and ignored files stay.
        let node = f.spawn(None, None).await.unwrap();
        until_lines(&launches, 1).await;
        remove(&f, &node.id).await;
        assert!(f.tree().await.is_empty());
        assert_eq!(branches(&project), "");
        assert!(detached(&dir) && registered());
        assert_eq!(ignored_snapshot(&dir), ignored);

        // Dirty or ahead work stays attached to its Agent; nothing is reset or stashed.
        let node = f.spawn(None, None).await.unwrap();
        std::fs::write(dir.join("scratch.txt"), "dirty").unwrap();
        let err = f
            .call("rail.remove", json!({"id": node.id}))
            .await
            .unwrap_err();
        assert!(err.message.contains("worktree_unlanded"), "{}", err.message);
        assert_eq!(std::fs::read(dir.join("scratch.txt")).unwrap(), b"dirty");
        commit_in(&dir, "agent work");
        std::fs::remove_file(dir.join("scratch.txt")).unwrap();
        let err = f
            .call("rail.remove", json!({"id": node.id}))
            .await
            .unwrap_err();
        assert!(err.message.contains("worktree_unlanded"), "{}", err.message);
        assert_eq!(head(&dir), node.worktree.as_ref().unwrap().branch);
        assert_eq!(f.tree().await.len(), 1);
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(err.message.starts_with("no_prepared_directory"));
        let err = enroll(&f, &[], "true", 1000).await.unwrap_err();
        assert!(
            err.message.starts_with("prepared_in_use"),
            "{}",
            err.message
        );

        // Explicit discard drops the Agent's work but never the ignored files.
        std::fs::write(dir.join("again.txt"), "untracked").unwrap();
        f.call("agent.discard", json!({"id": node.id}))
            .await
            .unwrap();
        assert!(detached(&dir) && registered());
        assert_eq!(branches(&project), "");
        assert!(!dir.join("again.txt").exists());
        assert_eq!(git(&dir, &["status", "--porcelain"]), "");
        assert_eq!(ignored_snapshot(&dir), ignored);
        assert_eq!(
            git(&dir, &["log", "--oneline", "-1", "--format=%s"]),
            "sources"
        );

        // A Workstream's removal retains the directory too.
        let workstream = f.workstream("w", None).await;
        f.call("rail.startDoor", json!({"id": workstream}))
            .await
            .unwrap();
        until_lines(&launches, 3).await;
        f.call("rail.remove", json!({"id": workstream}))
            .await
            .unwrap();
        assert!(f.tree().await.is_empty());
        assert!(detached(&dir) && registered());
        assert_eq!(branches(&project), "");
        assert_eq!(ignored_snapshot(&dir), ignored);

        // Unenrolling deletes nothing.
        enroll(&f, &[], "true", 1000).await.unwrap();
        assert!(dir.is_dir());
        assert_eq!(ignored_snapshot(&dir), ignored);

        // A restarted Door reuses its assignment: no switch, no readiness, work intact.
        enroll(&f, &[&dir], &readiness, 5000).await.unwrap();
        let readiness_runs = count(&ready);
        let door = f.workstream("again", None).await;
        let first = f.call("rail.startDoor", json!({"id": door})).await.unwrap();
        assert_eq!(count(&ready), readiness_runs + 1);
        std::fs::write(dir.join("door.txt"), "door work").unwrap();
        f.call("agent.stop", json!({"id": door})).await.unwrap();
        let second = f.call("rail.startDoor", json!({"id": door})).await.unwrap();
        assert_eq!(second["worktree"], first["worktree"]);
        assert_eq!(
            count(&ready),
            readiness_runs + 1,
            "restart wrote nothing through readiness"
        );
        assert_eq!(std::fs::read(dir.join("door.txt")).unwrap(), b"door work");
    }

    /// `git` that "dies" at `trigger`: that command and every later one fail, as they would in a
    /// Daemon killed there, so no in-process cleanup can run.
    fn dying_git(dir: &Path, dead: &Path, trigger: &str) -> Git {
        wrapped_git(
            dir,
            &format!(
                "if [ -e '{dead}' ]; then echo dead >&2; exit 128; fi\nif {trigger}; then touch '{dead}'; echo died >&2; exit 128; fi\nexec \"$REAL\" \"$@\"",
                dead = dead.display()
            ),
        )
    }

    #[tokio::test]
    async fn g2542d_crash_recovery_never_deletes_or_double_assigns() {
        // Process death after the reservation, after the branch exists, and after readiness.
        let points: [(&str, Option<&str>); 3] = [
            ("[ \"$1\" = update-ref ]", None),
            ("[ \"$1\" = switch ]", None),
            ("false", Some("touch '{dead}'")),
        ];
        for (index, (trigger, readiness_dies)) in points.into_iter().enumerate() {
            for dirty in [false, true] {
                if dirty && readiness_dies.is_none() {
                    continue;
                }
                let _ = index;
                let logs = tempfile::tempdir().unwrap();
                let (launches, script) = launch_counter(logs.path());
                let shim = tempfile::tempdir().unwrap();
                let dead = logs.path().join("dead");
                let git_wrapper = dying_git(shim.path(), &dead, trigger);
                let (f, dir) = project_with_dir(&script, git_wrapper);
                let project = f.dir.path().to_owned();
                std::fs::write(dir.join(".env"), "TOKEN=x").unwrap();
                let readiness = match readiness_dies {
                    Some(die) => format!(
                        "{}{}",
                        if dirty {
                            "echo work > scratch.txt; "
                        } else {
                            ""
                        },
                        die.replace("{dead}", &dead.to_string_lossy())
                    ),
                    None => "true".into(),
                };
                enroll(&f, &[&dir], &readiness, 5000).await.unwrap();
                let ignored = ignored_snapshot(&dir);

                let died = f.spawn(None, None).await;
                assert!(died.is_err() || index == 2, "point {index}");
                let f = f.reopen();

                assert_eq!(ignored_snapshot(&dir), ignored, "point {index}");
                assert!(dir.is_dir());
                if readiness_dies.is_some() {
                    // Readiness passed, so the Agent is recorded: it keeps its directory, with
                    // any work in it, and no second start can take it.
                    let tree = f.tree().await;
                    assert_eq!(tree.len(), 1);
                    let branch = tree[0].worktree.as_ref().unwrap().branch.clone();
                    assert_eq!(head(&dir), branch);
                    if dirty {
                        assert_eq!(std::fs::read(dir.join("scratch.txt")).unwrap(), b"work\n");
                    }
                    let err = f.spawn(None, None).await.unwrap_err();
                    assert!(
                        err.message.starts_with("no_prepared_directory"),
                        "{}",
                        err.message
                    );
                    assert_eq!(count(&launches), 0);
                    continue;
                }
                assert!(
                    f.tree().await.is_empty(),
                    "point {index}: recovery removed the Agent"
                );
                assert!(detached(&dir), "point {index}");
                assert_eq!(branches(&project), "", "point {index}");
                assert_eq!(git(&project, &["for-each-ref", "refs/roundup"]), "");
                assert_eq!(count(&launches), 0);
                // One owner: a retry assigns the directory and a second start finds none.
                let owner = f.spawn(None, None).await.unwrap();
                until_lines(&launches, 1).await;
                let err = f.spawn(None, None).await.unwrap_err();
                assert!(
                    err.message.starts_with("no_prepared_directory"),
                    "{}",
                    err.message
                );
                assert_eq!(owner.worktree.unwrap().path, dir.to_string_lossy());
            }
        }
    }

    #[tokio::test]
    async fn g2542d_failed_readiness_that_left_edits_keeps_the_directory_parked() {
        let logs = tempfile::tempdir().unwrap();
        let (launches, script) = launch_counter(logs.path());
        let (f, dir) = project_with_dir(&script, Git::from_env());
        enroll(&f, &[&dir], "echo work > scratch.txt; exit 1", 5000)
            .await
            .unwrap();

        let err = f.spawn(None, None).await.unwrap_err();
        assert!(err.message.contains("phase=readiness"), "{}", err.message);

        // Parking would lose the edits, so the directory stays parked, unavailable and intact.
        assert_eq!(f.tree().await.len(), 1);
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(
            err.message.starts_with("no_prepared_directory"),
            "{}",
            err.message
        );
        let f = f.reopen();
        assert_eq!(f.tree().await.len(), 1, "recovery refuses to park edits");
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(
            err.message.starts_with("no_prepared_directory"),
            "{}",
            err.message
        );
        assert_eq!(std::fs::read(dir.join("scratch.txt")).unwrap(), b"work\n");
        assert_eq!(count(&launches), 0);
    }

    #[tokio::test]
    async fn g2542d_a_running_agent_keeps_its_directory_across_restart() {
        let logs = tempfile::tempdir().unwrap();
        let (launches, script) = launch_counter(logs.path());
        let (f, dir) = project_with_dir(&script, Git::from_env());
        enroll(&f, &[&dir], "true", 5000).await.unwrap();
        let node = f.spawn(None, None).await.unwrap();
        until_lines(&launches, 1).await;
        std::fs::write(dir.join("work.txt"), "mine").unwrap();

        let f = f.reopen();

        let tree = f.tree().await;
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].worktree, node.worktree);
        assert_eq!(std::fs::read(dir.join("work.txt")).unwrap(), b"mine");
        let err = f.spawn(None, None).await.unwrap_err();
        assert!(
            err.message.starts_with("no_prepared_directory"),
            "{}",
            err.message
        );
    }
}
