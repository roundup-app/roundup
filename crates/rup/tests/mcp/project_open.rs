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
