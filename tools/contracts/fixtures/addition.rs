use super::*;
use rmcp::model::{CallToolRequestParams, CallToolResult};
use serde_json::json;
use std::sync::Arc;

#[tokio::test]
async fn c4_one_declaration_reaches_every_surface() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("mcp.sock");
    let daemon = Arc::new(rupd::Daemon::open(dir.path()).unwrap());
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    let server = tokio::spawn(rupd::serve(listener, daemon));
    let actor = Actor { kind: ActorKind::Agent, id: "fixture-agent".into(), parent: None };
    let direct = rpc::Client::connect(&socket).await.unwrap();
    direct.request("daemon.identify", json!({"actor": actor.clone()})).await.unwrap();
    let removed = std::env::var_os("C4_REMOVED").is_some();
    assert_eq!(contracts::methods::method_names().iter().filter(|name| **name == "project.contractProbe").count(), usize::from(!removed));
    for list in [tools(false), door_tools()] {
        assert_eq!(list.iter().filter(|offer| offer.method == "project.contractProbe").count(), usize::from(!removed));
    }
    // The wire namespace is Project, but the single declaration gives ownership to Todos.
    let result = direct.request("project.contractProbe", json!({"id": 41})).await;
    if removed {
        assert_eq!(result.unwrap_err().code, rpc::code::METHOD_NOT_FOUND);
    } else {
        assert_eq!(result.unwrap(), json!({"id": 42}));
    }
    let (client, transport) = tokio::io::duplex(65536);
    let (gone, _) = mpsc::channel(1);
    let shim = Shim { socket, actor, tools: tools(false), gone };
    let service = tokio::spawn(async move { shim.serve(transport).await.unwrap().waiting().await });
    let client = ().serve(client).await.unwrap();
    let outcome = client.call_tool(CallToolRequestParams::new("project_contractProbe").with_arguments(JsonObject::from_iter([("id".into(), 51.into())]))).await;
    if removed {
        assert!(outcome.is_err());
    } else {
        let result: CallToolResult = outcome.unwrap();
        assert_eq!(result.content[0].as_text().unwrap().text, "{\"id\":52}");
    }
    let history = direct.request("provenance.history", json!({"item":"c4:contractProbe"})).await.unwrap();
    assert_eq!(history.as_array().unwrap().len(), if removed { 0 } else { 2 }, "a non-offered call must never reach the handler");
    client.cancel().await.unwrap();
    drop(direct);
    server.abort();
    service.abort();
}
