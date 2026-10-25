use super::*;

#[tokio::test]
async fn b1_send_assigns_sequential_ids_from_is_the_caller_and_touches_wrote() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);

    let first = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    assert_eq!(first["id"], 1);
    assert_eq!(first["from"]["id"], "a");
    assert_eq!(first["to"], "b");
    assert_eq!(first["kind"], "note");
    assert_eq!(first["body"], "hi");
    assert_eq!(first["replyTo"], Value::Null);
    assert_eq!(first["status"], "pending");
    assert_eq!(first["reason"], Value::Null);
    assert!(first["at"].as_i64().unwrap() > 0, "at: {:?}", first["at"]);

    let second = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "question", "body": "ok?"}),
        )
        .await
        .unwrap();
    assert_eq!(second["id"], 2);
    assert_eq!(second["kind"], "question");

    assert_eq!(h.events(), ["message.sent", "message.sent"]);
    assert_eq!(h.touches(1), [(Verb::Wrote, "a".to_owned())]);
}

#[tokio::test]
async fn b1_kind_other_than_note_or_question_is_invalid_params() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

    let err = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "shout", "body": "hi"}),
        )
        .await
        .unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn b1_a_to_that_names_no_actor_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![]);

    let err = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "ghost", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap_err();

    assert_eq!(err.code, code::NOT_FOUND);
}

#[tokio::test]
async fn b1_a_to_that_is_a_group_or_the_sender_is_invalid_params() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(
        dir.path(),
        vec![node("g", NodeKind::Workstream, false, None)],
    );

    for to in ["g", "a"] {
        let err = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": to, "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap_err();
        assert_eq!(
            err.code,
            if to == "g" {
                code::CONFLICT
            } else {
                code::INVALID_PARAMS
            },
            "to {to}"
        );
    }
}

#[tokio::test]
async fn b1_a_door_can_receive() {
    let dir = tempfile::tempdir().unwrap();
    let meta = node(
        "m",
        NodeKind::Workstream,
        true,
        Some(Status {
            kind: Kind::Idle,
            label: "status".into(),
            since: 0,
            finished: "0".into(),
        }),
    );
    let h = Harness::new(dir.path(), vec![meta]);

    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "m", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(sent["to"], "m");
}

#[tokio::test]
async fn b1_empty_or_oversized_body_is_invalid_params() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

    let empty = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": ""}),
        )
        .await
        .unwrap_err();
    let big = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "x".repeat(8193)}),
        )
        .await
        .unwrap_err();

    assert_eq!(
        (empty.code, big.code),
        (code::INVALID_PARAMS, code::INVALID_PARAMS)
    );
}

#[tokio::test]
async fn b1_a_reply_to_that_names_no_message_is_invalid_params() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

    let err = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi", "replyTo": 9}),
        )
        .await
        .unwrap_err();

    assert_eq!(err.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn b1_reply_to_round_trips_on_a_successful_send() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(
        dir.path(),
        vec![agent_node("a", Kind::Idle), agent_node("b", Kind::Idle)],
    );
    let first = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    assert_eq!(first["id"], 1);

    let second = h
        .call_as(
            agent("b"),
            "message.send",
            json!({"to": "a", "kind": "note", "body": "ok", "replyTo": 1}),
        )
        .await
        .unwrap();

    assert_eq!(second["replyTo"], 1);
}

#[tokio::test]
async fn b1_dropped_messages_do_not_count_toward_the_bound_of_32() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
    h.call(
        "route.set",
        json!({"from": "a", "to": "b", "delivery": "drop"}),
    )
    .await
    .unwrap();
    for _ in 0..32 {
        let dropped = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap();
        assert_eq!(dropped["status"], "dropped");
    }

    let still_accepted = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(still_accepted["status"], "dropped");
}

#[tokio::test]
async fn b1_a_receiver_that_is_done_or_error_is_conflict() {
    for kind in [Kind::Done, Kind::Error] {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path(), vec![agent_node("b", kind)]);

        let err = h
            .call_as(
                agent("a"),
                "message.send",
                json!({"to": "b", "kind": "note", "body": "hi"}),
            )
            .await
            .unwrap_err();

        assert_eq!(err.code, code::CONFLICT, "{kind:?}");
    }
}

#[tokio::test]
async fn b1_a_receiver_at_the_bound_of_32_is_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    for n in 0..32 {
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": format!("hi {n}")}),
        )
        .await
        .unwrap();
    }

    let err = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap_err();

    assert_eq!(err.code, code::CONFLICT);
    assert!(err.message.contains("32"), "{}", err.message);
}

#[tokio::test]
async fn b1_a_body_of_exactly_8192_bytes_is_accepted() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "x".repeat(8192)}),
        )
        .await
        .unwrap();

    assert_eq!(sent["status"], "pending");
}

