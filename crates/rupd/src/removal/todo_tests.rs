//! Todo ownership and Home validation through the real Daemon route.

use super::{tests::call, *};
use serde_json::json;

#[tokio::test]
async fn t17_rejections_leave_no_trace() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(kind,name,ord) SELECT 'agent','agent',COUNT(*) FROM nodes",
        [],
    )
    .unwrap();
    let agent = db.last_insert_rowid().to_string();
    let id = call(&daemon, "todo.create", json!({"title":"a"}))
        .await
        .unwrap()["id"]
        .as_u64()
        .unwrap();
    let history = || async {
        call(
            &daemon,
            "provenance.history",
            json!({ "item": format!("todo:{id}") }),
        )
        .await
        .unwrap()
    };
    let touched = history().await;
    for owner in [
        json!({"kind":"agent","id":"nope","parent":null}),
        json!({"kind":"agent","id":"r1","parent":null}),
    ] {
        let err = call(&daemon, "todo.assign", json!({ "id": id, "owner": owner }))
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::NOT_FOUND);
    }
    let ext = call(
        &daemon,
        "todo.assign",
        json!({ "id": id, "owner": json!({"kind":"ext","id":"x","parent":null}) }),
    )
    .await
    .unwrap_err();
    assert_eq!(ext.code, rpc::code::INVALID_PARAMS);
    let made = call(
        &daemon,
        "todo.create",
        json!({ "title": "b", "owner": json!({"kind":"agent","id":"nope","parent":null}) }),
    )
    .await
    .unwrap_err();
    assert_eq!(made.code, rpc::code::NOT_FOUND);
    let made = call(
        &daemon,
        "todo.create",
        json!({ "title": "b", "owner": json!({"kind":"ext","id":"x","parent":null}) }),
    )
    .await
    .unwrap_err();
    assert_eq!(made.code, rpc::code::INVALID_PARAMS);
    assert_eq!(history().await, touched);
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":id})).await.unwrap()["owner"],
        Value::Null
    );
    let listed = call(&daemon, "todo.list", json!(null)).await.unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1);
    call(
        &daemon,
        "todo.assign",
        json!({ "id": id, "owner": json!({"kind":"agent","id":&agent,"parent":null}) }),
    )
    .await
    .unwrap();
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":id})).await.unwrap()["owner"],
        json!({"kind":"agent","id":&agent,"parent":null})
    );
}

#[tokio::test]
async fn t13_move_checks_the_rail() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let r1 = call(&daemon, "rail.createWorkstream", json!({"name":"r1"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(kind,name,ord) SELECT 'agent','agent',COUNT(*) FROM nodes",
        [],
    )
    .unwrap();
    let agent = db.last_insert_rowid().to_string();
    let mut events = daemon.bus.subscribe();
    let id = call(&daemon, "todo.create", json!({"title":"a"}))
        .await
        .unwrap()["id"]
        .as_u64()
        .unwrap();
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":id})).await.unwrap()["home"],
        Value::Null
    );
    assert!(matches!(
        events.try_recv().unwrap().data,
        contracts::EventData::TodoCreated(_)
    ));

    let history = || async {
        call(
            &daemon,
            "provenance.history",
            json!({ "item": format!("todo:{id}") }),
        )
        .await
        .unwrap()
    };
    let touched = history().await;
    let missing = call(&daemon, "todo.move", json!({ "id": id, "home": "nope" }))
        .await
        .unwrap_err();
    assert_eq!(missing.code, rpc::code::NOT_FOUND);
    let not_a_workstream = call(&daemon, "todo.move", json!({ "id": id, "home": agent }))
        .await
        .unwrap_err();
    assert_eq!(not_a_workstream.code, rpc::code::INVALID_PARAMS);
    assert_eq!(history().await, touched);
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":id})).await.unwrap()["home"],
        Value::Null
    );

    call(&daemon, "todo.move", json!({ "id": id, "home": r1 }))
        .await
        .unwrap();
    // The first Todo event after the rejections is the move that succeeded.
    let first = match events.try_recv().unwrap().data {
        contracts::EventData::TodoUpdated(todo) => todo.home,
        event => panic!("expected Todo update, got {event:?}"),
    };
    assert_eq!(first, Some(r1.clone()));
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":id})).await.unwrap()["home"],
        json!(r1)
    );
}

