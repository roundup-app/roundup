//! Retained execution evidence through the real Daemon and public callers.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
use serde_json::{Value, json};

#[tokio::test]
async fn u3078a_reopen_retains_exact_progress_without_starting() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    let node = client.request("rail.createWorkstream", json!({"name":"Login","order":{"kind":"work","ask":"Fix login","done":"Login passes","limits":["No deployment"]}})).await.unwrap();
    let query = json!({"project":project.dir.path(),"id":node["id"]});
    let before = client.request("message.progress", query.clone()).await.unwrap();
    assert_eq!(before["instructions"]["revisions"][0]["order"]["ask"], "Fix login");
    assert!(before["results"].as_array().unwrap().is_empty());
    drop(client);
    project.restart(&[]);
    let client = project.client().await;
    assert_eq!(client.request("message.progress", query).await.unwrap(), before);
    assert_eq!(client.request("terminal.list", Value::Null).await.unwrap(), json!([]));
}
