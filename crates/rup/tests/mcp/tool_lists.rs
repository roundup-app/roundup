//! M5: which methods have a tool for every Agent, for a Door only, or none, with the reason.

use std::path::Path;
/// M5: App seam commands kept outside the RPC declaration.
pub const NO_TOOL: &[&str] = &[
    // U4461: only the user answers native removal consent; Agents use rail.remove within Reach.
    "ask_removal",
    // D8: the App's Resource strip
    "close_project",
    "projects",
    // S6, U52: first-run facts belong to the App; Agents reach only their own Project's Daemon.
    "recent_projects",
    "claude_binary",
    "open_target",
    "open_in_editor",
    "save_pasted_image",
    // U3787f: only the user opens and controls the native Capture presentation.
    "plugin:capture-panel|control",
    // U3560a: only the user writes the native pasteboard.
    "plugin:clipboard-manager|write_text",
    // U2694a: the native menu of the user's right-click
    "show_context_menu",
    // U3813: native commands act on the user’s selected tab.
    "select_project_menu",
    // R24: the measurement-only producer has no Agent tool or execution authority.
    "record_idle_evidence",
    // U5232f: the user's macOS banner and sound, which an Agent cannot raise.
    "state_alert",
    // U449–U451: the user's native window, which an Agent cannot move or rename.
    "plugin:window-bar|set_window_title",
    "plugin:window-bar|drag_window",
    "plugin:window-bar|zoom_window",
    // U134: the user's native window appearance, which an Agent cannot change.
    "plugin:window-bar|native_material",
    // U3787f: the operating system hands the App a roundup link; an Agent reads one with link.read.
    "native_open",
    "rpc",
    "subscribe",
    // NA6: the user's App answers the Daemon's relayed action calls; the Daemon's action methods carry no tool.
    "action_serve",
    "action_answer",
    "terminal_output",
    "terminal_output_stop",
];

pub fn tool_name(method: &str) -> String {
    match method {
        "agent.setOrder" => "agent_set_order".into(),
        other => other.replace('.', "_"),
    }
}

/// The names of the strings inside the first `[...]` after `marker` in `file`.
pub fn quoted_after(file: &str, marker: &str) -> Vec<String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let text = std::fs::read_to_string(root.join(file)).unwrap();
    let start = text
        .find(marker)
        .unwrap_or_else(|| panic!("{marker} in {file}"));
    let open = start + text[start..].find(['[', '{']).unwrap();
    let close = open + text[open..].find([']', '}']).unwrap();
    text[open + 1..close]
        .split(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | ':' | '|' | '-')))
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The seam commands of `apps/desktop/src/app/seam.ts`, and whether `crates/desktop` registers the same.
pub fn seam_commands() -> Vec<String> {
    let table = quoted_after("apps/desktop/src/app/seam.ts", "SEAM_COMMANDS = [");
    let mut registered = quoted_after("crates/desktop/src/lib.rs", "generate_handler![");
    registered.extend(quoted_after(
        "crates/desktop/src/idle.rs",
        "generate_handler![",
    ));
    for command in &mut registered {
        if let Some((_, name)) = command.rsplit_once("::") {
            *command = name.to_owned();
        }
    }
    registered.extend(
        quoted_after("crates/desktop/src/window.rs", "generate_handler![")
            .into_iter()
            .map(|command| format!("plugin:window-bar|{command}")),
    );
    registered.extend(
        quoted_after("crates/native/src/capture.rs", "generate_handler![")
            .into_iter()
            .map(|command| format!("plugin:capture-panel|{command}")),
    );
    // The maintained clipboard plugin registers its own commands. The web adapter observer probes this command.
    registered.push("plugin:clipboard-manager|write_text".into());
    let mut declared = table.clone();
    registered.sort();
    declared.sort();
    assert_eq!(
        registered, declared,
        "seam.ts and the Tauri handler list differ"
    );
    table
}

/// M5, M6: the tools a non-Door Agent is offered.
pub fn expected_tools() -> Vec<String> {
    contracts::methods::metadata()
        .iter()
        .filter(|m| {
            matches!(m.mcp, contracts::methods::McpChoice::All) && m.name != "events.subscribe"
        })
        .map(|m| tool_name(m.name))
        .collect()
}

