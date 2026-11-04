//! FOP5978a–d: an Agents opened on a Fork's data folder (`<fork>/fork.json` beside
//! `<fork>/projects/<key>`) starts every Agent stopped, attaches no owner, turns Auto off,
//! resumes as a new branch and never changes a Worktree. FOP5978e is `crates/rupd/src/fork_tests.rs`.

use std::path::{Path, PathBuf};
use std::process::Command;

use contracts::Kind;
use rpc::{Bus, code};
use serde_json::json;

use crate::common::{Fixture, fake_claude, init_repo, status_of};

const CONVERSATION: &str = "11111111-1111-1111-1111-111111111111";

/// A live data folder, a recorded-argv fake `claude` and the file it records into.
struct Folder {
    root: tempfile::TempDir,
    data: PathBuf,
    bin: String,
    log: PathBuf,
}

impl Folder {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("projects").join("key");
        std::fs::create_dir_all(&data).unwrap();
        let log = root.path().join("argv.log");
        let bin = fake_claude(
            root.path(),
            &format!("echo \"$@\" >> '{}'\nexec sleep 30", log.display()),
        );
        Self {
            root,
            data,
            bin,
            log,
        }
    }

    fn open(&self) -> Fixture {
        folder_in_project(self, self.root.path())
    }

    /// An Agent with a saved conversation, a Workstream with Auto on, then the Daemon ends.
    async fn live_agent(&self) -> (String, String) {
        let f = self.open();
        let node = spawn_in(&f, self.root.path()).await.unwrap();
        let attempt = f.attempt(&node.id).await;
        f.call(
            "agent.signal",
            json!({"id": node.id, "attempt": attempt, "payload": {
                "hook_event_name": "SessionStart", "session_id": CONVERSATION, "source": "startup"}}),
        )
        .await
        .unwrap();
        crate::common::until_file(&self.log).await;
        let ws = f.workstream("ws", None).await;
        f.call("workstream.setAuto", json!({"id": ws, "auto": true}))
            .await
            .unwrap();
        (node.id, ws)
    }

    fn mark_fork(&self) {
        std::fs::write(self.root.path().join("fork.json"), "{}").unwrap();
    }

    fn launches(&self) -> Vec<String> {
        std::fs::read_to_string(&self.log)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

#[tokio::test]
async fn fop5978a_fork_opens_every_agent_stopped() {
    let folder = Folder::new();
    let (id, _) = folder.live_agent().await;
    let launched = folder.launches().len();
    folder.mark_fork();

    let f = folder.open();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let tree = f.tree().await;
    let node = tree.iter().find(|n| n.id == id).unwrap();
    assert_eq!(status_of(&tree, &id).kind, Kind::Done);
    assert!(node.can_resume && node.terminal_id.is_none());
    assert_eq!(folder.launches().len(), launched, "no program starts");
    assert!(f.terminals.list().await.is_empty());
}

#[tokio::test]
async fn fop5978a_live_folder_opens_unchanged() {
    let folder = Folder::new();
    let (_, ws) = folder.live_agent().await;

    let f = folder.open();

    let tree = f.tree().await;
    assert!(tree.iter().find(|n| n.id == ws).unwrap().auto == Some(true));
}

#[tokio::test]
async fn fop5978b_fork_attaches_no_owner_and_turns_auto_off() {
    let folder = Folder::new();
    let (id, ws) = folder.live_agent().await;
    let owners = folder.data.join("owners");
    std::fs::create_dir_all(&owners).unwrap();
    let record = owners.join(format!("{id}.json"));
    std::fs::write(&record, "{}").unwrap();
    folder.mark_fork();

    let f = folder.open();

    assert!(f.agents.reattach_owners().await.is_empty());
    assert!(!record.exists(), "the record is dropped");
    assert!(f.agents.retained_sockets().is_empty());
    assert!(f.tree().await.iter().find(|n| n.id == ws).unwrap().auto == Some(false));
    f.call("workstream.setAuto", json!({"id": ws, "auto": true}))
        .await
        .unwrap();
    assert!(f.tree().await.iter().find(|n| n.id == ws).unwrap().auto == Some(true));
}

async fn resumed_argv(folder: &Folder) -> String {
    let f = std::sync::Arc::new(folder.open());
    let tree = f.tree().await;
    let id = tree
        .iter()
        .find(|n| n.kind == contracts::agent::NodeKind::Agent)
        .unwrap()
        .id
        .clone();
    let before = folder.launches().len();
    let resuming = tokio::spawn({
        let f = std::sync::Arc::clone(&f);
        async move { f.call("agent.resume", json!({"id": id})).await }
    });
    let line = loop {
        if let Some(line) = folder.launches().get(before) {
            break line.clone();
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    };
    resuming.abort();
    line
}

#[tokio::test]
async fn fop5978c_resume_in_a_fork_passes_fork_session() {
    let folder = Folder::new();
    folder.live_agent().await;
    folder.mark_fork();

    let argv = resumed_argv(&folder).await;

    assert!(argv.contains(&format!("--resume {CONVERSATION}")), "{argv}");
    assert!(argv.contains("--fork-session"), "{argv}");
}

#[tokio::test]
async fn fop5978c_resume_in_a_live_folder_does_not() {
    let folder = Folder::new();
    folder.live_agent().await;

    let argv = resumed_argv(&folder).await;

    assert!(argv.contains(&format!("--resume {CONVERSATION}")), "{argv}");
    assert!(!argv.contains("--fork-session"), "{argv}");
}

fn git(project: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(project)
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// The Project's own state a Fork must leave as it is.
fn snapshot(project: &Path) -> (String, String) {
    (
        git(project, &["worktree", "list", "--porcelain"]),
        git(project, &["for-each-ref"]),
    )
}

/// A Fork over `project`, a git repository the live App owns, with one Worktree of it.
fn fork_over(project: &Path) -> (Folder, Fixture, PathBuf) {
    let folder = Folder::new();
    init_repo(project);
    let tree = folder.root.path().join("wt");
    git(
        project,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "agent",
            tree.to_str().unwrap(),
        ],
    );
    folder.mark_fork();
    let f = folder_in_project(&folder, project);
    (folder, f, tree)
}

#[tokio::test]
async fn fop5978d_fork_never_provisions_in_the_live_project() {
    let project = tempfile::tempdir().unwrap();
    let (_folder, f, _) = fork_over(project.path());
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let before = snapshot(project.path());

    let spawned = spawn_in(&f, project.path()).await;

    assert_eq!(spawned.unwrap_err().code, code::INVALID_PARAMS);
    assert_eq!(snapshot(project.path()), before);
}

#[tokio::test]
async fn fop5978d_fork_never_removes_a_live_worktree() {
    let project = tempfile::tempdir().unwrap();
    let (folder, f, tree) = fork_over(project.path());
    let id = spawn_in(&f, project.path()).await.unwrap().id;
    let db = rusqlite::Connection::open(folder.data.join("agents.db")).unwrap();
    db.execute(
        "UPDATE nodes SET worktree_path=?1, worktree_branch='agent', worktree_base='main',
         conversation_id=?2, conversation_cwd=?3",
        [
            tree.to_str().unwrap(),
            CONVERSATION,
            project.path().to_str().unwrap(),
        ],
    )
    .unwrap();
    f.call("agent.stop", json!({"id": id})).await.unwrap();
    let before = snapshot(project.path());
    let launched = folder.launches().len();

    let resumed = f.call("agent.resume", json!({"id": id})).await;
    let _ = f.call("rail.remove", json!({"id": id})).await;

    assert_eq!(resumed.unwrap_err().code, code::INVALID_PARAMS);
    assert_eq!(snapshot(project.path()), before);
    assert!(tree.is_dir());
    assert_eq!(folder.launches().len(), launched);
}

fn folder_in_project(folder: &Folder, project: &Path) -> Fixture {
    let bus = Bus::new();
    let events = bus.subscribe();
    let terminals =
        std::sync::Arc::new(terminal::Terminals::open(&folder.data, bus.clone()).unwrap());
    let rup = folder.root.path().join("rup");
    std::fs::write(&rup, "").unwrap();
    let launcher =
        agents::claude_code::Launcher::new(&folder.bin, folder.data.join("claude.json"), rup, None);
    let agents = agents::Agents::open_in(
        project,
        &folder.data,
        bus.clone(),
        std::sync::Arc::clone(&terminals),
        launcher,
        agents::worktree::Git::from_env(),
    )
    .unwrap();
    Fixture {
        dir: tempfile::tempdir().unwrap(),
        bus,
        events,
        agents,
        terminals,
    }
}

async fn spawn_in(
    f: &Fixture,
    project: &Path,
) -> Result<contracts::agent::RailNode, rpc::RpcError> {
    let cwd = project.to_string_lossy().into_owned();
    let node = f
        .call(
            "agent.spawn",
            json!({"cwd": cwd, "prompt": null, "parent": null}),
        )
        .await?;
    Ok(serde_json::from_value(node).unwrap())
}
