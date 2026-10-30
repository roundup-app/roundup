// T4902 removes the retired T29 migration; the same non-duration upgrade boundary is retained.
//! U4454c, U4454d: no Time or Timeline reads or stores measurements.
use rpc::{Client, code};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::net::UnixListener;

#[allow(dead_code)]
mod storage {
    include!("support/store_migrations.rs");
}

async fn serve(dir: &std::path::Path) -> Client {
    let daemon = Arc::new(rupd::Daemon::open(dir).unwrap());
    let socket = dir.join("rupd.sock");
    tokio::spawn(rupd::serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::clone(&daemon),
    ));
    Client::connect(&socket).await.unwrap()
}

#[tokio::test]
async fn u4454c_the_daemon_serves_no_measurement_summary() {
    let dir = tempfile::tempdir().unwrap();
    let client = serve(dir.path()).await;
    for method in ["project.measurementSummary", "project.measurements"] {
        let refusal = client.request(method, json!({})).await.unwrap_err();
        assert_eq!(refusal.code, code::METHOD_NOT_FOUND, "{method}");
    }
}

#[tokio::test]
async fn u4454d_a_project_opens_without_measurement_tables() {
    let dir = tempfile::tempdir().unwrap();
    let db = storage::project(dir.path(), 36);
    db.execute_batch(
        r#"INSERT INTO nodes(id,kind,name,ord) VALUES(1,'workstream','kept',0);
           INSERT INTO nodes(id,kind,name,parent,ord) VALUES(2,'agent','Kept Agent',1,0);
           INSERT INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage)
             VALUES('m','1','roundup:2','2','1','1','Kept Agent',1000,'{}','[]');
           INSERT INTO todos(id,title,body,created_at,home) VALUES(1,'Kept Todo','todo body',42,'1');"#,
    )
    .unwrap();
    drop(db);

    let client = serve(dir.path()).await;
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    let left: Vec<String> = db
        .prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'measurement%'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert!(left.is_empty(), "{left:?}");

    let tree = client.request("rail.tree", Value::Null).await.unwrap();
    let names: Vec<_> = tree
        .as_array()
        .unwrap()
        .iter()
        .map(|node| node["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(names, ["kept", "Kept Agent"]);
    let todos = client.request("todo.list", Value::Null).await.unwrap();
    assert_eq!(todos[0]["title"], "Kept Todo");
}
