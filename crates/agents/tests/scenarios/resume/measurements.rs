use super::*;

#[tokio::test]
async fn u3016c_elapsed_and_parallel_time_are_distinct_sources() {
    use std::sync::atomic::{AtomicU64, Ordering};
    let now = Arc::new(AtomicU64::new(0));
    let (claimed, mut claims) = tokio::sync::mpsc::unbounded_channel();
    let mut f = Fixture::running("sleep 30");
    let wall = now.clone();
    let mono = now.clone();
    f.agents = f
        .agents
        .with_clock(move || i64::try_from(wall.load(Ordering::SeqCst)).unwrap())
        .with_measurement_clock(move || u128::from(mono.load(Ordering::SeqCst)) * 1_000_000)
        .with_resume_effect(move |phase, _| {
            if phase == "claimed" {
                claimed.send(()).unwrap();
            }
            Ok(())
        });
    let door = f.workstream("door", None).await;
    f.call("rail.startDoor", json!({"id":door})).await.unwrap();
    f.session_start(&door, CONVERSATION, "startup")
        .await
        .unwrap();
    let child = f.spawn(Some(&door), None).await.unwrap();
    f.session_start(&child.id, OTHER_CONVERSATION, "startup")
        .await
        .unwrap();
    for sec in 1..=3 {
        now.store(sec * 1000, Ordering::SeqCst);
        f.call("project.measurements", Value::Null).await.unwrap();
    }
    f.call("agent.stop", json!({"id":door})).await.unwrap();
    let stopped = f.call("project.measurements", Value::Null).await.unwrap();
    let facts: Vec<_> = stopped["time_evidence"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|fact| fact["value"]["activity"]["kind"] == "attempt")
        .collect();
    assert_eq!(facts.len(), 2);
    let door_fact = facts.iter().find(|fact| fact["agent"] == door).unwrap();
    assert_eq!(door_fact["value"]["start"]["unix_ms"], 0);
    assert_eq!(door_fact["value"]["state"]["at"]["unix_ms"], 3000);
    assert!(
        facts
            .iter()
            .any(|fact| fact["agent"] == child.id && fact["value"]["state"]["kind"] == "active")
    );
    for sec in 4..=5 {
        now.store(sec * 1000, Ordering::SeqCst);
        f.call("project.measurements", Value::Null).await.unwrap();
    }
    f.call("agent.stop", json!({"id":child.id})).await.unwrap();
    let ended = f.call("project.measurements", Value::Null).await.unwrap();
    now.store(10000, Ordering::SeqCst);
    assert_eq!(
        f.call("project.measurements", Value::Null).await.unwrap()["time_evidence"],
        ended["time_evidence"],
        "the idle gap extends no lifetime"
    );
    let f = Arc::new(f);
    let resuming = {
        let f = f.clone();
        let door = door.clone();
        tokio::spawn(async move { f.call("rail.startDoor", json!({"id":door})).await })
    };
    let old = door_fact["attempt"].as_str().unwrap();
    f.until_attempt_changed(&door, old).await;
    assert_eq!(
        f.call("project.measurements", Value::Null).await.unwrap()["time_evidence"],
        ended["time_evidence"]
    );
    claims.recv().await.unwrap();
    now.store(11000, Ordering::SeqCst);
    f.session_start(&door, CONVERSATION, "resume")
        .await
        .unwrap();
    let resumed: RailNode = serde_json::from_value(resuming.await.unwrap().unwrap()).unwrap();
    let active = f.call("project.measurements", Value::Null).await.unwrap();
    assert_eq!(
        active["time_evidence"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|fact| fact["value"]["activity"]["kind"] == "attempt")
            .count(),
        3
    );
    let latest = active["time_evidence"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fact| {
            fact["agent"] == door
                && fact["attempt"].as_str() == resumed.attempt.as_deref()
                && fact["value"]["activity"]["kind"] == "attempt"
        })
        .unwrap();
    assert_eq!(
        latest["value"]["start"]["unix_ms"], 10000,
        "the observed launch precedes acknowledgement"
    );
    now.store(12000, Ordering::SeqCst);
    f.call("agent.stop", json!({"id":door})).await.unwrap();
    let before = f.call("project.measurements", Value::Null).await.unwrap();
    let f = Arc::try_unwrap(f).ok().unwrap().reopen();
    assert_eq!(
        f.call("project.measurements", Value::Null).await.unwrap()["time_evidence"],
        before["time_evidence"]
    );
    std::fs::remove_file(f.dir.path().join("fake-claude")).unwrap();
    assert!(f.call("rail.startDoor", json!({"id":door})).await.is_err());
    let failed = f.call("project.measurements", Value::Null).await.unwrap();
    assert_eq!(
        failed["time_evidence"], before["time_evidence"],
        "failed resume does not replace old facts"
    );
    assert!(
        failed["contributions"].as_array().unwrap().is_empty(),
        "an unacknowledged launch is no model/tool evidence"
    );
}

#[tokio::test]
async fn u3016c_live_resume_ends_the_replaced_attempt() {
    use std::sync::atomic::{AtomicU64, Ordering};
    let now = Arc::new(AtomicU64::new(0));
    let mut f = Fixture::running("sleep 30");
    let wall = now.clone();
    let mono = now.clone();
    f.agents = f
        .agents
        .with_clock(move || i64::try_from(wall.load(Ordering::SeqCst)).unwrap())
        .with_measurement_clock(move || u128::from(mono.load(Ordering::SeqCst)) * 1_000_000);
    let f = Arc::new(f);
    let node = f.spawn(None, None).await.unwrap();
    f.session_start(&node.id, CONVERSATION, "startup")
        .await
        .unwrap();
    now.store(1000, Ordering::SeqCst);
    let resumed = resume_in_mode(&f, &node, Some("normal")).await;
    let after_resume = f.call("project.measurements", Value::Null).await.unwrap();
    let old = after_resume["time_evidence"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fact| fact["attempt"].as_str() == node.attempt.as_deref())
        .unwrap();
    assert_eq!(old["value"]["state"]["kind"], "ended");
    assert_eq!(old["value"]["state"]["at"]["unix_ms"], 1000);
    now.store(2000, Ordering::SeqCst);
    f.call("agent.stop", json!({"id":resumed.id}))
        .await
        .unwrap();
    let stopped = f.call("project.measurements", Value::Null).await.unwrap();
    assert_eq!(
        stopped["time_evidence"]
            .as_array()
            .unwrap()
            .iter()
            .find(|fact| fact["attempt"].as_str() == node.attempt.as_deref())
            .unwrap(),
        old,
        "the replacement cannot extend the old Attempt"
    );
    now.store(3000, Ordering::SeqCst);
    assert_eq!(
        f.call("project.measurements", Value::Null).await.unwrap()["time_evidence"],
        stopped["time_evidence"],
        "stopping the replacement leaves no active lifetime"
    );
}
