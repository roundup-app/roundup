use super::*;

#[tokio::test]
async fn a35_reserved_messages_wait_for_the_next_attempt_release() {
    let dir = tempfile::tempdir().unwrap();
    let rail = FakeRail::new(vec![RailNode {
        kind: NodeKind::Workstream,
        ..agent_node("door", Kind::Working)
    }]);
    let bus = Bus::new();
    let typed: Arc<StdMutex<Vec<String>>> = Arc::default();
    let seen = typed.clone();
    let deliver: Deliver = Arc::new(move |_, text| {
        seen.lock().unwrap().push(shown(text));
        Box::pin(async { Ok(()) })
    });
    let m = Messages::open(dir.path(), bus.clone(), rail.clone(), deliver).unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus,
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    m.call(
        &ctx,
        "message.send",
        json!({"to":"door","kind":"note","body":"queued"}),
    )
    .await
    .unwrap();
    m.reserve_restart("door", "rewind-c", None).await.unwrap();
    *rail.0.lock().unwrap() = vec![agent_node("door", Kind::Done)];
    // A failed release leaves the reservation and queue intact.
    assert!(m.release_restart("door", "rewind-c", "2").await.is_err());
    let next = RailNode {
        attempt: Some("2".into()),
        status_revision: Some("2".into()),
        ..agent_node("door", Kind::Idle)
    };
    *rail.0.lock().unwrap() = vec![next];
    m.reserve_restart("door", "rewind-c", None).await.unwrap();
    assert!(typed.lock().unwrap().is_empty());
    m.release_restart("door", "rewind-c", "2").await.unwrap();
    m.release_restart("door", "rewind-c", "2").await.unwrap();
    assert_eq!(*typed.lock().unwrap(), vec!["[from you, note] queued"]);
    assert_eq!(
        m.thread("door").unwrap()[0].status,
        MessageStatus::Delivered
    );
}

struct RestartHarness {
    messages: Messages,
    rail: Arc<FakeRail>,
    ctx: Ctx,
    typed: Arc<StdMutex<Vec<String>>>,
    fail: Arc<StdMutex<Option<String>>>,
    clock: Arc<std::sync::atomic::AtomicI64>,
}

impl RestartHarness {
    fn new(dir: &Path) -> Self {
        let rail = FakeRail::new(vec![
            RailNode {
                kind: NodeKind::Workstream,
                ..agent_node("door", Kind::Working)
            },
            agent_node("skipped", Kind::Working),
        ]);
        let bus = Bus::new();
        let typed: Arc<StdMutex<Vec<String>>> = Arc::default();
        let seen = typed.clone();
        let deliver: Deliver = Arc::new(move |_, text| {
            seen.lock().unwrap().push(shown(text));
            Box::pin(async { Ok(()) })
        });
        let fail: Arc<StdMutex<Option<String>>> = Arc::default();
        let failing = fail.clone();
        let touches = Arc::new(Touches::open(&dir.join("touches.db")).unwrap());
        let clock = Arc::new(std::sync::atomic::AtomicI64::new(42));
        let reads = clock.clone();
        let env = Env {
            touches: touches.clone(),
            clock: Arc::new(move || reads.load(std::sync::atomic::Ordering::SeqCst)),
            fault: Arc::new(move |op| {
                let mut fail = failing.lock().unwrap();
                if fail.as_deref() == Some(op) {
                    *fail = None;
                    Err("recording failed".into())
                } else {
                    Ok(())
                }
            }),
        };
        let messages = Messages::open_with(dir, bus.clone(), rail.clone(), deliver, env).unwrap();
        Self {
            messages,
            rail,
            ctx: Ctx {
                actor: Actor::user(),
                bus,
                touches,
            },
            typed,
            fail,
            clock,
        }
    }

    async fn send(&self, from: Actor, to: &str, text: &str) -> Message {
        let ctx = Ctx {
            actor: from,
            bus: self.ctx.bus.clone(),
            touches: self.ctx.touches.clone(),
        };
        serde_json::from_value(
            self.messages
                .call(
                    &ctx,
                    "message.send",
                    json!({"to":to,"kind":"note","body":text}),
                )
                .await
                .unwrap(),
        )
        .unwrap()
    }

    async fn call(&self, method: &str, p: Value) {
        self.messages.call(&self.ctx, method, p).await.unwrap();
    }

    fn next(&self) {
        self.rail.0.lock().unwrap()[0] = RailNode {
            attempt: Some("2".into()),
            status_revision: Some("2".into()),
            ..agent_node("door", Kind::Idle)
        };
    }

