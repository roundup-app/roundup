use super::*;

#[tokio::test]
async fn i5765_mcp_project_open_waits_for_the_registered_apps_final_result() {
    let project = start_daemon();
    let user = Client::connect(&project.socket).await.unwrap();
    let door = user
        .request("rail.createWorkstream", json!({"name":"builder"}))
        .await
        .unwrap();
    let mut app = Client::connect(&project.socket).await.unwrap();
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    let shim = spawn_shim(&project.socket, door["id"].as_str().unwrap()).await;
    let tools = shim.client.list_all_tools().await.unwrap();
    let open = tools
        .iter()
        .find(|tool| tool.name == "project_open")
        .unwrap();
    assert!(
        open.description
            .as_ref()
            .unwrap()
            .contains("returns the canonical opened path")
    );
    let target = tempfile::tempdir().unwrap();
    let call = shim.call("project_open", json!({"path":target.path()}));
    tokio::pin!(call);
    loop {
        tokio::select! {
            early = &mut call => panic!("open answered before App completion: {early:?}"),
            request = requests.recv() => {
                let request = request.unwrap();
                let result = if request["method"] == "action.list" { json!([]) } else {
                    assert_eq!(request["method"], "project.open");
                    assert_eq!(request["params"]["agent"]["id"], door["id"]);
                    json!({"path":target.path()})
                };
                app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":result})).await.unwrap();
                if request["method"] == "project.open" { break; }
            }
        }
    }
    let result = call.await;
    assert_eq!(result.is_error, Some(false));
    assert_eq!(
        result.content[0].as_text().unwrap().text,
        format!("opened Project {}", target.path().display())
    );
    project.daemon.abort();
}

#[tokio::test]
async fn i5765_mcp_open_failures_are_tool_errors_with_the_original_cause() {
    let project = start_daemon();
    let target = tempfile::tempdir().unwrap();
    let shim = spawn_shim(&project.socket, "").await;
    let absent = shim
        .call("project_open", json!({"path":target.path()}))
        .await;
    assert_eq!(absent.is_error, Some(true));
    assert!(
        absent.content[0]
            .as_text()
            .unwrap()
            .text
            .contains("open it and retry")
    );
    let mut app = Client::connect(&project.socket).await.unwrap();
    let mut requests = app.take_requests().unwrap();
    app.request("action.serve", Value::Null).await.unwrap();
    for (code, cause) in [
        (-32002, "The user refused the target folder"),
        (-32001, "The target folder is unavailable"),
        (-32603, "The Project database could not be opened"),
        (-32004, "The App connection was lost"),
    ] {
        let call = shim.call("project_open", json!({"path":target.path()}));
        tokio::pin!(call);
        loop {
            tokio::select! {
                early = &mut call => panic!("open answered before App reply: {early:?}"),
                request = requests.recv() => {
                    let request = request.unwrap();
                    if request["method"] == "action.list" {
                        app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"result":[]})).await.unwrap();
                    } else {
                        assert_eq!(request["method"], "project.open");
                        app.reply(&json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":code,"message":cause}})).await.unwrap();
                        break;
                    }
                }
            }
        }
        let result = call.await;
        assert_eq!(result.is_error, Some(true));
        let body = &result.content[0].as_text().unwrap().text;
        assert!(body.contains(cause));
        assert!(body.contains(&code.to_string()));
        assert!(!body.contains("opened Project"));
    }
    project.daemon.abort();
}
