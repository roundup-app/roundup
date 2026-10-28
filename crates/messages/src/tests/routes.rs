use super::*;

#[tokio::test]
async fn b4_a_drop_route_drops_the_message_without_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
    h.call(
        "route.set",
        json!({"from": "a", "to": "b", "delivery": "drop"}),
    )
    .await
    .unwrap();
    h.events();

    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(sent["status"], "dropped");
    assert_eq!(h.events(), ["message.sent", "message.dropped"]);
}

#[tokio::test]
async fn b5_the_default_route_is_auto() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);

    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(sent["status"], "pending");
    assert_eq!(h.call("route.list", Value::Null).await.unwrap(), json!([]));
}

/// M14: an Agent's Route is stored as the Agent's, and never replaces one the user set.
#[tokio::test]
async fn b2705a_a_user_set_route_refusal_names_its_endpoints() {
    let dir = tempfile::tempdir().unwrap();
    let mut sender = agent_node("7013", Kind::Working);
    sender.name = "sad".into();
    let mut receiver = agent_node("8027", Kind::Working);
    receiver.name = "review".into();
    let rail = FakeRail::new(vec![sender, receiver]);
    let h = Harness::open(dir.path(), rail.clone(), false);
    let set = |delivery: &str| json!({"from": "7013", "to": "8027", "delivery": delivery});
    h.call("route.set", set("drop")).await.unwrap();

    let refused = h
        .call_as(agent("m"), "route.set", set("auto"))
        .await
        .unwrap_err();
    assert_eq!(
        refused.message,
        "the Route from sad to review was set by the user"
    );
    rail.0.lock().unwrap()[0].name = "glad".into();
    rail.0.lock().unwrap()[1].name = "checked".into();
    let renamed = h
        .call_as(agent("m"), "route.set", set("auto"))
        .await
        .unwrap_err();
    assert_eq!(
        renamed.message,
        "the Route from glad to checked was set by the user"
    );
    rail.0.lock().unwrap().clear();
    let gone = h
        .call_as(agent("m"), "route.set", set("auto"))
        .await
        .unwrap_err();
    assert_eq!(
        gone.message,
        "the Route from an Agent that is gone to an Agent that is gone was set by the user"
    );
    assert_eq!(
        h.call("route.list", Value::Null).await.unwrap(),
        json!([
            {"from":"7013", "to":"8027", "delivery":"drop"}
        ])
    );
    h.call_as(
        agent("m"),
        "route.set",
        json!({"from": "b", "to": "c", "delivery": "drop"}),
    )
    .await
    .unwrap();
    h.call_as(
        agent("m"),
        "route.set",
        json!({"from": "b", "to": "c", "delivery": "auto"}),
    )
    .await
    .unwrap();
    h.call(
        "route.set",
        json!({"from": "b", "to": "c", "delivery": "drop"}),
    )
    .await
    .unwrap();
    let replaced = h
        .call_as(
            agent("m"),
            "route.set",
            json!({"from": "b", "to": "c", "delivery": "auto"}),
        )
        .await
        .unwrap_err();

    assert_eq!(
        (refused.code, replaced.code),
        (code::FORBIDDEN, code::FORBIDDEN)
    );
}

#[tokio::test]
async fn b5_route_set_is_the_users_call_and_route_list_returns_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path(), vec![]);

    let forbidden = h
        .call_as(
            ext("x"),
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "drop"}),
        )
        .await
        .unwrap_err();
    assert_eq!(forbidden.code, code::FORBIDDEN);

    h.call(
        "route.set",
        json!({"from": "a", "to": "b", "delivery": "drop"}),
    )
    .await
    .unwrap();
    assert_eq!(h.events(), ["route.changed"]);

    let routes = h.call("route.list", Value::Null).await.unwrap();
    assert_eq!(
        routes,
        json!([{"from": "a", "to": "b", "delivery": "drop"}])
    );
}

