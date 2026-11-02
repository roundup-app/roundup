use super::*;
use rmcp::model::{CallToolRequestParams, CallToolResult};
use serde_json::json;

#[tokio::test]
async fn c4_one_declaration_reaches_every_surface() {
    let project = crate::start_daemon();
    let socket = project.socket.clone();
    let actor = Actor { kind: ActorKind::Agent, id: "fixture-agent".into(), parent: None };
    let direct = rpc::Client::connect(&socket).await.unwrap();
    direct.request("daemon.identify", json!({"actor": actor.clone()})).await.unwrap();
    let removed = std::env::var_os("C4_REMOVED").is_some();
    let no_tool = std::env::var_os("C4_NO_TOOL").is_some();
    let door_only = std::env::var_os("C4_DOOR_ONLY").is_some();
    assert_eq!(contracts::methods::method_names().iter().filter(|name| **name == "project.contractProbe").count(), usize::from(!removed));
    // The wire namespace is Project, but the single declaration gives ownership to Todos.
    let result = direct.request("project.contractProbe", json!({"id": 41})).await;
    if removed {
        assert_eq!(result.unwrap_err().code, rpc::code::METHOD_NOT_FOUND);
    } else {
        assert_eq!(result.unwrap(), json!({"id": 42}));
    }
    let metadata = contracts::methods::metadata().into_iter().find(|m| m.name == "project.contractProbe");
    if removed {
        assert!(metadata.is_none());
        assert!(contracts::describe::describe("project.contractProbe").is_err());
    } else {
        let described = direct.request("api.describe", json!({"method":"project.contractProbe"})).await.unwrap();
        assert_eq!(described["description"], "A harmless contract fixture.");
        let disposition = metadata.unwrap().perf;
        if no_tool {
            assert!(matches!(disposition, contracts::methods::PerfDisposition::OffPath("Fixture outside workload")));
        } else {
            assert!(matches!(disposition, contracts::methods::PerfDisposition::Measured(&["ping_p95_ms"])));
        }
    }
    let mut delivered = usize::from(!removed);
    for (door, id, expected) in [(false, 51, json!({"id":52})), (true, 61, json!({"id":62}))] {
        let allowed = !removed && !no_tool && (door || !door_only);
        let offers = if door { door_tools() } else { tools(false) };
        assert_eq!(offers.iter().filter(|offer| offer.method == "project.contractProbe").count(), usize::from(allowed));
        let (client, transport) = tokio::io::duplex(65536);
        let shim = Shim { socket: socket.clone(), actor: actor.clone(), tools: offers };
        let service = tokio::spawn(async move { shim.serve(transport).await.unwrap().waiting().await });
        let client = ().serve(client).await.unwrap();
        let outcome = client.call_tool(CallToolRequestParams::new("project_contractProbe").with_arguments(JsonObject::from_iter([("id".into(), id.into())]))).await;
        if allowed {
            let result: CallToolResult = outcome.unwrap();
            let value: Value = serde_json::from_str(&result.content[0].as_text().unwrap().text).unwrap();
            assert_eq!(value, expected);
            delivered += 1;
        } else {
            assert!(outcome.is_err());
        }
        let history = direct.request("provenance.history", json!({"item":"c4:contractProbe"})).await.unwrap();
        assert_eq!(history.as_array().unwrap().len(), delivered, "a non-offered call must never reach the live handler");
        client.cancel().await.unwrap();
        service.abort();
    }
    drop(direct);
    project.daemon.abort();
}
