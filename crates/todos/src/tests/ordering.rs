use super::*;

async fn order(h: &Harness) -> Vec<u64> {
    h.call("todo.list", json!(null))
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_u64().unwrap())
        .collect()
}

async fn four(h: &Harness) {
    for title in ["a", "b", "c", "d"] {
        h.call("todo.create", json!({"title": title}))
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn t10_a_new_todo_goes_last_after_a_reorder() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    four(&h).await;
    h.call("todo.reorder", json!({"id": 4, "before": 1}))
        .await
        .unwrap();
    h.call("todo.complete", json!({"id": 2})).await.unwrap();
    h.call_as(agent("a"), "todo.create", json!({"title": "e"}))
        .await
        .unwrap();
    assert_eq!(order(&h).await, [4, 1, 2, 3, 5]);
}

#[tokio::test]
async fn t10_completing_keeps_the_place_and_deleting_leaves_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    four(&h).await;
    h.call("todo.reorder", json!({"id": 3, "before": 1}))
        .await
        .unwrap();
    h.call("todo.complete", json!({"id": 3})).await.unwrap();
    assert_eq!(order(&h).await, [3, 1, 2, 4]);
    h.call("todo.delete", json!({"operation": "delete-1", "ids": [1]}))
        .await
        .unwrap();
    assert_eq!(order(&h).await, [3, 2, 4]);
    h.call("todo.setBlockers", json!({"id": 2, "blockers": [4]}))
        .await
        .unwrap();
    assert_eq!(order(&h).await, [3, 2, 4]);
}

#[tokio::test]
async fn t10_a_reorder_persists_across_open() {
    let dir = tempfile::tempdir().unwrap();
    {
        let h = Harness::new(dir.path());
        four(&h).await;
        h.call("todo.reorder", json!({"id": 4, "before": 2}))
            .await
            .unwrap();
    }
    let h = Harness::new(dir.path());
    assert_eq!(order(&h).await, [1, 4, 2, 3]);
}

#[tokio::test]
async fn t11_reorder_moves_before_or_last_and_returns_the_todo() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    four(&h).await;
    h.events();
    let moved = h
        .call("todo.reorder", json!({"id": 3, "before": 1}))
        .await
        .unwrap();
    assert_eq!(moved["id"], 3);
    assert_eq!(order(&h).await, [3, 1, 2, 4]);
    assert_eq!(h.events(), ["todo.updated 3"]);
    assert_eq!(h.touches(3).len(), 2, "create, then the reorder");
    h.call("todo.reorder", json!({"id": 3, "before": null}))
        .await
        .unwrap();
    assert_eq!(order(&h).await, [1, 2, 4, 3]);
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    h.call("todo.reorder", json!({"id": 4, "before": 1}))
        .await
        .unwrap();
    assert_eq!(order(&h).await, [4, 1, 2, 3]);
}

#[tokio::test]
async fn t11_moving_to_the_place_it_holds_is_a_no_op() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    four(&h).await;
    h.events();
    for (id, before) in [(2, json!(3)), (4, json!(null))] {
        let got = h
            .call("todo.reorder", json!({"id": id, "before": before}))
            .await
            .unwrap();
        assert_eq!(got["id"], id);
    }
    assert_eq!(order(&h).await, [1, 2, 3, 4]);
    assert!(h.events().is_empty());
    assert!(h.touches(2).len() == 1 && h.touches(4).len() == 1);
}

#[tokio::test]
async fn t11_a_rejected_reorder_leaves_no_trace() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    four(&h).await;
    h.events();
    for (params, want) in [
        (json!({"id": 9, "before": 1}), code::NOT_FOUND),
        (json!({"id": 1, "before": 9}), code::NOT_FOUND),
        (json!({"id": 2, "before": 2}), code::CONFLICT),
    ] {
        let err = h.call("todo.reorder", params).await.unwrap_err();
        assert_eq!(err.code, want);
    }
    assert_eq!(order(&h).await, [1, 2, 3, 4]);
    assert!(h.events().is_empty());
    assert!(h.touches(1).len() == 1 && h.touches(2).len() == 1);
}

#[tokio::test]
async fn t11_a_reorder_changes_no_other_field() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    four(&h).await;
    h.call("todo.setBlockers", json!({"id": 3, "blockers": [1]}))
        .await
        .unwrap();
    h.call("todo.complete", json!({"id": 3})).await.unwrap();
    let before = h.call("todo.get", json!({"id": 3})).await.unwrap();
    h.call("todo.reorder", json!({"id": 3, "before": 1}))
        .await
        .unwrap();
    assert_eq!(h.call("todo.get", json!({"id": 3})).await.unwrap(), before);
}

