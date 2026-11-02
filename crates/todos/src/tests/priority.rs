//! U4698c: optional Todo priority across public RPC and durable storage.
use super::*;

#[tokio::test]
async fn u4698c_priority_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    for priority in [
        json!(null),
        json!("low"),
        json!("medium"),
        json!("high"),
        json!("urgent"),
    ] {
        let mut h = Harness::new(dir.path());
        let todo = made(&h, json!({"title":"priority", "priority":priority})).await;
        assert_eq!(todo.get("priority"), Some(&priority));
        let id = todo["id"].clone();
        assert_eq!(h.event_data()["priority"], priority);
        assert_eq!(
            h.call("todo.get", json!({"id":id})).await.unwrap()["priority"],
            priority
        );
        assert_eq!(
            h.call("todo.list", json!(null))
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .last()
                .unwrap()["priority"],
            priority
        );

        drop(h);
        let h = Harness::new(dir.path());
        assert_eq!(
            h.call("todo.get", json!({"id":id})).await.unwrap()["priority"],
            priority
        );
    }
}

#[tokio::test]
async fn u4698c_invalid_priority_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    let original = made(&h, json!({"title":"kept"})).await;
    let history = changes(&h, 1).await;
    let touches = h.ctx.touches.sequence().unwrap();
    h.events();
    for bad in [
        json!(""),
        json!("Low"),
        json!("critical"),
        json!(0),
        json!(5),
        json!(1.5),
        json!(true),
        json!([]),
        json!({}),
    ] {
        for (method, params) in [
            ("todo.create", json!({"title":"wrong", "priority":bad})),
            (
                "todo.update",
                json!({"id":1, "title":"wrong", "priority":bad}),
            ),
        ] {
            assert_eq!(
                h.call(method, params).await.unwrap_err().code,
                code::INVALID_PARAMS
            );
        }
    }
    assert_eq!(
        h.call("todo.update", json!({"id":1}))
            .await
            .unwrap_err()
            .code,
        code::INVALID_PARAMS
    );
    assert_eq!(
        h.call("todo.list", json!(null)).await.unwrap(),
        json!([original])
    );
    assert_eq!(changes(&h, 1).await, history);
    assert_eq!(h.ctx.touches.sequence().unwrap(), touches);
    assert!(h.events().is_empty());
}

#[tokio::test]
async fn u4698c_priority_history_records_actual_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"original"})).await;
    for priority in [
        json!("low"),
        json!("medium"),
        json!("high"),
        json!("urgent"),
        json!(null),
    ] {
        let before = changes(&h, 1).await;
        let previous = before["changes"].as_array().unwrap().last().unwrap();
        h.events();
        let count = h.ctx.touches.sequence().unwrap();
        let reply = h
            .call_as(
                agent("writer"),
                "todo.update",
                json!({"id":1,"priority":priority}),
            )
            .await
            .unwrap();
        let after = changes(&h, 1).await;
        let last = after["changes"].as_array().unwrap().last().unwrap();
        assert_eq!(
            after["changes"].as_array().unwrap().len(),
            before["changes"].as_array().unwrap().len() + 1
        );
        assert_eq!(last["before"], previous["after"]);
        assert_eq!(last["after"]["priority"], priority);
        assert_eq!(last["actor"], owner_of(&agent("writer")));
        assert!(last["seq"].as_u64().unwrap() > previous["seq"].as_u64().unwrap());
        assert_eq!(last["changed_at"], reply["updated_at"]);
        assert_eq!(h.event_data(), reply);
        assert!(h.events().is_empty());
        assert_eq!(h.ctx.touches.sequence().unwrap(), count + 1);
        let count = h.ctx.touches.sequence().unwrap();
        let noop = h
            .call("todo.update", json!({"id":1,"priority":priority}))
            .await
            .unwrap();
        assert_eq!(noop, reply);
        assert_eq!(changes(&h, 1).await, after);
        assert_eq!(h.ctx.touches.sequence().unwrap(), count);
        assert!(h.events().is_empty());
    }
    let prior = changes(&h, 1).await;
    let count = h.ctx.touches.sequence().unwrap();
    let combined = h
        .call_as(
            agent("writer"),
            "todo.update",
            json!({"id":1,"title":"combined","body":"body","priority":"high"}),
        )
        .await
        .unwrap();
    let history = changes(&h, 1).await;
    let last = history["changes"].as_array().unwrap().last().unwrap();
    assert_eq!(
        history["changes"].as_array().unwrap().len(),
        prior["changes"].as_array().unwrap().len() + 1
    );
    assert_eq!(h.ctx.touches.sequence().unwrap(), count + 1);
    assert_eq!(h.event_data(), combined);
    assert!(h.events().is_empty());
    assert_eq!(last["after"]["title"], "combined");
    assert_eq!(last["after"]["body"], "body");
    assert_eq!(last["after"]["priority"], "high");
    h.events();
    let count = h.ctx.touches.sequence().unwrap();
    for (id, expected, code) in [(1, 0, code::CONFLICT), (999, 0, code::NOT_FOUND)] {
        assert_eq!(
            h.call(
                "todo.update",
                json!({"id":id,"priority":"low","expected_change":expected})
            )
            .await
            .unwrap_err()
            .code,
            code
        );
    }
    assert_eq!(changes(&h, 1).await, history);
    assert_eq!(h.ctx.touches.sequence().unwrap(), count);
    assert!(h.events().is_empty());
    drop(h);
    assert_eq!(
        changes(&Harness::new(dir.path()), 1).await["changes"],
        history["changes"]
    );
}

