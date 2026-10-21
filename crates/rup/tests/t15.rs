//! T15/U2773c: Todo history and captured-Change saves through the real Daemon.
#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use daemon::start;
use serde_json::json;

#[tokio::test]
async fn t15_real_daemon_history_and_reads_survive_restart() {
    let mut project = start(&[]);
    let client = project.client().await;
    client
        .request(
            "todo.create",
            json!({"title": "Initial", "body": "full\nbody"}),
        )
        .await
        .unwrap();
    let initial = client
        .request("todo.getHistory", json!({"id": 1}))
        .await
        .unwrap();
    client
        .request(
            "todo.readHistory",
            json!({"id": 1, "through": initial["changes"][0]["seq"]}),
        )
        .await
        .unwrap();
    client
        .request(
            "todo.update",
            json!({"id": 1, "title": "Changed", "body": "new\nbody"}),
        )
        .await
        .unwrap();
    client
        .request("todo.complete", json!({"id": 1}))
        .await
        .unwrap();
    let before = client
        .request("todo.getHistory", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(before["changes"].as_array().unwrap().len(), 3);
    assert_eq!(before["unread"], before["changes"][1]["seq"]);
    project.restart(&[]);
    let reopened = project.client().await;
    assert_eq!(
        reopened
            .request("todo.getHistory", json!({"id": 1}))
            .await
            .unwrap(),
        before
    );
    assert_eq!(before["changes"][1]["after"]["body"], "new\nbody");
    assert_eq!(before["changes"][2]["after"]["done"], true);
}

#[tokio::test]
async fn t15_list_and_rail_do_not_load_history() {
    let project = start(&[]);
    let client = project.client().await;
    client
        .request("todo.create", json!({"title": "Zero changes"}))
        .await
        .unwrap();
    client
        .request("todo.create", json!({"title": "Thousand changes"}))
        .await
        .unwrap();
    let before = client
        .request("rail.tree", serde_json::Value::Null)
        .await
        .unwrap();
    for n in 0..1000 {
        client
            .request("todo.update", json!({"id": 2, "body": n.to_string()}))
            .await
            .unwrap();
    }
    // A broken history table makes any query to it fail; both list paths must still answer.
    let db = rusqlite::Connection::open(project.data_dir().join("project.db")).unwrap();
    db.execute_batch("ALTER TABLE changes RENAME TO unavailable_changes")
        .unwrap();
    let list = client
        .request("todo.list", serde_json::Value::Null)
        .await
        .unwrap();
    assert_eq!(list[0]["title"], "Zero changes");
    assert_eq!(list[1]["body"], "999");
    assert!(list[0].get("changes").is_none());
    assert_eq!(
        client
            .request("rail.tree", serde_json::Value::Null)
            .await
            .unwrap(),
        before
    );
    assert!(
        client
            .request("todo.getHistory", json!({"id": 2}))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn u2773c_todo_stale_base_is_refused() {
    let project = start(&[]);
    let client = project.client().await;
    let other = project.client().await;
    other
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"user","id":"other","parent":null}}),
        )
        .await
        .unwrap();
    client
        .request("todo.create", json!({"title":"A","body":"original"}))
        .await
        .unwrap();
    let captured = client
        .request("todo.getHistory", json!({"id":1}))
        .await
        .unwrap()["changes"][0]["seq"]
        .clone();
    other
        .request(
            "todo.update",
            json!({"id":1,"title":"B","body":"another Actor"}),
        )
        .await
        .unwrap();
    let committed = client.request("todo.get", json!({"id":1})).await.unwrap();
    let history = client
        .request("todo.getHistory", json!({"id":1}))
        .await
        .unwrap();
    let touches = client
        .request("provenance.history", json!({"item":"todo:1"}))
        .await
        .unwrap();
    assert!(
        touches
            .as_array()
            .unwrap()
            .iter()
            .any(|touch| touch["actor"]["id"] == "other" && touch["verb"] == "wrote")
    );
    let mut events = project.subscribed().await;
    let error = client
        .request(
            "todo.update",
            json!({"id":1,"title":"stale","body":"lost update","expected_change":captured}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::CONFLICT);
    assert_eq!(
        client
            .request("todo.getHistory", json!({"id":1}))
            .await
            .unwrap(),
        history
    );
    assert_eq!(
        client
            .request("provenance.history", json!({"item":"todo:1"}))
            .await
            .unwrap(),
        touches
    );
    assert_eq!(
        client.request("todo.get", json!({"id":1})).await.unwrap(),
        committed
    );
    // A subsequent write is an event-stream barrier, so absence needs no timing guess.
    let marker = client
        .request("todo.create", json!({"title":"barrier"}))
        .await
        .unwrap();
    daemon::next(&mut events, |event| match event {
        contracts::EventData::TodoCreated(todo)
            if u64::from(todo.id) == marker["id"].as_u64().unwrap() =>
        {
            Some(())
        }
        contracts::EventData::TodoUpdated(_) => panic!("refused write emitted a success event"),
        _ => None,
    })
    .await;
}

