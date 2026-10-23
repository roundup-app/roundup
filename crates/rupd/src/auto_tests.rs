use super::*;
use crate::tests::ask;

async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    let response = ask(
        daemon,
        &json!({"id":1,"method":method,"params":params}).to_string(),
    )
    .await;
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

#[tokio::test]
async fn a3308_set_auto_persists_and_emits_once() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = Daemon::open(dir.path()).unwrap();
    let node = call(&daemon, "rail.createWorkstream", json!({"name":"Ship"})).await;
    let mut events = daemon.bus.subscribe();
    call(
        &daemon,
        "workstream.setAuto",
        json!({"id":node["id"],"auto":true}),
    )
    .await;
    let mut updates = 0;
    while let Ok(event) = events.try_recv() {
        if serde_json::to_value(event).unwrap()["name"] == "workstream.updated" {
            updates += 1;
        }
    }
    assert_eq!(updates, 1);
    drop(daemon);
    let reopened = Daemon::open(dir.path()).unwrap();
    let rail = call(&reopened, "rail.list", Value::Null).await;
    assert_eq!(rail[0]["auto"], true);
}