    async fn status(&self, attempt: &str, revision: &str, kind: Kind) {
        // Reopened harnesses have no runtime at open; start their listener before emitting.
        start_listener(&self.messages.inner);
        // on_status completion includes reconciliation and settling, without a synthetic receiver.
        let mut completed = self.messages.inner.completed.subscribe();
        self.ctx.bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(Box::new(contracts::agent::StatusEvent {
                id: "door".into(),
                attempt: attempt.into(),
                status_revision: revision.into(),
                status: Status {
                    kind,
                    label: "test".into(),
                    since: 0,
                },
            })),
        );
        tokio::time::timeout(std::time::Duration::from_secs(30), async {
            while completed.recv().await.unwrap() != "on_status" {}
        })
        .await
        .expect("status reconciliation completed");
    }
}

#[tokio::test]
async fn a35_restart_keeps_holds_and_b7_order() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    let pending = h.send(Actor::user(), "door", "first").await;
    h.call(
        "route.set",
        json!({"from":"a","to":"door","delivery":"ask-first"}),
    )
    .await;
    let ask = h.send(agent("a"), "door", "ask").await;
    h.call("takeover.begin", json!({"agent":"door"})).await;
    let held = h.send(agent("b"), "door", "held").await;
    h.call("message.deliver", json!({"id":pending.id})).await;
    assert_eq!(
        h.messages
            .thread("door")
            .unwrap()
            .iter()
            .map(|m| (m.status, m.reason))
            .collect::<Vec<_>>(),
        vec![
            (MessageStatus::Pending, None),
            (MessageStatus::Held, Some(Reason::AskFirst)),
            (MessageStatus::Held, Some(Reason::Takeover))
        ]
    );
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    // Consent is the coordinator's responsibility: it explicitly ends a chosen Takeover.
    h.call("takeover.end", json!({"agent":"door"})).await;
    h.rail.0.lock().unwrap()[0] = agent_node("door", Kind::Error);
    h.status("1", "3", Kind::Error).await;
    h.next();
    h.status("2", "2", Kind::Idle).await;
    h.status("1", "99", Kind::Done).await;
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    let before = h.messages.thread("door").unwrap();
    assert_eq!(
        before
            .iter()
            .map(|m| (m.id, m.status, m.reason))
            .collect::<Vec<_>>(),
        vec![
            (pending.id, MessageStatus::Pending, None),
            (ask.id, MessageStatus::Held, Some(Reason::AskFirst)),
            (held.id, MessageStatus::Pending, None)
        ]
    );
    assert!(h.typed.lock().unwrap().is_empty());
    h.messages.release_restart("door", "c", "2").await.unwrap();
    assert_eq!(
        *h.typed.lock().unwrap(),
        vec!["[from you, note] first\n\n[from an Agent that is gone, note] held"]
    );
    assert_eq!(
        h.messages.thread("door").unwrap()[1].reason,
        Some(Reason::AskFirst)
    );
}

#[tokio::test]
async fn a35_skipped_takeover_is_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.call("takeover.begin", json!({"agent":"skipped"})).await;
    let held = h.send(agent("a"), "skipped", "wait").await;
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    h.next();
    h.messages.release_restart("door", "c", "2").await.unwrap();
    assert!(h.messages.takeover_active("skipped"));
    let saved = h.messages.thread("skipped").unwrap();
    assert_eq!(saved[0].id, held.id);
    assert_eq!(saved[0].status, MessageStatus::Held);
    assert_eq!(saved[0].reason, Some(Reason::Takeover));
    assert!(h.typed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a35_first_prompt_recording_retries_without_a_second_note_or_steer() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.send(Actor::user(), "door", "earlier").await;
    h.messages.end_iteration("door").unwrap();
    let earlier = h.messages.thread("door").unwrap();
    h.messages
        .reserve_restart("door", "c", Some("rewound c"))
        .await
        .unwrap();
    h.next();
    assert!(h.messages.release_restart("door", "c", "2").await.is_err());
    *h.fail.lock().unwrap() = Some("record_restart_prompt".into());
    assert!(
        h.messages
            .record_restart_prompt("door", "c", "2")
            .await
            .is_err()
    );
    assert_eq!(h.messages.thread("door").unwrap(), earlier);
    *h.fail.lock().unwrap() = Some("publish_restart_prompt".into());
    assert!(
        h.messages
            .record_restart_prompt("door", "c", "2")
            .await
            .is_err()
    );
    let note = h
        .messages
        .record_restart_prompt("door", "c", "2")
        .await
        .unwrap();
    assert_eq!(
        h.messages
            .record_restart_prompt("door", "c", "2")
            .await
            .unwrap(),
        note
    );
    let thread = h.messages.thread("door").unwrap();
    assert_eq!(&thread[..earlier.len()], &earlier);
    assert_eq!(thread.last().unwrap().iteration, Some(2));
    assert_eq!(note.from, Actor::user());
    assert_eq!(note.kind, MessageKind::Note);
    assert_eq!(note.status, MessageStatus::Delivered);
    assert_eq!(note.body, "rewound c");
    assert_eq!(h.ctx.touches.history(&item(note.id)).unwrap().len(), 1);
    assert!(h.typed.lock().unwrap().is_empty());
}

