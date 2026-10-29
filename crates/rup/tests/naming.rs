//! Session-fixed naming guides through the real Daemon and built MCP shim.
#[allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use contracts::agent::RailNode;
use rmcp::ServiceExt;
use serde_json::{Value, json};
use std::process::Stdio;
use std::time::Duration;

const G1: &str = "Use three words: role, verb, object; join them with hyphens";
const G2: &str = "Name the task in Japanese: 役割-動作-対象";

async fn save(client: &rpc::Client, guide: &str) {
    client
        .request(
            "daemon.setNaming",
            json!({"automaticRenaming": true, "namingGuide": guide}),
        )
        .await
        .unwrap();
}

async fn spawn(project: &daemon::Project, client: &rpc::Client) -> RailNode {
    serde_json::from_value(
        client
            .request("agent.spawn", json!({"cwd": project.dir.path()}))
            .await
            .unwrap(),
    )
    .unwrap()
}

async fn shim(
    project: &daemon::Project,
    id: &str,
) -> (
    rmcp::service::RunningService<rmcp::service::RoleClient, ()>,
    tokio::process::Child,
) {
    let config: Value = serde_json::from_slice(
        &std::fs::read(project.data_dir().join(format!("agents/{id}.mcp.json"))).unwrap(),
    )
    .unwrap();
    let server = &config["mcpServers"]["roundup"];
    let mut command = tokio::process::Command::new(server["command"].as_str().unwrap());
    command.args(
        server["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|arg| arg.as_str().unwrap()),
    );
    if let Some(env) = server["env"].as_object() {
        command.envs(
            env.iter()
                .map(|(key, value)| (key, value.as_str().unwrap())),
        );
    }
    let mut child = command
        .env("RUPD_SOCKET", project.socket())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = tokio::time::timeout(Duration::from_secs(10), ().serve(transport))
        .await
        .unwrap()
        .unwrap();
    (client, child)
}

fn spawn_description(tools: &rmcp::model::ListToolsResult) -> &str {
    tools
        .tools
        .iter()
        .find(|tool| tool.name == "agent_spawn")
        .unwrap()
        .description
        .as_deref()
        .unwrap()
}

#[tokio::test]
async fn a4688c_the_spawn_tool_receives_the_saved_guide() {
    let project = daemon::start(&[]);
    let user = project.client().await;
    save(&user, G1).await;
    let parent = spawn(&project, &user).await;
    let (mcp, _child) = shim(&project, &parent.id).await;
    let tools = mcp.list_tools(None).await.unwrap();
    assert!(
        spawn_description(&tools).contains(G1),
        "{}",
        spawn_description(&tools)
    );
    let mut call = rmcp::model::CallToolRequestParams::new("agent_spawn");
    call.arguments = Some(json!({"cwd": project.dir.path(), "name": "reviewer-checks-tests", "order": {"kind":"work", "title":"Check tests", "ask":"Check tests", "done":"Tests checked", "limits":["Read only"]}}).as_object().unwrap().clone());
    let result = mcp.call_tool(call).await.unwrap();
    assert_ne!(result.is_error, Some(true), "{result:?}");
    let rail = user.request("rail.tree", ()).await.unwrap();
    assert!(
        rail.as_array()
            .unwrap()
            .iter()
            .any(|node| node["name"] == "reviewer-checks-tests" && node["parent"] == parent.id)
    );
}

#[tokio::test]
async fn a4688d_the_spawn_guide_is_fixed_for_each_launch() {
    let project = daemon::start(&[]);
    let user = project.client().await;
    save(&user, G1).await;
    let first = spawn(&project, &user).await;
    let (mcp, _child) = shim(&project, &first.id).await;
    let before = serde_json::to_value(mcp.list_tools(None).await.unwrap()).unwrap();
    let files = ["settings.json", "brief.md", "mcp.json"].map(|suffix| {
        project
            .data_dir()
            .join(format!("agents/{}.{suffix}", first.id))
    });
    let bytes = files.each_ref().map(|path| std::fs::read(path).unwrap());
    save(&user, G2).await;
    assert_eq!(
        serde_json::to_value(mcp.list_tools(None).await.unwrap()).unwrap(),
        before
    );
    for (path, expected) in files.iter().zip(bytes) {
        assert_eq!(std::fs::read(path).unwrap(), expected);
    }
    // Even a shim connected late in the same vendor launch must retain the launch's guide.
    let (late, _late_child) = shim(&project, &first.id).await;
    assert!(spawn_description(&late.list_tools(None).await.unwrap()).contains(G1));
    let second = spawn(&project, &user).await;
    let (next, _next_child) = shim(&project, &second.id).await;
    let tools = next.list_tools(None).await.unwrap();
    assert!(spawn_description(&tools).contains(G2));
    assert!(!spawn_description(&tools).contains(G1));
}
