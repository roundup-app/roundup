//! T29: an Agent sets a Todo's estimate through the `roundup` MCP server.
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use contracts::{Actor, ActorKind, IdentifyParams};
use rmcp::ServiceExt;
use rmcp::model::CallToolRequestParams;
use serde_json::{Value, json};
use tokio::net::UnixListener;

fn agent(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    }
}

#[tokio::test]
async fn t29_mcp_todo_update_sets_the_estimate() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let daemon = Arc::new(rupd::Daemon::open(&dir.path().join(".roundup")).unwrap());
    let _daemon = tokio::spawn(rupd::serve(UnixListener::bind(&socket).unwrap(), daemon));
    let user = rpc::Client::connect(&socket).await.unwrap();
    user.request(
        "daemon.identify",
        IdentifyParams {
            actor: Actor::user(),
        },
    )
    .await
    .unwrap();
    user.request("todo.create", json!({"title": "ship"}))
        .await
        .unwrap();

    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["mcp", "a1"])
        .env("RUPD_SOCKET", &socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let shim = tokio::time::timeout(Duration::from_secs(20), ().serve(transport))
        .await
        .unwrap()
        .unwrap();
    let mut request = CallToolRequestParams::new("todo_update");
    request = request.with_arguments(
        json!({"id": 1, "estimate_minutes": 45})
            .as_object()
            .unwrap()
            .clone(),
    );
    let result = shim.call_tool(request).await.unwrap();
    assert_ne!(result.is_error, Some(true));
    let reply: Value = serde_json::from_str(&result.content[0].as_text().unwrap().text).unwrap();
    assert_eq!(reply["estimate_minutes"], 45);

    let history = user
        .request("todo.getHistory", json!({"id": 1}))
        .await
        .unwrap();
    assert_eq!(history["changes"][1]["actor"], json!(agent("a1")));
    assert_eq!(history["changes"][1]["after"]["estimate_minutes"], 45);
    let touches = user
        .request("provenance.history", json!({"item": "todo:1"}))
        .await
        .unwrap();
    assert!(
        touches
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["verb"] == "wrote" && t["actor"] == json!(agent("a1")))
    );
    let _ = shim.cancel().await;
}
