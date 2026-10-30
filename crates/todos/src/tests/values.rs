// T4902 retires T29 duration setup; all non-duration scenario proofs below remain.
use super::*;

#[tokio::test]
async fn t1_create_assigns_sequential_ids_emits_and_touches() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    let first = h.call("todo.create", json!({"title": "a"})).await.unwrap();
    assert_eq!(first["id"], 1);
    assert_eq!(first["done"], false);
    assert_eq!(first["blocked"], false);
    assert_eq!(
        h.call("todo.create", json!({"title": "b"})).await.unwrap()["id"],
        2
    );
    assert_eq!(h.events(), ["todo.created 1", "todo.created 2"]);
    assert_eq!(h.touches(1), [(Verb::Wrote, "you".to_owned())]);
}

#[tokio::test]
async fn t2_list_is_in_id_order_and_get_logs_a_read() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.create", json!({"title": "b"})).await.unwrap();
    let ids: Vec<_> = h
        .call("todo.list", json!({}))
        .await
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].clone())
        .collect();
    assert_eq!(ids, [1, 2]);
    assert_eq!(
        h.call("todo.get", json!({"id": 2})).await.unwrap()["title"],
        "b"
    );
    assert_eq!(
        h.touches(2),
        [
            (Verb::Wrote, "you".to_owned()),
            (Verb::Read, "you".to_owned())
        ]
    );
    let err = h.call("todo.get", json!({"id": 9})).await.unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
}

#[tokio::test]
async fn t5_everything_survives_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let before = {
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a", "body": "x"}))
            .await
            .unwrap();
        h.call("todo.create", json!({"title": "b", "blockers": [1]}))
            .await
            .unwrap();
        h.call("todo.complete", json!({"id": 1})).await.unwrap();
        h.call("todo.list", json!({})).await.unwrap()
    };
    let h = Harness::new(dir.path());
    assert_eq!(h.call("todo.list", json!({})).await.unwrap(), before);
    assert_eq!(before[0]["done"], true);
    assert_eq!(before[1]["blockers"], json!([1]));
    assert_eq!(
        h.call("todo.create", json!({"title": "c"})).await.unwrap()["id"],
        3
    );
}

#[tokio::test]
async fn t7_update_changes_only_the_given_fields() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a", "body": "keep"}))
        .await
        .unwrap();
    h.events();
    let todo = h
        .call("todo.update", json!({"id": 1, "title": "x"}))
        .await
        .unwrap();
    assert_eq!(
        (todo["title"].as_str(), todo["body"].as_str()),
        (Some("x"), Some("keep"))
    );
    assert_eq!(h.events(), ["todo.updated 1"]);
    assert_eq!(
        h.touches(1),
        [
            (Verb::Wrote, "you".to_owned()),
            (Verb::Wrote, "you".to_owned())
        ]
    );
    let err = h.call("todo.update", json!({"id": 1})).await.unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
}

#[tokio::test]
async fn t1_each_create_logs_a_wrote_touch_by_the_caller() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    for title in ["a", "b"] {
        h.call_as(agent("a"), "todo.create", json!({"title": title}))
            .await
            .unwrap();
    }
    let by_agent = [(Verb::Wrote, "a".to_owned())];
    assert_eq!(h.touches(1), by_agent);
    assert_eq!(h.touches(2), by_agent);
}

#[tokio::test]
async fn t2_get_logs_a_read_touch_by_the_caller() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call_as(agent("a"), "todo.get", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(
        h.touches(1),
        [
            (Verb::Wrote, "you".to_owned()),
            (Verb::Read, "a".to_owned())
        ]
    );
}

#[tokio::test]
async fn t7_update_by_body_alone_keeps_the_title_and_logs_the_caller() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "keep", "body": "old"}))
        .await
        .unwrap();
    let todo = h
        .call_as(agent("a"), "todo.update", json!({"id": 1, "body": "new"}))
        .await
        .unwrap();
    assert_eq!(
        (todo["title"].as_str(), todo["body"].as_str()),
        (Some("keep"), Some("new"))
    );
    assert_eq!(
        h.touches(1),
        [
            (Verb::Wrote, "you".to_owned()),
            (Verb::Wrote, "a".to_owned())
        ]
    );
}

#[tokio::test]
async fn t3_completing_a_blocker_unblocks_the_todo() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    let two = h
        .call("todo.create", json!({"title": "b", "blockers": [1]}))
        .await
        .unwrap();
    assert_eq!(two["blocked"], true);
    h.events();
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(h.events(), ["todo.updated 1", "todo.unblocked 2"]);
    assert_eq!(
        h.call("todo.get", json!({"id": 2})).await.unwrap()["blocked"],
        false
    );
    h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(h.events(), ["todo.updated 1"]);
}

