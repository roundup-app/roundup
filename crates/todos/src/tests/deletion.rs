use super::*;

#[tokio::test]
async fn u3787a_undo_restores_original_graph() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(
        &h,
        json!({"title":"first", "body":"retained", "owner":Actor::user(), "estimate_minutes":17}),
    )
    .await;
    made(&h, json!({"title":"dependent", "blockers":[1]})).await;
    h.call("todo.move", json!({"id":1,"home":"a"}))
        .await
        .unwrap();
    h.call("todo.move", json!({"id":2,"home":"b"}))
        .await
        .unwrap();
    h.call("todo.comment", json!({"id":1,"body":"keep me"}))
        .await
        .unwrap();
    let before = h.call("todo.list", Value::Null).await.unwrap();
    let history = changes(&h, 1).await;
    let comments = h.call("todo.comments", json!({"id":1})).await.unwrap();
    h.call("todo.delete", json!({"operation":"chosen","ids":[1]}))
        .await
        .unwrap();
    h.call("todo.restore", json!({"operation":"chosen"}))
        .await
        .unwrap();
    assert_eq!(h.call("todo.list", Value::Null).await.unwrap(), before);
    assert_eq!(changes(&h, 1).await, history);
    assert_eq!(
        h.call("todo.comments", json!({"id":1})).await.unwrap(),
        comments
    );
}
