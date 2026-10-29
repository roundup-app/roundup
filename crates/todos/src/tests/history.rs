use super::*;

#[tokio::test]
async fn t19_reopen_preserves_identity_fields_and_order() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(
        &h,
        json!({"title":"ship", "body":"details", "owner": owner_of(&agent("a"))}),
    )
    .await;
    made(&h, json!({"title":"other"})).await;
    h.call("todo.move", json!({"id":1,"home":"r1"}))
        .await
        .unwrap();
    h.call("todo.reorder", json!({"id":1,"before":null}))
        .await
        .unwrap();
    h.call("todo.complete", json!({"id":1})).await.unwrap();
    let mut expected = h.call("todo.list", json!({})).await.unwrap();
    expected[1]["done"] = json!(false);
    let reopened = h.call("todo.reopen", json!({"id":1})).await.unwrap();
    expected[1]["updated_at"] = reopened["updated_at"].clone();
    assert_eq!(reopened, expected[1]);
    assert_eq!(h.call("todo.get", json!({"id":1})).await.unwrap(), reopened);
    assert_eq!(h.call("todo.list", json!({})).await.unwrap(), expected);
}

#[tokio::test]
async fn t19_reopen_history_and_provenance_name_the_caller() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"blocker"})).await;
    made(&h, json!({"title":"dependent", "blockers":[1]})).await;
    h.call("todo.complete", json!({"id":1})).await.unwrap();
    let dependent = changes(&h, 2).await;
    let touches = h.touches(2);
    h.events();
    let caller = agent("a");
    let reopened = h
        .call_as(
            caller.clone(),
            "todo.reopen",
            json!({"id":1,"actor":Actor::user()}),
        )
        .await
        .unwrap();
    let event = h.events.try_recv().unwrap();
    assert_eq!(event.actor, caller);
    assert!(
        matches!(event.data, EventData::TodoUpdated(todo) if serde_json::to_value(&todo).unwrap() == reopened)
    );
    assert!(h.events().is_empty());
    let history = changes(&h, 1).await;
    let entries = history["changes"].as_array().unwrap();
    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0]["actor"], json!(Actor::user()));
    assert_eq!(entries[2]["actor"], json!(caller));
    assert_eq!(entries[2]["before"]["done"], true);
    assert_eq!(entries[2]["after"]["done"], false);
    assert_eq!(
        h.touches(1),
        vec![
            (Verb::Wrote, "you".into()),
            (Verb::Wrote, "you".into()),
            (Verb::Wrote, "a".into())
        ]
    );
    assert_eq!(changes(&h, 2).await, dependent);
    assert_eq!(h.touches(2), touches);
}

#[tokio::test]
async fn t19_open_reopen_is_a_noop() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    let todo = made(&h, json!({"title":"open"})).await;
    let history = changes(&h, 1).await;
    let touches = h.touches(1);
    h.events();
    assert_eq!(h.call("todo.reopen", json!({"id":1})).await.unwrap(), todo);
    assert_eq!(changes(&h, 1).await, history);
    assert_eq!(h.touches(1), touches);
    assert!(h.events().is_empty());
}

#[tokio::test]
async fn t19_unknown_id_leaves_no_trace() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"kept"})).await;
    let list = h.call("todo.list", json!({})).await.unwrap();
    let history = changes(&h, 1).await;
    h.events();
    assert_eq!(
        h.call("todo.reopen", json!({"id":99}))
            .await
            .unwrap_err()
            .code,
        code::NOT_FOUND
    );
    assert_eq!(h.call("todo.list", json!({})).await.unwrap(), list);
    assert_eq!(changes(&h, 1).await, history);
    assert!(h.touches(99).is_empty());
    assert!(h.events().is_empty());
}

#[tokio::test]
async fn t19_reopen_reblocks_dependents_and_can_complete_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"own blocker"})).await;
    made(&h, json!({"title":"reopen", "blockers":[1]})).await;
    made(&h, json!({"title":"dependent", "blockers":[2]})).await;
    made(&h, json!({"title":"done dependent", "blockers":[2]})).await;
    for id in [2, 4] {
        h.call("todo.complete", json!({"id":id})).await.unwrap();
    }
    h.events();
    let reopened = h.call("todo.reopen", json!({"id":2})).await.unwrap();
    assert_eq!(reopened["blocked"], true);
    let list = h.call("todo.list", json!({})).await.unwrap();
    assert_eq!(list[2]["blocked"], true);
    assert_eq!(list[2]["done"], false);
    assert_eq!(list[3]["blocked"], true);
    assert_eq!(list[3]["done"], true);
    assert_eq!(h.events(), ["todo.updated 2"]);
    h.call("todo.complete", json!({"id":2})).await.unwrap();
    assert_eq!(
        h.events(),
        ["todo.updated 2", "todo.unblocked 3", "todo.unblocked 4"]
    );
}

