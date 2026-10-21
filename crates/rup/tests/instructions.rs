//! Instruction identity prerequisite only; result acceptance and continuation are not exercised.
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;

use serde_json::{Value, json};

#[tokio::test]
async fn u3078c_order_replacements_retain_exact_revisions_across_reopen() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    let i1 = json!({"kind":"work", "ask":"Fix login", "done":"Login passes", "limits":["No deployment"]});
    let node = client
        .request(
            "rail.createWorkstream",
            json!({"name":"Login", "parent":null,"order":i1}),
        )
        .await
        .unwrap();
    let id = node["id"].clone();
    let mut expected = vec![i1.clone()];
    for changed in [
        json!({"kind":"work", "ask":"Fix logout", "done":"Login passes", "limits":["No deployment"]}),
        json!({"kind":"work", "ask":"Fix logout", "done":"Logout passes", "limits":["No deployment"]}),
        json!({"kind":"work", "ask":"Fix logout", "done":"Logout passes", "limits":["No schema changes"]}),
        i1.clone(),
    ] {
        client
            .request("agent.setOrder", json!({"id":id,"order":changed}))
            .await
            .unwrap();
        expected.push(changed);
    }
    let before = client
        .request("agent.instructions", json!({"id":id}))
        .await
        .unwrap();
    assert_eq!(
        before["revisions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["order"].clone())
            .collect::<Vec<_>>(),
        expected
    );
    let revisions: std::collections::HashSet<_> = before["revisions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["revision"].as_str().unwrap())
        .collect();
    assert_eq!(revisions.len(), 5);
    // Captured Order retains its existing value comparison, including change-away-and-back.
    client
        .request(
            "agent.setOrder",
            json!({"id":id,"order":i1,"captured":{"order":i1}}),
        )
        .await
        .unwrap();
    let conflict = client
        .request(
            "agent.setOrder",
            json!({"id":id,"order":i1,"captured":{"order":null}}),
        )
        .await
        .unwrap_err();
    assert_eq!(conflict.code, rpc::code::CONFLICT);
    let saved = client
        .request("agent.instructions", json!({"id":id}))
        .await
        .unwrap();
    drop(client);
    project.restart(&[]);
    let client = project.client().await;
    assert_eq!(
        client
            .request("agent.instructions", json!({"id":id}))
            .await
            .unwrap(),
        saved
    );
    let terminals: Value = client.request("terminal.list", Value::Null).await.unwrap();
    assert!(terminals.as_array().unwrap().is_empty());
}
