use super::*;

#[tokio::test]
async fn ec5637a_owner_flush_reads_only_rail() {
    let (stub, reader) = rig(vec![node("a", "idle", true)]);
    let mut told = assigned();
    told.commented(1, &[comment(1, Actor::user(), "go")]);
    flush(&mut told, &reader).await;
    assert_eq!(*stub.calls.lock(), ["rail.tree", "message.send"]);
    assert_eq!(
        *stub.sent.lock(),
        vec![
            json!({"to":"a","kind":"note","body":"[todos]\n- Ship: assigned to you, new comment from you: go (rup todo get 1)"})
        ]
    );
}

#[tokio::test]
async fn ec5637a_owner_handoff_reads_only_rail() {
    let (stub, reader) = rig(vec![node("a", "idle", true), node("b", "idle", true)]);
    let mut told = Told::default();
    // Production record deduplicates repeated idle Events in a batch.
    for id in ["b", "a", "b"] {
        let status = serde_json::from_value(json!({"id":id,"attempt":"1","status_revision":"1","ended":false,"status":{"kind":"idle","label":"","since":0,"finished":"0"}})).unwrap();
        told.record(&Event {
            seq: None,
            actor: Actor::daemon(),
            data: EventData::AgentStatus(Box::new(status)),
        });
    }
    hand_off(&mut told, &reader).await;
    assert_eq!(
        *stub.calls.lock(),
        [
            "rail.tree",
            "todo.hand:b",
            "message.send",
            "todo.hand:a",
            "message.send"
        ]
    );
    assert_eq!(
        *stub.sent.lock(),
        vec![
            json!({"to":"b","kind":"note","body":"Next: #7 Next task"}),
            json!({"to":"a","kind":"note","body":"Next: #7 Next task"})
        ]
    );
}

#[tokio::test]
async fn ec5637a_owner_required_rail_failure_sends_nothing() {
    let (stub, reader) = rig(vec![node("a", "idle", true)]);
    stub.rail_fails
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let mut told = assigned();
    told.idled.push("a".into());
    flush(&mut told, &reader).await;
    hand_off(&mut told, &reader).await;
    assert_eq!(*stub.calls.lock(), ["rail.tree", "rail.tree"]);
    assert!(stub.sent.lock().is_empty());
    stub.rail_fails
        .store(false, std::sync::atomic::Ordering::Relaxed);
    flush(&mut told, &reader).await;
    assert_eq!(
        stub.sent.lock()[0]["body"],
        "[todos]\n- Ship: assigned to you (rup todo get 1)"
    );
}

#[test]
fn ec5637b_owner_state_allocations_ignore_body_size() {
    fn sample(size: usize) -> ([u64; 4], String) {
        let mut initial = todo(1, "Old", None, vec![]);
        initial.body = "x".repeat(size);
        let input = vec![initial.clone()];
        let mut events = [
            updated(Actor::user(), initial.clone()),
            updated(Actor::user(), initial.clone()),
            updated(Actor::user(), initial),
        ];
        events[0].data = match &events[0].data {
            EventData::TodoUpdated(t) => EventData::TodoCreated(t.clone()),
            _ => unreachable!(),
        };
        events[2].data = match &events[2].data {
            EventData::TodoUpdated(t) => EventData::TodoRestored(t.clone()),
            _ => unreachable!(),
        };
        for (i, event) in events.iter_mut().enumerate() {
            let (EventData::TodoCreated(t)
            | EventData::TodoUpdated(t)
            | EventData::TodoRestored(t)) = &mut event.data
            else {
                unreachable!()
            };
            t.title = format!("Latest {i}");
            t.owner = Some(agent_actor("a"));
            if i == 1 {
                t.blockers = vec![2];
            }
        }
        let mut told = None;
        let first = allocation_counter::measure(|| told = Some(Told::new(input))).bytes_total;
        let told = told.as_mut().unwrap();
        let rest = events
            .each_ref()
            .map(|event| allocation_counter::measure(|| told.record(event)).bytes_total);
        ([first, rest[0], rest[1], rest[2]], told.take("a").unwrap())
    }
    sample(0);
    sample(1 << 20);
    let small = sample(0);
    let large = sample(1 << 20);
    assert_eq!(small.0, large.0, "empty vs 1 MiB: {small:?}, {large:?}");
    assert_eq!(
        small.1,
        "[todos]\n- Latest 2: assigned to you, now blocked by 2 (rup todo get 1)"
    );
    assert_eq!(small.1, large.1);
    eprintln!(
        "EC5637b allocated bytes [init, create, update, restore]: {:?}",
        small.0
    );
}

#[test]
fn ec5637c_owner_delete_restore_preserves_pending_rules() {
    let mut told = assigned();
    told.commented(1, &[comment(1, Actor::user(), "old")]);
    told.record(&Event {
        seq: None,
        actor: Actor::user(),
        data: EventData::TodoDeleted(TodoId { id: 1 }),
    });
    assert!(told.take("a").is_none());
    told.record(&Event {
        seq: None,
        actor: Actor::user(),
        data: EventData::TodoRestored(Box::new(todo(
            1,
            "Restored",
            Some(agent_actor("a")),
            vec![],
        ))),
    });
    assert!(told.take("a").is_none());
    told.commented(1, &[comment(1, Actor::user(), "new")]);
    told.record(&updated(
        Actor::user(),
        todo(1, "Latest", Some(agent_actor("a")), vec![2]),
    ));
    assert_eq!(
        told.take("a").unwrap(),
        "[todos]\n- Latest: new comment from you: new, now blocked by 2 (rup todo get 1)"
    );
}

#[test]
fn ec5637c_owner_comments_before_todo_keep_progress() {
    let mut told = Told::default();
    let thread = [
        comment(1, agent_actor("a"), "question"),
        comment(2, Actor::user(), "answer"),
    ];
    told.commented(1, &thread);
    told.record(&Event {
        seq: None,
        actor: Actor::user(),
        data: EventData::TodoRestored(Box::new(todo(1, "Arrived", None, vec![]))),
    });
    told.commented(1, &thread);
    assert_eq!(
        told.take("a").unwrap(),
        "[todos]\n- Arrived: new comment from you: answer (rup todo get 1)"
    );
    told.commented(1, &thread);
    assert!(told.take("a").is_none());
}
