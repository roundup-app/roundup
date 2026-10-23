//! T29: a Todo has an estimate.
use super::*;

async fn estimate_of(h: &Harness) -> Value {
    h.call("todo.get", json!({"id": 1})).await.unwrap()["estimate_minutes"].clone()
}

#[tokio::test]
async fn t29_estimate_set_and_cleared_with_history() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    let created = made(&h, json!({"title": "t", "estimate_minutes": 10})).await;
    assert_eq!(created["estimate_minutes"], 10);
    assert_eq!(h.event_data()["estimate_minutes"], 10);
    let plain = made(&h, json!({"title": "u"})).await;
    assert_eq!(plain["estimate_minutes"], Value::Null);
    h.events();
    h.call("todo.update", json!({"id": 2, "estimate_minutes": 45}))
        .await
        .unwrap();
    assert_eq!(h.events(), ["todo.updated 2"]);
    assert_eq!(h.touches(2).len(), 2);
    let mut expected = plain.clone();
    expected["estimate_minutes"] = json!(45);
    assert_eq!(
        h.call("todo.get", json!({"id": 2})).await.unwrap(),
        expected
    );
    let last = changes(&h, 2).await["changes"][1].clone();
    assert_eq!(last["before"]["estimate_minutes"], Value::Null);
    assert_eq!(last["after"]["estimate_minutes"], 45);
    h.call("todo.update", json!({"id": 2, "title": "v"}))
        .await
        .unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id": 2})).await.unwrap()["estimate_minutes"],
        45
    );
    h.call("todo.update", json!({"id": 2, "estimate_minutes": null}))
        .await
        .unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id": 2})).await.unwrap()["estimate_minutes"],
        Value::Null
    );
}

#[tokio::test]
async fn t29_same_estimate_is_a_no_op() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t", "estimate_minutes": 45})).await;
    h.events();
    h.call("todo.update", json!({"id": 1, "estimate_minutes": 45}))
        .await
        .unwrap();
    assert!(h.events().is_empty());
    assert_eq!(h.touches(1).len(), 1);
    assert_eq!(changes(&h, 1).await["changes"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn t29_invalid_estimate_is_rejected_without_trace() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t", "estimate_minutes": 5})).await;
    h.events();
    for bad in [json!(0), json!(1441), json!(1.5), json!(-3), json!("9")] {
        let update = h
            .call("todo.update", json!({"id": 1, "estimate_minutes": bad}))
            .await
            .unwrap_err();
        assert_eq!(update.code, code::INVALID_PARAMS, "{bad}");
        let create = h
            .call(
                "todo.create",
                json!({"title": "x", "estimate_minutes": bad}),
            )
            .await
            .unwrap_err();
        assert_eq!(create.code, code::INVALID_PARAMS, "{bad}");
    }
    assert!(h.events().is_empty());
    assert_eq!(h.touches(1).len(), 1);
    assert_eq!(changes(&h, 1).await["changes"].as_array().unwrap().len(), 1);
    assert_eq!(
        h.call("todo.list", json!(null))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(estimate_of(&h).await, 5);
    for ok in [1, 1440] {
        h.call("todo.update", json!({"id": 1, "estimate_minutes": ok}))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn t29_estimate_survives_open_and_old_db_reads_null() {
    let dir = tempfile::tempdir().unwrap();
    {
        let h = Harness::new(dir.path());
        made(&h, json!({"title": "t", "estimate_minutes": 30})).await;
    }
    assert_eq!(estimate_of(&Harness::new(dir.path())).await, 30);
    // A database written by the migrations before this field.
    let old = tempfile::tempdir().unwrap();
    let db = rusqlite::Connection::open(old.path().join("todos.db")).unwrap();
    db.execute_batch(include_str!("../../migrations/001/up.sql"))
        .unwrap();
    db.pragma_update(None, "user_version", 1).unwrap();
    db.execute(
        "INSERT INTO todos (title, body, created_at) VALUES ('old', '', 1)",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO changes (todo, after_values, after_touch) VALUES (1, '{\"title\":\"old\",\"body\":\"\",\"done\":false,\"blockers\":[]}', 0)",
        [],
    )
    .unwrap();
    drop(db);
    let h = Harness::new(old.path());
    assert_eq!(estimate_of(&h).await, Value::Null);
    assert_eq!(
        changes(&h, 1).await["changes"][0]["after"]["estimate_minutes"],
        Value::Null
    );
}

#[tokio::test]
async fn t29_other_todo_methods_keep_the_estimate() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t", "estimate_minutes": 20})).await;
    made(&h, json!({"title": "u"})).await;
    for (method, params) in [
        ("todo.setBlockers", json!({"id": 1, "blockers": [2]})),
        (
            "todo.assign",
            json!({"id": 1, "owner": owner_of(&agent("a"))}),
        ),
        ("todo.move", json!({"id": 1, "home": "r1"})),
        ("todo.reorder", json!({"id": 1, "before": null})),
        ("todo.update", json!({"id": 1, "title": "x"})),
        ("todo.complete", json!({"id": 1})),
    ] {
        h.call_as(Actor::user(), method, params).await.unwrap();
        assert_eq!(estimate_of(&h).await, 20, "{method}");
    }
}