#[tokio::test]
async fn t4_bad_blockers_are_rejected_and_change_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.create", json!({"title": "b", "blockers": [1]}))
        .await
        .unwrap();
    let cycle = h
        .call("todo.setBlockers", json!({"id": 1, "blockers": [2]}))
        .await
        .unwrap_err();
    let own = h
        .call("todo.setBlockers", json!({"id": 1, "blockers": [1]}))
        .await
        .unwrap_err();
    let unknown = h
        .call("todo.setBlockers", json!({"id": 2, "blockers": [9]}))
        .await
        .unwrap_err();
    assert_eq!(
        (cycle.code, own.code, unknown.code),
        (code::CONFLICT, code::CONFLICT, code::NOT_FOUND)
    );
    assert_eq!(
        h.call("todo.get", json!({"id": 1})).await.unwrap()["blockers"],
        json!([])
    );
    assert_eq!(
        h.call("todo.get", json!({"id": 2})).await.unwrap()["blockers"],
        json!([1])
    );
}

#[tokio::test]
async fn t4_set_blockers_replaces_the_whole_list() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    for title in ["a", "b", "c"] {
        h.call("todo.create", json!({"title": title}))
            .await
            .unwrap();
    }
    h.call("todo.setBlockers", json!({"id": 3, "blockers": [1]}))
        .await
        .unwrap();
    let todo = h
        .call("todo.setBlockers", json!({"id": 3, "blockers": [2]}))
        .await
        .unwrap();
    assert_eq!(todo["blockers"], json!([2]));
}

#[tokio::test]
async fn t6_deleting_a_blocker_unblocks_the_todo() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.create", json!({"title": "b", "blockers": [1]}))
        .await
        .unwrap();
    h.events();
    h.call("todo.delete", json!({"operation": "delete-1", "ids": [1]}))
        .await
        .unwrap();
    assert_eq!(h.events(), ["todo.deleted 1", "todo.unblocked 2"]);
    let two = h.call("todo.get", json!({"id": 2})).await.unwrap();
    assert_eq!(
        (two["blockers"].clone(), two["blocked"].clone()),
        (json!([]), json!(false))
    );
}

#[tokio::test]
async fn t6_deleting_a_blocked_todo_announces_only_its_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    h.call("todo.create", json!({"title": "a"})).await.unwrap();
    h.call("todo.create", json!({"title": "b", "blockers": [1]}))
        .await
        .unwrap();
    h.events();
    h.call("todo.delete", json!({"operation": "delete-2", "ids": [2]}))
        .await
        .unwrap();
    assert_eq!(h.events(), ["todo.deleted 2"]);
}

#[tokio::test]
async fn t8_creator_is_the_calling_actor_on_create_list_get_and_the_event() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());

    let by_user = h.call("todo.create", json!({"title": "a"})).await.unwrap();
    assert_eq!(
        by_user["creator"],
        serde_json::to_value(Actor::user()).unwrap()
    );
    assert_eq!(
        h.event_data()["creator"],
        serde_json::to_value(Actor::user()).unwrap()
    );

    // A `creator` sent in the params is ignored: the caller's own Actor wins.
    let by_agent = h
        .call_as(
            agent("a"),
            "todo.create",
            json!({"title": "b", "creator": Actor::user()}),
        )
        .await
        .unwrap();
    assert_eq!(
        by_agent["creator"],
        serde_json::to_value(agent("a")).unwrap()
    );
    assert_eq!(
        h.event_data()["creator"],
        serde_json::to_value(agent("a")).unwrap()
    );

    let listed = h.call("todo.list", json!({})).await.unwrap();
    assert_eq!(
        listed[1]["creator"],
        serde_json::to_value(agent("a")).unwrap()
    );
    let got = h
        .call("todo.get", json!({"id": by_agent["id"]}))
        .await
        .unwrap();
    assert_eq!(got["creator"], serde_json::to_value(agent("a")).unwrap());
}

#[tokio::test]
async fn t8_update_complete_and_set_blockers_never_change_creator() {
    let dir = tempfile::tempdir().unwrap();
    let h = Harness::new(dir.path());
    h.call_as(agent("a"), "todo.create", json!({"title": "x"}))
        .await
        .unwrap();
    h.call("todo.create", json!({"title": "y"})).await.unwrap();
    let expected = serde_json::to_value(agent("a")).unwrap();

    let updated = h
        .call("todo.update", json!({"id": 1, "title": "z"}))
        .await
        .unwrap();
    assert_eq!(updated["creator"], expected);

    let completed = h.call("todo.complete", json!({"id": 1})).await.unwrap();
    assert_eq!(completed["creator"], expected);

    let reblocked = h
        .call("todo.setBlockers", json!({"id": 1, "blockers": [2]}))
        .await
        .unwrap();
    assert_eq!(reblocked["creator"], expected);
}