#[tokio::test]
async fn t19_reopen_and_actor_survive_restart() {
    let dir = tempfile::tempdir().unwrap();
    let before = {
        let h = Harness::new(dir.path());
        made(&h, json!({"title":"ship"})).await;
        h.call("todo.complete", json!({"id":1})).await.unwrap();
        h.call_as(agent("a"), "todo.reopen", json!({"id":1}))
            .await
            .unwrap();
        changes(&h, 1).await["changes"].clone()
    };
    let h = Harness::new(dir.path());
    assert_eq!(
        h.call("todo.list", json!({})).await.unwrap()[0]["done"],
        false
    );
    assert_eq!(changes(&h, 1).await["changes"], before);
    assert_eq!(before[2]["actor"], json!(agent("a")));
}

#[tokio::test]
async fn t19_failed_history_preserves_done_state() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title":"done"})).await;
    h.call("todo.complete", json!({"id":1})).await.unwrap();
    let before = changes(&h, 1).await;
    let touches = h.touches(1);
    h.events();
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'history failed'); END;").unwrap();
    assert!(h.call("todo.reopen", json!({"id":1})).await.is_err());
    assert_eq!(
        h.call("todo.list", json!({})).await.unwrap()[0]["done"],
        true
    );
    assert_eq!(changes(&h, 1).await, before);
    assert_eq!(h.touches(1), touches);
    assert!(h.events().is_empty());
}

#[tokio::test]
async fn t19_legacy_history_keeps_unknown_actor() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    rusqlite_migration::Migrations::new(vec![
        rusqlite_migration::M::up(include_str!("../../migrations/001/up.sql")),
        rusqlite_migration::M::up(include_str!("../../migrations/002/up.sql")),
    ])
    .to_latest(&mut db)
    .unwrap();
    db.execute_batch("INSERT INTO todos (title,body,created_at) VALUES ('old','',0); INSERT INTO changes(todo,after_values,after_touch) VALUES (1,'{\"title\":\"old\",\"body\":\"\",\"done\":false,\"blockers\":[]}',0);").unwrap();
    drop(db);
    let h = Harness::new(dir.path());
    assert_eq!(changes(&h, 1).await["changes"][0]["actor"], Value::Null);
    h.call("todo.complete", json!({"id":1})).await.unwrap();
    assert_eq!(
        changes(&h, 1).await["changes"][1]["actor"],
        json!(Actor::user())
    );
}

#[tokio::test]
async fn t15_initial_values_and_field_changes() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call(
        "todo.create",
        json!({"title": "First", "body": "one\n two"}),
    )
    .await
    .unwrap();
    h.call("todo.update", json!({"id": 1, "body": "three\nfour"}))
        .await
        .unwrap();
    let history = h.call("todo.getHistory", json!({"id": 1})).await.unwrap();
    assert_eq!(history["changes"].as_array().unwrap().len(), 2);
    assert_eq!(history["changes"][0]["after"]["title"], "First");
    assert_eq!(history["changes"][1]["before"]["body"], "one\n two");
    assert_eq!(history["changes"][1]["after"]["body"], "three\nfour");
    assert_eq!(history["unread"], history["changes"][0]["seq"]);
}

#[tokio::test]
async fn t15_combined_update_is_one_change() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a", "body": "b"}))
        .await
        .unwrap();
    h.call(
        "todo.update",
        json!({"id": 1, "title": "new", "body": "full\nbody"}),
    )
    .await
    .unwrap();
    let history = changes(&h, 1).await;
    assert_eq!(history["changes"].as_array().unwrap().len(), 2);
    assert_eq!(history["changes"][1]["before"]["title"], "a");
    assert_eq!(history["changes"][1]["after"]["body"], "full\nbody");
}

#[tokio::test]
async fn t15_noops_and_rejections_add_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    let before = changes(&h, 1).await;
    h.call("todo.update", json!({"id": 1, "title": "a"}))
        .await
        .unwrap();
    h.call("todo.setBlockers", json!({"id": 1, "blockers": []}))
        .await
        .unwrap();
    assert!(
        h.call("todo.setBlockers", json!({"id": 1, "blockers": [1]}))
            .await
            .is_err()
    );
    assert!(h.call("todo.update", json!({"id": 1})).await.is_err());
    assert_eq!(changes(&h, 1).await, before);
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    let done = changes(&h, 1).await;
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(changes(&h, 1).await, done);
}

#[tokio::test]
async fn t15_reads_reorder_and_move_add_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.create", json!({"title": "b"})).await.unwrap();
    let before = changes(&h, 1).await["changes"].clone();
    h.call("todo.get", json!({"id": 1})).await.unwrap();
    h.call("todo.reorder", json!({"id": 1, "before": null}))
        .await
        .unwrap();
    h.call("todo.move", json!({"id": 1, "home": "workstream-1"}))
        .await
        .unwrap();
    assert_eq!(changes(&h, 1).await["changes"], before);
}

