//! The prerequisite lifecycle seam; #808 still owns real-Daemon rewind acceptance.
use crate::common::{Fixture, until_file};
use agents::marks::MarkResume;
use checkpoints::RecordMarks;
use contracts::{Kind, agent::RailNode};
use rpc::Module;
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
    fixture_with_bound(door, None).await
}

async fn fixture_with_bound(
    door: bool,
    bound: Option<Duration>,
) -> (Arc<Fixture>, RailNode, checkpoints::Mark) {
    fixture_with_agents(door, bound, |agents| agents).await
}

async fn fixture_with_agents(
    door: bool,
    bound: Option<Duration>,
    configure: impl FnOnce(agents::Agents) -> agents::Agents,
) -> (Arc<Fixture>, RailNode, checkpoints::Mark) {
    let mut f = Fixture::in_git_project(
        "echo \"$@\" >> \"$(dirname \"$0\")/argv.txt\"; sleep 30",
        agents::worktree::Git::from_env(),
    );
    f.agents = configure(f.agents);
    if let Some(bound) = bound {
        f.agents = f.agents.with_steer_bound(bound);
    }
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let home = f.workstream("rewind", None).await;
    let node: RailNode = if door {
        serde_json::from_value(
            f.call(
                "rail.startDoor",
                json!({"id": home, "model": "sonnet", "effort": "low"}),
            )
            .await
            .unwrap(),
        )
        .unwrap()
    } else {
        serde_json::from_value(f.call("agent.spawn", json!({
            "cwd": f.dir.path().to_string_lossy(), "parent": home, "prompt": "previous order",
            "model": "sonnet", "effort": "low"
        })).await.unwrap()).unwrap()
    };
    acknowledge(&f, &node.id, ORIGINAL, "startup")
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
        let started: RailNode =
            serde_json::from_value(f.call("rail.startDoor", json!({"id": home})).await.unwrap())
                .unwrap();
        acknowledge(&f, &home, ORIGINAL, "startup").await.unwrap();
        let cwd = f
            .terminals
            .list()
            .into_iter()
            .find(|t| Some(&t.id) == started.terminal_id.as_ref())
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

pub(super) async fn resumes_copy(door: bool) {
    let (f, before, mark) = fixture(door).await;
    let original = conversation(&f, &mark.cwd, ORIGINAL);
    let bytes = fs::read(&original).unwrap();
    let git_state = |root: &str| {
        let out = std::process::Command::new("git")
            .current_dir(root)
            .args(["rev-parse", "HEAD", "--symbolic-full-name", "HEAD"])
            .output()
            .unwrap();
        assert!(out.status.success());
        out.stdout
    };
    let branch = git_state(&mark.worktree);
    let tree_before = f.tree().await;
    crate::common::fake_claude(
        f.dir.path(),
        &format!(
            "echo \"$@\" >> \"$(dirname \"$0\")/argv.txt\"; {}",
            crate::common::GATED
        ),
    );
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
    acknowledge(&f, &before.id, &copied, "resume")
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
    let tree_after = f.tree().await;
    for home in tree_before
        .iter()
        .filter(|n| n.kind == contracts::agent::NodeKind::Workstream)
    {
        assert_eq!(
            tree_after
                .iter()
                .find(|n| n.id == home.id)
                .unwrap()
                .iteration,
            home.iteration
        );
    }
    assert_eq!(git_state(&cwd_from_node(&after)), branch);
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
    // F8: the Agent fixture also starts its Door; check only the rewind launch.
    for launch in argv.lines().filter(|line| line.contains("--resume")) {
        let args: Vec<_> = launch.split_whitespace().collect();
        assert_eq!(
            args.iter().filter(|&&arg| arg == "--tools").count(),
            usize::from(door)
        );
        if door {
            let at = args.iter().position(|&arg| arg == "--tools").unwrap();
            assert_eq!(args[at + 1], "Read,Grep,Glob,ToolSearch,Skill");
        }
    }
    until_file(&f.dir.path().join("ready")).await;
    crate::common::star(f.dir.path());
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if f.terminals.list().iter().any(|t| {
                Some(&t.id) == after.terminal_id.as_ref()
                    && t.title.as_ref().is_some_and(|title| title.starts_with('✳'))
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let delivery = {
        let f = Arc::clone(&f);
        let id = before.id.clone();
        tokio::spawn(async move { f.agents.prompt(&id, "new prompt").await })
    };
    let expected = format!(
        "{}\x1b[200~new prompt\x1b[201~\r",
        agents::claude_code::LEAD_IN
    );
    assert_eq!(
        typed(&f, &expected).await,
        expected,
        "no old order or slash command is retyped"
    );
    signal(
        &f,
        &before.id,
        json!({"hook_event_name": "UserPromptSubmit", "prompt": "new prompt"}),
    )
    .await;
    delivery.await.unwrap().unwrap();
}

#[tokio::test]
async fn a35_agent_resumes_a_mark_copy_without_changing_its_rail_or_files() {
    resumes_copy(false).await;
}
#[tokio::test]
async fn a35_door_resumes_a_mark_copy_without_advancing_iteration() {
    resumes_copy(true).await;
}

async fn signal(f: &Fixture, id: &str, payload: serde_json::Value) {
    f.call(
        "agent.signal",
        json!({"id": id, "attempt": f.attempt(id).await, "payload": payload}),
    )
    .await
    .unwrap();
}

fn copies(f: &Fixture, cwd: &str) -> Vec<PathBuf> {
    fs::read_dir(conversation(f, cwd, ORIGINAL).parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.file_stem().unwrap() != ORIGINAL)
        .collect()
}

async fn assert_stopped(f: &Fixture, node: &RailNode) {
    assert!(node.terminal_id.is_none());
    let tree = f.tree().await;
    assert!(
        f.terminals
            .list()
            .iter()
            .filter(|t| t.running)
            .all(|t| tree.iter().any(|n| n.terminal_id.as_ref() == Some(&t.id))),
        "rollback leaves no running Terminal outside the Rail"
    );
}

async fn failed_launch(door: bool) {
    let (f, before, mark) = fixture(door).await;
    let bin = f.dir.path().join("fake-claude");
    let script = fs::read(&bin).unwrap();
    fs::remove_file(&bin).unwrap();
    let mut progress = MarkResume::new(mark.clone(), None);
    assert!(f.agents.resume_mark(&f.ctx(), &mut progress).await.is_err());
    let after = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == before.id)
        .unwrap();
    assert_stopped(&f, &after).await;
    let paths = copies(&f, &mark.cwd);
    assert_eq!(paths.len(), 1);
    crate::common::fake_claude(f.dir.path(), std::str::from_utf8(&script).unwrap());
    let restarted = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            let node = f.agents.resume_mark(&f.ctx(), &mut progress).await.unwrap();
            f.call("agent.stop", json!({"id": node.id})).await.unwrap();
            let retry = f.agents.resume_mark(&f.ctx(), &mut progress).await.unwrap();
            (node, retry)
        })
    };
    let id = copy_id(&f).await;
    assert_eq!(paths[0].file_stem().unwrap(), id.as_str());
    acknowledge(&f, &before.id, &id, "resume").await.unwrap();
    let (node, retry) = restarted.await.unwrap();
    assert_eq!(node.attempt, retry.attempt);
    assert_eq!(copies(&f, &mark.cwd), paths);
    assert_eq!(
        fs::read_to_string(f.dir.path().join("argv.txt"))
            .unwrap()
            .matches("--resume")
            .count(),
        1
    );
}