#[tokio::test]
async fn u2773c_todo_stale_blockers_are_refused() {
    let project = start(&[]);
    let client = project.client().await;
    let other = project.client().await;
    other
        .request(
            "daemon.identify",
            json!({"actor":{"kind":"user","id":"other","parent":null}}),
        )
        .await
        .unwrap();
    for title in ["original", "blocker", "replacement"] {
        client
            .request("todo.create", json!({"title":title}))
            .await
            .unwrap();
    }
    let captured = client
        .request("todo.getHistory", json!({"id":1}))
        .await
        .unwrap()["changes"][0]["seq"]
        .clone();
    other
        .request("todo.setBlockers", json!({"id":1,"blockers":[2]}))
        .await
        .unwrap();
    let committed = client.request("todo.get", json!({"id":1})).await.unwrap();
    let history = client
        .request("todo.getHistory", json!({"id":1}))
        .await
        .unwrap();
    let touches = client
        .request("provenance.history", json!({"item":"todo:1"}))
        .await
        .unwrap();
    assert!(
        touches
            .as_array()
            .unwrap()
            .iter()
            .any(|touch| touch["actor"]["id"] == "other" && touch["verb"] == "wrote")
    );
    let mut events = project.subscribed().await;
    let error = client
        .request(
            "todo.setBlockers",
            json!({"id":1,"blockers":[3],"expected_change":captured}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::CONFLICT);
    assert_eq!(
        client
            .request("todo.getHistory", json!({"id":1}))
            .await
            .unwrap(),
        history
    );
    assert_eq!(
        client
            .request("provenance.history", json!({"item":"todo:1"}))
            .await
            .unwrap(),
        touches
    );
    assert_eq!(
        client.request("todo.get", json!({"id":1})).await.unwrap(),
        committed
    );
    let marker = client
        .request("todo.create", json!({"title":"barrier"}))
        .await
        .unwrap();
    daemon::next(&mut events, |event| match event {
        contracts::EventData::TodoCreated(todo)
            if u64::from(todo.id) == marker["id"].as_u64().unwrap() =>
        {
            Some(())
        }
        contracts::EventData::TodoUpdated(_) | contracts::EventData::TodoUnblocked(_) => {
            panic!("refused blockers emitted a success event")
        }
        _ => None,
    })
    .await;
}

#[tokio::test]
async fn u2773c_matching_change_commits_once_in_its_original_project() {
    for (method, fields) in [
        (
            "todo.update",
            json!({"title":"saved","body":"exact\n Unicode 🦀"}),
        ),
        ("todo.setBlockers", json!({"blockers":[2]})),
    ] {
        let first = start(&[]);
        let second = start(&[]);
        let a = first.client().await;
        let b = second.client().await;
        let mut originals = Vec::new();
        for client in [&a, &b] {
            originals.push(
                client
                    .request("todo.create", json!({"title":"original"}))
                    .await
                    .unwrap(),
            );
            client
                .request("todo.create", json!({"title":"blocker"}))
                .await
                .unwrap();
        }
        assert_eq!(originals[0]["id"], originals[1]["id"]);
        let mut captured = Vec::new();
        for client in [&a, &b] {
            captured.push(
                client
                    .request("todo.getHistory", json!({"id":1}))
                    .await
                    .unwrap()["changes"][0]["seq"]
                    .clone(),
            );
        }
        // Equal ids and equal base sequences belong to separate Projects.
        for (index, client) in [&a, &b].into_iter().enumerate() {
            let mut params = fields.clone();
            params["id"] = json!(1);
            params["expected_change"] = captured[index].clone();
            let committed = client.request(method, params.clone()).await.unwrap();
            let mut expected = originals[index].clone();
            for (field, value) in fields.as_object().unwrap() {
                expected[field] = value.clone();
            }
            if method == "todo.setBlockers" {
                expected["blocked"] = json!(true);
            }
            assert_eq!(committed, expected);
            assert_eq!(
                client.request("todo.get", json!({"id":1})).await.unwrap(),
                committed
            );
            assert_eq!(
                client.request(method, params).await.unwrap_err().code,
                rpc::code::CONFLICT
            );
            if index == 0 {
                assert_eq!(
                    b.request("todo.get", json!({"id":1})).await.unwrap(),
                    originals[1]
                );
            }
        }
    }
}

#[tokio::test]
async fn u2773c_removed_original_is_not_recreated_or_retargeted() {
    for (method, fields) in [
        ("todo.update", json!({"title":"saved","body":"draft"})),
        ("todo.setBlockers", json!({"blockers":[]})),
    ] {
        let project = start(&[]);
        let client = project.client().await;
        client
            .request("todo.create", json!({"title":"original"}))
            .await
            .unwrap();
        let base = client
            .request("todo.getHistory", json!({"id":1}))
            .await
            .unwrap()["changes"][0]["seq"]
            .clone();
        client
            .request("todo.delete", json!({"id":1}))
            .await
            .unwrap();
        let replacement = client
            .request("todo.create", json!({"title":"original"}))
            .await
            .unwrap();
        assert_ne!(replacement["id"], 1);
        let touches = client
            .request("provenance.history", json!({"item":"todo:1"}))
            .await
            .unwrap();
        let mut params = fields;
        params["id"] = json!(1);
        params["expected_change"] = base;
        assert_eq!(
            client.request(method, params).await.unwrap_err().code,
            rpc::code::NOT_FOUND
        );
        assert_eq!(
            client.request("todo.list", json!(null)).await.unwrap(),
            json!([replacement])
        );
        assert_eq!(
            client
                .request("provenance.history", json!({"item":"todo:1"}))
                .await
                .unwrap(),
            touches
        );
    }
}

#[tokio::test]
async fn u2773c_returning_to_original_values_does_not_revive_a_stale_change() {
    let project = start(&[]);
    let client = project.client().await;
    client
        .request("todo.create", json!({"title":"A"}))
        .await
        .unwrap();
    let base = client
        .request("todo.getHistory", json!({"id":1}))
        .await
        .unwrap()["changes"][0]["seq"]
        .clone();
    for title in ["B", "A"] {
        client
            .request("todo.update", json!({"id":1,"title":title}))
            .await
            .unwrap();
    }
    assert_eq!(
        client
            .request(
                "todo.update",
                json!({"id":1,"title":"stale","expected_change":base})
            )
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
}

#[tokio::test]
async fn t19_daemon_reopen_refreshes_dependents() {
    let mut project = start(&[]);
    let client = project.client().await;
    client
        .request("todo.create", json!({"title":"blocker"}))
        .await
        .unwrap();
    client
        .request("todo.create", json!({"title":"dependent","blockers":[1]}))
        .await
        .unwrap();
    client
        .request("todo.complete", json!({"id":1}))
        .await
        .unwrap();
    let mut events = project.subscribed().await;
    let reopened = client
        .request("todo.reopen", json!({"id":1}))
        .await
        .unwrap();
    assert_eq!(reopened["done"], false);
    let updated = daemon::next(&mut events, |event| match event {
        contracts::EventData::TodoUpdated(todo) => Some(serde_json::to_value(todo).unwrap()),
        contracts::EventData::TodoUnblocked(_) => panic!("reopen must not unblock"),
        _ => None,
    })
    .await;
    assert_eq!(updated, reopened);
    let list = client.request("todo.list", json!(null)).await.unwrap();
    assert_eq!(list[1]["blocked"], true);
    assert_eq!(list[1]["blockers"], json!([1]));
    let history = client
        .request("todo.getHistory", json!({"id":1}))
        .await
        .unwrap();
    let touches = client
        .request("provenance.history", json!({"item":"todo:1"}))
        .await
        .unwrap();
    assert_eq!(
        history["changes"][2]["actor"],
        json!(contracts::Actor::user())
    );
    project.restart(&[]);
    let client = project.client().await;
    assert_eq!(
        client.request("todo.list", json!(null)).await.unwrap(),
        list
    );
    assert_eq!(
        client
            .request("todo.getHistory", json!({"id":1}))
            .await
            .unwrap(),
        history
    );
    assert_eq!(
        client
            .request("provenance.history", json!({"item":"todo:1"}))
            .await
            .unwrap(),
        touches
    );
    assert_eq!(
        client.request("todo.get", json!({"id":1})).await.unwrap(),
        reopened
    );
}
