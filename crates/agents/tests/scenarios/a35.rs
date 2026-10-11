//! A35 rewinding a Workstream to a Checkpoint's Marks (`scenarios/workstream-rewind.md`).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use agents::worktree::Git;
use contracts::agent::{NodeKind, RailNode};
use contracts::workstream::{Files, Rewind};
use rpc::code;
use serde_json::json;

use crate::common::Fixture;

/// A `claude` that records where and how it was started, then waits to be stopped.
const RECORDING: &str = "echo \"$(pwd) $@\" >> \"$(dirname \"$0\")/starts.txt\"; exec sleep 30";

const TURNS: [&str; 3] = ["first", "second", "third"];

struct Run {
    f: Arc<Fixture>,
    ws: String,
    agent: String,
}

fn munged(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn id_of(n: u32) -> String {
    format!("{n:08}-0000-4000-8000-000000000000")
}

fn cwd_of(f: &Fixture, node: &RailNode) -> PathBuf {
    node.worktree
        .as_ref()
        .map_or_else(|| f.dir.path().to_path_buf(), |w| PathBuf::from(&w.path))
}

fn conversation_path(f: &Fixture, cwd: &Path, id: &str) -> PathBuf {
    f.dir
        .path()
        .join(".roundup/claude-config/projects")
        .join(munged(cwd))
        .join(format!("{id}.jsonl"))
}

/// Append one turn of `conversation` for the Agent running in `cwd`.
fn turn(f: &Fixture, cwd: &Path, conversation: &str, text: &str) {
    use std::io::Write;
    let path = conversation_path(f, cwd, conversation);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .unwrap();
    let line = json!({"sessionId": conversation, "type": "user", "text": text});
    writeln!(file, "{line}").unwrap();
}

fn text_of(f: &Fixture, cwd: &Path, conversation: &str) -> String {
    std::fs::read_to_string(conversation_path(f, cwd, conversation)).unwrap()
}

impl Fixture {
    async fn session(&self, id: &str, conversation: &str, source: &str) {
        let attempt = self.attempt(id).await;
        self.call(
            "agent.signal",
            json!({"id": id, "attempt": attempt, "payload": {
                "hook_event_name": "SessionStart", "session_id": conversation, "source": source}}),
        )
        .await
        .unwrap();
    }

    async fn node(&self, id: &str) -> Option<RailNode> {
        self.tree().await.into_iter().find(|n| n.id == id)
    }

    fn starts(&self) -> Vec<String> {
        std::fs::read_to_string(self.dir.path().join("starts.txt"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

/// A Project with Worktrees on, a Door and an Agent under it, each with a conversation of three
/// turns; the Agent's Worktree holds `kept.txt`.
async fn run() -> Run {
    run_with(Taken::default()).await
}

/// The ids of the Agents under Takeover.
type Taken = Arc<std::sync::Mutex<Vec<String>>>;

async fn run_with(taken: Taken) -> Run {
    let mut f = Fixture::in_git_project(RECORDING, Git::from_env());
    f.agents = f
        .agents
        .with_takeover(move |id| taken.lock().unwrap().iter().any(|t| t == id));
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let ws = f.workstream("ws", None).await;
    f.call("rail.startDoor", json!({"id": ws})).await.unwrap();
    let agent = f.spawn(Some(&ws), None).await.unwrap().id;
    let f = Arc::new(f);
    for (n, id) in [(1, &ws), (2, &agent)] {
        let node = f.node(id).await.unwrap();
        f.session(id, &id_of(n), "startup").await;
        for text in &TURNS[..2] {
            turn(&f, &cwd_of(&f, &node), &id_of(n), text);
        }
    }
    let node = f.node(&agent).await.unwrap();
    std::fs::write(cwd_of(&f, &node).join("kept.txt"), "at the mark\n").unwrap();
    Run { f, ws, agent }
}

impl Run {
    async fn mark(&self, checkpoint: u32) {
        self.f
            .agents
            .record_marks(&self.ws, checkpoint)
            .await
            .unwrap();
    }

    async fn worktree(&self) -> PathBuf {
        cwd_of(&self.f, &self.f.node(&self.agent).await.unwrap())
    }

    /// Rewind and acknowledge every restart the way Claude Code does, naming the conversation it
    /// was started on.
    async fn rewind(&self, checkpoint: u32, files: Files) -> Result<Rewind, rpc::RpcError> {
        // Restarts of an earlier, failed rewind are not this rewind's to acknowledge; count them
        // before the rewind can start one.
        let earlier = self
            .f
            .starts()
            .iter()
            .filter(|l| l.contains("--resume"))
            .count();
        let running = {
            let (f, ws) = (Arc::clone(&self.f), self.ws.clone());
            tokio::spawn(async move { f.agents.rewind(&f.ctx(), &ws, checkpoint, files).await })
        };
        // A start can be seen before its Attempt is recorded, and an acknowledgement of the old
        // Attempt is ignored: repeat each one until the rewind ends.
        while !running.is_finished() {
            let starts = self.f.starts();
            let resumes: Vec<_> = starts
                .iter()
                .filter(|l| l.contains("--resume"))
                .skip(earlier)
                .collect();
            for line in resumes {
                let (cwd, rest) = line.split_once(' ').unwrap();
                let Some(conversation) = rest
                    .split("--resume ")
                    .nth(1)
                    .and_then(|r| r.split(' ').next())
                    .filter(|c| c.len() == 36)
                else {
                    continue;
                };
                for node in self.f.tree().await {
                    // `pwd` prints the physical path: compare as the filesystem resolves them.
                    let same = |a: &Path, b: &Path| match (a.canonicalize(), b.canonicalize()) {
                        (Ok(a), Ok(b)) => a == b,
                        _ => a == b,
                    };
                    if same(&cwd_of(&self.f, &node), Path::new(cwd))
                        && node.kind != NodeKind::Terminal
                    {
                        self.f.session(&node.id, conversation, "resume").await;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        running.await.unwrap()
    }
}

#[tokio::test]
async fn a35_write_records_a_mark_per_agent() {
    let r = run().await;

    r.mark(1).await;

    assert_eq!(r.f.agents.rewindable(&r.ws).unwrap(), vec![1]);
    let plan = r.f.agents.rewind_plan(&r.ws, 1).await.unwrap();
    let mut found: Vec<_> = plan.agents.iter().map(|a| a.agent.clone()).collect();
    found.sort();
    let mut all = vec![r.ws.clone(), r.agent.clone()];
    all.sort();
    assert_eq!(found, all);
}

#[tokio::test]
async fn a35_marks_survive_a_restart() {
    let r = run().await;
    r.mark(1).await;
    let (f, ws) = (Arc::try_unwrap(r.f).ok().unwrap().reopen(), r.ws);

    assert_eq!(f.agents.rewindable(&ws).unwrap(), vec![1]);
}

#[tokio::test]
async fn a35_an_old_checkpoint_is_not_rewindable() {
    let r = run().await;
    r.mark(2).await;

    let err = r.f.agents.rewind_plan(&r.ws, 1).await.unwrap_err();

    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(r.f.agents.rewindable(&r.ws).unwrap(), vec![2]);
}

#[tokio::test]
async fn a35_plan_lists_each_agent_and_changes_nothing() {
    let r = run().await;
    r.mark(1).await;
    let tree = r.worktree().await;
    std::fs::write(tree.join("kept.txt"), "later\n").unwrap();
    std::fs::write(tree.join("added.txt"), "new\n").unwrap();
    let before = r.f.starts().len();

    let plan = r.f.agents.rewind_plan(&r.ws, 1).await.unwrap();

    assert!(plan.files_changed);
    let agent = plan.agents.iter().find(|a| a.agent == r.agent).unwrap();
    assert_eq!(agent.files_changed, vec!["added.txt", "kept.txt"]);
    assert_eq!(
        std::fs::read_to_string(tree.join("kept.txt")).unwrap(),
        "later\n"
    );
    assert_eq!(r.f.starts().len(), before);
}

#[tokio::test]
async fn a35_plan_refuses_an_unrewindable_checkpoint() {
    let r = run().await;

    let err = r.f.agents.rewind_plan(&r.ws, 7).await.unwrap_err();

    assert_eq!(err.code, code::CONFLICT);
}

#[tokio::test]
async fn a35_keep_changes_no_file() {
    let r = run().await;
    r.mark(1).await;
    let tree = r.worktree().await;
    std::fs::write(tree.join("kept.txt"), "later\n").unwrap();
    std::fs::write(tree.join("added.txt"), "new\n").unwrap();

    r.rewind(1, Files::Keep).await.unwrap();

    assert_eq!(
        std::fs::read_to_string(tree.join("kept.txt")).unwrap(),
        "later\n"
    );
    assert!(tree.join("added.txt").exists());
}

#[tokio::test]
async fn a35_restore_returns_each_worktree_to_its_snapshot() {
    let r = run().await;
    r.mark(1).await;
    let tree = r.worktree().await;
    std::fs::write(tree.join("kept.txt"), "later\n").unwrap();
    std::fs::write(tree.join("added.txt"), "new\n").unwrap();
    std::fs::remove_file(tree.join("README.md")).unwrap();

    r.rewind(1, Files::Restore).await.unwrap();

    assert_eq!(
        std::fs::read_to_string(tree.join("kept.txt")).unwrap(),
        "at the mark\n"
    );
    assert!(!tree.join("added.txt").exists());
    assert!(tree.join("README.md").exists());
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).into_owned()
}

#[tokio::test]
async fn a35_restore_moves_no_branch_and_pushes_nothing() {
    let r = run().await;
    r.mark(1).await;
    let (project, tree) = (r.f.dir.path().to_path_buf(), r.worktree().await);
    std::fs::write(tree.join("added.txt"), "new\n").unwrap();
    let state = |dir: &Path| {
        (
            git(&project, &["branch", "-v"]),
            git(dir, &["rev-parse", "HEAD"]),
            git(dir, &["diff", "--cached", "--name-only"]),
            git(&project, &["remote"]),
        )
    };
    let before = state(&tree);

    r.rewind(1, Files::Restore).await.unwrap();

    assert_eq!(state(&tree), before);
}

#[tokio::test]
async fn a35_each_agent_resumes_a_copy_cut_at_its_mark() {
    let r = run().await;
    r.mark(1).await;
    let tree = r.worktree().await;
    turn(&r.f, &tree, &id_of(2), TURNS[2]);

    r.rewind(1, Files::Keep).await.unwrap();

    let all = r.f.starts();
    let resumes: Vec<_> = all.into_iter().filter(|l| l.contains("--resume")).collect();
    assert_eq!(resumes.len(), 2);
    // The start line names the physical path `pwd` prints.
    let physical = tree.canonicalize().unwrap();
    let line = resumes
        .iter()
        .find(|l| {
            l.starts_with(physical.to_str().unwrap()) || l.starts_with(tree.to_str().unwrap())
        })
        .unwrap();
    let copy = line
        .split("--resume ")
        .nth(1)
        .unwrap()
        .split(' ')
        .next()
        .unwrap();
    assert_ne!(copy, id_of(2));
    let text = text_of(&r.f, &tree, copy);
    assert!(text.contains("second") && !text.contains("third"));
    assert!(text.lines().all(|l| l.contains(copy)));
}

#[tokio::test]
async fn a35_the_original_conversation_is_untouched() {
    let r = run().await;
    r.mark(1).await;
    let tree = r.worktree().await;
    turn(&r.f, &tree, &id_of(2), TURNS[2]);
    let before = text_of(&r.f, &tree, &id_of(2));

    r.rewind(1, Files::Keep).await.unwrap();

    assert_eq!(text_of(&r.f, &tree, &id_of(2)), before);
}

#[tokio::test]
async fn a35_no_slash_command_is_typed() {
    let r = run().await;
    r.mark(1).await;

    r.rewind(1, Files::Keep).await.unwrap();

    for id in [&r.ws, &r.agent] {
        let node = r.f.node(id).await.unwrap();
        let typed =
            r.f.terminals
                .snapshot(node.terminal_id.as_deref().unwrap())
                .unwrap();
        assert!(!typed.data.contains("/rewind"));
    }
}

#[tokio::test]
async fn a35_a_later_subagent_leaves_the_rail_and_keeps_its_worktree() {
    let r = run().await;
    r.mark(1).await;
    let later = r.f.spawn(Some(&r.ws), None).await.unwrap();
    let kept = later.worktree.clone().unwrap().path;

    let done = r.rewind(1, Files::Keep).await.unwrap();

    assert_eq!(done.removed, vec![later.id.clone()]);
    assert!(r.f.node(&later.id).await.is_none());
    assert!(Path::new(&kept).is_dir());
    let plan_agents = r.f.agents.rewind_plan(&r.ws, 1).await.unwrap().agents;
    assert!(plan_agents.iter().all(|a| !a.created_after));
}

#[tokio::test]
async fn a35_a_takeover_agent_is_skipped_unless_named() {
    let taken = Taken::default();
    let r = run_with(Arc::clone(&taken)).await;
    taken.lock().unwrap().push(r.agent.clone());
    r.mark(1).await;

    let plan = r.f.agents.rewind_plan(&r.ws, 1).await.unwrap();
    let done = r.rewind(1, Files::Keep).await.unwrap();

    assert!(plan.agents.iter().any(|a| a.agent == r.agent && a.takeover));
    assert_eq!(done.skipped, vec![r.agent.clone()]);
    assert_eq!(done.rewound, vec![r.ws.clone()]);
    assert_eq!(
        r.f.starts()
            .iter()
            .filter(|l| l.contains("--resume"))
            .count(),
        1
    );
}

#[tokio::test]
async fn a35_a_failed_restart_leaves_the_others_rewound_and_retries() {
    let r = run().await;
    r.mark(1).await;

    // Nothing acknowledges the restart: the rewind fails when its bound passes.
    let ctx = r.f.ctx();
    let first = tokio::time::timeout(
        Duration::from_secs(60),
        r.f.agents.rewind(&ctx, &r.ws, 1, Files::Keep),
    )
    .await
    .unwrap();
    assert!(first.is_err());
    let attempts =
        r.f.starts()
            .iter()
            .filter(|l| l.contains("--resume"))
            .count();
    assert!(attempts >= 1);

    let again = r.rewind(1, Files::Keep).await.unwrap();

    assert_eq!(again.rewound.len(), 2);
}

#[tokio::test]
async fn a35_a_failed_step_retries_without_repeating_work() {
    let r = run().await;
    r.mark(1).await;
    let tree = r.worktree().await;
    let folder = conversation_path(&r.f, &tree, "x")
        .parent()
        .unwrap()
        .to_path_buf();

    // Nothing acknowledges the restarts: the rewind fails once its bound passes.
    let first = r.f.agents.rewind(&r.f.ctx(), &r.ws, 1, Files::Keep).await;
    assert!(first.is_err());
    let copies = std::fs::read_dir(&folder).unwrap().count();
    assert_eq!(copies, 2, "the original and one copy");

    r.rewind(1, Files::Keep).await.unwrap();

    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), copies);
}