#[tokio::test]
async fn t8_creator_persists_across_reopen() {
    let dir = tempfile::tempdir().unwrap();
    {
        let h = Harness::new(dir.path());
        h.call_as(agent("a"), "todo.create", json!({"title": "x"}))
            .await
            .unwrap();
    }
    let h = Harness::new(dir.path());
    let got = h.call("todo.get", json!({"id": 1})).await.unwrap();
    assert_eq!(got["creator"], serde_json::to_value(agent("a")).unwrap());
}

#[tokio::test]
async fn t8_creator_from_an_extension_is_stored_as_is() {
    let dir = tempfile::tempdir().unwrap();
    let caller = ext("git-sync", "a");
    let expected = serde_json::to_value(&caller).unwrap();
    {
        let h = Harness::new(dir.path());
        let created = h
            .call_as(caller.clone(), "todo.create", json!({"title": "x"}))
            .await
            .unwrap();
        assert_eq!(created["creator"], expected);
        let got = h
            .call("todo.get", json!({"id": created["id"]}))
            .await
            .unwrap();
        assert_eq!(got["creator"], expected);
    }
    let h = Harness::new(dir.path());
    let got = h.call("todo.get", json!({"id": 1})).await.unwrap();
    assert_eq!(got["creator"], expected);
}

/// Mutant M8: a stored `creator` that fails to parse must error, not silently read as the user.
#[tokio::test]
async fn t8_unparseable_creator_fails_as_internal() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("todos.db");
    {
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
    }
    rusqlite::Connection::open(&db_path)
        .unwrap()
        .execute("UPDATE todos SET creator = 'not json' WHERE id = 1", [])
        .unwrap();

    let h = Harness::new(dir.path());
    let err = h.call("todo.get", json!({"id": 1})).await.unwrap_err();
    assert_eq!(err.code, code::INTERNAL);
}

#[tokio::test]
async fn t31_the_user_updates_an_agent_owned_todo() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    h.call_as(
        agent("a"),
        "todo.create",
        json!({"title": "a", "body": "b"}),
    )
    .await
    .unwrap();
    h.call("todo.assign", json!({"id": 1, "owner": agent("a")}))
        .await
        .unwrap();
    h.events();
    for params in [
        json!({"id": 1, "title": "x"}),
        json!({"id": 1, "body": "y"}),
    ] {
        h.call("todo.update", params).await.unwrap();
    }
    let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
    assert_eq!(
        (todo["title"].as_str(), todo["body"].as_str()),
        (Some("x"), Some("y"))
    );
    assert_eq!(todo["owner"]["id"], "a");
    assert_eq!(h.events(), ["todo.updated 1", "todo.updated 1"]);
    assert!(h.touches(1).contains(&(Verb::Wrote, "you".to_owned())));
}

#[tokio::test]
async fn t4902_todo_values_and_history_have_no_duration() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = Harness::new(dir.path());
    let created = made(&h, json!({"title":"ship", "body":"keep"})).await;
    assert!(created.get("estimate_minutes").is_none());
    assert!(h.event_data().get("estimate_minutes").is_none());
    for (method, params) in [
        ("todo.update", json!({"id":1,"title":"saved"})),
        ("todo.assign", json!({"id":1,"owner":agent("a")})),
        ("todo.complete", json!({"id":1})),
        ("todo.reopen", json!({"id":1})),
        ("todo.move", json!({"id":1,"home":"w1"})),
        ("todo.reorder", json!({"id":1,"before":null})),
    ] {
        let reply = h.call(method, params).await.unwrap();
        assert!(reply.get("estimate_minutes").is_none(), "{method}: {reply}");
        while let Ok(event) = h.events.try_recv() {
            let wire = serde_json::to_value(event).unwrap();
            assert!(!wire.to_string().contains("estimate_minutes"), "{wire}");
        }
    }
    h.call("todo.delete", json!({"operation":"remove", "ids":[1]}))
        .await
        .unwrap();
    h.call("todo.restore", json!({"operation":"remove"}))
        .await
        .unwrap();
    let got = h.call("todo.get", json!({"id":1})).await.unwrap();
    assert!(got.get("estimate_minutes").is_none());
    assert_eq!(got["title"], "saved");
    assert_eq!(got["body"], "keep");
    assert_eq!(got["home"], "w1");
    assert_eq!(got["owner"], json!(agent("a")));
    let listed = h.call("todo.list", json!({})).await.unwrap();
    assert_eq!(listed, json!([got]));
    let history = changes(&h, 1).await;
    assert!(
        !history.to_string().contains("estimate_minutes"),
        "{history}"
    );
    assert_eq!(history["changes"][1]["before"]["title"], "ship");
    assert_eq!(history["changes"][1]["after"]["title"], "saved");
    while let Ok(event) = h.events.try_recv() {
        let wire = serde_json::to_value(event).unwrap();
        assert!(!wire.to_string().contains("estimate_minutes"), "{wire}");
    }
}