#[tokio::test]
async fn u3789a_mcp_and_cli_rename_keep_the_guarded_creation() {
    let project = super::start_daemon();
    let owner = super::client_as(&project.socket, super::agent("maker")).await;
    let original = owner
        .request(
            "pad.create",
            serde_json::json!({"name":"Notes","text":"original"}),
        )
        .await
        .unwrap();
    let shim = super::spawn_shim(&project.socket, "maker").await;
    let refused = shim
        .call(
            "pad_rename",
            serde_json::json!({"name":"Notes","newName":"Plan","expectedIncarnation":"stale"}),
        )
        .await;
    assert_eq!(refused.is_error, Some(true));
    assert_eq!(super::text(&refused)["code"], rpc::code::CONFLICT);
    let accepted = shim.call("pad_rename", serde_json::json!({"name":"Notes","newName":"Plan","expectedIncarnation":original["incarnation"]})).await;
    assert_eq!(accepted.is_error, Some(false));
    let mut expected = original.clone();
    expected["name"] = serde_json::json!("Plan");
    assert_eq!(super::text(&accepted), expected);
    let cli = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args([
            "pad",
            "rename",
            "Plan",
            "Final",
            original["incarnation"].as_str().unwrap(),
            "--agent",
            "maker",
        ])
        .env("RUPD_SOCKET", &project.socket)
        .output()
        .await
        .unwrap();
    assert!(
        cli.status.success(),
        "{}",
        String::from_utf8_lossy(&cli.stderr)
    );
    expected["name"] = serde_json::json!("Final");
    assert_eq!(
        owner
            .request("pad.read", serde_json::json!({"name":"Final"}))
            .await
            .unwrap(),
        expected
    );
}

#[tokio::test]
async fn a32_removed_tools_are_unavailable() {
    let project = super::start_daemon();
    let user = super::client_as(&project.socket, contracts::Actor::user()).await;
    let door = user
        .request("rail.createWorkstream", serde_json::json!({"name":"team"}))
        .await
        .unwrap();
    user.request("todo.create", serde_json::json!({"title":"retained task"}))
        .await
        .unwrap();
    user.request(
        "pad.create",
        serde_json::json!({"name":"retained pad","text":"exact text"}),
    )
    .await
    .unwrap();
    let mut before = Vec::new();
    for method in ["rail.tree", "todo.list", "pad.list", "message.list"] {
        before.push(user.request(method, serde_json::json!({})).await.unwrap());
    }
    for id in ["ordinary", door["id"].as_str().unwrap()] {
        let shim = super::spawn_shim(&project.socket, id).await;
        let tools = shim.client.list_all_tools().await.unwrap();
        for name in ["workstream_clear", "workstream_handoff"] {
            assert!(!tools.iter().any(|tool| tool.name == name), "{id}: {name}");
            let error = shim
                .client
                .call_tool(super::CallToolRequestParams::new(name).with_arguments(serde_json::json!({"id":door["id"],"reason":"retired","without_handoff":true,"summary":"retired","keep_todos":[],"keep_pads":[]}).as_object().unwrap().clone()))
                .await
                .unwrap_err();
            let rmcp::service::ServiceError::McpError(error) = error else {
                panic!("{error:?}")
            };
            assert_eq!(error.code.0, -32602);
            assert_eq!(error.message, format!("no tool named {name}"));
        }
        for (method, expected) in ["rail.tree", "todo.list", "pad.list", "message.list"]
            .into_iter()
            .zip(&before)
        {
            assert_eq!(
                &user.request(method, serde_json::json!({})).await.unwrap(),
                expected,
                "{method}"
            );
        }
    }
}