#[tokio::test]
async fn t13_a_failed_rail_remove_leaves_every_home() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let r1 = call(&daemon, "rail.createWorkstream", json!({"name":"r1"}))
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let id = call(&daemon, "todo.create", json!({"title":"a"}))
        .await
        .unwrap()["id"]
        .as_u64()
        .unwrap();
    call(&daemon, "todo.move", json!({ "id": id, "home": r1 }))
        .await
        .unwrap();
    let mut events = daemon.bus.subscribe();

    let err = call(&daemon, "rail.remove", json!({ "id": "nope" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::NOT_FOUND);
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":id})).await.unwrap()["home"],
        json!(r1)
    );
    assert!(matches!(
        events.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn t17_rail_remove_unassigns_its_todos() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(kind,name,ord) SELECT 'agent','agent',COUNT(*) FROM nodes",
        [],
    )
    .unwrap();
    let agent = db.last_insert_rowid().to_string();
    let mut ids = Vec::new();
    for title in ["a", "b", "c"] {
        ids.push(
            call(&daemon, "todo.create", json!({"title":title}))
                .await
                .unwrap()["id"]
                .clone(),
        );
    }
    let [a, b, c] = ids.as_slice() else {
        panic!("three Todos created")
    };
    for id in [c, a] {
        call(
            &daemon,
            "todo.assign",
            json!({"id":id,"owner":{"kind":"agent","id":agent,"parent":null}}),
        )
        .await
        .unwrap();
    }
    let user = json!({"kind":"user","id":"you","parent":null});
    call(&daemon, "todo.assign", json!({"id":b,"owner":user}))
        .await
        .unwrap();
    let mut events = daemon.bus.subscribe();

    call(&daemon, "rail.remove", json!({"id":agent}))
        .await
        .unwrap();

    let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert!(
        !tree
            .as_array()
            .unwrap()
            .iter()
            .any(|node| node["id"] == agent)
    );
    let mut updated = Vec::new();
    while let Ok(event) = events.try_recv() {
        if let contracts::EventData::TodoUpdated(todo) = event.data {
            updated.push(json!(todo.id));
        }
    }
    assert_eq!(updated, [a.clone(), c.clone()]);
    for id in [a, c] {
        assert_eq!(
            call(&daemon, "todo.get", json!({"id":id})).await.unwrap()["owner"],
            Value::Null
        );
    }
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":b})).await.unwrap()["owner"],
        user
    );
}

#[tokio::test]
async fn t13_workstream_removal_resets_homes_and_emits_in_id_order() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let r1 = call(&daemon, "rail.createWorkstream", json!({"name":"r1"}))
        .await
        .unwrap()["id"]
        .clone();
    let r2 = call(&daemon, "rail.createWorkstream", json!({"name":"r2"}))
        .await
        .unwrap()["id"]
        .clone();
    let mut ids = Vec::new();
    for title in ["a", "b", "c", "d"] {
        ids.push(
            call(&daemon, "todo.create", json!({"title":title}))
                .await
                .unwrap()["id"]
                .clone(),
        );
    }
    let [a, b, c, d] = ids.as_slice() else {
        panic!("four Todos created")
    };
    for (id, home) in [(d, &r1), (b, &r1), (c, &r2)] {
        call(&daemon, "todo.move", json!({"id":id,"home":home}))
            .await
            .unwrap();
    }
    let mut events = daemon.bus.subscribe();

    call(&daemon, "rail.remove", json!({"id":r1}))
        .await
        .unwrap();

    let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert!(!tree.as_array().unwrap().iter().any(|node| node["id"] == r1));
    let mut updated = Vec::new();
    while let Ok(event) = events.try_recv() {
        if let contracts::EventData::TodoUpdated(todo) = event.data {
            updated.push(json!(todo.id));
        }
    }
    assert_eq!(updated, [b.clone(), d.clone()]);
    for (id, home) in [
        (a, Value::Null),
        (b, Value::Null),
        (c, r2),
        (d, Value::Null),
    ] {
        assert_eq!(
            call(&daemon, "todo.get", json!({"id":id})).await.unwrap()["home"],
            home
        );
    }
    assert_eq!(
        call(&daemon, "todo.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        4
    );
}