// Event ordering is the subject; SQLite work after overflow must not consume the hang guard.
#[tokio::test(start_paused = true)]
async fn a35_lag_resync_preserves_reserved_messages() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.send(Actor::user(), "door", "queued").await;
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    h.rail.0.lock().unwrap()[0] = agent_node("door", Kind::Done);
    // No await lets the listener consume events before overflow on this current-thread
    // runtime. Ignored events isolate the lag resync from RailChanged resyncs.
    for _ in 0..=h.ctx.bus.capacity() {
        h.ctx.bus.emit(Actor::daemon(), EventData::TerminalChanged);
    }
    h.status("1", "2", Kind::Error).await;
    assert_eq!(
        h.messages.thread("door").unwrap()[0].status,
        MessageStatus::Pending
    );
    assert!(h.typed.lock().unwrap().is_empty());
    h.next();
    h.messages.release_restart("door", "c", "2").await.unwrap();
    h.status("1", "99", Kind::Done).await;
    assert_eq!(*h.typed.lock().unwrap(), vec!["[from you, note] queued"]);
    assert_eq!(
        h.messages.thread("door").unwrap()[0].status,
        MessageStatus::Delivered
    );
}

#[test]
fn a35_daemon_death_replays_held_messages_and_the_acknowledged_note() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    let first = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    first.block_on(async {
        h.send(Actor::user(), "door", "queue").await;
        h.call("takeover.begin", json!({"agent":"door"})).await;
        h.call(
            "route.set",
            json!({"from":"a","to":"door","delivery":"ask-first"}),
        )
        .await;
        h.send(agent("a"), "door", "ask").await;
        h.messages
            .reserve_restart("door", "c", Some("rewound"))
            .await
            .unwrap();
        h.next();
        *h.fail.lock().unwrap() = Some("publish_restart_prompt".into());
        assert!(
            h.messages
                .record_restart_prompt("door", "c", "2")
                .await
                .is_err()
        );
    });
    drop(first); // Ends this Daemon's listeners, not just its Messages handle.
    let before = h.messages.thread("door").unwrap();
    let touches = h.ctx.touches.clone();
    drop(h);
    let recovered = RestartHarness::new(dir.path());
    let second = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    second.block_on(async {
        recovered.rail.0.lock().unwrap()[0] = agent_node("door", Kind::Done);
        recovered
            .messages
            .reserve_restart("door", "c", Some("rewound"))
            .await
            .unwrap();
        assert_eq!(recovered.messages.thread("door").unwrap(), before);
        let note = recovered
            .messages
            .record_restart_prompt("door", "c", "2")
            .await
            .unwrap();
        assert_eq!(note.id, before.last().unwrap().id);
        assert_eq!(touches.history(&item(note.id)).unwrap().len(), 1);
        recovered.next();
        recovered.rail.0.lock().unwrap()[0].attempt = Some("3".into());
        recovered
            .messages
            .release_restart("door", "c", "3")
            .await
            .unwrap();
        let after = recovered.messages.thread("door").unwrap();
        assert_eq!(
            after
                .iter()
                .map(|m| (m.status, m.reason))
                .collect::<Vec<_>>(),
            vec![
                (MessageStatus::Delivered, None),
                (MessageStatus::Held, Some(Reason::AskFirst)),
                (MessageStatus::Delivered, None)
            ]
        );
        assert_eq!(
            *recovered.typed.lock().unwrap(),
            vec!["[from you, note] queue"]
        );
        recovered
            .messages
            .release_restart("door", "c", "3")
            .await
            .unwrap();
        assert_eq!(recovered.typed.lock().unwrap().len(), 1);
    });
}

