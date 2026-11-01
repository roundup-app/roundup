use super::*;

/// A23: a Workstream whose Door started, saved `CONVERSATION` and was stopped.
pub(super) async fn exited_door(f: &Fixture) -> RailNode {
    let workstream = f.workstream("team", None).await;
    f.call("rail.startDoor", json!({"id": workstream}))
        .await
        .unwrap();
    f.session_start(&workstream, CONVERSATION, "startup")
        .await
        .unwrap();
    f.call("agent.stop", json!({"id": workstream}))
        .await
        .unwrap();
    f.tree()
        .await
        .into_iter()
        .find(|n| n.id == workstream)
        .unwrap()
}

pub(super) async fn start_door(f: &Fixture, id: &str) -> Result<RailNode, rpc::RpcError> {
    let node = f.call("rail.startDoor", json!({"id": id})).await?;
    Ok(serde_json::from_value(node).unwrap())
}

#[tokio::test]
async fn a23_a_restarted_door_resumes_its_saved_conversation() {
    let f = Fixture::running("echo \"$@\" >> \"$(dirname \"$0\")/argv.txt\"; sleep 30");
    let door = exited_door(&f).await;
    assert!(door.can_resume);
    let f = Arc::new(f);
    let old_attempt = door.attempt.clone().unwrap();

    let starting = {
        let (f, id) = (Arc::clone(&f), door.id.clone());
        tokio::spawn(async move { start_door(&f, &id).await })
    };
    f.until_attempt_changed(&door.id, &old_attempt).await;
    f.session_start(&door.id, CONVERSATION, "resume")
        .await
        .unwrap();
    let restarted = starting.await.unwrap().unwrap();

    assert_eq!(restarted.id, door.id);
    assert_eq!(restarted.kind, door.kind);
    assert!(restarted.terminal_id.is_some());
    assert_ne!(restarted.attempt, door.attempt);
    let argv = until_resumed(&f).await;
    assert_eq!(
        argv.matches("--resume").count(),
        1,
        "only the restart resumes"
    );
    assert!(argv.contains(&format!("--resume {CONVERSATION}")));
}

#[tokio::test]
async fn a23_a_door_with_no_saved_conversation_starts_fresh() {
    let f = Fixture::running("echo \"$@\" >> \"$(dirname \"$0\")/argv.txt\"; sleep 30");
    let workstream = f.workstream("team", None).await;

    let door = start_door(&f, &workstream).await.unwrap();

    assert!(door.terminal_id.is_some());
    let argv = crate::common::until_file(&f.dir.path().join("argv.txt")).await;
    assert!(!argv.contains("--resume"));
}

#[tokio::test]
async fn a23_a_restarted_door_after_reopen_resumes() {
    let f = Fixture::running("echo \"$@\" >> \"$(dirname \"$0\")/argv.txt\"; sleep 30");
    let door = exited_door(&f).await;
    let f = Arc::new(f.reopen());
    let reopened = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == door.id)
        .unwrap();
    assert!(reopened.can_resume);
    let old_attempt = reopened.attempt.clone().unwrap();

    let starting = {
        let (f, id) = (Arc::clone(&f), door.id.clone());
        tokio::spawn(async move { start_door(&f, &id).await })
    };
    f.until_attempt_changed(&door.id, &old_attempt).await;
    f.session_start(&door.id, CONVERSATION, "resume")
        .await
        .unwrap();

    assert!(starting.await.unwrap().unwrap().terminal_id.is_some());
    let argv = until_resumed(&f).await;
    assert!(argv.contains(&format!("--resume {CONVERSATION}")));
}

#[tokio::test]
async fn a23_a_saved_conversation_that_cannot_resume_never_starts_fresh() {
    let f = Fixture::running("echo \"$@\" >> \"$(dirname \"$0\")/argv.txt\"; sleep 30");
    let door = exited_door(&f).await;
    let launches = std::fs::read_to_string(f.dir.path().join("argv.txt"))
        .unwrap_or_default()
        .lines()
        .count();
    std::fs::remove_file(f.dir.path().join("fake-claude")).unwrap();

    let err = start_door(&f, &door.id).await.unwrap_err();

    assert_ne!(err.code, code::NOT_FOUND);
    let after = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == door.id)
        .unwrap();
    assert!(after.can_resume, "still resumable, not replaced");
    assert_eq!(after.terminal_id, door.terminal_id);
    let now = std::fs::read_to_string(f.dir.path().join("argv.txt"))
        .unwrap_or_default()
        .lines()
        .count();
    assert_eq!(now, launches, "no fresh program ran");
}

#[tokio::test]
async fn a23_a_restart_without_acknowledgement_fails_with_a22s_error() {
    let f = Fixture::running("sleep 30");
    let door = exited_door(&f).await;
    // Plugin compatibility probes use a real process; pause only the resume deadline.
    tokio::time::pause();
    let f = Arc::new(f);
    let old_attempt = door.attempt.clone().unwrap();
    let starting = {
        let (f, id) = (Arc::clone(&f), door.id.clone());
        tokio::spawn(async move { start_door(&f, &id).await })
    };
    f.until_attempt_changed(&door.id, &old_attempt).await;
    tokio::time::advance(Duration::from_secs(11)).await;
    // Cleanup waits on the real PTY reader; its exit bound needs the real clock.
    tokio::time::resume();

    let err = starting.await.unwrap().unwrap_err();

    assert_eq!(err.code, code::CONFLICT);
    let after = f
        .tree()
        .await
        .into_iter()
        .find(|n| n.id == door.id)
        .unwrap();
    assert!(after.can_resume);
    assert_eq!(after.terminal_id, None);
}

#[tokio::test]
async fn a23_an_earlier_attempts_signal_is_ignored_by_a_restarted_door() {
    let f = Fixture::running("sleep 30");
    let door = exited_door(&f).await;
    let f = Arc::new(f);
    let old_attempt = door.attempt.clone().unwrap();
    let starting = {
        let (f, id) = (Arc::clone(&f), door.id.clone());
        tokio::spawn(async move { start_door(&f, &id).await })
    };
    f.until_attempt_changed(&door.id, &old_attempt).await;

    let stale = f
        .signal_payload(
            &door.id,
            &old_attempt,
            json!({"hook_event_name": "SessionStart", "session_id": OTHER_CONVERSATION, "source": "resume"}),
        )
        .await;
    assert!(stale.is_ok(), "ignored, never an error to the caller");
    f.session_start(&door.id, CONVERSATION, "resume")
        .await
        .unwrap();
    let restarted = starting.await.unwrap().unwrap();

    assert_eq!(restarted.status.as_ref().map(|s| s.kind), Some(Kind::Idle));
    assert!(restarted.terminal_id.is_some());
}
