use super::*;

const NOTES: &str = "roundup://pad/notes?project=k";

#[tokio::test]
async fn t27_refs_keep_order_and_one_per_target() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    h.events();
    let plan = format!("{NOTES}#Plan");
    for url in [&plan, &NOTES.to_string(), &format!("{NOTES}#plan")] {
        h.call_as(agent("a"), "todo.addRef", json!({"id": 1, "url": url}))
            .await
            .unwrap();
    }
    let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
    assert_eq!(todo["refs"], json!([plan, NOTES]));
    assert_eq!(h.events(), ["todo.refAdded 1", "todo.refAdded 1"]);
    // A ref is no Change: History keeps its creation entry and the Todo does not update.
    let history = h.call("todo.getHistory", json!({"id": 1})).await.unwrap();
    assert_eq!(history["changes"].as_array().unwrap().len(), 1);
    let by_a = h.touches(1).into_iter().filter(|(_, who)| who == "a");
    assert_eq!(
        by_a.collect::<Vec<_>>(),
        vec![(Verb::Wrote, "a".to_string()); 2]
    );
    h.call(
        "todo.removeRef",
        json!({"id": 1, "url": format!("{NOTES}#PLAN")}),
    )
    .await
    .unwrap();
    h.call(
        "todo.removeRef",
        json!({"id": 1, "url": format!("{NOTES}#PLAN")}),
    )
    .await
    .unwrap();
    let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
    assert_eq!(todo["refs"], json!([NOTES]));
    assert_eq!(h.events(), ["todo.refRemoved 1"]);
}

#[tokio::test]
async fn t27_refs_persist_and_delete_clears_them() {
    let dir = tempfile::tempdir().unwrap();

    {
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title":"current"}))
            .await
            .unwrap();
        let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
        assert_eq!(todo["refs"], json!([]));
        h.call("todo.addRef", json!({"id": 1, "url": NOTES}))
            .await
            .unwrap();
    }
    let h = Harness::new(dir.path());
    let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
    assert_eq!(todo["refs"], json!([NOTES]));
    h.call("todo.delete", json!({"operation": "delete-1", "ids": [1]}))
        .await
        .unwrap();
    let rows: i64 = rusqlite::Connection::open(dir.path().join("todos.db"))
        .unwrap()
        .query_row("SELECT count(*) FROM todo_refs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0);
}
