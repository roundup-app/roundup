use super::*;

#[tokio::test]
async fn t16_a_new_todo_is_unassigned() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    for actor in [Actor::user(), agent("a")] {
        let todo = h
            .call_as(actor, "todo.create", json!({"title": "t"}))
            .await
            .unwrap();
        assert_eq!(todo["owner"], Value::Null);
    }
    made(&h, json!({"title": "t", "owner": null})).await;
    assert!(
        h.call("todo.list", json!(null))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["owner"].is_null())
    );
    assert_eq!(h.event_data()["owner"], Value::Null);
}

#[tokio::test]
async fn t16_create_with_an_owner() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    for actor in [Actor::user(), agent("a")] {
        let todo = made(&h, json!({"title": "t", "owner": owner_of(&actor)})).await;
        assert_eq!(todo["owner"], owner_of(&actor));
        assert_eq!(h.event_data()["owner"], owner_of(&actor));
        let got = h.call("todo.get", json!({"id": todo["id"]})).await.unwrap();
        assert_eq!(got["owner"], owner_of(&actor));
    }
}

#[tokio::test]
async fn t16_owner_persists_and_old_databases_read_null() {
    let dir = tempfile::tempdir().unwrap();
    {
        let h = Harness::new(dir.path());
        made(&h, json!({"title": "t", "owner": owner_of(&agent("a"))})).await;
    }
    let h = Harness::new(dir.path());
    assert_eq!(
        h.call("todo.get", json!({"id": 1})).await.unwrap()["owner"],
        owner_of(&agent("a"))
    );
}

#[tokio::test]
async fn t16_other_calls_never_change_the_owner() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t", "owner": owner_of(&agent("a"))})).await;
    made(&h, json!({"title": "u"})).await;
    for (method, params) in [
        ("todo.update", json!({"id": 1, "title": "x"})),
        ("todo.setBlockers", json!({"id": 1, "blockers": [2]})),
        ("todo.move", json!({"id": 1, "home": "r1"})),
        ("todo.reorder", json!({"id": 1, "before": null})),
        ("todo.complete", json!({"id": 1})),
    ] {
        h.call_as(Actor::user(), method, params).await.unwrap();
        assert_eq!(
            h.call("todo.get", json!({"id": 1})).await.unwrap()["owner"],
            owner_of(&agent("a")),
            "{method}"
        );
    }
}

#[tokio::test]
async fn t17_assign_changes_only_the_owner() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    h.events();
    let before = h.call("todo.get", json!({"id": 1})).await.unwrap();
    h.touches(1);
    let caller = agent("a");
    let assigned = h
        .call_as(
            caller,
            "todo.assign",
            json!({"id": 1, "owner": owner_of(&agent("b"))}),
        )
        .await
        .unwrap();
    let mut expected = before;
    expected["owner"] = owner_of(&agent("b"));
    expected["updated_at"] = assigned["updated_at"].clone();
    assert_eq!(assigned, expected);
    assert_eq!(h.events(), ["todo.updated 1"]);
    assert_eq!(h.touches(1).last(), Some(&(Verb::Wrote, "a".to_string())));
    assert_eq!(
        h.call("todo.get", json!({"id": 1})).await.unwrap(),
        expected
    );
}

#[tokio::test]
async fn t17_history_records_owner_change() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    let me = owner_of(&Actor::user());
    h.call("todo.assign", json!({"id": 1, "owner": me}))
        .await
        .unwrap();
    let history = changes(&h, 1).await["changes"].clone();
    let last = history.as_array().unwrap().last().unwrap().clone();
    assert_eq!(history.as_array().unwrap().len(), 2);
    assert_eq!(last["before"]["owner"], Value::Null);
    assert_eq!(last["after"]["owner"], me);
    assert_eq!(last["after"]["title"], "t");
}

#[tokio::test]
async fn t17_stale_expected_change_conflicts() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    h.events();
    let err = h
        .call(
            "todo.assign",
            json!({"id": 1, "owner": owner_of(&Actor::user()), "expected_change": 9}),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, code::CONFLICT);
    assert_eq!(
        h.call("todo.get", json!({"id": 1})).await.unwrap()["owner"],
        Value::Null
    );
    assert!(h.events().is_empty());
    h.call(
        "todo.assign",
        json!({"id": 1, "owner": owner_of(&Actor::user()), "expected_change": 1}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn t17_same_owner_is_a_noop() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t", "owner": owner_of(&agent("a"))})).await;
    h.events();
    let touches = h.touches(1);
    let history = changes(&h, 1).await;
    h.call(
        "todo.assign",
        json!({"id": 1, "owner": owner_of(&agent("a"))}),
    )
    .await
    .unwrap();
    assert!(h.events().is_empty());
    assert_eq!(h.touches(1), touches);
    assert_eq!(changes(&h, 1).await, history);
    let missing = h
        .call("todo.assign", json!({"id": 9, "owner": null}))
        .await
        .unwrap_err();
    assert_eq!(missing.code, code::NOT_FOUND);
}
