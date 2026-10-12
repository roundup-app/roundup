//! The prerequisite lifecycle seam; #808 still owns real-Daemon rewind acceptance.
use crate::common::{Fixture, until_file};
use agents::marks::MarkResume;
use checkpoints::RecordMarks;
use contracts::{Kind, agent::RailNode};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

const ORIGINAL: &str = "12345678-1234-4234-8234-123456789abc";

fn conversation(f: &Fixture, cwd: &str, id: &str) -> PathBuf {
    let key: String = Path::new(cwd)
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    f.dir
        .path()
        .join(".roundup/projects")
        .join(key)
        .join(format!("{id}.jsonl"))
}

async fn fixture(door: bool) -> (Arc<Fixture>, RailNode, checkpoints::Mark) {
    let f = Fixture::in_git_project(
        "echo \"$@\" >> \"$(dirname \"$0\")/argv.txt\"; sleep 30",
        agents::worktree::Git::from_env(),
    );
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let home = f.workstream("rewind", None).await;
    let node: RailNode = if door {
        serde_json::from_value(f.call("rail.startDoor", json!({"id": home})).await.unwrap())
            .unwrap()
    } else {
        f.spawn(Some(&home), Some("previous order")).await.unwrap()
    };
    f.session_start(&node.id, ORIGINAL, "startup")
        .await
        .unwrap();
    let cwd = f
        .terminals
        .list()
        .into_iter()
        .find(|t| Some(&t.id) == node.terminal_id.as_ref())
        .unwrap()
        .cwd;
    let path = conversation(&f, &cwd, ORIGINAL);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        &path,
        format!("{{\"sessionId\":\"{ORIGINAL}\",\"message\":\"at Mark\"}}\n"),
    )
    .unwrap();
    // The Door must also have a conversation to obtain a complete set of Marks.
    if !door {
        f.call("rail.startDoor", json!({"id": home})).await.unwrap();
        f.session_start(&home, ORIGINAL, "startup").await.unwrap();
        let cwd = f
            .terminals
            .list()
            .into_iter()
            .find(|t| t.owner.as_deref() == Some(&home))
            .unwrap()
            .cwd;
        let path = conversation(&f, &cwd, ORIGINAL);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"{\"message\":\"Door\"}\n").unwrap();
    }
    let marks = f.agents.record(&home).await.unwrap().unwrap();
    let mark = marks
        .agents
        .into_iter()
        .find(|m| m.agent == node.id)
        .unwrap();
    fs::write(
        &path,
        [
            mark.conversation.clone(),
            b"{\"message\":\"after Mark\"}\n".to_vec(),
        ]
        .concat(),
    )
    .unwrap();
    let node = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == node.id)
        .unwrap();
    (Arc::new(f), node, mark)
}

async fn copy_id(f: &Fixture) -> String {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let argv = fs::read_to_string(f.dir.path().join("argv.txt")).unwrap_or_default();
            if let Some(id) = argv.lines().find_map(|line| {
                let words: Vec<_> = line.split_whitespace().collect();
                words
                    .windows(2)
                    .find(|w| w[0] == "--resume")
                    .map(|w| w[1].to_owned())
            }) {
                return id;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

async fn resumes_copy(door: bool) {
    let (f, before, mark) = fixture(door).await;
    let original = conversation(&f, &mark.cwd, ORIGINAL);
    let bytes = fs::read(&original).unwrap();
    let working = Path::new(&mark.worktree).join("README.md");
    fs::write(&working, b"working bytes after Mark\n").unwrap();
    let restarting = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            let mut progress = MarkResume::new(mark, None);
            let node = f.agents.resume_mark(&f.ctx(), &mut progress).await?;
            let retry = f.agents.resume_mark(&f.ctx(), &mut progress).await?;
            Ok::<_, rpc::RpcError>((node, retry))
        })
    };
    f.until_attempt_changed(&before.id, before.attempt.as_deref().unwrap())
        .await;
    let copied = copy_id(&f).await;
    assert_ne!(copied, ORIGINAL);
    assert!(
        !restarting.is_finished(),
        "matching acknowledgement is required"
    );
    f.session_start(&before.id, &copied, "resume")
        .await
        .unwrap();
    let (after, retry) = restarting.await.unwrap().unwrap();
    assert_eq!(after.attempt, retry.attempt);
    assert_ne!(before.attempt, after.attempt);
    assert_eq!(after.id, before.id);
    assert_eq!(after.parent, before.parent);
    assert_eq!(after.name, before.name);
    assert_eq!(after.worktree, before.worktree);
    assert_eq!(after.model, before.model);
    assert_eq!(after.effort, before.effort);
    assert_eq!(after.iteration, before.iteration);
    assert_eq!(after.status.unwrap().kind, Kind::Idle);
    assert_eq!(fs::read(original).unwrap(), bytes);
    assert_eq!(fs::read(working).unwrap(), b"working bytes after Mark\n");
    let cwd = f
        .terminals
        .list()
        .into_iter()
        .find(|t| Some(&t.id) == after.terminal_id.as_ref())
        .unwrap()
        .cwd;
    let copy = fs::read_to_string(conversation(&f, &cwd, &copied)).unwrap();
    assert!(copy.contains("at Mark"));
    assert!(!copy.contains("after Mark"));
    assert!(copy.contains(&copied));
    assert!(!copy.contains(ORIGINAL));
    let argv = until_file(&f.dir.path().join("argv.txt")).await;
    assert_eq!(argv.matches("--resume").count(), 1);
}

#[tokio::test]
async fn a35_agent_resumes_a_mark_copy_without_changing_its_rail_or_files() {
    resumes_copy(false).await;
}
#[tokio::test]
async fn a35_door_resumes_a_mark_copy_without_advancing_iteration() {
    resumes_copy(true).await;
}
