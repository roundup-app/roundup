//! Session-fixed naming guides through the real Daemon and built MCP shim.
#[allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

#[path = "common/waiting.rs"]
#[allow(dead_code)]
mod waiting;
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
async fn a4688c_launch_and_spawn_receive_the_guide() {
    let reports = tempfile::tempdir().unwrap();
    let report = reports.path().join("{agent}.json");
    let prompts = reports.path().join("prompts.jsonl");
    let project = daemon::start(&[
        ("FAKE_CLAUDE_BRIEF_REPORT", report.to_str().unwrap()),
        ("FAKE_CLAUDE_NAME_REPORT", "1"),
        ("FAKE_CLAUDE_PROMPT_LOG", prompts.to_str().unwrap()),
    ]);
    let user = project.client().await;
    save(&user, G1).await;
    let parent = spawn(&project, &user).await;
    let free = assert_start(reports.path(), &parent.id, G1, "on").await;
    assert!(!free.contains("two or more steps"));
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
    let child = rail
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["name"] == "reviewer-checks-tests")
        .unwrap();
    let text = assert_start(reports.path(), child["id"].as_str().unwrap(), G1, "on").await;
    assert!(text.contains("keep it"), "{text}");
    for scout in [false, true] {
        let mut call = rmcp::model::CallToolRequestParams::new("agent_spawn");
        call.arguments = Some(json!({"cwd":project.dir.path(), "scout":scout, "order":{"kind":"work","title":"Check tests","ask":"Check tests","done":"Tests checked","limits":["Read only"]}}).as_object().unwrap().clone());
        let result = mcp.call_tool(call).await.unwrap();
        assert_ne!(result.is_error, Some(true), "{result:?}");
    }
    let rail = user.request("rail.tree", ()).await.unwrap();
    for child in rail
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["parent"] == parent.id)
    {
        assert_start(reports.path(), child["id"].as_str().unwrap(), G1, "on").await;
    }
    let unnamed_on = rail
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["parent"] == parent.id && n["name"] != "reviewer-checks-tests")
        .unwrap();
    let id_on = unnamed_on["id"].as_str().unwrap();
    user.request(
        "agent.prompt",
        json!({"id":id_on,"text":"Fix the refresh race in token.ts"}),
    )
    .await
    .unwrap();
    waiting::until_async("unnamed child uses the first-prompt fallback", || async {
        let tree = user.request("rail.tree", ()).await.unwrap();
        tree.as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == id_on && n["name"] == "fix-refresh-race")
            .then_some(())
    })
    .await;
    user.request(
        "daemon.setNaming",
        json!({"automaticRenaming":false,"namingGuide":G1}),
    )
    .await
    .unwrap();
    let before_off = user.request("rail.tree", ()).await.unwrap();
    let mut call = rmcp::model::CallToolRequestParams::new("agent_spawn");
    call.arguments = Some(json!({"cwd":project.dir.path(),"order":{"kind":"work","title":"Keep current name","ask":"Keep current name","done":"Checked","limits":["Read only"]}}).as_object().unwrap().clone());
    let result = mcp.call_tool(call).await.unwrap();
    assert_ne!(result.is_error, Some(true), "{result:?}");
    let after_off = user.request("rail.tree", ()).await.unwrap();
    let unnamed = after_off
        .as_array()
        .unwrap()
        .iter()
        .find(|node| {
            !before_off
                .as_array()
                .unwrap()
                .iter()
                .any(|old| old["id"] == node["id"])
        })
        .unwrap();
    let id = unnamed["id"].as_str().unwrap();
    assert_start(reports.path(), id, G1, "off").await;
    user.request(
        "agent.prompt",
        json!({"id":id,"text":"Fix the refresh race in token.ts"}),
    )
    .await
    .unwrap();
    waiting::idle(&user, id).await;
    let after = user.request("rail.tree", ()).await.unwrap();
    assert_eq!(
        after
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .unwrap()["name"],
        unnamed["name"]
    );
    let workstream = user
        .request(
            "rail.createWorkstream",
            json!({"name":"Door keeps this","parent":null}),
        )
        .await
        .unwrap();
    user.request("rail.startDoor", json!({"id":workstream["id"]}))
        .await
        .unwrap();
    let text = assert_start(
        reports.path(),
        workstream["id"].as_str().unwrap(),
        G1,
        "off",
    )
    .await;
    assert!(text.contains("Keep your current name"));
    assert!(text.contains("Door keeps this"));
    let door_id = workstream["id"].as_str().unwrap();
    let door_brief = std::fs::read_to_string(
        project
            .data_dir()
            .join(format!("agents/{door_id}.brief.md")),
    )
    .unwrap();
    assert!(door_brief.find("two or more steps").unwrap() < door_brief.find("## Tools").unwrap());
    let (door_mcp, _door_shim) = shim(&project, door_id).await;
    for scout in [false, true] {
        let mut call = rmcp::model::CallToolRequestParams::new("agent_spawn");
        call.arguments = Some(json!({"cwd":project.dir.path(),"name": if scout {"scout-keeps-guide"} else {"reader-keeps-guide"},"scout":scout,"order":{"kind":"work","title":"Read guide","ask":"Read guide","done":"Read","limits":["Read only"]}}).as_object().unwrap().clone());
        let result = door_mcp.call_tool(call).await.unwrap();
        assert_ne!(result.is_error, Some(true), "{result:?}");
    }
    let tree = user.request("rail.tree", ()).await.unwrap();
    for child in tree
        .as_array()
        .unwrap()
        .iter()
        .filter(|n| n["parent"] == door_id)
    {
        let id = child["id"].as_str().unwrap();
        let startup = assert_start(reports.path(), id, G1, "off").await;
        for rule in [
            "two or more steps",
            "complete each",
            "handoff",
            "without approval",
            "reason",
            "end your turn",
            "never poll",
            "user moves win",
        ] {
            assert!(startup.contains(rule), "missing {rule}: {startup}");
        }
        if let Some(catalogue) = startup.find("## Tools") {
            assert!(startup.find("two or more steps").unwrap() < catalogue);
        }
        let brief =
            std::fs::read_to_string(project.data_dir().join(format!("agents/{id}.brief.md")))
                .unwrap();
        assert!(!brief.contains("two or more steps"));
        assert!(child["name"].as_str().unwrap().ends_with("keeps-guide"));
    }
}

