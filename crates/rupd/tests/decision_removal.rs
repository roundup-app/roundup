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
    db.execute_batch(
        r#"INSERT INTO nodes(id,kind,name,ord) VALUES(1,'workstream','kept',0);
         INSERT INTO events(event) VALUES('{"actor":{"kind":"user","id":"you","parent":null},"name":"rail.changed","data":null}');
         INSERT INTO decision_answers(decision,agent,record) VALUES('d1','2','{}');"#,
    ).unwrap();
    for name in ["decision.opened", "decision.cleared"] {
        db.execute(
            "INSERT INTO events(event) VALUES (?1)",
            [legacy_decision_event(name)],
        )
        .unwrap();
    }
    db.execute_batch(
        r#"INSERT INTO nodes(id,kind,name,parent,ord) VALUES(2,'agent','Kept Agent',1,0);
           INSERT INTO todos(id,title,body,created_at,home) VALUES(1,'Kept Todo','todo body',42,'1');
           INSERT INTO pads(key,name,text,updated_at,home)
             VALUES('kept','Kept Pad','pad body',42,'1');
           INSERT INTO routes(from_id,to_id,delivery,set_by) VALUES('2','1','drop','user');
           INSERT INTO messages(id,from_actor,to_id,kind,body,status,at,passed_from)
             VALUES(1,'{"kind":"user","id":"you","parent":null}','2','note','final body','delivered',42,NULL),
                   (2,'{"kind":"agent","id":"2","parent":"1"}','1','note','old question','pending',43,2);"#,
    ).unwrap();
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

    let tree = client.request("rail.tree", Value::Null).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .any(|node| node["id"] == "2" && node["name"] == "Kept Agent")
    );
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    assert_eq!(todos[0]["id"], 1);
    assert_eq!(todos[0]["title"], "Kept Todo");
    assert_eq!(todos[0]["body"], "todo body");
    assert_eq!(todos[0]["home"], "1");
    let pads = client.request("pad.list", Value::Null).await.unwrap();
    assert_eq!(pads[0]["name"], "Kept Pad");
    assert_eq!(pads[0]["text"], "pad body");
    assert_eq!(pads[0]["incarnation"], "1");
    assert_eq!(pads[0]["home"], "1");
    let routes = client.request("route.list", Value::Null).await.unwrap();
    assert!(
        routes
            .as_array()
            .unwrap()
            .iter()
            .any(|route| route["from"] == "2" && route["to"] == "1" && route["delivery"] == "drop")
    );
    let messages = client.request("message.list", json!({})).await.unwrap();
    let messages = messages.as_array().unwrap();
    assert_eq!(messages.len(), 2, "no forwarded question");
    let final_message = messages.iter().find(|message| message["id"] == 1).unwrap();
    assert_eq!(
        final_message,
        &json!({
            "id": 1, "from": {"kind": "user", "id": "you", "parent": null},
            "to": "2", "kind": "note", "body": "final body", "replyTo": null,
            "status": "delivered", "reason": null, "at": 42
        })
    );
    let hop = messages.iter().find(|message| message["id"] == 2).unwrap();
    assert_eq!(hop["body"], "old question");
    assert_eq!(hop["status"], "dropped");
    assert!(
        hop["reason"]
            .as_str()
            .is_some_and(|reason| !reason.is_empty())
    );
    assert_eq!(
        client.request("terminal.list", json!({})).await.unwrap(),
        json!([])
    );

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
