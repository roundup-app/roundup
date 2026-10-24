use super::*;

#[tokio::test]
async fn a35_a_previously_stopped_retained_agent_can_restart_without_reviving_final_messages() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    let gone = h
        .send(Actor::user(), "door", "ordinary stop drops this")
        .await;
    h.status("1", "2", Kind::Done).await;
    h.rail.0.lock().unwrap()[0].status.as_mut().unwrap().kind = Kind::Done;
    h.rail.0.lock().unwrap()[0].status_revision = Some("2".into());
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    h.next();
    h.messages.release_restart("door", "c", "2").await.unwrap();
    let thread = h.messages.thread("door").unwrap();
    assert_eq!(
        thread
            .iter()
            .map(|m| (m.id, m.status, m.reason))
            .collect::<Vec<_>>(),
        vec![(gone.id, MessageStatus::Dropped, Some(Reason::ReceiverGone))]
    );
    assert!(h.inbox.written().is_empty());
}

#[tokio::test]
async fn a35_retirement_preserves_records_after_removal_and_old_events() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.rail.0.lock().unwrap()[0] = agent_node("door", Kind::Idle);
    let delivered = h.send(Actor::user(), "door", "delivered").await;
    assert_eq!(
        h.messages.thread("door").unwrap()[0].status,
        MessageStatus::Delivered
    );
    assert_eq!(h.messages.thread("door").unwrap()[0].id, delivered.id);
    h.rail.0.lock().unwrap()[0] = RailNode {
        status_revision: Some("2".into()),
        ..agent_node("door", Kind::Working)
    };
    let written = h.inbox.written();
    h.send(Actor::user(), "door", "pending").await;
    h.send(agent("a"), "door", "second").await;
    h.call(
        "route.set",
        json!({"from":"a","to":"door","delivery":"drop"}),
    )
    .await;
    h.send(agent("a"), "door", "final").await;
    let before = h.messages.thread("door").unwrap();
    h.messages.reserve_retirement("door", "c").await.unwrap();
    h.status("1", "2", Kind::Done).await;
    h.rail.0.lock().unwrap().retain(|n| n.id != "door");
    h.ctx.bus.emit(Actor::daemon(), EventData::RailChanged);
    h.status("1", "99", Kind::Idle).await;
    h.messages.complete_retirement("door", "c").await.unwrap();
    h.messages.complete_retirement("door", "c").await.unwrap();
    h.messages.reserve_retirement("door", "c").await.unwrap();
    assert!(
        h.messages
            .call(
                &h.ctx,
                "message.send",
                json!({"to":"door","kind":"note","body":"new"})
            )
            .await
            .is_err()
    );
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert_eq!(h.inbox.written(), written);
}

#[tokio::test]
async fn a35_retirement_failure_retries_keep_protection_and_completed_work() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.send(Actor::user(), "door", "first").await;
    h.send(Actor::user(), "skipped", "second").await;
    let before = h.messages.thread("door").unwrap();
    *h.fail.lock().unwrap() = Some("reserve_retirement".into());
    assert!(h.messages.reserve_retirement("door", "c").await.is_err());
    h.messages.reserve_retirement("door", "c").await.unwrap();
    assert!(h.messages.complete_retirement("door", "c").await.is_err());
    assert!(
        h.messages
            .reserve_retirement("door", "other")
            .await
            .is_err()
    );
    assert!(
        h.messages
            .reserve_restart("door", "restart", None)
            .await
            .is_err()
    );
    h.status("1", "2", Kind::Done).await;
    assert_eq!(h.messages.thread("door").unwrap(), before);
    h.rail.0.lock().unwrap().retain(|n| n.id != "door");
    *h.fail.lock().unwrap() = Some("complete_retirement".into());
    assert!(h.messages.complete_retirement("door", "c").await.is_err());
    h.status("1", "3", Kind::Error).await;
    assert_eq!(h.messages.thread("door").unwrap(), before);
    h.messages.complete_retirement("door", "c").await.unwrap();
    *h.fail.lock().unwrap() = Some("reserve_retirement".into());
    assert!(h.messages.reserve_retirement("skipped", "c").await.is_err());
    h.messages.complete_retirement("door", "c").await.unwrap();
    assert!(
        h.messages
            .complete_retirement("door", "other")
            .await
            .is_err()
    );
    assert!(
        h.messages
            .complete_retirement("unknown", "c")
            .await
            .is_err()
    );
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert!(h.inbox.written().is_empty());
}

