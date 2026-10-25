use super::*;

#[tokio::test]
async fn t12_every_caller_creates_a_todo_at_the_project_root() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    for (id, actor) in [
        Actor::user(),
        Actor {
            kind: ActorKind::Agent,
            id: "a1".into(),
            parent: None,
        },
        Actor {
            kind: ActorKind::Ext,
            id: "x".into(),
            parent: None,
        },
    ]
    .into_iter()
    .enumerate()
    {
        let made = h
            .call_as(actor, "todo.create", json!({"title": "t", "home": "r1"}))
            .await
            .unwrap();
        assert_eq!(made["home"], Value::Null);
        assert_eq!(
            get_home(&h, u32::try_from(id + 1).unwrap()).await,
            Value::Null
        );
    }
    assert_eq!(h.event_data()["home"], Value::Null);
    let listed = h.call("todo.list", json!(null)).await.unwrap();
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["home"].is_null())
    );
}

#[tokio::test]
async fn t12_home_survives_reopen_and_other_writes() {
    let dir = tempfile::tempdir().unwrap();
    {
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.call("todo.move", json!({"id": 1, "home": "r1"}))
            .await
            .unwrap();
        h.call("todo.update", json!({"id": 1, "title": "b"}))
            .await
            .unwrap();
        h.call("todo.complete", json!({"id": 1})).await.unwrap();
        h.call("todo.setBlockers", json!({"id": 1, "blockers": []}))
            .await
            .unwrap();
    }
    let h = Harness::new(dir.path());
    assert_eq!(get_home(&h, 1).await, "r1");
}

#[tokio::test]
async fn t12_blockers_cross_homes() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.create", json!({"title": "b"})).await.unwrap();
    h.call("todo.move", json!({"id": 1, "home": "r1"}))
        .await
        .unwrap();
    h.call("todo.move", json!({"id": 2, "home": "r2"}))
        .await
        .unwrap();
    let blocked = h
        .call("todo.setBlockers", json!({"id": 2, "blockers": [1]}))
        .await
        .unwrap();
    assert_eq!(blocked["blocked"], true);
}

#[tokio::test]
async fn t13_a_move_changes_only_the_home_and_back() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.create", json!({"title": "b", "blockers": [1]}))
        .await
        .unwrap();
    let before = h.call("todo.get", json!({"id": 2})).await.unwrap();
    let moved = h
        .call_as(
            Actor {
                kind: ActorKind::Ext,
                id: "x".into(),
                parent: None,
            },
            "todo.move",
            json!({"id": 2, "home": "r1"}),
        )
        .await
        .unwrap();
    let mut expected = before.clone();
    expected["home"] = json!("r1");
    assert_eq!(moved, expected);
    assert_eq!(get_home(&h, 2).await, "r1");
    h.call("todo.move", json!({"id": 2, "home": null}))
        .await
        .unwrap();
    assert_eq!(h.call("todo.get", json!({"id": 2})).await.unwrap(), before);
}

#[tokio::test]
async fn t13_a_move_logs_one_touch_by_the_caller() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    let agent = Actor {
        kind: ActorKind::Agent,
        id: "a1".into(),
        parent: None,
    };
    h.call_as(agent, "todo.move", json!({"id": 1, "home": "r1"}))
        .await
        .unwrap();
    assert_eq!(
        h.touches(1),
        [
            (Verb::Wrote, "you".to_owned()),
            (Verb::Wrote, "a1".to_owned())
        ]
    );
}

#[tokio::test]
async fn t13_a_move_emits_one_event() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.events();
    h.call("todo.move", json!({"id": 1, "home": "r1"}))
        .await
        .unwrap();
    assert_eq!(h.events(), ["todo.updated 1"]);
}

#[tokio::test]
async fn t13_moving_to_the_home_it_has_is_a_no_op() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.events();
    let same = h
        .call("todo.move", json!({"id": 1, "home": null}))
        .await
        .unwrap();
    assert_eq!(same["id"], 1);
    assert!(h.events().is_empty());
    assert_eq!(h.touches(1).len(), 1);
}

#[tokio::test]
async fn t13_an_unknown_todo_is_not_found_and_leaves_no_trace() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    let err = h
        .call("todo.move", json!({"id": 9, "home": "r1"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(h.events().is_empty());
    assert!(h.touches(9).is_empty());
}

#[tokio::test]
async fn t13_a_move_of_a_todo_made_by_an_agent_or_an_extension_is_the_same() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    for (n, creator) in [(1, agent("a")), (2, ext("x", "a"))] {
        h.call_as(creator.clone(), "todo.create", json!({"title": "t"}))
            .await
            .unwrap();
        h.events();
        let moved = h
            .call("todo.move", json!({"id": n, "home": "r1"}))
            .await
            .unwrap();
        assert_eq!(moved["home"], "r1");
        assert_eq!(moved["creator"], serde_json::to_value(&creator).unwrap());
        assert_eq!(h.events(), [format!("todo.updated {n}")]);
        h.call("todo.move", json!({"id": n, "home": null}))
            .await
            .unwrap();
        assert_eq!(get_home(&h, n).await, Value::Null);
    }
}
