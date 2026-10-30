//! A34 `rail.remove` of a Workstream removes its finished work and keeps the rest.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use agents::worktree::Git;
use contracts::agent::{RailNode, Removal};
use serde_json::{Value, json};

use crate::common::Fixture;

const AGENT: &str = "exec sleep 30";

fn git(path: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// `git branch` and `git worktree list`, to compare what a removal left.
fn git_state(project: &Path) -> (String, String) {
    (
        git(project, &["branch", "--list"]),
        git(project, &["worktree", "list"]),
    )
}

async fn project(script: &str) -> Fixture {
    let f = Fixture::in_git_project(script, Git::from_env());
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    f
}

async fn remove(f: &Fixture, id: &str) -> Removal {
    let value = f.call("rail.remove", json!({"id": id})).await.unwrap();
    serde_json::from_value(value).unwrap()
}

/// An Agent under `parent` that ran and then stopped, so its Status is `done`.
async fn finished(f: &Fixture, parent: Option<&str>) -> RailNode {
    let node = f.spawn(parent, None).await.unwrap();
    f.call("agent.stop", json!({"id": node.id})).await.unwrap();
    f.tree()
        .await
        .into_iter()
        .find(|n| n.id == node.id)
        .unwrap()
}

/// A Subagent of Agent `parent`, started by it and then stopped.
async fn nested(f: &Fixture, parent: &str) -> RailNode {
    let node = f.spawn_as(parent, Some(parent)).await.unwrap();
    f.call("agent.stop", json!({"id": node.id})).await.unwrap();
    let tree = f.tree().await;
    find(&tree, &node.id).unwrap().clone()
}

fn find<'a>(tree: &'a [RailNode], id: &str) -> Option<&'a RailNode> {
    tree.iter().find(|n| n.id == id)
}

fn path_of(node: &RailNode) -> std::path::PathBuf {
    node.worktree.as_ref().unwrap().path.clone().into()
}

#[tokio::test]
async fn a34_a_clean_exited_agent_goes_with_its_worktree_and_branch() {
    let f = project(AGENT).await;
    let before = git_state(f.dir.path());
    let ws = f.workstream("w", None).await;
    let agent = finished(&f, Some(&ws)).await;
    assert!(path_of(&agent).exists());

    let removal = remove(&f, &ws).await;

    assert_eq!(removal.removed.len(), 1);
    assert_eq!(removal.removed[0].id, agent.id);
    assert!(removal.kept.is_empty());
    assert!(f.tree().await.is_empty());
    assert!(!path_of(&agent).exists());
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn a34_an_agent_with_no_worktree_goes() {
    let f = Fixture::running(AGENT);
    let ws = f.workstream("w", None).await;
    let agent = finished(&f, Some(&ws)).await;
    assert!(agent.worktree.is_none());

    let removal = remove(&f, &ws).await;

    assert_eq!(removal.removed[0].id, agent.id);
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn a34_a_running_agent_moves_to_the_project_root() {
    let f = project(AGENT).await;
    let ws = f.workstream("w", None).await;
    let agent = f.spawn(Some(&ws), None).await.unwrap();

    let removal = remove(&f, &ws).await;

    assert!(removal.removed.is_empty());
    assert_eq!(removal.kept.len(), 1);
    assert_eq!(removal.kept[0].id, agent.id);
    assert_eq!(
        serde_json::to_value(removal.kept[0].reason).unwrap(),
        json!("running")
    );
    let tree = f.tree().await;
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].parent, None);
    assert!(path_of(&agent).exists());
}

#[tokio::test]
async fn a34_an_agent_ahead_of_the_base_is_kept() {
    let f = project(AGENT).await;
    let ws = f.workstream("w", None).await;
    let agent = finished(&f, Some(&ws)).await;
    let path = path_of(&agent);
    std::fs::write(path.join("work"), "x").unwrap();
    git(&path, &["add", "work"]);
    git(&path, &["commit", "-qm", "work"]);
    let state = git_state(f.dir.path());

    let removal = remove(&f, &ws).await;

    assert_eq!(removal.kept.len(), 1);
    assert_eq!(
        serde_json::to_value(removal.kept[0].reason).unwrap(),
        json!("ahead")
    );
    assert_eq!(find(&f.tree().await, &agent.id).unwrap().parent, None);
    assert!(path.join("work").exists());
    assert_eq!(git_state(f.dir.path()), state);
}

