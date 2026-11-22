//! FOP5978a–d: an Agents opened on a Fork's data folder (`<fork>/fork.json` beside
//! `<fork>/projects/<key>`) starts every Agent stopped, attaches no owner, turns Auto off,
//! resumes as a new branch and never changes a Worktree. FOP5978e is in the Daemon crate's `fork_tests.rs`.

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
        (node.base.id, ws)
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
    assert!(node.can_resume() && node.terminal_id().is_none());
    assert_eq!(folder.launches().len(), launched, "no program starts");
    assert!(f.terminals.list().await.is_empty());
}

#[tokio::test]
async fn fop5978a_live_folder_opens_unchanged() {
    let folder = Folder::new();
    let (_, ws) = folder.live_agent().await;

    let f = folder.open();

    let tree = f.tree().await;
    assert!(tree.iter().find(|n| n.id == ws).unwrap().auto());
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
    assert!(!f.tree().await.iter().find(|n| n.id == ws).unwrap().auto());
    f.call("workstream.setAuto", json!({"id": ws, "auto": true}))
        .await
        .unwrap();
    assert!(f.tree().await.iter().find(|n| n.id == ws).unwrap().auto());
}

async fn resumed_argv(folder: &Folder) -> String {
    let f = std::sync::Arc::new(folder.open());
    let tree = f.tree().await;
    let id = tree
        .iter()
        .find(|n| n.kind() == contracts::agent::NodeKind::Agent)
        .unwrap()
        .id
        .clone();
    std::fs::write(&folder.log, "").unwrap();
    let resuming = tokio::spawn({
        let f = std::sync::Arc::clone(&f);
        async move { f.call("agent.resume", json!({"id": id})).await }
    });
    let line = crate::common::until_file(&folder.log).await;
    resuming.abort();
    line.trim_end().to_owned()
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
    let id = spawn_in(&f, project.path()).await.unwrap().base.id;
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
        agents::Quiet::default().shared(),
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

#[tokio::test]
async fn mc52_daemon_open_ends_a_core_terminal_of_no_agent_with_no_owner_records() {
    let f = Fixture::new();
    // `Agents::open_with` takes the data folder's parent for the Project.
    let project = f
        .dir
        .path()
        .parent()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    f.terminals
        .spawn_labelled(
            contracts::terminal::SpawnParams {
                cwd: project.clone(),
                command: Some(vec!["cat".into()]),
                env: Default::default(),
                unset: Vec::new(),
                cols: 80,
                rows: 24,
                machine: None,
            },
            terminal::reconcile::labels(&project, "no-such-agent", "1"),
        )
        .await
        .unwrap();

    assert!(f.agents.reattach_owners().await.is_empty());

    let left = f.terminals.reconcile_open(&project, &[]).await.unwrap();
    assert!(
        left.is_empty(),
        "open left a Terminal of no Agent: {left:?}"
    );
}

/// UKR1–UKR4: what an update's reopen keeps (`scenarios/update-keeps-runs.md`).
mod update_keeps_runs {
    use super::{CONVERSATION, json};
    use crate::common::{Fixture, status_of};
    use contracts::Kind;
    use rpc::Module;

    const LAUNCHES: &str = "echo started >> launches.log\nexec sleep 30";

    async fn ack(f: &Fixture, id: &str, source: &str) {
        let attempt = f.attempt(id).await;
        f.call(
            "agent.signal",
            json!({"id": id, "attempt": attempt, "payload": {
                "hook_event_name": "SessionStart", "session_id": CONVERSATION, "source": source}}),
        )
        .await
        .unwrap();
    }

    /// Stop `id` and resume it through `method`, acknowledging the new Attempt.
    async fn resumed(f: &Fixture, method: &str, id: &str) {
        f.call("agent.stop", json!({"id": id})).await.unwrap();
        let before = f.attempt(id).await;
        let resuming = f.call(method, json!({"id": id}));
        let acking = async {
            f.until_attempt_changed(id, &before).await;
            ack(f, id, "resume").await;
        };
        let (resumed, ()) = tokio::join!(resuming, acking);
        resumed.unwrap();
    }

    /// A Door and an Agent, each resumed once, both running.
    async fn running_pair() -> (Fixture, String, String) {
        let f = Fixture::running(LAUNCHES);
        let ws = f.workstream("ws", None).await;
        f.call("rail.startDoor", json!({"id": ws})).await.unwrap();
        ack(&f, &ws, "startup").await;
        let agent = f.spawn(None, None).await.unwrap().base.id;
        ack(&f, &agent, "startup").await;
        resumed(&f, "rail.startDoor", &ws).await;
        resumed(&f, "agent.resume", &agent).await;
        // The fake `claude` logs its launch once its shell runs, after the Terminal is reported
        // started: count the four launches only when all four have logged, or a late line reads
        // as a launch the reopen made.
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(10));
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while launches(&f) < 4 {
                tick.tick().await;
            }
        })
        .await
        .expect("the four launches log in time");
        (f, ws, agent)
    }

    fn record(f: &Fixture, id: &str) -> serde_json::Value {
        let body = std::fs::read(f.dir.path().join("owners").join(format!("{id}.json"))).unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    async fn pid(f: &Fixture, id: &str) -> u32 {
        let tree = f.tree().await;
        let terminal = tree.iter().find(|n| n.id == id).unwrap().terminal_id();
        f.terminals
            .program_pid(&terminal.expect("a Terminal"))
            .expect("a program")
    }

    fn alive(pid: u32) -> bool {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .unwrap()
            .success()
    }

    fn launches(f: &Fixture) -> usize {
        std::fs::read_to_string(f.dir.path().join("launches.log"))
            .unwrap_or_default()
            .lines()
            .count()
    }

    #[tokio::test]
    async fn ukr1_a_resumed_door_and_a_resumed_agent_save_their_owner_record() {
        let (f, ws, agent) = running_pair().await;

        for id in [&ws, &agent] {
            assert_eq!(
                record(&f, id)["attempt"].as_str().unwrap(),
                f.attempt(id).await,
                "{id}'s record names its current Attempt"
            );
        }
    }

    #[tokio::test]
    async fn ukr2_reopen_reattaches_a_door_and_a_resumed_agent_on_the_same_terminal_and_attempt() {
        let (f, ws, agent) = running_pair().await;
        let (door_pid, agent_pid) = (pid(&f, &ws).await, pid(&f, &agent).await);
        let (door_attempt, agent_attempt) = (f.attempt(&ws).await, f.attempt(&agent).await);
        let launched = launches(&f);

        let f = f.reopen_over_core();
        let mut kept = f.agents.reattach_owners().await;
        kept.sort();

        let mut both = vec![ws.clone(), agent.clone()];
        both.sort();
        assert_eq!(kept, both);
        let tree = f.tree().await;
        for (id, pid_before, attempt) in [
            (&ws, door_pid, door_attempt),
            (&agent, agent_pid, agent_attempt),
        ] {
            assert_ne!(
                status_of(&tree, id).kind,
                Kind::Done,
                "{id} reports running"
            );
            assert_eq!(f.attempt(id).await, attempt);
            assert_eq!(pid(&f, id).await, pid_before, "{id} keeps its program");
        }
        assert_eq!(launches(&f), launched, "nothing new launches");
    }

    #[tokio::test]
    async fn ukr3_a_start_after_reopen_leaves_the_live_program_alive() {
        let (f, ws, agent) = running_pair().await;
        let (door_pid, agent_pid) = (pid(&f, &ws).await, pid(&f, &agent).await);
        // The Agent keeps no record, as one resumed before this build; the Door's is kept.
        std::fs::remove_file(f.dir.path().join("owners").join(format!("{agent}.json"))).unwrap();

        let f = f.reopen_over_core();
        assert_eq!(f.agents.reattach_owners().await, vec![ws.clone()]);
        let _ = f.call("rail.startDoor", json!({"id": ws})).await;
        let _ = f.call("agent.resume", json!({"id": agent})).await;

        assert!(alive(door_pid), "the Door's program is alive");
        assert!(alive(agent_pid), "the Agent's program is alive");
    }

    #[tokio::test]
    async fn ukr4_reattach_keeps_the_channel_state_and_arms_no_deadline() {
        let f = Fixture::running(LAUNCHES);
        let id = f.spawn(None, None).await.unwrap().base.id;
        ack(&f, &id, "startup").await;
        let mut ctx = f.ctx();
        ctx.actor = contracts::Actor {
            kind: contracts::ActorKind::Agent,
            id: id.clone(),
            parent: None,
        };
        f.agents
            .call(&ctx, "agent.channelUp", json!({"id": id}))
            .await
            .unwrap();

        let f = f.reopen_over_core();
        assert_eq!(f.agents.reattach_owners().await, vec![id.clone()]);

        let node = f.tree().await.into_iter().find(|n| n.id == id).unwrap();
        assert_eq!(node.channel(), Some(contracts::agent::Channel::Up));
    }
}