async fn wrong_acknowledgements(door: bool) {
    let (f, before, mark) = fixture(door).await;
    let restarting = {
        let f = Arc::clone(&f);
        let mark = mark.clone();
        tokio::spawn(async move {
            let mut progress = MarkResume::new(mark, None);
            let result = f.agents.resume_mark(&f.ctx(), &mut progress).await;
            (result, progress)
        })
    };
    let id = copy_id(&f).await;
    acknowledge(&f, &before.id, ORIGINAL, "resume")
        .await
        .unwrap();
    acknowledge(&f, &before.id, &id, "startup").await.unwrap();
    assert!(!restarting.is_finished());
    let (result, mut progress) = restarting.await.unwrap();
    assert_eq!(result.unwrap_err().code, rpc::code::CONFLICT);
    let after = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == before.id)
        .unwrap();
    assert_stopped(&f, &after).await;
    let restarting = {
        let f = Arc::clone(&f);
        tokio::spawn(async move { f.agents.resume_mark(&f.ctx(), &mut progress).await })
    };
    f.until_attempt_changed(&before.id, after.attempt.as_deref().unwrap())
        .await;
    // Attempt allocation precedes process launch; observe the fake's second launch before
    // acknowledging it so its argv record cannot race the retry assertions.
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let argv = fs::read_to_string(f.dir.path().join("argv.txt")).unwrap_or_default();
            if argv.matches(&format!("--resume {id}")).count() == 2 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    acknowledge(&f, &before.id, &id, "resume").await.unwrap();
    let node = restarting.await.unwrap().unwrap();
    assert!(node.terminal_id.is_some());
    assert_eq!(copies(&f, &mark.cwd).len(), 1);
    let argv = fs::read_to_string(f.dir.path().join("argv.txt")).unwrap();
    assert_eq!(argv.matches(&format!("--resume {id}")).count(), 2);
}