#[tokio::test]
async fn a35_failure_retains_the_same_retry_and_rejects_another_key() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.send(Actor::user(), "door", "queued").await;
    h.messages
        .reserve_restart("door", "c", Some("rewound"))
        .await
        .unwrap();
    assert!(
        h.messages
            .reserve_restart("door", "other", None)
            .await
            .is_err()
    );
    assert!(
        h.messages
            .reserve_restart("door", "c", Some("different"))
            .await
            .is_err()
    );
    h.rail.0.lock().unwrap()[0] = agent_node("door", Kind::Error);
    h.status("1", "2", Kind::Error).await;
    assert!(h.messages.release_restart("door", "c", "2").await.is_err());
    h.next();
    h.messages
        .reserve_restart("door", "c", Some("rewound"))
        .await
        .unwrap();
    h.messages
        .record_restart_prompt("door", "c", "2")
        .await
        .unwrap();
    h.messages.release_restart("door", "c", "2").await.unwrap();
    assert_eq!(*h.typed.lock().unwrap(), vec!["[from you, note] queued"]);
    h.rail.0.lock().unwrap()[0] = agent_node("door", Kind::Done);
    h.messages.release_restart("door", "c", "2").await.unwrap();
    h.messages
        .record_restart_prompt("door", "c", "2")
        .await
        .unwrap();
    assert_eq!(h.messages.thread("door").unwrap().len(), 2);
    assert_eq!(h.typed.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a35_escalated_holds_survive_the_retained_receiver_restart() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    let ask = h
        .messages
        .call(
            &Ctx {
                actor: agent("a"),
                bus: h.ctx.bus.clone(),
                touches: h.ctx.touches.clone(),
            },
            "message.send",
            json!({"to":"door","kind":"question","body":"which?"}),
        )
        .await
        .unwrap();
    h.messages
        .call(
            &Ctx {
                actor: agent("door"),
                bus: h.ctx.bus.clone(),
                touches: h.ctx.touches.clone(),
            },
            "message.pass",
            json!({"id":ask["id"]}),
        )
        .await
        .unwrap();
    let before = h.messages.thread("you").unwrap();
    assert_eq!(before[0].reason, Some(Reason::Escalated));
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    h.status("1", "2", Kind::Done).await;
    h.next();
    h.messages.release_restart("door", "c", "2").await.unwrap();
    assert_eq!(h.messages.thread("you").unwrap(), before);
}

#[tokio::test]
async fn a35_final_removal_still_drops_reserved_pending_messages() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.send(Actor::user(), "door", "queued").await;
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    h.rail.0.lock().unwrap().retain(|n| n.id != "door");
    h.ctx.bus.emit(Actor::daemon(), EventData::RailChanged);
    h.status("1", "2", Kind::Done).await;
    let message = &h.messages.thread("door").unwrap()[0];
    assert_eq!(message.status, MessageStatus::Dropped);
    assert_eq!(message.reason, Some(Reason::ReceiverGone));
    assert!(h.messages.release_restart("door", "c", "2").await.is_err());
    assert!(h.typed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a35_temporary_statuses_preserve_takeover_held_reasons() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.call("takeover.begin", json!({"agent":"door"})).await;
    let held = h.send(agent("a"), "door", "held").await;
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    h.status("1", "2", Kind::Done).await;
    h.status("1", "3", Kind::Error).await;
    h.next();
    h.status("2", "2", Kind::Idle).await;
    let before = h.messages.thread("door").unwrap();
    assert_eq!(before[0].id, held.id);
    assert_eq!(before[0].status, MessageStatus::Held);
    assert_eq!(before[0].reason, Some(Reason::Takeover));
    assert!(h.messages.takeover_active("door"));
    h.messages.release_restart("door", "c", "2").await.unwrap();
    h.status("1", "99", Kind::Done).await;
    assert!(h.messages.takeover_active("door"));
    assert_eq!(h.messages.thread("door").unwrap(), before);
    assert!(h.typed.lock().unwrap().is_empty());
    h.call("takeover.end", json!({"agent":"door"})).await;
    assert_eq!(
        *h.typed.lock().unwrap(),
        vec!["[from an Agent that is gone, note] held"]
    );
}

#[tokio::test]
async fn a35_first_prompt_events_are_emitted_once_before_queue_delivery() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    let queued = h.send(Actor::user(), "door", "queued").await;
    h.messages
        .reserve_restart("door", "c", Some("rewound"))
        .await
        .unwrap();
    h.next();
    let mut events = h.ctx.bus.subscribe();
    let note = h
        .messages
        .record_restart_prompt("door", "c", "2")
        .await
        .unwrap();
    h.messages
        .record_restart_prompt("door", "c", "2")
        .await
        .unwrap();
    h.messages.release_restart("door", "c", "2").await.unwrap();
    let mut observed = Vec::new();
    while let Ok(event) = events.try_recv() {
        match event.data {
            EventData::MessageSent(m) => observed.push(("sent", m.id)),
            EventData::MessageDelivered(m) => observed.push(("delivered", m.id)),
            _ => {}
        }
    }
    assert_eq!(
        observed,
        vec![
            ("sent", note.id),
            ("delivered", note.id),
            ("delivered", queued.id)
        ]
    );
}