#[tokio::test]
async fn b1_the_bound_of_32_is_per_receiver_not_shared() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(
        dir.path(),
        vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
    );
    for n in 0..32 {
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": format!("hi {n}")}),
        )
        .await
        .unwrap();
    }

    let to_c = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "c", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(to_c["status"], "pending");
}

#[tokio::test]
async fn b1_a_rejected_call_at_the_bound_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    for n in 0..32 {
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": format!("hi {n}")}),
        )
        .await
        .unwrap();
    }
    h.events();

    let err = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap_err();

    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(
        h.events(),
        Vec::<String>::new(),
        "the bound check must run before the insert, so a rejected call emits no event"
    );
    let phantom = h.call("message.get", json!({"id": 33})).await.unwrap_err();
    assert_eq!(
        phantom.code,
        code::NOT_FOUND,
        "no row was ever inserted for the rejected call"
    );
}

#[tokio::test]
async fn b1_a_message_to_the_user_is_accepted() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![]);

    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "you", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(sent["to"], "you");
}

#[tokio::test]
async fn b10_a_message_to_the_user_is_delivered_at_once_and_never_fills_their_slots() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path(), vec![]);

    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "you", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(sent["status"], "delivered");
    assert_eq!(sent["reason"], Value::Null);
    assert_eq!(h.events(), ["message.sent", "message.delivered"]);

    // 32 more Messages to the user, none of which ever becomes `pending`, so
    // a 33rd still succeeds: the bound never fills for the user (B10).
    for _ in 0..32 {
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "you", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    }
    let still_accepted = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "you", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    assert_eq!(still_accepted["status"], "delivered");
}

#[tokio::test]
async fn b1_a_rejected_call_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

    let rejected = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "shout", "body": "hi"}),
        )
        .await
        .unwrap_err();
    assert_eq!(rejected.code, code::INVALID_PARAMS);
    assert_eq!(h.events(), Vec::<String>::new());

    let first = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    assert_eq!(first["id"], 1, "the rejected call used no id");
    assert_eq!(
        h.touches(1),
        [(Verb::Wrote, "a".to_owned())],
        "no Touch for the rejected call"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn b1_concurrent_sends_at_the_bound_never_both_succeed() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let touches = Arc::new(Touches::in_memory().unwrap());
    let messages = Arc::new(
        Messages::open(
            dir.path(),
            bus.clone(),
            FakeRail::new(vec![agent_node("b", Kind::Working)]),
        )
        .unwrap(),
    );
    let make_ctx = |actor: Actor| Ctx {
        actor,
        bus: bus.clone(),
        touches: Arc::clone(&touches),
    };
    for _ in 0..40 {
        // Exercise the same SQL admission/transaction path without paying for
        // 40 WAL databases and 1,240 durable seed inserts. Durability is not B1's race.
        *messages.inner.store.lock().unwrap() =
            Store::open(std::path::Path::new(":memory:")).unwrap();
        for n in 0..31 {
            messages
                .call(
                    &make_ctx(agent("a")),
                    "message.send",
                    json!({"to": "b", "kind": "note", "body": format!("hi {n}")}),
                )
                .await
                .unwrap();
        }

        let m1 = Arc::clone(&messages);
        let c1 = make_ctx(agent("a"));
        let m2 = Arc::clone(&messages);
        let c2 = make_ctx(agent("a"));
        let (r1, r2) = tokio::join!(
            tokio::spawn(async move {
                m1.call(
                    &c1,
                    "message.send",
                    json!({"to": "b", "kind": "note", "body": "x"}),
                )
                .await
            }),
            tokio::spawn(async move {
                m2.call(
                    &c2,
                    "message.send",
                    json!({"to": "b", "kind": "note", "body": "y"}),
                )
                .await
            }),
        );
        let successes = [r1.unwrap(), r2.unwrap()]
            .into_iter()
            .filter(Result::is_ok)
            .count();
        assert_eq!(
            successes, 1,
            "exactly one of two sends racing for the last open slot should pass"
        );
    }
}

#[tokio::test]
async fn b1_only_an_agent_or_the_user_is_its_own_receiver() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("a", Kind::Idle)]);
    let to_you = json!({"to": "you", "kind": "note", "body": "hi"});

    let user = h.call("message.send", to_you).await.unwrap_err();
    let agent_self = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "a", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap_err();
    let extension = h
        .call_as(
            ext("a"),
            "message.send",
            json!({"to": "a", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(
        (user.code, agent_self.code),
        (code::INVALID_PARAMS, code::INVALID_PARAMS)
    );
    assert_eq!(extension["status"], "pending");
}