#[test]
fn a35_retirement_reopen_before_after_removal_and_completion_never_delivers() {
    // This tests event ordering across runtimes, not elapsed time. Paused time keeps
    // synchronous SQLite reconciliation under CI load outside the drop hang guard.
    for stage in 0..3 {
        let dir = tempfile::tempdir().unwrap();
        let h = RestartHarness::new(dir.path());
        let first = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .start_paused(true)
            .build()
            .unwrap();
        first.block_on(async {
            h.send(Actor::user(), "door", "pending").await;
            h.send(agent("a"), "door", "second").await;
            h.call(
                "route.set",
                json!({"from":"b","to":"door","delivery":"drop"}),
            )
            .await;
            h.send(agent("b"), "door", "final").await;
            h.messages.reserve_retirement("door", "c").await.unwrap();
            if stage > 0 {
                h.rail.0.lock().unwrap().retain(|n| n.id != "door");
            }
            if stage == 2 {
                h.messages.complete_retirement("door", "c").await.unwrap();
            }
        });
        drop(first);
        let before = h.messages.thread("door").unwrap();
        drop(h);
        let recovered = RestartHarness::new(dir.path());
        if stage > 0 {
            recovered.rail.0.lock().unwrap().retain(|n| n.id != "door");
        }
        let second = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .start_paused(true)
            .build()
            .unwrap();
        second.block_on(async {
            recovered
                .messages
                .reserve_retirement("door", "c")
                .await
                .unwrap();
            // Even a stale Rail entry and Idle after reopen cannot make archived records eligible.
            if stage == 0 {
                recovered.next();
                assert!(
                    recovered
                        .messages
                        .call(
                            &recovered.ctx,
                            "message.send",
                            json!({"to":"door","kind":"note","body":"new"})
                        )
                        .await
                        .is_err()
                );
            }
            recovered.status("2", "3", Kind::Idle).await;
            recovered.rail.0.lock().unwrap().retain(|n| n.id != "door");
            // Overflow forces a lag resync of the missing receiver. Ignored events avoid
            // queuing a database resync per retained event ahead of the Status fence.
            for _ in 0..=recovered.ctx.bus.capacity() {
                recovered
                    .ctx
                    .bus
                    .emit(Actor::daemon(), EventData::TerminalChanged);
            }
            recovered.status("1", "99", Kind::Done).await;
            recovered
                .messages
                .complete_retirement("door", "c")
                .await
                .unwrap();
            recovered
                .messages
                .complete_retirement("door", "c")
                .await
                .unwrap();
            assert_eq!(recovered.messages.thread("door").unwrap(), before);
            assert!(recovered.inbox.written().is_empty());
        });
    }
}

#[tokio::test]
async fn a35_retirement_keeps_a_delivered_question_on_receiver_loss() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.rail.0.lock().unwrap()[0] = agent_node("door", Kind::Idle);
    let ctx = Ctx {
        actor: agent("a"),
        bus: h.ctx.bus.clone(),
        touches: h.ctx.touches.clone(),
    };
    h.messages
        .call(
            &ctx,
            "message.send",
            json!({"to":"door","kind":"question","body":"which?"}),
        )
        .await
        .unwrap();
    let before = h.messages.thread("door").unwrap();
    assert_eq!(before[0].status, MessageStatus::Delivered);
    let written = h.inbox.written();
    h.messages.reserve_retirement("door", "c").await.unwrap();
    h.rail.0.lock().unwrap().retain(|n| n.id != "door");
    h.send(Actor::daemon(), "skipped", "settle").await;
    h.ctx.bus.emit(Actor::daemon(), EventData::RailChanged);
    h.status("1", "2", Kind::Done).await;
    h.messages.complete_retirement("door", "c").await.unwrap();
    h.send(Actor::daemon(), "skipped", "settle again").await;
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert!(h.messages.thread("you").unwrap().is_empty());
    assert_eq!(h.inbox.written(), written);
}

#[tokio::test]
async fn a35_a_stopped_later_agent_retires_without_reviving_final_messages() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    let pending = h.send(Actor::user(), "door", "ordinary stop").await;
    h.status("1", "2", Kind::Done).await;
    h.rail.0.lock().unwrap()[0] = RailNode {
        status: Some(Status {
            kind: Kind::Done,
            label: "stopped".into(),
            since: 0,
            finished: "0".into(),
        }),
        status_revision: None,
        terminal_id: None,
        ..agent_node("door", Kind::Done)
    };
    let before = h.messages.thread("door").unwrap();
    assert_eq!(
        (before[0].id, before[0].status, before[0].reason),
        (
            pending.id,
            MessageStatus::Dropped,
            Some(Reason::ReceiverGone)
        )
    );
    h.messages.reserve_retirement("door", "c").await.unwrap();
    h.rail.0.lock().unwrap().retain(|n| n.id != "door");
    h.ctx.bus.emit(Actor::daemon(), EventData::RailChanged);
    h.status("1", "3", Kind::Idle).await;
    h.messages.complete_retirement("door", "c").await.unwrap();
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert!(h.inbox.written().is_empty());
}