#[tokio::test]
async fn a34_a_dirty_agent_is_kept_and_untouched() {
    let f = project(AGENT).await;
    let ws = f.workstream("w", None).await;
    let agent = finished(&f, Some(&ws)).await;
    let path = path_of(&agent);
    std::fs::write(path.join("scratch"), "keep").unwrap();

    let removal = remove(&f, &ws).await;

    assert_eq!(
        serde_json::to_value(removal.kept[0].reason).unwrap(),
        json!("dirty")
    );
    assert_eq!(
        std::fs::read_to_string(path.join("scratch")).unwrap(),
        "keep"
    );
    assert_eq!(find(&f.tree().await, &agent.id).unwrap().parent, None);
}

#[tokio::test]
async fn a34_an_agent_that_writes_while_stopping_is_kept() {
    let guard = tempfile::tempdir().unwrap();
    let armed = guard.path().join("armed");
    let wrapper = guard.path().join("git");
    let real = String::from_utf8(
        std::process::Command::new("sh")
            .args(["-c", "command -v git"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    // The first `status` in an Agent's Worktree after `armed` exists sees it clean; the file
    // lands right after, as an Agent's last write while it stops would.
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nREAL='{}'\ncase \"$PWD\" in *agent-*) if [ \"$1\" = status ] && [ -e '{}' ]; then rm '{}'; \"$REAL\" \"$@\"; rc=$?; echo late > late; exit $rc; fi;; esac\nexec \"$REAL\" \"$@\"\n",
            real.trim(),
            armed.display(),
            armed.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let git = Git::with_path(format!(
        "{}:{}",
        guard.path().display(),
        std::env::var("PATH").unwrap()
    ));
    let f = Fixture::in_git_project(AGENT, git);
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let ws = f.workstream("w", None).await;
    let agent = finished(&f, Some(&ws)).await;
    let path = path_of(&agent);
    std::fs::write(&armed, "").unwrap();

    let removal = remove(&f, &ws).await;

    assert!(removal.removed.is_empty());
    assert_eq!(removal.kept.len(), 1);
    assert_eq!(
        std::fs::read_to_string(path.join("late")).unwrap(),
        "late\n"
    );
    assert_eq!(find(&f.tree().await, &agent.id).unwrap().parent, None);
}

#[tokio::test]
async fn a34_nested_subagents_are_judged_one_by_one() {
    let f = project(AGENT).await;
    let ws = f.workstream("w", None).await;
    let parent = finished(&f, Some(&ws)).await;
    let clean = nested(&f, &parent.id).await;
    let live = f.spawn_as(&parent.id, Some(&parent.id)).await.unwrap();

    let removal = remove(&f, &ws).await;

    let removed: Vec<&str> = removal.removed.iter().map(|i| i.id.as_str()).collect();
    assert!(removed.contains(&parent.id.as_str()) && removed.contains(&clean.id.as_str()));
    assert_eq!(removal.kept.len(), 1);
    assert_eq!(removal.kept[0].id, live.id);
    let tree = f.tree().await;
    assert_eq!(tree.len(), 1);
    assert_eq!(tree[0].parent, None);
}

#[tokio::test]
async fn a34_the_workstreams_terminals_close() {
    let f = Fixture::running(AGENT);
    let ws = f.workstream("w", None).await;
    let opened = f
        .call("terminal.open", json!({"workstream": ws}))
        .await
        .unwrap();
    let id = opened["terminal_id"].as_str().unwrap().to_owned();

    remove(&f, &ws).await;

    assert!(f.terminals.list().await.iter().all(|t| t.id != id));
}

#[tokio::test]
async fn a34_the_result_lists_removed_and_kept_with_reasons() {
    let f = project(AGENT).await;
    let ws = f.workstream("w", None).await;
    let gone = finished(&f, Some(&ws)).await;
    let live = f.spawn(Some(&ws), None).await.unwrap();

    let value: Value = f.call("rail.remove", json!({"id": ws})).await.unwrap();

    assert_eq!(
        value,
        json!({
            "removed": [{"id": gone.id, "kind": "agent", "name": gone.name}],
            "kept": [{"id": live.id, "kind": "agent", "name": live.name, "reason": "running"}],
        })
    );
}

#[tokio::test]
async fn a34_a_failed_removal_changes_nothing() {
    let f = project(AGENT).await;
    let ws = f.workstream("w", None).await;
    let door = f.call("rail.startDoor", json!({"id": ws})).await.unwrap();
    let door: RailNode = serde_json::from_value(door).unwrap();
    let gone = finished(&f, Some(&ws)).await;
    std::fs::write(path_of(&door).join("scratch"), "keep").unwrap();
    let tree = f.tree().await;
    let state = git_state(f.dir.path());

    let err = f.call("rail.remove", json!({"id": ws})).await.unwrap_err();

    assert!(err.message.starts_with("worktree_unlanded"));
    assert_eq!(f.tree().await.len(), tree.len());
    assert!(path_of(&gone).exists());
    assert_eq!(git_state(f.dir.path()), state);
}

#[tokio::test]
async fn a34_other_workstreams_are_untouched() {
    let f = project(AGENT).await;
    let ws = f.workstream("w", None).await;
    let other = f.workstream("other", None).await;
    let theirs = finished(&f, Some(&other)).await;
    let root = finished(&f, None).await;

    remove(&f, &ws).await;

    let tree = f.tree().await;
    assert_eq!(
        find(&tree, &theirs.id).unwrap().parent.as_deref(),
        Some(other.as_str())
    );
    assert!(find(&tree, &root.id).is_some());
    assert!(path_of(&theirs).exists() && path_of(&root).exists());
}

#[tokio::test]
async fn a34_a_special_ignored_file_refuses_removal_without_changing_the_rail() {
    use std::os::unix::fs::FileTypeExt;
    let f = project(AGENT).await;
    let ws = f.workstream("w", None).await;
    let agent = finished(&f, Some(&ws)).await;
    let path = path_of(&agent);
    let exclude = git(f.dir.path(), &["rev-parse", "--git-path", "info/exclude"]);
    let exclude = f.dir.path().join(exclude.trim());
    let mut contents = std::fs::read_to_string(&exclude).unwrap();
    contents.push_str("\npipe\n");
    std::fs::write(exclude, contents).unwrap();
    let pipe = path.join("pipe");
    assert!(
        std::process::Command::new("mkfifo")
            .arg(&pipe)
            .status()
            .unwrap()
            .success()
    );
    let before = f.tree().await;
    let state = git_state(f.dir.path());

    let err = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        f.call("rail.remove", json!({"id":ws})),
    )
    .await
    .expect("a special file must not block removal indefinitely")
    .unwrap_err();
    assert!(err.message.contains("special Worktree file"));
    assert_eq!(f.tree().await, before);
    assert_eq!(git_state(f.dir.path()), state);
    assert!(
        std::fs::symlink_metadata(&pipe)
            .unwrap()
            .file_type()
            .is_fifo()
    );

    std::fs::remove_file(pipe).unwrap();
    remove(&f, &ws).await;
    assert!(f.tree().await.is_empty());
}

#[tokio::test]
async fn a34_a_stopped_door_remains_resumable_and_announced_after_failed_removal() {
    use contracts::EventData;
    let f = Fixture::running(AGENT);
    let ws = f.workstream("w", None).await;
    let door: RailNode =
        serde_json::from_value(f.call("rail.startDoor", json!({"id": ws})).await.unwrap()).unwrap();
    f.call("agent.signal", json!({
        "id": ws, "attempt": door.attempt,
        "payload": {"hook_event_name": "SessionStart", "session_id": "11111111-1111-1111-1111-111111111111", "source": "startup"}
    })).await.unwrap();
    assert!(!find(&f.tree().await, &ws).unwrap().can_resume);
    let db = rusqlite::Connection::open(f.dir.path().join("agents.db")).unwrap();
    db.execute_batch("CREATE TRIGGER a34_fail BEFORE DELETE ON nodes WHEN old.kind = 'workstream' BEGIN SELECT RAISE(FAIL, 'A34 removal'); END;").unwrap();
    let mut events = f.bus.subscribe();

    f.call("rail.remove", json!({"id": ws})).await.unwrap_err();

    assert!(find(&f.tree().await, &ws).unwrap().can_resume);
    let mut announced = false;
    while let Ok(event) = events.try_recv() {
        if matches!(event.data, EventData::RailChanged) {
            announced = true;
        }
    }
    assert!(
        announced,
        "A22 requires a refresh when the stopped Door becomes resumable"
    );
}

#[tokio::test]
async fn u4461_remove_all_deletes_a_dirty_agents_worktree_and_branch() {
    let f = project(AGENT).await;
    let other = f.workstream("other", None).await;
    let survivor = f.spawn(Some(&other), None).await.unwrap();
    let before = git_state(f.dir.path());
    let ws = f.workstream("all", None).await;
    let agent = f.spawn(Some(&ws), None).await.unwrap();
    let path = path_of(&agent);
    std::fs::write(path.join("committed"), "ahead").unwrap();
    git(&path, &["add", "committed"]);
    git(&path, &["commit", "-qm", "ahead"]);
    std::fs::write(path.join("scratch"), "dirty").unwrap();
    let state = git_state(f.dir.path());
    let db = rusqlite::Connection::open(f.dir.path().join(".roundup/agents.db")).unwrap();
    db.execute_batch("CREATE TRIGGER u4461_fail BEFORE DELETE ON nodes WHEN old.kind='workstream' BEGIN SELECT RAISE(FAIL, 'commit refused'); END;").unwrap();
    f.call("rail.remove", json!({"id":ws,"scope":"all"}))
        .await
        .unwrap_err();
    assert_eq!(
        std::fs::read_to_string(path.join("scratch")).unwrap(),
        "dirty"
    );
    assert_eq!(
        std::fs::read_to_string(path.join("committed")).unwrap(),
        "ahead"
    );
    assert_eq!(git_state(f.dir.path()), state);
    assert_eq!(
        find(&f.tree().await, &agent.id).unwrap().parent.as_deref(),
        Some(ws.as_str())
    );
    db.execute_batch("DROP TRIGGER u4461_fail").unwrap();
    let result = f
        .call("rail.remove", json!({"id":ws,"scope":"all"}))
        .await
        .unwrap();
    assert_eq!(result["kept"], json!([]));
    assert_eq!(result["removed"][0]["id"], agent.id);
    let tree = f.tree().await;
    assert_eq!(tree.len(), 2);
    assert_eq!(
        find(&tree, &survivor.id).unwrap().parent.as_deref(),
        Some(other.as_str())
    );
    assert!(path_of(&survivor).exists());
    assert!(!path.exists());
    assert_eq!(git_state(f.dir.path()), before);
}

#[tokio::test]
async fn u4461_scope_all_on_an_agent_is_invalid() {
    let f = Fixture::running(AGENT);
    let agent = f.spawn(None, None).await.unwrap();
    let before = f.tree().await;
    let error = f
        .call("rail.remove", json!({"id":agent.id,"scope":"all"}))
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::INVALID_PARAMS);
    assert_eq!(f.tree().await, before);
}

#[tokio::test]
async fn u4461_no_scope_is_remove_this() {
    for scope in [None, Some("this")] {
        let f = Fixture::running(AGENT);
        let ws = f.workstream("this", None).await;
        let agent = f.spawn(Some(&ws), None).await.unwrap();
        let mut params = json!({"id":ws});
        if let Some(scope) = scope {
            params["scope"] = json!(scope);
        }
        let result = f.call("rail.remove", params).await.unwrap();
        assert_eq!(result["removed"], json!([]));
        assert_eq!(result["kept"][0]["id"], agent.id);
        let tree = f.tree().await;
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].parent, None);
        assert_eq!(tree[0].terminal_id, agent.terminal_id);
    }
}

