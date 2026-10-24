use super::*;

#[tokio::test]
async fn a35_a_previously_stopped_retained_agent_can_restart_without_reviving_final_messages() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    let gone = h
        .send(Actor::user(), "door", "ordinary stop drops this")
        .await;
    h.call(
        "route.set",
        json!({"from":"a","to":"door","delivery":"ask-first"}),
    )
    .await;
    let held = h.send(agent("a"), "door", "ask").await;
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
        vec![
            (gone.id, MessageStatus::Dropped, Some(Reason::ReceiverGone)),
            (held.id, MessageStatus::Held, Some(Reason::AskFirst))
        ]
    );
    assert!(h.typed.lock().unwrap().is_empty());
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
    h.typed.lock().unwrap().clear();
    h.send(Actor::user(), "door", "pending").await;
    h.call(
        "route.set",
        json!({"from":"a","to":"door","delivery":"ask-first"}),
    )
    .await;
    let held = h.send(agent("a"), "door", "held").await;
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
    assert!(
        h.messages
            .call(&h.ctx, "message.deliver", json!({"id":held.id}))
            .await
            .is_err()
    );
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert!(h.typed.lock().unwrap().is_empty());
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
    assert!(h.typed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a35_retirement_ends_only_an_authorized_takeover_without_changing_records() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    for receiver in ["door", "skipped"] {
        h.call("takeover.begin", json!({"agent":receiver})).await;
        h.send(agent("a"), receiver, "held").await;
    }
    let before = h.messages.thread("door").unwrap();
    let skipped = h.messages.thread("skipped").unwrap();
    h.messages.reserve_retirement("door", "c").await.unwrap();
    assert!(h.messages.takeover_active("door"));
    assert!(
        h.messages
            .call(
                &Ctx {
                    actor: agent("door"),
                    bus: h.ctx.bus.clone(),
                    touches: h.ctx.touches.clone()
                },
                "takeover.end",
                json!({"agent":"door"})
            )
            .await
            .is_err()
    );
    assert!(h.messages.takeover_active("door"));
    h.call("takeover.end", json!({"agent":"door"})).await;
    assert!(!h.messages.takeover_active("door"));
    h.status("1", "2", Kind::Done).await;
    h.rail.0.lock().unwrap().retain(|n| n.id != "door");
    h.messages.complete_retirement("door", "c").await.unwrap();
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert_eq!(h.messages.thread("skipped").unwrap(), skipped);
    assert!(h.messages.takeover_active("skipped"));
    assert!(
        h.messages
            .complete_retirement("skipped", "c")
            .await
            .is_err()
    );
    assert!(h.typed.lock().unwrap().is_empty());
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
            let pending = h.send(Actor::user(), "door", "pending").await;
            h.call("takeover.begin", json!({"agent":"door"})).await;
            h.call("message.deliver", json!({"id":pending.id})).await;
            h.send(agent("a"), "door", "takeover-held").await;
            h.call(
                "route.set",
                json!({"from":"b","to":"door","delivery":"ask-first"}),
            )
            .await;
            h.send(agent("b"), "door", "ask-first-held").await;
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
            assert!(!recovered.messages.takeover_active("door"));
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
                let held = before
                    .iter()
                    .find(|m| m.reason == Some(Reason::AskFirst))
                    .unwrap();
                assert!(
                    recovered
                        .messages
                        .call(&recovered.ctx, "message.deliver", json!({"id":held.id}))
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
            assert!(recovered.typed.lock().unwrap().is_empty());
        });
    }
}

#[tokio::test]
async fn a35_retirement_does_not_pass_a_delivered_question_on_receiver_loss_or_timeout() {
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
    h.typed.lock().unwrap().clear();
    h.messages.reserve_retirement("door", "c").await.unwrap();
    h.rail.0.lock().unwrap().retain(|n| n.id != "door");
    h.clock.store(
        42 + hops::HOP_BOUND_MS + 1,
        std::sync::atomic::Ordering::SeqCst,
    );
    h.send(Actor::daemon(), "skipped", "settle").await;
    h.ctx.bus.emit(Actor::daemon(), EventData::RailChanged);
    h.status("1", "2", Kind::Done).await;
    h.messages.complete_retirement("door", "c").await.unwrap();
    h.send(Actor::daemon(), "skipped", "settle again").await;
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert!(h.messages.thread("you").unwrap().is_empty());
    assert!(h.typed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a35_a_stopped_later_agent_retires_without_reviving_final_messages() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    let pending = h.send(Actor::user(), "door", "ordinary stop").await;
    h.call(
        "route.set",
        json!({"from":"a","to":"door","delivery":"ask-first"}),
    )
    .await;
    let held = h.send(agent("a"), "door", "ask").await;
    h.status("1", "2", Kind::Done).await;
    h.rail.0.lock().unwrap()[0] = RailNode {
        status: Some(Status {
            kind: Kind::Done,
            label: "stopped".into(),
            since: 0,
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
    assert_eq!(
        (before[1].id, before[1].status, before[1].reason),
        (held.id, MessageStatus::Held, Some(Reason::AskFirst))
    );
    h.messages.reserve_retirement("door", "c").await.unwrap();
    h.rail.0.lock().unwrap().retain(|n| n.id != "door");
    h.ctx.bus.emit(Actor::daemon(), EventData::RailChanged);
    h.status("1", "3", Kind::Idle).await;
    h.messages.complete_retirement("door", "c").await.unwrap();
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert!(h.typed.lock().unwrap().is_empty());
}