async fn typed(f: &Fixture, expected: &str) -> String {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let text = fs::read_to_string(f.dir.path().join("typed")).unwrap_or_default();
            if text.len() >= expected.len() {
                return text;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

async fn reserved_prompt(star_before_ack: bool) {
    let (f, before, mark) = fixture(true).await;
    crate::common::fake_claude(f.dir.path(), crate::common::GATED);
    // The fake lets this observer choose either order of the two readiness inputs.
    let restarting = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            let mut progress = MarkResume::new(mark, Some("rewind note".into()));
            f.agents.resume_mark(&f.ctx(), &mut progress).await
        })
    };
    f.until_attempt_changed(&before.id, before.attempt.as_deref().unwrap())
        .await;
    until_file(&f.dir.path().join("ready")).await;
    // GATED publishes ready before its background reader opens dropped. Wait for that
    // reader before star can kill it, so the final assertion observes all early input.
    let dropped = f.dir.path().join("dropped");
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match fs::read(&dropped) {
                Ok(_) => break,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tokio::task::yield_now().await;
                }
                Err(error) => panic!("{} could not be read: {error}", dropped.display()),
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{} was never written", dropped.display()));
    assert!(matches!(
        f.agents.prompt(&before.id, "pending Message").await,
        Err(agents::PromptError::Busy { .. })
    ));
    let id = copies(&f, &conversation_cwd(&f, &before.id).await)[0]
        .file_stem()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    if star_before_ack {
        crate::common::star(f.dir.path());
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if f.terminals.list().iter().any(|t| {
                    t.running && t.title.as_ref().is_some_and(|title| title.starts_with('✳'))
                }) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        // Terminal's Title wakes the watcher spawned by Agents::resume_conversation
        // (crates/agents/src/lib.rs); let that queued task consume it before the hook.
        tokio::task::yield_now().await;
        acknowledge(&f, &before.id, ORIGINAL, "resume")
            .await
            .unwrap();
        assert!(
            !restarting.is_finished(),
            "a mismatched parked hook is not the ack"
        );
    }
    acknowledge(&f, &before.id, &id, "resume").await.unwrap();
    let after = restarting.await.unwrap().unwrap();
    assert_eq!(after.status.unwrap().kind, Kind::Idle);
    assert!(matches!(
        f.agents.prompt(&before.id, "pending Message").await,
        Err(agents::PromptError::Busy { .. })
    ));
    crate::common::star(f.dir.path());
    let paste = |text| format!("{}\x1b[200~{text}\x1b[201~\r", agents::claude_code::LEAD_IN);
    let first = paste("rewind note");
    assert_eq!(typed(&f, &first).await, first);
    assert!(matches!(
        f.agents.prompt(&before.id, "pending Message").await,
        Err(agents::PromptError::Busy { .. })
    ));
    signal(
        &f,
        &before.id,
        json!({"hook_event_name": "UserPromptSubmit", "prompt": "rewind note"}),
    )
    .await;
    signal(&f, &before.id, json!({"hook_event_name": "Stop"})).await;
    let mut delivery = Box::pin({
        let f = Arc::clone(&f);
        let id = before.id.clone();
        async move { f.agents.prompt(&id, "pending Message").await }
    });
    // Poll in the idle Signal's turn, before the first Steer's awakened task can clear
    // its reservation. Busy here would strand a Message with no later idle to wake it.
    std::future::poll_fn(|cx| {
        assert!(delivery.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    let delivery = tokio::spawn(delivery);
    let both = format!("{first}{}", paste("pending Message"));
    assert_eq!(typed(&f, &both).await, both);
    signal(
        &f,
        &before.id,
        json!({"hook_event_name": "UserPromptSubmit", "prompt": "pending Message"}),
    )
    .await;
    delivery.await.unwrap().unwrap();
    assert_eq!(fs::read(dropped).unwrap(), b"");
}

#[tokio::test]
async fn a35_idle_after_an_early_ack_waits_for_the_reserved_physical_write() {
    let (arrived, mut arrival) = tokio::sync::mpsc::unbounded_channel();
    let (release, released) = std::sync::mpsc::channel();
    let released = std::sync::Mutex::new(released);
    let first = std::sync::atomic::AtomicBool::new(true);
    let (f, before, mark) = fixture_with_agents(true, None, |agents| {
        agents.with_steer_effect(move |_| {
            if first.swap(false, std::sync::atomic::Ordering::SeqCst) {
                arrived.send(()).unwrap();
                released.lock().unwrap().recv().unwrap();
            }
            Ok(())
        })
    })
    .await;
    crate::common::fake_claude(f.dir.path(), crate::common::GATED);
    let restarting = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            let mut progress = MarkResume::new(mark, Some("rewind note".into()));
            f.agents.resume_mark(&f.ctx(), &mut progress).await
        })
    };
    f.until_attempt_changed(&before.id, before.attempt.as_deref().unwrap())
        .await;
    until_file(&f.dir.path().join("ready")).await;
    let copied = selected_copy(&f, &before).await;
    acknowledge(&f, &before.id, &copied, "resume")
        .await
        .unwrap();
    restarting.await.unwrap().unwrap();
    crate::common::star(f.dir.path());
    arrival.recv().await.unwrap();
    signal(
        &f,
        &before.id,
        json!({"hook_event_name": "UserPromptSubmit", "prompt": "rewind note"}),
    )
    .await;
    signal(&f, &before.id, json!({"hook_event_name": "Stop"})).await;
    let attempt = f.attempt(&before.id).await;
    let mut completion = Box::pin(f.agents.first_steer_completion(&before.id, &attempt));
    let mut delivery = Box::pin(f.agents.prompt(&before.id, "pending Message"));
    std::future::poll_fn(|cx| {
        assert!(completion.as_mut().poll(cx).is_pending());
        assert!(delivery.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    assert_eq!(
        fs::read(f.dir.path().join("typed")).unwrap_or_default(),
        b""
    );
    release.send(()).unwrap();
    let both = format!(
        "{}\x1b[200~rewind note\x1b[201~\r{}\x1b[200~pending Message\x1b[201~\r",
        agents::claude_code::LEAD_IN,
        agents::claude_code::LEAD_IN
    );
    let (delivered, ()) = tokio::join!(delivery, async {
        assert_eq!(typed(&f, &both).await, both);
        signal(
            &f,
            &before.id,
            json!({"hook_event_name": "UserPromptSubmit", "prompt": "pending Message"}),
        )
        .await;
    });
    delivered.unwrap();
    assert_eq!(
        completion.await,
        Ok(agents::FirstSteerCompletion::Submitted)
    );
}

async fn conversation_cwd(f: &Fixture, id: &str) -> String {
    let node = f.tree().await.into_iter().find(|n| n.id == id).unwrap();
    node.worktree.unwrap().path
}

fn cwd_from_node(node: &RailNode) -> String {
    node.worktree.as_ref().unwrap().path.clone()
}

#[tokio::test]
async fn a35_agent_failed_launch_retries_the_same_copy() {
    failed_launch(false).await;
}
#[tokio::test]
async fn a35_door_failed_launch_retries_the_same_copy() {
    failed_launch(true).await;
}
#[tokio::test]
async fn a35_agent_wrong_acknowledgements_time_out_and_retry_the_same_copy() {
    wrong_acknowledgements(false).await;
}
#[tokio::test]
async fn a35_door_wrong_acknowledgements_time_out_and_retry_the_same_copy() {
    wrong_acknowledgements(true).await;
}

async fn acknowledge(
    f: &Fixture,
    id: &str,
    conversation: &str,
    source: &str,
) -> Result<serde_json::Value, rpc::RpcError> {
    f.call("agent.signal", json!({"id": id, "attempt": f.attempt(id).await,
        "payload": {"hook_event_name": "SessionStart", "session_id": conversation, "source": source}})).await
}

#[tokio::test]
async fn a35_losing_the_acknowledged_result_does_not_restart_on_retry() {
    let (f, before, mark) = fixture(true).await;
    let mut progress = MarkResume::new(mark, None);
    let ctx = f.ctx();
    let mut restarting = Box::pin(f.agents.resume_mark(&ctx, &mut progress));
    tokio::select! {
        result = &mut restarting => panic!("returned before the test acknowledged it: {result:?}"),
        () = async {
            let copied = copy_id(&f).await;
            acknowledge(&f, &before.id, &copied, "resume").await.unwrap();
        } => {}
    }
    // SessionStart has promoted the Attempt, but the call's future never read its result.
    drop(restarting);
    let acknowledged = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == before.id)
        .unwrap();
    let retry = f.agents.resume_mark(&ctx, &mut progress).await.unwrap();
    assert_eq!(retry.attempt, acknowledged.attempt);
    assert_eq!(retry.terminal_id, acknowledged.terminal_id);
    assert_eq!(
        fs::read_to_string(f.dir.path().join("argv.txt"))
            .unwrap()
            .matches("--resume")
            .count(),
        1
    );
}

#[tokio::test]
async fn a35_reserved_door_prompt_precedes_messages_through_agents_prompt() {
    reserved_prompt(false).await;
}

#[tokio::test]
async fn a35_a_ready_title_before_ack_still_delivers_the_reserved_prompt_first() {
    reserved_prompt(true).await;
}

#[tokio::test]
async fn a35_coordinated_resume_keeps_status_without_rail_announcements() {
    let (f, before, mark) = fixture(true).await;
    let mut events = f.bus.subscribe();
    let restarting = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            let mut resume = agents::marks::Resume::new(vec![MarkResume::new(mark, None)], vec![]);
            f.agents.stop_marks(&f.ctx(), &mut resume).await?;
            f.agents.resume_marks(&f.ctx(), &mut resume).await
        })
    };
    let copied = copy_id(&f).await;
    assert!(!restarting.is_finished());
    let mut statuses = 0;
    while let Ok(event) = events.try_recv() {
        assert!(!matches!(event.data, contracts::EventData::RailChanged));
        statuses += usize::from(matches!(event.data, contracts::EventData::AgentStatus(_)));
    }
    assert!(statuses > 0);
    acknowledge(&f, &before.id, &copied, "resume")
        .await
        .unwrap();
    restarting.await.unwrap().unwrap();
    while let Ok(event) = events.try_recv() {
        assert!(!matches!(event.data, contracts::EventData::RailChanged));
    }
}