#[tokio::test]
async fn u4461_a_failed_stop_changes_nothing_and_retries() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    let mut f = Fixture::running("stty -isig; echo ready > ready; exec sleep 30");
    let fail = Arc::new(AtomicBool::new(true));
    let kills = fail.clone();
    let terminals = f.terminals.clone();
    f.agents = f.agents.with_terminal_kills(move |id| {
        let fail = kills.clone();
        let terminals = terminals.clone();
        async move {
            if fail.load(Ordering::SeqCst) {
                return Err(rpc::RpcError::internal("stop refused"));
            }
            terminals.kill(&id).await
        }
    });
    let ws = f.workstream("all", None).await;
    let agent = f.spawn(Some(&ws), None).await.unwrap();
    crate::common::until_file(&f.dir.path().join("ready")).await;
    let before = f.tree().await;
    let params = json!({"id":ws,"scope":"all"});
    let error = f.call("rail.remove", params.clone()).await.unwrap_err();
    assert!(error.message.contains("stop refused"));
    let after = f.tree().await;
    assert_eq!(after.len(), before.len());
    for node in &before {
        let current = find(&after, &node.id).unwrap();
        assert_eq!(current.parent, node.parent);
        assert_eq!(current.worktree, node.worktree);
        assert_eq!(current.terminal_id, node.terminal_id);
    }
    fail.store(false, Ordering::SeqCst);
    let result = f.call("rail.remove", params).await.unwrap();
    assert_eq!(result["kept"], json!([]));
    assert_eq!(result["removed"][0]["id"], agent.id);
    assert!(f.tree().await.is_empty());
}
