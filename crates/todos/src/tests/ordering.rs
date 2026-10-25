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
