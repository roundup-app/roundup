//! T7708a: a Todo links one pull request. T7708c: a merge completes it as the Daemon, once.
use super::*;

fn daemon(h: &Harness) -> Ctx {
    Ctx {
        actor: Actor::daemon(),
        bus: h.ctx.bus.clone(),
        touches: h.ctx.touches.clone(),
    }
}

#[tokio::test]
async fn t7708a_create_and_update_set_keep_and_clear_the_link() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    assert_eq!(made(&h, json!({"title": "t"})).await["pr"], Value::Null);
    let todo = made(&h, json!({"title": "u", "pr": 12})).await;
    assert_eq!(todo["pr"], 12);
    let kept = h
        .call("todo.update", json!({"id": 2, "title": "v"}))
        .await
        .unwrap();
    assert_eq!(kept["pr"], 12);
    let set = h
        .call("todo.update", json!({"id": 1, "pr": 5}))
        .await
        .unwrap();
    assert_eq!(set["pr"], 5);
    let cleared = h
        .call("todo.update", json!({"id": 1, "pr": null}))
        .await
        .unwrap();
    assert_eq!(cleared["pr"], Value::Null);
    let listed = h.call("todo.list", Value::Null).await.unwrap();
    assert_eq!(listed[1]["pr"], 12);
}

#[tokio::test]
async fn t7708a_a_bad_number_is_invalid_params_and_leaves_no_trace() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    h.events();
    for (method, params) in [
        ("todo.create", json!({"title": "x", "pr": 0})),
        ("todo.update", json!({"id": 1, "pr": 0})),
        ("todo.update", json!({"id": 1, "pr": -3})),
    ] {
        let err = h.call(method, params).await.unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
    }
    assert_eq!(h.events(), Vec::<String>::new());
    assert_eq!(wrote(&h), 1);
    assert_eq!(
        h.call("todo.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn t7708a_the_link_adds_no_change_and_keeps_updated_at() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "t"})).await;
    let stamp = get_updated(&h).await;
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    h.events();
    h.call("todo.update", json!({"id": 1, "pr": 9}))
        .await
        .unwrap();
    assert_eq!(h.events(), ["todo.updated 1"]);
    assert_eq!(wrote(&h), 2);
    assert_eq!(get_updated(&h).await, stamp);
    assert_eq!(changes(&h, 1).await["changes"].as_array().unwrap().len(), 1);
    // The link it already has: nothing changes, nothing is emitted, no Touch.
    h.call("todo.update", json!({"id": 1, "pr": 9}))
        .await
        .unwrap();
    assert_eq!(h.events(), Vec::<String>::new());
    assert_eq!(wrote(&h), 2);
}

fn wrote(h: &Harness) -> usize {
    h.touches(1)
        .iter()
        .filter(|(verb, _)| *verb == Verb::Wrote)
        .count()
}

async fn get_updated(h: &Harness) -> i64 {
    h.call("todo.get", json!({"id": 1})).await.unwrap()["updated_at"]
        .as_i64()
        .unwrap()
}

#[tokio::test]
async fn t7708a_the_link_persists_across_open() {
    let dir = tempfile::tempdir().unwrap();
    {
        let h = Harness::new(dir.path());
        made(&h, json!({"title": "t", "pr": 4})).await;
    }
    let h = Harness::new(dir.path());
    assert_eq!(h.call("todo.get", json!({"id": 1})).await.unwrap()["pr"], 4);
}

#[tokio::test]
async fn t7708c_completion_writes_one_change_by_the_daemon() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t", "pr": 7})).await;
    let done = h
        .todos
        .complete_merged(&daemon(&h), 1, 7, "2026-11-19T10:00:00Z")
        .await
        .unwrap()
        .unwrap();
    assert!(done.done);
    let history = changes(&h, 1).await;
    let changes = history["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 2);
    assert_eq!(changes[1]["actor"], owner_of(&Actor::daemon()));
    assert_eq!(changes[1]["before"]["done"], false);
    assert_eq!(changes[1]["after"]["done"], true);
    assert_eq!(h.touches(1).last().unwrap(), &(Verb::Wrote, "rupd".into()));
}

#[tokio::test]
async fn t7708c_owner_notices_match_a_users_completion() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    made(&h, json!({"title": "a", "pr": 7})).await;
    made(&h, json!({"title": "b", "blockers": [1]})).await;
    h.events();
    h.todos
        .complete_merged(&daemon(&h), 1, 7, "t1")
        .await
        .unwrap();
    let by_merge = h.events();
    assert_eq!(by_merge, ["todo.updated 1", "todo.unblocked 2"]);
    h.call("todo.reopen", json!({"id": 1})).await.unwrap();
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    h.events();
    h.call("todo.reopen", json!({"id": 1})).await.unwrap();
    h.events();
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(h.events(), by_merge);
}

#[tokio::test]
async fn t7708c_a_reopened_todo_is_not_closed_by_the_same_merge() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t", "pr": 7})).await;
    let ctx = daemon(&h);
    assert!(
        h.todos
            .complete_merged(&ctx, 1, 7, "t1")
            .await
            .unwrap()
            .is_some()
    );
    h.call("todo.reopen", json!({"id": 1})).await.unwrap();
    assert!(
        h.todos
            .complete_merged(&ctx, 1, 7, "t1")
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        h.call("todo.get", json!({"id": 1})).await.unwrap()["done"],
        false
    );
}

#[tokio::test]
async fn t7708c_the_record_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    {
        let h = Harness::new(dir.path());
        made(&h, json!({"title": "t", "pr": 7})).await;
        h.todos
            .complete_merged(&daemon(&h), 1, 7, "t1")
            .await
            .unwrap();
        h.call("todo.reopen", json!({"id": 1})).await.unwrap();
    }
    let h = Harness::new(dir.path());
    let again = h
        .todos
        .complete_merged(&daemon(&h), 1, 7, "t1")
        .await
        .unwrap();
    assert!(again.is_none());
}

#[tokio::test]
async fn t7708c_a_new_merge_or_link_can_complete_again() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    made(&h, json!({"title": "t", "pr": 7})).await;
    let ctx = daemon(&h);
    h.todos.complete_merged(&ctx, 1, 7, "t1").await.unwrap();
    h.call("todo.reopen", json!({"id": 1})).await.unwrap();
    assert!(
        h.todos
            .complete_merged(&ctx, 1, 7, "t2")
            .await
            .unwrap()
            .is_some()
    );
    h.call("todo.reopen", json!({"id": 1})).await.unwrap();
    h.call("todo.update", json!({"id": 1, "pr": 8}))
        .await
        .unwrap();
    assert!(
        h.todos
            .complete_merged(&ctx, 1, 7, "t3")
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        h.todos
            .complete_merged(&ctx, 1, 8, "t2")
            .await
            .unwrap()
            .is_some()
    );
    // A Todo the user completed first is not completed by the merge.
    h.call("todo.reopen", json!({"id": 1})).await.unwrap();
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert!(
        h.todos
            .complete_merged(&ctx, 1, 8, "t9")
            .await
            .unwrap()
            .is_none()
    );
}
