//! A3564d: the question machinery is gone from the Agent tools and from the Daemon.

use super::*;

#[tokio::test]
async fn a3564d_removed_question_methods_are_not_offered_or_dispatched() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    let tools = shim.client.list_all_tools().await.unwrap();
    let user = client_as(&project.socket, Actor::user()).await;

    for name in ["ask_user", "decision_list", "decision_answer"] {
        assert!(!tools.iter().any(|tool| tool.name == name), "{name}");
        let error = tokio::time::timeout(
            BOUND,
            shim.client.call_tool(CallToolRequestParams::new(name)),
        )
        .await
        .expect("the shim refused the call")
        .unwrap_err();
        let rmcp::service::ServiceError::McpError(error) = error else {
            panic!("expected a protocol error for {name}: {error:?}");
        };
        assert_eq!(error.code.0, -32602, "{name}: {error:?}");
        assert_eq!(error.message, format!("no tool named {name}"));
    }
    for method in [
        "decision.list",
        "decision.answer",
        "agent.permission",
        "agent.ask",
    ] {
        let error = user.request(method, json!({})).await.unwrap_err();
        assert_eq!(
            error.code,
            rpc::code::METHOD_NOT_FOUND,
            "{method}: {error:?}"
        );
    }
}

#[tokio::test]
async fn b3692a_message_pass_is_not_offered_or_dispatched() {
    let project = start_daemon();
    let shim = spawn_shim(&project.socket, "a1").await;
    let tools = shim.client.list_all_tools().await.unwrap();
    assert!(!tools.iter().any(|tool| tool.name == "message_pass"));
    let user = client_as(&project.socket, Actor::user()).await;
    let error = user
        .request("message.pass", json!({"id": 1}))
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::METHOD_NOT_FOUND, "{error:?}");
}
