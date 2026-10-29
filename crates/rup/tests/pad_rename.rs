//! U3789a's bounded rename prerequisite, through the real Daemon, CLI and MCP.
#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use serde_json::json;

#[tokio::test]
async fn u3789a_real_daemon_rename_retains_publication_after_restart() {
    let mut project = daemon::start(&[]);
    let client = project.client().await;
    let home = client
        .request("rail.createWorkstream", json!({"name":"Home"}))
        .await
        .unwrap();
    let original = client
        .request(
            "pad.create",
            json!({"name":"Notes","text":"retained\n revision"}),
        )
        .await
        .unwrap();
    client
        .request("pad.move", json!({"name":"Notes","home":home["id"]}))
        .await
        .unwrap();
    let publication = client.request("deliverable.publish", json!({"key":"result","title":"Original","target":{"kind":"pad","name":"Notes","incarnation":original["incarnation"],"revision":original["revision"]}})).await.unwrap();
    client
        .request("pad.setStorage", json!({"files":true}))
        .await
        .unwrap();
    client
        .request(
            "pad.rename",
            json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]}),
        )
        .await
        .unwrap();
    project.restart(&[]);
    let client = project.client().await;
    let mut expected = original.clone();
    expected["name"] = json!("Plan");
    expected["home"] = home["id"].clone();
    assert_eq!(
        client
            .request("pad.read", json!({"name":"Plan"}))
            .await
            .unwrap(),
        expected
    );
    assert_eq!(
        client
            .request(
                "deliverable.get",
                json!({"project":publication["project"],"id":publication["id"]})
            )
            .await
            .unwrap(),
        publication
    );
    let resolved = client
        .request(
            "deliverable.resolve",
            json!({"project":publication["project"],"id":publication["id"]}),
        )
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(resolved["path"].as_str().unwrap()).unwrap(),
        "retained\n revision"
    );
    client
        .request("pad.create", json!({"name":"Notes","text":"replacement"}))
        .await
        .unwrap();
    assert_eq!(client.request("pad.rename", json!({"name":"Notes","newName":"Wrong","expectedIncarnation":original["incarnation"]})).await.unwrap_err().code, rpc::code::CONFLICT);
    assert_eq!(
        client
            .request("pad.read", json!({"name":"Notes"}))
            .await
            .unwrap()["text"],
        "replacement"
    );
    assert_eq!(
        std::fs::read_to_string(project.data_dir().join("pads/Plan.md")).unwrap(),
        "retained\n revision"
    );
}

#[tokio::test]
async fn p16_the_user_renames_an_agent_owned_pad() {
    let project = daemon::start(&[]);
    let client = project.client().await;
    let original = client
        .request("pad.create", json!({"name":"Notes","text":"original"}))
        .await
        .unwrap();
    let accepted = client
        .request(
            "pad.rename",
            json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]}),
        )
        .await
        .unwrap();
    assert_eq!(accepted["incarnation"], original["incarnation"]);
    assert_eq!(accepted["owner"]["id"], "maker");
    assert_eq!(accepted["text"], "original");
}