fn announcements(
    events: &mut tokio::sync::broadcast::Receiver<contracts::Event>,
) -> (usize, Vec<String>) {
    let mut rail = 0;
    let mut statuses = Vec::new();
    loop {
        match events.try_recv() {
            Ok(event) => match event.data {
                contracts::EventData::RailChanged => rail += 1,
                contracts::EventData::AgentStatus(status) => statuses.push(status.id),
                _ => {}
            },
            Err(tokio::sync::broadcast::error::TryRecvError::Empty) => break,
            Err(error) => panic!("event observer failed: {error}"),
        }
    }
    (rail, statuses)
}

async fn subagent(f: &Fixture, parent: &str) -> RailNode {
    let mut ctx = f.ctx();
    if f.tree()
        .await
        .iter()
        .any(|n| n.id == parent && n.kind == contracts::agent::NodeKind::Agent)
    {
        ctx.actor = contracts::Actor {
            kind: contracts::ActorKind::Agent,
            id: parent.into(),
            parent: None,
        };
    }
    let node: RailNode = serde_json::from_value(f.agents.call(&ctx, "agent.spawn", json!({
        "cwd": f.dir.path().to_string_lossy(), "parent": parent, "order": {"kind": "work", "ask": "previous order", "done": "done", "limits": []}
    })).await.unwrap()).unwrap();
    acknowledge(f, &node.id, ORIGINAL, "startup").await.unwrap();
    let cwd = conversation_cwd(f, &node.id).await;
    let path = conversation(f, &cwd, ORIGINAL);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        path,
        format!("{{\"sessionId\":\"{ORIGINAL}\",\"message\":\"at Mark\"}}\n"),
    )
    .unwrap();
    f.tree()
        .await
        .into_iter()
        .find(|n| n.id == node.id)
        .unwrap()
}

