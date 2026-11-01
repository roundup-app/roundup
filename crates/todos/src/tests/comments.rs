use super::*;

#[tokio::test]
async fn t20_comments_read_oldest_first_with_their_author() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
    let history = changes(&h, 1).await;
    h.events();
    let before = h.touches(1);
    h.call("todo.comment", json!({"id": 1, "body": "first"}))
        .await
        .unwrap();
    h.call_as(
        agent("a"),
        "todo.comment",
        json!({"id": 1, "body": "second"}),
    )
    .await
    .unwrap();
    let thread = h.call("todo.comments", json!({"id": 1})).await.unwrap();
    let lines: Vec<_> = thread
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["body"].as_str().unwrap(),
                c["author"]["id"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(lines, [("first", "you"), ("second", "a")]);
    assert_eq!(thread[1]["author"]["kind"], "agent");
    assert!(thread[0]["created_at"].as_i64().unwrap() > 0);
    assert_eq!(h.events(), ["todo.commented 1", "todo.commented 1"]);
    let mut expected = before;
    expected.push((Verb::Wrote, "you".to_string()));
    expected.push((Verb::Wrote, "a".to_string()));
    assert_eq!(h.touches(1), expected);
    assert_eq!(h.call("todo.get", json!({"id": 1})).await.unwrap(), todo);
    assert_eq!(changes(&h, 1).await["changes"], history["changes"]);
}

#[tokio::test]
async fn t20_a_rejected_comment_leaves_no_trace() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    h.events();
    let touches = h.touches(1);
    for body in ["", "  \n "] {
        let err = h
            .call("todo.comment", json!({"id": 1, "body": body}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }
    let err = h
        .call("todo.comment", json!({"id": 9, "body": "x"}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    assert!(h.events().is_empty());
    assert_eq!(h.touches(1), touches);
    let thread = h.call("todo.comments", json!({"id": 1})).await.unwrap();
    assert_eq!(thread, json!([]));
}

#[tokio::test]
async fn t20_comments_persist() {
    let dir = tempfile::tempdir().unwrap();

    let thread = {
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title":"current"}))
            .await
            .unwrap();
        assert_eq!(
            h.call("todo.comments", json!({"id": 1})).await.unwrap(),
            json!([])
        );
        h.call("todo.comment", json!({"id": 1, "body": "kept"}))
            .await
            .unwrap();
        h.call("todo.comments", json!({"id": 1})).await.unwrap()
    };
    let h = Harness::new(dir.path());
    assert_eq!(
        h.call("todo.comments", json!({"id": 1})).await.unwrap(),
        thread
    );
    assert_eq!(thread[0]["body"], "kept");
}

#[tokio::test]
async fn t20_delete_removes_the_comments() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    h.call_as(agent("a"), "todo.comment", json!({"id": 1, "body": "q?"}))
        .await
        .unwrap();
    h.call("todo.delete", json!({"operation": "delete-1", "ids": [1]}))
        .await
        .unwrap();
    assert_eq!(h.call("todo.unread", json!({})).await.unwrap(), json!([]));
    made(&h, json!({"title": "again"})).await;
    // A new Todo never inherits the deleted one's thread.
    assert_eq!(
        h.call("todo.comments", json!({"id": 2})).await.unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn t21_a_long_or_multi_line_agent_comment_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    for body in ["x".repeat(281), "one\ntwo".to_string()] {
        let err = h
            .call_as(agent("a"), "todo.comment", json!({"id": 1, "body": body}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }
    h.call_as(
        agent("a"),
        "todo.comment",
        json!({"id": 1, "body": "x".repeat(280)}),
    )
    .await
    .unwrap();
    // The user's thread line may be long and hold newlines.
    h.call(
        "todo.comment",
        json!({"id": 1, "body": format!("{}\nmore", "y".repeat(400))}),
    )
    .await
    .unwrap();
    assert_eq!(
        h.call("todo.comments", json!({"id": 1}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn t23_an_agent_comment_is_unread_and_a_user_comment_is_read() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "ship"})).await;
    h.call("todo.comment", json!({"id": 1, "body": "mine"}))
        .await
        .unwrap();
    h.call_as(agent("a"), "todo.comment", json!({"id": 1, "body": "q?"}))
        .await
        .unwrap();
    let thread = h.call("todo.comments", json!({"id": 1})).await.unwrap();
    assert_eq!(
        (&thread[0]["read"], &thread[1]["read"]),
        (&json!(true), &json!(false))
    );
    let unread = h.call("todo.unread", json!({})).await.unwrap();
    assert_eq!(unread.as_array().unwrap().len(), 1);
    assert_eq!(unread[0]["todo"], 1);
    assert_eq!(unread[0]["title"], "ship");
    assert_eq!(unread[0]["comment"]["author"]["id"], "a");
}

#[tokio::test]
async fn t23_mark_read_is_idempotent_and_emits_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "ship"})).await;
    h.call_as(agent("a"), "todo.comment", json!({"id": 1, "body": "q?"}))
        .await
        .unwrap();
    h.events();
    let touches = h.touches(1);
    let history = changes(&h, 1).await;
    for _ in 0..2 {
        h.call("todo.markCommentsRead", json!({"id": 1}))
            .await
            .unwrap();
    }
    assert_eq!(h.events(), ["todo.commentsRead 1"]);
    assert_eq!(h.touches(1), touches);
    assert_eq!(changes(&h, 1).await, history);
    let thread = h.call("todo.comments", json!({"id": 1})).await.unwrap();
    assert_eq!(thread[0]["read"], true);
    assert_eq!(h.call("todo.unread", json!({})).await.unwrap(), json!([]));
}

#[tokio::test]
async fn t23_unread_persists_and_delete_clears_it() {
    let dir = tempfile::tempdir().unwrap();
    {
        let h = Harness::new(dir.path());
        made(&h, json!({"title": "a"})).await;
        made(&h, json!({"title": "b"})).await;
        for id in [1, 2] {
            h.call_as(agent("a"), "todo.comment", json!({"id": id, "body": "q?"}))
                .await
                .unwrap();
        }
        h.call("todo.markCommentsRead", json!({"id": 2}))
            .await
            .unwrap();
    }
    let h = Harness::new(dir.path());
    let unread = h.call("todo.unread", json!({})).await.unwrap();
    assert_eq!(unread.as_array().unwrap().len(), 1);
    h.call("todo.delete", json!({"operation": "delete-1", "ids": [1]}))
        .await
        .unwrap();
    assert_eq!(h.call("todo.unread", json!({})).await.unwrap(), json!([]));
}

#[tokio::test]
async fn t23_listing_never_marks_read() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "a"})).await;
    h.call_as(agent("a"), "todo.comment", json!({"id": 1, "body": "q?"}))
        .await
        .unwrap();
    h.events();
    h.call("todo.comments", json!({"id": 1})).await.unwrap();
    h.call("todo.get", json!({"id": 1})).await.unwrap();
    assert_eq!(
        h.call("todo.unread", json!({}))
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(h.events().is_empty());
}
