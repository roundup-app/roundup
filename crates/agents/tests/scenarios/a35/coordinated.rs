//! Coordinated rewind lifecycle, retries and Rail announcements.

use super::*;

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
                // RO2: a transcript read in the background announces itself as the Daemon.
                contracts::EventData::RailChanged if event.actor != contracts::Actor::daemon() => {
                    rail += 1;
                }
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
    let original = format!("87654321-1234-4234-8234-{:0>12}", node.id);
    acknowledge(f, &node.id, &original, "startup")
        .await
        .unwrap();
    let cwd = conversation_cwd(f, &node.id).await;
    let path = conversation(f, &cwd, &original);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        path,
        format!("{{\"sessionId\":\"{original}\",\"message\":\"at Mark\"}}\n"),
    )
    .unwrap();
    f.tree()
        .await
        .into_iter()
        .find(|n| n.id == node.id)
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