async fn selected_copy(f: &Fixture, node: &RailNode) -> String {
    f.until_attempt_changed(&node.id, node.attempt.as_deref().unwrap())
        .await;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let paths = copies(f, &cwd_from_node(node));
            if let Some(path) = paths.first() {
                return path.file_stem().unwrap().to_string_lossy().into_owned();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn a35_selected_lifecycle_retries_without_announcements_or_repeating_completed_steps() {
    let (f, door, _) = fixture(true).await;
    let child = subagent(&f, &door.id).await;
    let grandchild = subagent(&f, &child.id).await;
    let marks = f.agents.record(&door.id).await.unwrap().unwrap();
    let later = subagent(&f, &grandchild.id).await;
    let deepest = subagent(&f, &later.id).await;
    let other_home = f.workstream("unrelated", None).await;
    let unrelated = subagent(&f, &other_home).await;
    let branch = |node: &RailNode| {
        let output = std::process::Command::new("git")
            .current_dir(cwd_from_node(node))
            .args(["rev-parse", "HEAD", "--symbolic-full-name", "HEAD"])
            .output()
            .unwrap();
        assert!(output.status.success());
        output.stdout
    };
    let later_branch = branch(&later);
    let deepest_branch = branch(&deepest);
    let mut resume = agents::marks::Resume::new(
        [&door, &child, &grandchild]
            .into_iter()
            .map(|node| {
                MarkResume::new(
                    marks
                        .agents
                        .iter()
                        .find(|m| m.agent == node.id)
                        .unwrap()
                        .clone(),
                    None,
                )
            })
            .collect(),
        vec![later.id.clone(), deepest.id.clone()],
    );
    let mut events = f.bus.subscribe();
    f.agents.stop_marks(&f.ctx(), &mut resume).await.unwrap();
    let (rail, statuses) = announcements(&mut events);
    assert_eq!(rail, 0);
    for node in [&door, &child, &grandchild] {
        assert!(
            statuses.contains(&node.id),
            "selected stop keeps Status for {}",
            node.id
        );
    }
    let later_statuses: Vec<_> = statuses
        .into_iter()
        .filter(|id| id == &later.id || id == &deepest.id)
        .collect();
    assert_eq!(later_statuses, vec![deepest.id.clone(), later.id.clone()]);
    assert!(
        !f.tree()
            .await
            .iter()
            .any(|n| n.id == later.id || n.id == deepest.id)
    );
    assert_eq!(branch(&later), later_branch);
    assert_eq!(branch(&deepest), deepest_branch);
    f.agents.stop_marks(&f.ctx(), &mut resume).await.unwrap();
    assert_eq!(announcements(&mut events), (0, vec![]));

    let restarting = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            let result = f.agents.resume_marks(&f.ctx(), &mut resume).await;
            (result, resume)
        })
    };
    let door_copy = selected_copy(&f, &door).await;
    assert!(!restarting.is_finished());
    assert_eq!(announcements(&mut events).0, 0);
    f.call(
        "rail.rename",
        json!({"id": unrelated.id, "name": "unrelated renamed"}),
    )
    .await
    .unwrap();
    assert_eq!(
        announcements(&mut events).0,
        1,
        "unrelated mutation is not deferred"
    );
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let argv = fs::read_to_string(f.dir.path().join("argv.txt")).unwrap_or_default();
            if argv.contains(&format!("--resume {door_copy}")) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let bin = f.dir.path().join("fake-claude");
    let script = fs::read(&bin).unwrap();
    fs::remove_file(&bin).unwrap();
    acknowledge(&f, &door.id, &door_copy, "resume")
        .await
        .unwrap();
    let (failed, mut resume) = restarting.await.unwrap();
    assert!(failed.is_err(), "second selected launch fails");
    let completed = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == door.id)
        .unwrap();
    assert!(completed.terminal_id.is_some());
    assert_eq!(completed.status.as_ref().unwrap().kind, Kind::Idle);
    assert_eq!(
        announcements(&mut events).0,
        0,
        "failed launch rollback also stays unpublished"
    );
    crate::common::fake_claude(f.dir.path(), std::str::from_utf8(&script).unwrap());
    f.agents.stop_marks(&f.ctx(), &mut resume).await.unwrap();
    assert_eq!(announcements(&mut events), (0, vec![]));
    let child_after_failure = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == child.id)
        .unwrap();
    let retry = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            f.agents.resume_marks(&f.ctx(), &mut resume).await.unwrap();
            f.agents.resume_marks(&f.ctx(), &mut resume).await.unwrap();
            resume
        })
    };
    for node in [&child_after_failure, &grandchild] {
        let copied = selected_copy(&f, node).await;
        assert!(!retry.is_finished());
        assert_eq!(announcements(&mut events).0, 0);
        acknowledge(&f, &node.id, &copied, "resume").await.unwrap();
    }
    retry.await.unwrap();
    let (rail, statuses) = announcements(&mut events);
    assert_eq!(rail, 0);
    assert!(statuses.contains(&grandchild.id));
    let tree = f.tree().await;
    let after = tree.iter().find(|n| n.id == door.id).unwrap();
    assert_eq!(after.attempt, completed.attempt);
    assert_eq!(after.terminal_id, completed.terminal_id);
    assert_eq!(branch(&later), later_branch);
    assert_eq!(branch(&deepest), deepest_branch);
    // #808's coordinator is the sole publisher after lifecycle completion.
    f.ctx().emit(contracts::EventData::RailChanged);
    assert_eq!(announcements(&mut events).0, 1);
}

