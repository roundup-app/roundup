// T4902 retires T29 duration setup; all non-duration scenario proofs below remain.
//! T30: a Todo carries the time of its last change.
use super::*;

async fn get(h: &Harness, id: u32) -> Value {
    h.call("todo.get", json!({"id": id})).await.unwrap()
}

async fn stamp(h: &Harness, id: u32) -> i64 {
    get(h, id).await["updated_at"].as_i64().unwrap()
}

async fn tick() {
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
}

#[tokio::test]
async fn t30_create_sets_updated_at_to_created_at() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    let todo = made(&h, json!({"title": "t"})).await;
    assert_eq!(todo["updated_at"], todo["created_at"]);
}

#[tokio::test]
async fn t30_each_of_title_body_done_owner_and_blockers_moves_updated_at() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    made(&h, json!({"title": "u"})).await;
    let me = owner_of(&Actor::user());
    let calls = [
        ("todo.update", json!({"id": 1, "title": "x"})),
        ("todo.update", json!({"id": 1, "body": "y"})),
        ("todo.update", json!({"id": 1, "priority": "high"})),
        ("todo.complete", json!({"id": 1})),
        ("todo.assign", json!({"id": 1, "owner": me})),
        ("todo.setBlockers", json!({"id": 1, "blockers": [2]})),
    ];
    for (method, params) in calls {
        let before = stamp(&h, 1).await;
        tick().await;
        h.events();
        let reply = h.call(method, params).await.unwrap();
        let after = stamp(&h, 1).await;
        assert!(after > before, "{method} moves updated_at");
        assert_eq!(reply["updated_at"], after);
        assert_eq!(h.event_data()["updated_at"], after);
        let changes = changes(&h, 1).await["changes"].clone();
        assert_eq!(
            changes.as_array().unwrap().last().unwrap()["changed_at"],
            after
        );
    }
}

#[tokio::test]
async fn t30_reads_and_no_op_writes_keep_updated_at() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    made(&h, json!({"title": "u"})).await;
    h.call("todo.update", json!({"id": 1, "title": "x"}))
        .await
        .unwrap();
    h.call("todo.setBlockers", json!({"id": 2, "blockers": [1]}))
        .await
        .unwrap();
    let first = stamp(&h, 1).await;
    let second = stamp(&h, 2).await;
    tick().await;
    for (method, params) in [
        ("todo.list", json!({})),
        ("todo.getHistory", json!({"id": 1})),
        ("todo.comments", json!({"id": 1})),
        ("todo.reorder", json!({"id": 1, "before": null})),
        ("todo.update", json!({"id": 1, "title": "x"})),
        ("todo.setBlockers", json!({"id": 2, "blockers": [1]})),
        ("todo.complete", json!({"id": 1})),
    ] {
        let _ = h.call(method, params).await;
    }
    assert_eq!(
        stamp(&h, 2).await,
        second,
        "a dependent that unblocks keeps it"
    );
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert!(stamp(&h, 1).await >= first);
    let done = stamp(&h, 1).await;
    tick().await;
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(stamp(&h, 1).await, done);
}

#[tokio::test]
async fn t30_updated_at_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let moved = {
        let h = Harness::new(dir.path());
        made(&h, json!({"title": "t"})).await;
        tick().await;
        h.call("todo.update", json!({"id": 1, "body": "b"}))
            .await
            .unwrap();
        stamp(&h, 1).await
    };
    let h = Harness::new(dir.path());
    assert_eq!(stamp(&h, 1).await, moved);
    assert!(moved > get(&h, 1).await["created_at"].as_i64().unwrap());
}

#[tokio::test]
async fn t30_an_old_todos_db_reads_its_latest_change_time() {
    let old = tempfile::tempdir().unwrap();
    let db = rusqlite::Connection::open(old.path().join("todos.db")).unwrap();
    for sql in [
        include_str!("../../migrations/001/up.sql"),
        include_str!("../../migrations/002/up.sql"),
        include_str!("../../migrations/003/up.sql"),
        include_str!("../../migrations/004/up.sql"),
        include_str!("../../migrations/005/up.sql"),
        include_str!("../../migrations/006/up.sql"),
        include_str!("../../migrations/007/up.sql"),
        "-- T4902: retired T29; retain the migration slot.",
        include_str!("../../migrations/009/up.sql"),
    ] {
        db.execute_batch(sql).unwrap();
    }
    db.pragma_update(None, "user_version", 9).unwrap();
    for id in 1..=2 {
        db.execute(
            "INSERT INTO todos (title, body, created_at) VALUES ('old', '', 10)",
            [],
        )
        .unwrap();
        let values = format!(
            "{{\"title\":\"old\",\"body\":\"\",\"done\":false,\"blockers\":[],\"id\":{id}}}"
        );
        if id == 1 {
            for at in [20, 50, 30] {
                db.execute(
                    "INSERT INTO changes (todo, after_values, after_touch, changed_at) VALUES (?1, ?2, 0, ?3)",
                    rusqlite::params![id, values, at],
                )
                .unwrap();
            }
        }
    }
    drop(db);
    let h = Harness::new(old.path());
    assert_eq!(stamp(&h, 1).await, 50);
    assert_eq!(stamp(&h, 2).await, 10);
    assert_eq!(changes(&h, 1).await["changes"].as_array().unwrap().len(), 3);
}