#[tokio::test]
async fn u4698c_other_mutations_keep_priority() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(
        &h,
        json!({"title":"t", "priority":"urgent", "owner":owner_of(&agent("a"))}),
    )
    .await;
    let other = made(&h, json!({"title":"other"})).await;
    for (method, params) in [
        ("todo.update", json!({"id":1,"title":"title","body":"body"})),
        ("todo.complete", json!({"id":1})),
        ("todo.reopen", json!({"id":1})),
        ("todo.assign", json!({"id":1,"owner":null})),
        ("todo.setBlockers", json!({"id":1,"blockers":[2]})),
        ("todo.move", json!({"id":1,"home":"home"})),
        ("todo.reorder", json!({"id":1,"before":null})),
    ] {
        h.call(method, params).await.unwrap();
        assert_eq!(
            h.call("todo.get", json!({"id":1})).await.unwrap()["priority"],
            "urgent"
        );
    }
    let before = h.call("todo.get", json!({"id":1})).await.unwrap();
    let after = h
        .call("todo.update", json!({"id":1,"priority":"low"}))
        .await
        .unwrap();
    for key in ["owner", "home", "blockers", "done"] {
        assert_eq!(before[key], after[key]);
    }
    assert_eq!(h.call("todo.get", json!({"id":2})).await.unwrap(), other);
    h.call(
        "todo.delete",
        json!({"operation":"priority-delete","ids":[1]}),
    )
    .await
    .unwrap();
    h.call("todo.restore", json!({"operation":"priority-delete"}))
        .await
        .unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["priority"],
        "low"
    );
}

#[tokio::test]
async fn u4698c_standalone_priority_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title":"current"})).await;
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["priority"],
        Value::Null
    );
    let old = changes(&h, 1).await["changes"][0].clone();
    h.call("todo.update", json!({"id":1,"priority":"high"}))
        .await
        .unwrap();
    drop(h);
    let h = Harness::new(dir.path());
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["priority"],
        "high"
    );
    assert_eq!(changes(&h, 1).await["changes"][0], old);
}

#[tokio::test]
async fn u4698c_current_reopen_keeps_retained_redo_authority() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title":"retained"})).await;
    h.call("todo.delete", json!({"operation":"old","ids":[1]}))
        .await
        .unwrap();
    let restored = h
        .call("todo.restore", json!({"operation":"old"}))
        .await
        .unwrap();
    drop(h);
    let h = Harness::new(dir.path());
    h.call(
        "todo.redo",
        json!({"source":"old","operation":"redo","restoration":restored["restoration"]}),
    )
    .await
    .unwrap();
    h.call("todo.restore", json!({"operation":"redo"}))
        .await
        .unwrap();
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["title"],
        "retained"
    );
    let source = h
        .call("todo.deletion", json!({"operation":"redo"}))
        .await
        .unwrap();
    h.call("todo.update", json!({"id":1,"priority":"urgent"}))
        .await
        .unwrap();
    assert_eq!(
        h.call(
            "todo.redo",
            json!({"source":"redo","operation":"unsafe","restoration":source["restoration"]})
        )
        .await
        .unwrap_err()
        .code,
        code::CONFLICT
    );
    assert_eq!(
        h.call("todo.get", json!({"id":1})).await.unwrap()["priority"],
        "urgent"
    );
}