#[tokio::test]
async fn a35_interrupted_selected_resume_awaits_the_same_attempt_on_retry() {
    let (f, before, mark) = fixture(true).await;
    let mut resume = agents::marks::Resume::new(vec![MarkResume::new(mark, None)], vec![]);
    let ctx = f.ctx();
    let mut events = f.bus.subscribe();
    f.agents.stop_marks(&ctx, &mut resume).await.unwrap();
    let mut restarting = Box::pin(f.agents.resume_marks(&ctx, &mut resume));
    let copied = tokio::select! {
        result = &mut restarting => panic!("returned before acknowledgement: {result:?}"),
        copied = selected_copy(&f, &before) => copied,
    };
    // The installed Attempt precedes the program running its launch script.
    // Observe that launch before interrupting and acknowledging it ourselves.
    tokio::select! {
        result = &mut restarting => panic!("returned before acknowledgement: {result:?}"),
        result = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let argv = fs::read_to_string(f.dir.path().join("argv.txt")).unwrap_or_default();
                if argv.contains(&format!("--resume {copied}")) {
                    break;
                }
                tokio::task::yield_now().await;
            }
        }) => result.unwrap(),
    }
    drop(restarting);
    let pending = f.attempt(&before.id).await;
    acknowledge(&f, &before.id, &copied, "resume")
        .await
        .unwrap();
    f.agents.resume_marks(&ctx, &mut resume).await.unwrap();
    f.agents.resume_marks(&ctx, &mut resume).await.unwrap();
    assert_eq!(f.attempt(&before.id).await, pending);
    assert_eq!(announcements(&mut events).0, 0);
    assert_eq!(
        fs::read_to_string(f.dir.path().join("argv.txt"))
            .unwrap()
            .matches("--resume")
            .count(),
        1
    );
}

