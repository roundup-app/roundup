//! MC30, MC31 against a fake herdr-core exec: it records each command it is asked to run on a
//! Machine and runs it on this test's own disk, which stands for the Machine's.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use super::*;
use crate::worktree::Worktree;

#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<(String, std::path::PathBuf, Vec<String>)>>,
    /// Commands starting with these arguments fail to start, as a Machine's exec would.
    broken: Mutex<Vec<String>>,
}

impl Machines for Fake {
    fn exec(
        &self,
        machine: &str,
        cwd: &Path,
        argv: &[String],
        _limit: Duration,
    ) -> Result<Output, String> {
        self.calls
            .lock()
            .unwrap()
            .push((machine.to_owned(), cwd.to_owned(), argv.to_vec()));
        if self.broken.lock().unwrap().iter().any(|b| argv.contains(b)) {
            return Err("core_closed: the Machine's core went away".into());
        }
        Command::new(&argv[0])
            .args(&argv[1..])
            .current_dir(cwd)
            .output()
            .map_err(|err| err.to_string())
    }
}

impl Fake {
    fn argvs(&self) -> Vec<Vec<String>> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|c| c.2.clone())
            .collect()
    }
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

/// A repository on branch `main` with one commit, and a `Git` that reaches it on Machine `m`.
fn folder() -> (tempfile::TempDir, std::path::PathBuf, Git, Arc<Fake>) {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().canonicalize().unwrap();
    git(&project, &["init", "-q", "-b", "main"]);
    std::fs::write(project.join("a.txt"), "a\n").unwrap();
    git(&project, &["add", "."]);
    git(&project, &["commit", "-q", "-m", "one"]);
    let fake = Arc::new(Fake::default());
    let host = Git::from_env();
    host.set_host(Arc::clone(&fake) as Arc<dyn Machines>);
    host.set_machine(Some("m".into()));
    (dir, project, host, fake)
}

fn start(host: &Git, project: &Path, id: &str) -> Worktree {
    let plan = host.plan(project, id).unwrap();
    let made = host.provision(project, &plan).unwrap();
    host.finish(project, &plan).unwrap();
    made
}

#[test]
fn mc30_git_state_read_on_the_folders_machine() {
    let (_dir, project, host, fake) = folder();
    let made = start(&host, &project, "one");
    let state = host.state(&project, &made).unwrap();
    assert_eq!((state.ahead, state.behind, state.dirty), (0, 0, false));
    let calls = fake.calls.lock().unwrap();
    assert!(calls.iter().all(|c| c.0 == "m"), "{calls:?}");
    let reads: Vec<_> = calls
        .iter()
        .filter(|c| c.2.contains(&"rev-list".to_owned()) || c.2.contains(&"status".to_owned()))
        .collect();
    assert_eq!(reads.len(), 2, "{calls:?}");
    assert_eq!(reads[0].1, project, "the count is read in the folder");
    assert_eq!(
        reads[1].1, made.path,
        "the dirty check is read in the Worktree"
    );
}

#[test]
fn mc30_folder_has_one_machine() {
    let two = serde_json::from_str::<contracts::project::SetMachine>(r#"{"machine":["a","b"]}"#);
    assert!(two.is_err());
    let one: contracts::project::SetMachine = serde_json::from_str(r#"{"machine":"a"}"#).unwrap();
    assert_eq!(one.machine.as_deref(), Some("a"));
}

#[test]
fn mc30_local_folder_unchanged() {
    let (_dir, project, _, fake) = folder();
    let local = Git::from_env();
    local.set_host(Arc::clone(&fake) as Arc<dyn Machines>);
    let made = start(&local, &project, "one");
    assert!(made.path.is_dir());
    assert_eq!(local.state(&project, &made).unwrap().ahead, 0);
    assert!(
        fake.calls.lock().unwrap().is_empty(),
        "a local folder asks no Machine"
    );
}

#[test]
fn mc31_remote_worktree_one_cwd_per_working_agent() {
    let (_dir, project, host, fake) = folder();
    let (one, two) = (start(&host, &project, "one"), start(&host, &project, "two"));
    assert_ne!(one.path, two.path);
    assert!(one.path.is_dir() && two.path.is_dir());
    assert!(host.is_dir(&one.path) && host.is_dir(&two.path));
    assert_eq!(git(&project, &["worktree", "list"]).lines().count(), 3);
    let adds: Vec<_> = fake
        .argvs()
        .into_iter()
        .filter(|a| a.contains(&"add".to_owned()) && a.contains(&"worktree".to_owned()))
        .collect();
    assert_eq!(
        adds.len(),
        2,
        "each Worktree is made by exec on the Machine"
    );
}

fn commit_in(made: &Worktree) {
    std::fs::write(made.path.join("b.txt"), "b\n").unwrap();
    git(&made.path, &["add", "."]);
    git(&made.path, &["commit", "-q", "-m", "work"]);
}

#[test]
fn mc31_remote_land_is_rebase_check_fast_forward() {
    let (_dir, project, host, fake) = folder();
    let made = start(&host, &project, "one");
    commit_in(&made);
    let before = git(&project, &["rev-parse", "main"]);
    let after = host.land(&project, &made, Some("test -f b.txt")).unwrap();
    assert_ne!(before, after);
    assert_eq!(after, git(&made.path, &["rev-parse", "HEAD"]));
    let steps: Vec<String> = fake
        .argvs()
        .into_iter()
        .filter_map(|a| {
            let word = if a[0] == "git" {
                a.get(1).cloned()
            } else {
                a.get(4).cloned()
            };
            word.filter(|w| ["rebase", "test -f b.txt", "merge"].contains(&w.as_str()))
        })
        .collect();
    assert_eq!(steps, ["rebase", "test -f b.txt", "merge"]);

    // A red check ends the sequence before the fast-forward and leaves the Base as it was.
    let (_dir, project, host, fake) = folder();
    let made = start(&host, &project, "one");
    commit_in(&made);
    let before = git(&project, &["rev-parse", "main"]);
    let err = host.land(&project, &made, Some("false")).unwrap_err();
    assert!(err.message.contains("check_failed"), "{}", err.message);
    assert_eq!(git(&project, &["rev-parse", "main"]), before);
    assert!(
        !fake
            .argvs()
            .iter()
            .any(|a| a.get(1).is_some_and(|w| w == "merge"))
    );
}

#[test]
fn mc31_remote_failed_exec_leaves_the_base_untouched() {
    let (_dir, project, host, fake) = folder();
    let made = start(&host, &project, "one");
    commit_in(&made);
    let before = git(&project, &["rev-parse", "main"]);
    fake.broken.lock().unwrap().push("merge".into());
    let err = host.land(&project, &made, Some("true")).unwrap_err();
    assert!(!err.message.is_empty());
    assert_eq!(git(&project, &["rev-parse", "main"]), before);
}

#[test]
fn mc31_remote_reject_leaves_no_worktree_or_branch() {
    let (_dir, project, host, _fake) = folder();
    let worktrees = git(&project, &["worktree", "list"]);
    let branches = git(&project, &["branch"]);
    let made = start(&host, &project, "one");
    commit_in(&made);
    host.discard(&project, &made).unwrap();
    assert_eq!(git(&project, &["worktree", "list"]), worktrees);
    assert_eq!(git(&project, &["branch"]), branches);
    assert!(!made.path.exists());
}
