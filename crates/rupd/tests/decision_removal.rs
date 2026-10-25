//! A3564d: a Project made before native questions opens with no Decision data left in it.
use std::sync::Arc;

use contracts::EventData;
use rpc::{Client, code};
use rusqlite::Connection;
use serde_json::{Value, json};
use tokio::net::UnixListener;

#[allow(dead_code)]
mod storage {
    include!("support/store_migrations.rs");
}

fn legacy_decision_event(name: &str) -> String {
    json!({"actor": {"kind": "user", "id": "user", "parent": null}, "name": name, "data": {"id": "d1"}})
        .to_string()
}

#[tokio::test]
async fn a3564d_existing_project_opens_without_custom_question_authority() {
    let dir = tempfile::tempdir().unwrap();
    // Version 36 is the shipped prefix before custom authority removal.
    let db = storage::project(dir.path(), 36);
    db.execute(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'workstream','kept',0)",
        [],
    )
    .unwrap();
    db.execute("INSERT INTO events(event) VALUES (?1)", [json!({"actor":{"kind":"user","id":"you","parent":null},"name":"rail.changed","data":null}).to_string()])
        .unwrap();
    db.execute_batch(
        "INSERT INTO decision_answers(decision, agent, record) VALUES('d1', '1', '{}');",
    )
    .unwrap();
    for name in ["decision.opened", "decision.cleared"] {
        db.execute(
            "INSERT INTO events(event) VALUES (?1)",
            [legacy_decision_event(name)],
        )
        .unwrap();
    }
    for (identity, activity) in [
        ("held", json!({"kind": "decision", "decision": "d1"})),
        ("kept", json!({"kind": "attempt"})),
    ] {
        let value = json!({"kind": "observed", "activity": activity, "clock_lifetime": "c",
            "start": null, "segments": [], "state": {"kind": "active"}});
        db.execute(
            "INSERT INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage)
             VALUES(?1,'1','fixture','1','1',NULL,'Maker',1000,?2,'[]')",
            [identity, &value.to_string()],
        )
        .unwrap();
    }
    drop(db);

    let daemon = Arc::new(rupd::Daemon::open(dir.path()).unwrap());
    let socket = dir.path().join("rupd.sock");
    tokio::spawn(rupd::serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::clone(&daemon),
    ));
    let mut client = Client::connect(&socket).await.unwrap();
    client
        .request("events.subscribe", json!({"after": 0}))
        .await
        .unwrap();
    let replayed = client.next_event().await.unwrap();
    assert!(
        matches!(replayed.data, EventData::RailChanged),
        "{replayed:?}"
    );

    let db = Connection::open(dir.path().join("project.db")).unwrap();
    let table: Option<String> = db
        .query_row(
            "SELECT name FROM sqlite_schema WHERE name = 'decision_answers'",
            [],
            |row| row.get(0),
        )
        .ok();
    assert_eq!(table, None);
    let kept: Vec<String> = db
        .prepare("SELECT DISTINCT identity FROM measurement_revisions")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(kept, ["kept"]);

    for method in [
        "decision.list",
        "decision.answer",
        "agent.permission",
        "agent.ask",
    ] {
        let err = client.request(method, Value::Null).await.unwrap_err();
        assert_eq!(err.code, code::METHOD_NOT_FOUND, "{method}");
    }
}