#[tokio::test]
async fn a35_selected_resume_waits_for_reserved_first_prompt_and_keeps_messages_behind_it() {
    let (f, before, mark) = fixture(true).await;
    crate::common::fake_claude(f.dir.path(), crate::common::GATED);
    let mut events = f.bus.subscribe();
    let mut resume = agents::marks::Resume::new(
        vec![MarkResume::new(mark, Some("rewind note".into()))],
        vec![],
    );
    f.agents.stop_marks(&f.ctx(), &mut resume).await.unwrap();
    let restarting = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            f.agents.resume_marks(&f.ctx(), &mut resume).await.unwrap();
            f.agents.resume_marks(&f.ctx(), &mut resume).await.unwrap();
        })
    };
    let copied = selected_copy(&f, &before).await;
    until_file(&f.dir.path().join("ready")).await;
    // A hook parked before SessionStart is not acknowledgement of a prompt not yet typed.
    signal(
        &f,
        &before.id,
        json!({"hook_event_name": "UserPromptSubmit", "prompt": "rewind note"}),
    )
    .await;
    acknowledge(&f, &before.id, &copied, "resume")
        .await
        .unwrap();
    assert!(
        !restarting.is_finished(),
        "SessionStart does not acknowledge the first prompt"
    );
    assert!(matches!(
        f.agents.prompt(&before.id, "pending Message").await,
        Err(agents::PromptError::Busy { .. })
    ));
    assert_eq!(announcements(&mut events).0, 0);
    crate::common::star(f.dir.path());
    let first = format!(
        "{}\x1b[200~rewind note\x1b[201~\r",
        agents::claude_code::LEAD_IN
    );
    assert_eq!(typed(&f, &first).await, first);
    assert!(!restarting.is_finished(), "typing is not acknowledgement");
    assert!(matches!(
        f.agents.prompt(&before.id, "pending Message").await,
        Err(agents::PromptError::Busy { .. })
    ));
    signal(
        &f,
        &before.id,
        json!({"hook_event_name": "UserPromptSubmit", "prompt": format!("{}rewind note", agents::claude_code::LEAD_IN)}),
    )
    .await;
    restarting.await.unwrap();
    assert_eq!(announcements(&mut events).0, 0);
    signal(&f, &before.id, json!({"hook_event_name": "Stop"})).await;
    let delivery = {
        let f = Arc::clone(&f);
        let id = before.id.clone();
        tokio::spawn(async move { f.agents.prompt(&id, "pending Message").await })
    };
    let both = format!(
        "{first}{}\x1b[200~pending Message\x1b[201~\r",
        agents::claude_code::LEAD_IN
    );
    assert_eq!(typed(&f, &both).await, both);
    signal(
        &f,
        &before.id,
        json!({"hook_event_name": "UserPromptSubmit", "prompt": "pending Message"}),
    )
    .await;
    delivery.await.unwrap().unwrap();
}

