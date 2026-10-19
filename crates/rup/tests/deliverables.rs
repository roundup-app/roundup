//! DV1–DV4: deliberately published results through the real Project Daemon.
#[path = "common/served.rs"]
mod common;
use serde_json::{Value, json};

#[tokio::test]
async fn dv1_publication_identity() {
    let a = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let b = common::Served::start("#!/bin/sh\nexit 0\n", &[]).await;
    let ca = rpc::Client::connect(&a.socket()).await.unwrap();
    let cb = rpc::Client::connect(&b.socket()).await.unwrap();
    let request = json!({"key":"result-1", "title":"Result", "target":{"kind":"external", "url":"https://example.com/pr/1"}});
    let first = ca.request("deliverable.publish", request.clone()).await.unwrap();
    let second = cb.request("deliverable.publish", request.clone()).await.unwrap();
    assert_ne!(first["project"], second["project"]);
    assert_ne!(first["id"], second["id"]);
    assert_eq!(first["maker"]["kind"], "user");
    assert_eq!(first["title"], "Result");
    assert_eq!(first["target"]["kind"], "external");
    assert_eq!(ca.request("deliverable.publish", request).await.unwrap(), first);
    assert!(ca.request("deliverable.get", json!({"project":second["project"],"id":second["id"]})).await.is_err());
    assert_eq!(ca.request("deliverable.list", json!({})).await.unwrap(), json!([first]));
    assert_eq!(cb.request("deliverable.list", json!({})).await.unwrap(), json!([second]));
    let _: Value = json!(null);
}