#[tokio::test]
async fn a35_a_question_waits_through_restart_without_using_its_answer_bound() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
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
    h.messages.reserve_restart("door", "c", None).await.unwrap();
    h.clock.store(
        42 + hops::HOP_BOUND_MS + 1,
        std::sync::atomic::Ordering::SeqCst,
    );
    h.send(Actor::daemon(), "skipped", "settle").await;
    let before = h.messages.thread("door").unwrap();
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].status, MessageStatus::Pending);
    h.next();
    h.messages.release_restart("door", "c", "2").await.unwrap();
    h.send(Actor::daemon(), "skipped", "settle again").await;
    let after = h.messages.thread("door").unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].status, MessageStatus::Delivered);
    assert_eq!(
        *h.typed.lock().unwrap(),
        vec!["[from an Agent that is gone, question] which?"]
    );
}

#[tokio::test]
async fn a35_reservation_waits_for_an_already_accepted_prompt_to_finish() {
    reservation_waits_for_prompt(false).await;
}

#[tokio::test]
async fn a35_retirement_waits_for_an_already_accepted_prompt_to_finish() {
    reservation_waits_for_prompt(true).await;
}

async fn reservation_waits_for_prompt(retiring: bool) {
    let dir = tempfile::tempdir().unwrap();
    let rail = FakeRail::new(vec![agent_node("door", Kind::Working)]);
    let bus = Bus::new();
    let entered = Arc::new(tokio::sync::Notify::new());
    let (finish, finished) = tokio::sync::oneshot::channel();
    let finished = Arc::new(StdMutex::new(Some(finished)));
    let entered_delivery = entered.clone();
    let deliver: Deliver = Arc::new(move |_, _| {
        let finished = finished.lock().unwrap().take().unwrap();
        entered_delivery.notify_one();
        Box::pin(async move {
            finished.await.unwrap();
            Ok(())
        })
    });
    let messages = Messages::open(dir.path(), bus.clone(), rail.clone(), deliver).unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: bus.clone(),
        touches: Arc::new(Touches::in_memory().unwrap()),
    };
    messages
        .call(
            &ctx,
            "message.send",
            json!({"to":"door","kind":"note","body":"in flight"}),
        )
        .await
        .unwrap();
    bus.emit(
        Actor::daemon(),
        EventData::AgentStatus(Box::new(contracts::agent::StatusEvent {
            id: "door".into(),
            attempt: "1".into(),
            status_revision: "2".into(),
            status: Status {
                kind: Kind::Idle,
                label: "idle".into(),
                since: 0,
            },
        })),
    );
    tokio::time::timeout(std::time::Duration::from_secs(3), entered.notified())
        .await
        .unwrap();
    let reservation = async {
        if retiring {
            messages.reserve_retirement("door", "c").await
        } else {
            messages.reserve_restart("door", "c", None).await
        }
    };
    tokio::pin!(reservation);
    // Observe that reserve cannot acknowledge while the accepted prompt is still in flight.
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(20), &mut reservation)
            .await
            .is_err()
    );
    finish.send(()).unwrap();
    reservation.await.unwrap();
    assert_eq!(
        messages.thread("door").unwrap()[0].status,
        MessageStatus::Delivered
    );
}

#[tokio::test]
async fn a35_acknowledged_first_prompt_can_be_recorded_after_its_attempt_stopped() {
    let dir = tempfile::tempdir().unwrap();
    let h = RestartHarness::new(dir.path());
    h.messages
        .reserve_restart("door", "c", Some("rewound"))
        .await
        .unwrap();
    h.next();
    *h.fail.lock().unwrap() = Some("record_restart_prompt".into());
    assert!(
        h.messages
            .record_restart_prompt("door", "c", "2")
            .await
            .is_err()
    );
    h.rail.0.lock().unwrap()[0].status.as_mut().unwrap().kind = Kind::Done;
    let note = h
        .messages
        .record_restart_prompt("door", "c", "2")
        .await
        .unwrap();
    assert_eq!(note.status, MessageStatus::Delivered);
    assert_eq!(
        h.messages
            .record_restart_prompt("door", "c", "2")
            .await
            .unwrap(),
        note
    );
    assert_eq!(h.messages.thread("door").unwrap().len(), 1);
    assert!(h.typed.lock().unwrap().is_empty());
}

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