#[tokio::test]
async fn t15_deleted_blocker_is_recorded() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    for title in ["a", "b"] {
        h.call("todo.create", json!({"title": title}))
            .await
            .unwrap();
    }
    h.call("todo.setBlockers", json!({"id": 2, "blockers": [1]}))
        .await
        .unwrap();
    let before = changes(&h, 2).await["changes"].clone();
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(changes(&h, 2).await["changes"], before);
    h.call("todo.delete", json!({"operation": "delete-1", "ids": [1]}))
        .await
        .unwrap();
    let history = changes(&h, 2).await;
    let last = history["changes"].as_array().unwrap().last().unwrap();
    assert_eq!(last["before"]["blockers"], json!([1]));
    assert_eq!(last["after"]["blockers"], json!([]));
}

#[tokio::test]
async fn t15_restart_retains_history() {
    let dir = tempfile::tempdir().unwrap();
    let before = {
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.call("todo.update", json!({"id": 1, "body": "many\nlines"}))
            .await
            .unwrap();
        h.call("todo.complete", json!({"id": 1})).await.unwrap();
        changes(&h, 1).await["changes"].clone()
    };
    assert_eq!(
        changes(&Harness::new(dir.path()), 1).await["changes"],
        before
    );
}

#[tokio::test]
async fn t15_restart_retains_change_time() {
    let dir = tempfile::tempdir().unwrap();
    let (start, stored) = {
        let h = Harness::new(dir.path());
        let start = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.call("todo.complete", json!({"id": 1})).await.unwrap();
        (start, changes(&h, 1).await["changes"].clone())
    };
    let reopened = changes(&Harness::new(dir.path()), 1).await["changes"].clone();
    assert_eq!(reopened, stored);
    for change in reopened.as_array().unwrap() {
        assert!(change["changed_at"].as_i64().unwrap() >= start);
    }
}

#[tokio::test]
async fn t15_unknown_todo_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    assert_eq!(
        h.call("todo.getHistory", json!({"id": 99}))
            .await
            .unwrap_err()
            .code,
        code::NOT_FOUND
    );
}

#[tokio::test]
async fn t15_history_failure_leaves_no_unrecorded_mutation() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    let before = changes(&h, 1).await;
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON changes BEGIN SELECT RAISE(ABORT, 'history failed'); END;").unwrap();
    for (method, params) in [
        ("todo.update", json!({"id": 1, "title": "lost"})),
        ("todo.complete", json!({"id": 1})),
        ("todo.create", json!({"title": "lost"})),
    ] {
        assert!(h.call(method, params).await.is_err());
    }
    assert_eq!(
        h.call("todo.list", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(changes(&h, 1).await, before);
    assert_eq!(
        Harness::new(dir.path())
            .call("todo.list", json!({}))
            .await
            .unwrap()[0]["title"],
        "a"
    );
}

#[tokio::test]
async fn t15_equal_time_reads_and_changes_keep_order() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    let touches_path = dir.path().join("touches.db");
    let mut h = h;
    h.ctx.touches = Arc::new(Touches::open(&touches_path).unwrap());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.get", json!({"id": 1})).await.unwrap();
    h.call_as(agent("a"), "todo.update", json!({"id": 1, "body": "new"}))
        .await
        .unwrap();
    let db = rusqlite::Connection::open(&touches_path).unwrap();
    db.execute("UPDATE touches SET at = 0", []).unwrap();
    let history = changes(&h, 1).await;
    assert_eq!(history["unread"], history["changes"][1]["seq"]);
    h.call_as(agent("a"), "todo.get", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(changes(&h, 1).await["unread"], history["unread"]);
}

#[tokio::test]
async fn t15_opening_read_does_not_acknowledge_a_later_change() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    let fetched = changes(&h, 1).await;
    assert_eq!(h.touches(1).len(), 1);
    h.call_as(agent("a"), "todo.update", json!({"id": 1, "body": "later"}))
        .await
        .unwrap();
    h.call(
        "todo.readHistory",
        json!({"id": 1, "through": fetched["changes"][0]["seq"]}),
    )
    .await
    .unwrap();
    let history = changes(&h, 1).await;
    assert_eq!(history["unread"], history["changes"][1]["seq"]);
    assert_eq!(
        h.call("todo.readHistory", json!({"id": 1, "through": 999}))
            .await
            .unwrap_err()
            .code,
        code::INVALID_PARAMS
    );
}

#[tokio::test]
async fn t15_list_does_not_load_history() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    for n in 0..1000 {
        h.call("todo.update", json!({"id": 1, "body": n.to_string()}))
            .await
            .unwrap();
    }
    let db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
    db.execute("UPDATE changes SET after_values = 'unreadable'", [])
        .unwrap();
    let list = h.call("todo.list", json!({})).await.unwrap();
    assert_eq!(list[0]["body"], "999");
    assert!(list[0].get("changes").is_none());
    assert!(h.call("todo.getHistory", json!({"id": 1})).await.is_err());
}