#[tokio::test]
async fn b5_a_route_to_the_user_or_from_itself_is_invalid_params() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![]);

    let to_user = h
        .call(
            "route.set",
            json!({"from": "a", "to": "you", "delivery": "drop"}),
        )
        .await
        .unwrap_err();
    let self_route = h
        .call(
            "route.set",
            json!({"from": "a", "to": "a", "delivery": "drop"}),
        )
        .await
        .unwrap_err();

    assert_eq!(
        (to_user.code, self_route.code),
        (code::INVALID_PARAMS, code::INVALID_PARAMS)
    );
}

#[tokio::test]
async fn b5_a_route_change_does_not_affect_an_already_pending_message() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Working)]);
    let pending = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    assert_eq!(pending["status"], "pending");

    h.call(
        "route.set",
        json!({"from": "a", "to": "b", "delivery": "drop"}),
    )
    .await
    .unwrap();

    let still_pending = h.call("message.get", json!({"id": 1})).await.unwrap();
    assert_eq!(still_pending["status"], "pending");
}

#[tokio::test]
async fn b5_changing_an_existing_route_applies_to_messages_sent_after_it() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path(), vec![agent_node("b", Kind::Idle)]);
    h.call(
        "route.set",
        json!({"from": "a", "to": "b", "delivery": "auto"}),
    )
    .await
    .unwrap();

    h.call(
        "route.set",
        json!({"from": "a", "to": "b", "delivery": "drop"}),
    )
    .await
    .unwrap();
    assert_eq!(
        h.call("route.list", Value::Null).await.unwrap(),
        json!([{"from": "a", "to": "b", "delivery": "drop"}]),
        "the stored Route must have been updated, not left as auto"
    );

    let sent = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    assert_eq!(sent["status"], "dropped");
}

#[tokio::test]
async fn b5_a_route_applies_only_to_its_own_sender_not_every_sender_to_the_receiver() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(
        dir.path(),
        vec![agent_node("b", Kind::Idle), agent_node("c", Kind::Idle)],
    );
    h.call(
        "route.set",
        json!({"from": "a", "to": "b", "delivery": "drop"}),
    )
    .await
    .unwrap();

    let from_a = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
    let from_c = h
        .call_as(
            agent("c"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();

    assert_eq!(from_a["status"], "dropped", "a's Route to b is drop");
    assert_eq!(
        from_c["status"], "pending",
        "c has no Route to b, so the default auto applies, not a's drop Route"
    );
}

#[tokio::test]
async fn b8_routes_messages_and_statuses_survive_reopening_and_the_id_sequence_continues() {
    let dir = tempfile::tempdir().unwrap();
    let rail = vec![
        agent_node("b", Kind::Working),
        agent_node("c", Kind::Working),
        agent_node("d", Kind::Working),
    ];
    {
        let h = Harness::new(dir.path(), rail.clone());
        h.call(
            "route.set",
            json!({"from": "a", "to": "b", "delivery": "auto"}),
        )
        .await
        .unwrap();
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "hi"}),
        )
        .await
        .unwrap();
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "c", "kind": "note", "body": "still waiting"}),
        )
        .await
        .unwrap();
        h.call(
            "route.set",
            json!({"from": "a", "to": "d", "delivery": "drop"}),
        )
        .await
        .unwrap();
        h.call_as(
            agent("a"),
            "message.send",
            json!({"to": "d", "kind": "note", "body": "never typed"}),
        )
        .await
        .unwrap();
    }

    let h = Harness::new(dir.path(), rail);
    let message = h.call("message.get", json!({"id": 1})).await.unwrap();
    assert_eq!(
        (&message["status"], &message["reason"]),
        (&json!("pending"), &Value::Null)
    );
    let pending = h.call("message.get", json!({"id": 2})).await.unwrap();
    assert_eq!(pending["status"], "pending");
    let dropped = h.call("message.get", json!({"id": 3})).await.unwrap();
    assert_eq!(dropped["status"], "dropped");
    let routes = h.call("route.list", Value::Null).await.unwrap();
    assert_eq!(
        routes,
        json!([
            {"from": "a", "to": "b", "delivery": "auto"},
            {"from": "a", "to": "d", "delivery": "drop"},
        ])
    );

    let next = h
        .call_as(
            agent("a"),
            "message.send",
            json!({"to": "b", "kind": "note", "body": "again"}),
        )
        .await
        .unwrap();
    assert_eq!(next["id"], 4);
}
