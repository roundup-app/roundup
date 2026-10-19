//! T15: probe the history contract through the real Daemon, including restart.
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
