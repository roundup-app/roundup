use super::*;
use crate::tests::ask;
use serde_json::json;

fn daemon() -> (tempfile::TempDir, Daemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::tests::daemon_in(dir.path());
    (dir, daemon)
}

async fn call(daemon: &Daemon, method: &str, params: Value) -> Value {
    let line = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params});
    ask(daemon, &line.to_string()).await
}

fn valid(schema: &Value, instance: &Value) -> bool {
    jsonschema::validator_for(schema)
        .expect("a schema the Daemon served compiles")
        .is_valid(instance)
}

#[tokio::test]
async fn i10_list_names_every_method_the_daemon_serves() {
    let (_dir, daemon) = daemon();
    let reply = call(&daemon, "api.list", Value::Null).await;
    let listed: Vec<&str> = reply["result"]["methods"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap())
        .collect();
    let served = call(&daemon, "daemon.methods", Value::Null).await;
    let served: Vec<&str> = served["result"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_str().unwrap())
        .collect();
    assert_eq!(listed, served);
    assert!(listed.contains(&"api.list") && listed.contains(&"api.describe"));
}

#[tokio::test]
async fn i10_describe_gives_summary_params_result_and_example() {
    let (_dir, daemon) = daemon();
    let reply = call(&daemon, "api.describe", json!({"method": "todo.create"})).await;
    let described = &reply["result"];
    assert_eq!(described["name"], "todo.create");
    assert!(
        described["description"]
            .as_str()
            .unwrap()
            .starts_with(described["summary"].as_str().unwrap().trim_end_matches('.'))
    );
    let properties = &described["params"]["properties"];
    assert!(properties.get("title").is_some() && properties.get("owner").is_some());
    assert!(valid(&described["params"], &described["example"]["params"]));
    assert!(valid(&described["result"], &described["example"]["result"]));
}

#[tokio::test]
async fn i10_every_listed_method_describes_itself_with_a_valid_example() {
    let (_dir, daemon) = daemon();
    let list = call(&daemon, "api.list", Value::Null).await;
    let mut bad: Vec<String> = Vec::new();
    for entry in list["result"]["methods"].as_array().unwrap() {
        let name = entry["name"].as_str().unwrap();
        let reply = call(&daemon, "api.describe", json!({"method": name})).await;
        let described = &reply["result"];
        assert_eq!(described["name"], name, "{reply}");
        for part in ["params", "result"] {
            if !valid(&described[part], &described["example"][part]) {
                let errors: Vec<String> = jsonschema::validator_for(&described[part])
                    .unwrap()
                    .iter_errors(&described["example"][part])
                    .map(|e| e.to_string())
                    .collect();
                bad.push(format!("{name} {part}: {errors:?}"));
            }
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}

#[tokio::test]
async fn i10_an_unknown_method_is_method_not_found_naming_it() {
    let (_dir, daemon) = daemon();
    let reply = call(&daemon, "api.describe", json!({"method": "todo.creat"})).await;
    assert_eq!(reply["error"]["code"], rpc::code::METHOD_NOT_FOUND);
    let message = reply["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("todo.creat") && message.contains("todo.create"),
        "{message}"
    );
}

#[tokio::test]
async fn i10_a_missing_method_is_invalid_params() {
    let (_dir, daemon) = daemon();
    for params in [Value::Null, json!({}), json!({"method": 3})] {
        let reply = call(&daemon, "api.describe", params).await;
        assert_eq!(reply["error"]["code"], rpc::code::INVALID_PARAMS, "{reply}");
    }
}

#[tokio::test]
async fn i10_other_replies_are_unchanged() {
    let (_dir, daemon) = daemon();
    let head = |reply: Value| reply["result"]["head"].clone();
    let before = head(call(&daemon, "events.subscribe", Value::Null).await);
    call(&daemon, "api.list", Value::Null).await;
    call(&daemon, "api.describe", json!({"method": "todo.list"})).await;
    assert_eq!(
        head(call(&daemon, "events.subscribe", Value::Null).await),
        before
    );
    let ping = call(&daemon, "daemon.ping", Value::Null).await;
    assert_eq!(ping["result"]["pong"], true);
    assert_eq!(
        ping["result"]["contract"]["fingerprint"],
        json!(contracts::methods::fingerprint())
    );
}