#[tokio::test]
async fn p16_shared_pad_access_over_public_seams() {
    use serde_json::{Value, json};
    let project = super::start_daemon();
    let user = super::client_as(&project.socket, contracts::Actor::user()).await;
    let home = user
        .request("rail.createWorkstream", json!({"name":"Shared Home"}))
        .await
        .unwrap();
    let actors = ["", "first", "second"];
    let mut retained = Vec::new();
    for (index, actor) in actors.iter().enumerate() {
        let caller = if actor.is_empty() {
            contracts::Actor::user()
        } else {
            super::agent(actor)
        };
        let shim = super::spawn_shim(&project.socket, actor).await;
        let tools = shim.client.list_all_tools().await.unwrap();
        assert!(tools.iter().any(|tool| tool.name == "pad_move"));
        assert!(!tools.iter().any(|tool| tool.name == "pad_setOwner"));
        let creator = super::spawn_shim(&project.socket, actors[(index + 1) % actors.len()]).await;
        for cli in [false, true] {
            if actor.is_empty() && cli {
                continue;
            }
            let name = format!("shared-{index}-{cli}");
            let result = creator
                .call("pad_create", json!({"name":name,"text":"original"}))
                .await;
            assert_ne!(result.is_error, Some(true));
            let original = super::text(&result);
            let renamed = format!("{name}-renamed");
            for (method, params, positional, flags) in [
                ("read", json!({"name":name}), vec![name.as_str()], vec![]),
                (
                    "write",
                    json!({"name":name,"text":"replacement"}),
                    vec![name.as_str(), "replacement"],
                    vec![],
                ),
                (
                    "append",
                    json!({"name":name,"text":"+append"}),
                    vec![name.as_str(), "+append"],
                    vec![],
                ),
                (
                    "rename",
                    json!({"name":name,"newName":renamed,"expectedIncarnation":original["incarnation"]}),
                    vec![
                        name.as_str(),
                        renamed.as_str(),
                        original["incarnation"].as_str().unwrap(),
                    ],
                    vec![],
                ),
                (
                    "move",
                    json!({"name":renamed,"home":home["id"]}),
                    vec![renamed.as_str()],
                    vec!["--home", home["id"].as_str().unwrap()],
                ),
            ] {
                if cli {
                    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"));
                    command
                        .args(["--json", "pad", method])
                        .args(positional)
                        .args(flags)
                        .env("RUPD_SOCKET", &project.socket)
                        .env_remove("ROUNDUP_AGENT");
                    if !actor.is_empty() {
                        command.args(["--agent", actor]);
                    }
                    let output = command.output().await.unwrap();
                    assert!(
                        output.status.success(),
                        "{method}: {}",
                        String::from_utf8_lossy(&output.stderr)
                    );
                } else {
                    let result = shim.call(&format!("pad_{method}"), params).await;
                    assert_ne!(result.is_error, Some(true), "{method}: {result:?}");
                }
            }
            let current = user
                .request("pad.read", json!({"name":renamed}))
                .await
                .unwrap();
            assert_eq!(current["text"], "replacement+append");
            assert_eq!(current["home"], home["id"]);
            assert_eq!(current["incarnation"], original["incarnation"]);
            assert_eq!(current["revision"], 3);
            assert!(current.get("owner").is_none());
            for item in [&name, &renamed] {
                let history = user
                    .request("provenance.history", json!({"item":format!("pad:{item}")}))
                    .await
                    .unwrap();
                assert_eq!(
                    history
                        .as_array()
                        .unwrap()
                        .iter()
                        .rfind(|touch| touch["verb"] == "wrote")
                        .unwrap()["actor"],
                    json!(caller)
                );
            }
            let removed = shim
                .call(
                    "pad_delete",
                    json!({"name":renamed,"expectedIncarnation":original["incarnation"]}),
                )
                .await;
            assert_ne!(removed.is_error, Some(true));
            assert!(
                user.request("pad.read", json!({"name":renamed}))
                    .await
                    .is_err()
            );
            let receipt = super::text(&removed);
            let restored = shim
                .call(
                    "pad_restore",
                    json!({"project":receipt["project"],"operation":receipt["operation"]}),
                )
                .await;
            assert_ne!(restored.is_error, Some(true));
            assert_eq!(
                user.request("pad.read", json!({"name":renamed}))
                    .await
                    .unwrap(),
                current
            );
            retained.push(current);
        }
        let _ = creator.client.cancel().await;
        let _ = shim.client.cancel().await;
    }
    project.daemon.abort();
    let _ = project.daemon.await;
    // Reopen the same authoritative Project store; no fixture data is reconstructed.
    let socket = project._dir.path().join("reopened.sock");
    let serving = super::common::serve(project._dir.path(), &socket);
    let reopened = super::client_as(&socket, contracts::Actor::user()).await;
    let listed = reopened.request("pad.list", Value::Null).await.unwrap();
    for pad in retained {
        assert!(listed.as_array().unwrap().contains(&pad));
    }
    let before = reopened.request("pad.list", Value::Null).await.unwrap();
    let error = reopened
        .request("pad.setOwner", json!({"name":"missing"}))
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::METHOD_NOT_FOUND);
    assert_eq!(
        reopened.request("pad.list", Value::Null).await.unwrap(),
        before
    );
    serving.abort();
}

#[test]
fn m5_every_app_action_has_a_tool_or_a_reason() {
    let commands = seam_commands();
    for command in &commands {
        match command.as_str() {
            "open_project" | "rename_project" => {
                let method = if command == "open_project" {
                    "project.open"
                } else {
                    "project.rename"
                };
                assert!(expected_tools().contains(&tool_name(method)));
            }
            _ => assert!(
                NO_TOOL.contains(&command.as_str()),
                "{command} has no App seam policy"
            ),
        }
    }
    for command in NO_TOOL {
        assert!(
            commands.iter().any(|name| name == command),
            "{command} is gone from the App seam"
        );
    }
}