#[tokio::test]
async fn a35_ordinary_stop_and_resume_keep_their_rail_announcements() {
    let (f, before, _) = fixture(false).await;
    let mut events = f.bus.subscribe();
    f.call("agent.stop", json!({"id": before.id}))
        .await
        .unwrap();
    assert_eq!(announcements(&mut events).0, 1);
    let restarting = {
        let f = Arc::clone(&f);
        let id = before.id.clone();
        tokio::spawn(async move { f.call("agent.resume", json!({"id": id})).await })
    };
    f.until_attempt_changed(&before.id, before.attempt.as_deref().unwrap())
        .await;
    assert!(!restarting.is_finished());
    assert_eq!(
        announcements(&mut events).0,
        1,
        "ordinary Resume announces the pending slot"
    );
    acknowledge(&f, &before.id, ORIGINAL, "resume")
        .await
        .unwrap();
    restarting.await.unwrap().unwrap();
    assert_eq!(
        announcements(&mut events).0,
        1,
        "ordinary Resume announces completion"
    );
}

#[tokio::test]
async fn a35_interrupted_selected_stop_and_retirement_keep_completed_work() {
    let (f, door, mark) = fixture(true).await;
    let later = subagent(&f, &door.id).await;
    let deepest = subagent(&f, &later.id).await;
    let mut resume = agents::marks::Resume::new(
        vec![MarkResume::new(mark, None)],
        vec![later.id.clone(), deepest.id.clone()],
    );
    let ctx = f.ctx();
    let mut events = f.bus.subscribe();
    let mut control = f.bus.subscribe();
    for id in [&door.id, &deepest.id] {
        let mut stopping = Box::pin(f.agents.stop_marks(&ctx, &mut resume));
        tokio::select! {
            biased;
            () = async {
                loop {
                    let event = control.recv().await.unwrap();
                    if matches!(event.data, contracts::EventData::AgentStatus(ref status) if &status.id == id) {
                        break;
                    }
                }
            } => {},
            result = &mut stopping => panic!("returned before interruption point: {result:?}"),
        }
        drop(stopping);
    }
    f.agents.stop_marks(&ctx, &mut resume).await.unwrap();
    f.agents.stop_marks(&ctx, &mut resume).await.unwrap();
    let (rail, statuses) = announcements(&mut events);
    assert_eq!(rail, 0);
    assert_eq!(
        statuses,
        vec![door.id.clone(), deepest.id.clone(), later.id.clone()]
    );
    assert!(Path::new(&cwd_from_node(&later)).exists());
    assert!(Path::new(&cwd_from_node(&deepest)).exists());
    let tree = f.tree().await;
    assert!(!tree.iter().any(|n| n.id == later.id || n.id == deepest.id));
    assert!(
        tree.iter()
            .find(|n| n.id == door.id)
            .unwrap()
            .terminal_id
            .is_none()
    );
}

#[tokio::test]
async fn a35_a_late_reserved_prompt_acknowledgement_retries_without_another_resume() {
    let (f, before, mark) = fixture_with_bound(true, Some(Duration::from_secs(1))).await;
    crate::common::fake_claude(f.dir.path(), crate::common::GATED);
    let mut resume = agents::marks::Resume::new(
        vec![MarkResume::new(mark, Some("rewind note".into()))],
        vec![],
    );
    let mut events = f.bus.subscribe();
    f.agents.stop_marks(&f.ctx(), &mut resume).await.unwrap();
    let restarting = {
        let f = Arc::clone(&f);
        tokio::spawn(async move {
            let result = f.agents.resume_marks(&f.ctx(), &mut resume).await;
            (result, resume)
        })
    };
    let copied = selected_copy(&f, &before).await;
    until_file(&f.dir.path().join("ready")).await;
    acknowledge(&f, &before.id, &copied, "resume")
        .await
        .unwrap();
    crate::common::star(f.dir.path());
    let expected = format!(
        "{}\x1b[200~rewind note\x1b[201~\r",
        agents::claude_code::LEAD_IN
    );
    assert_eq!(typed(&f, &expected).await, expected);
    let (failed, mut resume) = restarting.await.unwrap();
    assert!(failed.is_err());
    let attempt = f.attempt(&before.id).await;
    signal(
        &f,
        &before.id,
        json!({"hook_event_name": "UserPromptSubmit", "prompt": "rewind note"}),
    )
    .await;
    f.agents.resume_marks(&f.ctx(), &mut resume).await.unwrap();
    assert_eq!(f.attempt(&before.id).await, attempt);
    assert_eq!(
        fs::read_to_string(f.dir.path().join("typed")).unwrap(),
        expected
    );
    assert_eq!(announcements(&mut events).0, 0);
}