#[tokio::test]
async fn a4688d_guide_is_fixed_for_each_session() {
    let reports = tempfile::tempdir().unwrap();
    let report = reports.path().join("{agent}.json");
    let prompts = reports.path().join("prompts.jsonl");
    let project = daemon::start(&[
        ("FAKE_CLAUDE_BRIEF_REPORT", report.to_str().unwrap()),
        ("FAKE_CLAUDE_NAME_REPORT", "1"),
        ("FAKE_CLAUDE_PROMPT_LOG", prompts.to_str().unwrap()),
    ]);
    let user = project.client().await;
    save(&user, G1).await;
    let first = spawn(&project, &user).await;
    let (mcp, _child) = shim(&project, &first.id).await;
    assert_start(reports.path(), &first.id, G1, "on").await;
    waiting::idle(&user, &first.id).await;
    let prompt_bytes = std::fs::read(&prompts).unwrap_or_default();
    let before = serde_json::to_value(mcp.list_tools(None).await.unwrap()).unwrap();
    let files = ["settings.json", "brief.md", "mcp.json"].map(|suffix| {
        project
            .data_dir()
            .join(format!("agents/{}.{suffix}", first.id))
    });
    let bytes = files.each_ref().map(|path| std::fs::read(path).unwrap());
    let rail_before = user.request("rail.tree", ()).await.unwrap();
    save(&user, G2).await;
    assert_eq!(user.request("rail.tree", ()).await.unwrap(), rail_before);
    assert_eq!(
        serde_json::to_value(mcp.list_tools(None).await.unwrap()).unwrap(),
        before
    );
    for (path, expected) in files.iter().zip(bytes) {
        assert_eq!(std::fs::read(path).unwrap(), expected);
    }
    assert_eq!(std::fs::read(&prompts).unwrap_or_default(), prompt_bytes);
    // Even a shim connected late in the same vendor launch must retain the launch's guide.
    let (late, _late_child) = shim(&project, &first.id).await;
    assert!(spawn_description(&late.list_tools(None).await.unwrap()).contains(G1));
    let second = spawn(&project, &user).await;
    assert_start(reports.path(), &second.id, G2, "on").await;
    let (next, _next_child) = shim(&project, &second.id).await;
    let tools = next.list_tools(None).await.unwrap();
    assert!(spawn_description(&tools).contains(G2));
    assert!(!spawn_description(&tools).contains(G1));
    let mut call = rmcp::model::CallToolRequestParams::new("agent_spawn");
    call.arguments = Some(json!({"cwd":project.dir.path(),"name":"reader-checks-guide","order":{"kind":"work","title":"Read guide","ask":"Read guide","done":"Read","limits":["Read only"]}}).as_object().unwrap().clone());
    let result = next.call_tool(call).await.unwrap();
    assert_ne!(result.is_error, Some(true), "{result:?}");
    let tree = user.request("rail.tree", ()).await.unwrap();
    let child = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["parent"] == second.id)
        .unwrap();
    assert_start(reports.path(), child["id"].as_str().unwrap(), G2, "on").await;
    user.request("agent.stop", json!({"id":first.id}))
        .await
        .unwrap();
    std::fs::remove_file(reports.path().join(format!("{}.json", first.id))).unwrap();
    user.request("agent.resume", json!({"id":first.id}))
        .await
        .unwrap();
    assert_start(reports.path(), &first.id, G2, "on").await;
    let (resumed, _resumed_child) = shim(&project, &first.id).await;
    assert!(spawn_description(&resumed.list_tools(None).await.unwrap()).contains(G2));
}

async fn assert_start(dir: &std::path::Path, id: &str, guide: &str, state: &str) -> String {
    let report = waiting::until("SessionStart hook report", || {
        std::fs::read(dir.join(format!("{id}.json")))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
    })
    .await;
    let text = report["startup"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v["hookSpecificOutput"]["additionalContext"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains(guide), "{text}");
    assert!(
        text.contains(&format!("Automatic self-naming is {state}")),
        "{text}"
    );
    assert!(text.contains("Your Rail name is"), "{text}");
    text
}