#[test]
fn t5642a_list_executes_three_reads() {
    use rusqlite::trace::{TraceEvent, TraceEventCodes};
    use std::cell::Cell;
    thread_local! { static READS: Cell<usize> = const { Cell::new(0) }; }
    for size in [0, 1, 1000] {
        let store = store::Store::open(&storage::fixture().unwrap().keep()).unwrap();
        store.db.execute(
            "WITH RECURSIVE n(id) AS (SELECT 1 WHERE ?1 > 0 UNION ALL SELECT id+1 FROM n WHERE id < ?1)
             INSERT INTO todos(id, title, body, created_at, pos) SELECT id, 'title', 'body', 1, id FROM n",
            [size],
        ).unwrap();
        READS.set(0);
        store.db.trace_v2(
            TraceEventCodes::SQLITE_TRACE_STMT,
            Some(|event| {
                if let TraceEvent::Stmt(_, sql) = event
                    && sql.trim_start().starts_with("SELECT")
                {
                    READS.set(READS.get() + 1);
                }
            }),
        );
        let started = std::time::Instant::now();
        let listed = store.list().unwrap();
        store.db.trace_v2(TraceEventCodes::empty(), None);
        assert_eq!(listed.len(), usize::try_from(size).unwrap());
        assert_eq!(READS.get(), 3, "size {size}");
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }
}

#[test]
fn t5642a_batched_list_matches_individual_reads() {
    let store = store::Store::open(&storage::fixture().unwrap().keep()).unwrap();
    for id in 1..=5 {
        store
            .insert(
                &format!("title {id}"),
                &format!("body {id}"),
                &[],
                &agent(&format!("maker {id}")),
                Some(&agent(&format!("owner {id}"))),
                None,
                0,
            )
            .unwrap();
    }
    store
        .db
        .execute_batch(
            "UPDATE todos SET pos = CASE id WHEN 4 THEN -1 WHEN 3 THEN 0 ELSE 1 END,
         done = (id = 1), home = 'workstream ' || id,
         priority = CASE id WHEN 1 THEN NULL WHEN 3 THEN '\"medium\"' WHEN 4 THEN '\"high\"' ELSE '\"urgent\"' END,
         created_at = id * 10, updated_at = id * 20;
         INSERT INTO blockers VALUES(4,3),(4,1),(4,2),(3,1);
         INSERT INTO todo_refs(todo,target,url) VALUES
         (4,'missing-pad','z-missing'),(4,'other','a-second'),(2,'deleted','deleted-ref');
         DELETE FROM todos WHERE id = 2;",
        )
        .unwrap();
    let expected: Vec<_> = [4, 3, 1, 5]
        .into_iter()
        .map(|id| store.get(id).unwrap())
        .collect();
    let history: Vec<_> = [4, 3, 1, 5]
        .into_iter()
        .map(|id| store.history(id).unwrap())
        .collect();
    let listed = store.list().unwrap();
    assert_eq!(listed, expected);
    assert_eq!(
        listed.iter().map(|t| t.id).collect::<Vec<_>>(),
        [4, 3, 1, 5]
    );
    assert_eq!(listed[0].blockers, [1, 3]);
    assert_eq!(listed[0].refs, ["z-missing", "a-second"]);
    assert!(listed[0].blocked);
    assert!(!listed[1].blocked, "done blocker is not blocking");
    assert!(listed[2].blockers.is_empty() && listed[2].refs.is_empty());
    for todo in &listed {
        assert_eq!(todo.title, format!("title {}", todo.id));
        assert_eq!(todo.body, format!("body {}", todo.id));
        assert_eq!(todo.created_at, i64::from(todo.id) * 10);
        assert_eq!(todo.updated_at, i64::from(todo.id) * 20);
        assert_eq!(todo.creator, agent(&format!("maker {}", todo.id)));
        assert_eq!(todo.owner, Some(agent(&format!("owner {}", todo.id))));
        assert_eq!(todo.home, Some(format!("workstream {}", todo.id)));
        assert_eq!(
            todo.priority,
            match todo.id {
                1 => None,
                3 => Some(contracts::todo::Priority::Medium),
                4 => Some(contracts::todo::Priority::High),
                5 => Some(contracts::todo::Priority::Urgent),
                _ => unreachable!(),
            }
        );
        assert_eq!(todo.done, todo.id == 1);
    }
    assert_eq!(store.list().unwrap(), listed);
    assert_eq!(
        [4, 3, 1, 5]
            .into_iter()
            .map(|id| store.history(id).unwrap())
            .collect::<Vec<_>>(),
        history
    );
}

#[test]
fn t5642a_list_preserves_the_callers_transaction() {
    let store = store::Store::open(&storage::fixture().unwrap().keep()).unwrap();
    for title in ["one", "two"] {
        store
            .insert(title, "body", &[], &Actor::user(), None, None, 0)
            .unwrap();
    }
    let before = store.list().unwrap();
    let tx = store.db.unchecked_transaction().unwrap();
    tx.execute_batch(
        "UPDATE todos SET body='uncommitted',pos=-1 WHERE id=2;
        INSERT INTO blockers VALUES(2,1);
        INSERT INTO todo_refs(todo,target,url) VALUES(2,'missing','uncommitted-ref');",
    )
    .unwrap();
    let listed = store.list().unwrap();
    assert_eq!(listed[0].id, 2);
    assert_eq!(listed[0].body, "uncommitted");
    assert_eq!(listed[0].blockers, [1]);
    assert!(listed[0].blocked);
    assert_eq!(listed[0].refs, ["uncommitted-ref"]);
    tx.rollback().unwrap();
    assert_eq!(store.list().unwrap(), before);
}
