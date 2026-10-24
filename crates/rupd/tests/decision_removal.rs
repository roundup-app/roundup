//! A3564d: a Project made before native questions opens with no Decision data left in it.
use std::sync::Arc;

use contracts::EventData;
use rpc::{Client, code};
use rusqlite::Connection;
use serde_json::{Value, json};
use tokio::net::UnixListener;

fn legacy_decision_event(name: &str) -> String {
    json!({"actor": {"kind": "user", "id": "user", "parent": null}, "name": name, "data": {"id": "d1"}})
        .to_string()
}

#[tokio::test]
async fn a3564d_existing_project_opens_without_custom_question_authority() {
    let dir = tempfile::tempdir().unwrap();
    {
        let daemon = Arc::new(rupd::Daemon::open(dir.path()).unwrap());
        let socket = dir.path().join("first.sock");
        let server = tokio::spawn(rupd::serve(
            UnixListener::bind(&socket).unwrap(),
            Arc::clone(&daemon),
        ));
        let client = Client::connect(&socket).await.unwrap();
        client
            .request("rail.createWorkstream", json!({"name": "kept"}))
            .await
            .unwrap();
        server.abort();
        let _ = server.await;
    }

    // Make it the Project an older version left: the Decision table, rows and events return and
    // the schema is one migration behind.
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    db.execute_batch(&format!("PRAGMA user_version = {}", version - 1))
        .unwrap();
    db.execute_batch(
        "CREATE TABLE decision_answers (seq INTEGER PRIMARY KEY, decision TEXT NOT NULL UNIQUE,
            agent TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, record TEXT NOT NULL);
         INSERT INTO decision_answers(decision, agent, record) VALUES('d1', '1', '{}');",
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
