//! CL1 to CL4 (`scenarios/rup-ext.md`): the built `rup` against an in-process Daemon on a temp socket.

#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::sync::Arc;
use std::time::Duration;

use contracts::{Actor, ActorKind, IdentifyParams, Touch, Verb};
use rmcp::ServiceExt;
use rmcp::model::CallToolRequestParams;
use serde_json::{Value, json};
use tokio::net::UnixListener;

struct Project {
    dir: tempfile::TempDir,
    socket: PathBuf,
}

fn start_daemon(proof: Option<&str>) -> Project {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let daemon =
        rupd::Daemon::open_with_proof(&dir.path().join(".roundup"), proof.map(Into::into)).unwrap();
    tokio::spawn(rupd::serve(
        UnixListener::bind(&socket).unwrap(),
        Arc::new(daemon),
    ));
    Project { dir, socket }
}

async fn rup(socket: Option<&Path>, home: &Path, args: &[&str]) -> Output {
    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"));
    command.args(args).env("HOME", home).stdin(Stdio::null());
    match socket {
        Some(socket) => command.env("RUPD_SOCKET", socket),
        None => command.env_remove("RUPD_SOCKET"),
    };
    tokio::time::timeout(Duration::from_secs(20), command.output())
        .await
        .unwrap()
        .unwrap()
}

fn ext(name: &str) -> Actor {
    Actor {
        kind: ActorKind::Ext,
        id: format!("ext:{name}"),
        parent: None,
    }
}

async fn client_as(socket: &Path, actor: Actor) -> rpc::Client {
    let client = rpc::Client::connect(socket).await.unwrap();
    client
        .request("daemon.identify", IdentifyParams { actor })
        .await
        .unwrap();
    client
}

fn stdout(out: &Output) -> String {
    String::from_utf8(out.stdout.clone()).unwrap()
}

fn stderr(out: &Output) -> String {
    String::from_utf8(out.stderr.clone()).unwrap()
}

#[tokio::test]
async fn cl1_ping_names_the_daemon_its_socket_and_its_project() {
    let project = start_daemon(None);

    let out = rup(Some(&project.socket), project.dir.path(), &["ping"]).await;

    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        stdout(&out),
        format!(
            "rupd {} at {} for {}\n",
            std::process::id(),
            project.socket.display(),
            project.dir.path().display()
        )
    );
}

#[tokio::test]
async fn cl1_ping_without_a_daemon_names_the_default_socket() {
    let home = tempfile::tempdir().unwrap();

    let out = rup(None, home.path(), &["ping"]).await;

    assert_eq!(out.status.code(), Some(1));
    let err = stderr(&out);
    assert_eq!(err.lines().count(), 1, "{err}");
    assert!(err.contains(&home.path().join(".roundup/rupd.sock").display().to_string()));
}

#[tokio::test]
async fn cl1_ping_json_holds_the_actor_the_socket_and_the_reply() {
    let project = start_daemon(None);

    let out = rup(
        Some(&project.socket),
        project.dir.path(),
        &["--json", "ping"],
    )
    .await;

    let printed: Value = serde_json::from_str(&stdout(&out)).unwrap();
    assert_eq!(printed["socket"], project.socket.display().to_string());
    assert_eq!(printed["result"]["pong"], true);
    assert_eq!(printed["result"]["pid"], std::process::id());
}

#[tokio::test]
async fn cl2_json_prints_who_rup_acted_as() {
    let project = start_daemon(None);
    let home = project.dir.path();

    let user = rup(Some(&project.socket), home, &["--json", "ping"]).await;
    let outside = rup(
        Some(&project.socket),
        home,
        &["--as", "ext:claude-code", "--json", "ping"],
    )
    .await;

    let actor =
        |out: &Output| serde_json::from_str::<Value>(&stdout(out)).unwrap()["actor"].clone();
    assert_eq!(
        actor(&user),
        json!({"kind": "user", "id": "you", "parent": null})
    );
    assert_eq!(
        actor(&outside),
        json!({"kind": "ext", "id": "ext:claude-code", "parent": null})
    );
}

#[tokio::test]
async fn cl2_a_bad_actor_name_exits_2_and_sends_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("none.sock");
    let long = format!("ext:{}", "a".repeat(65));

    for bad in ["ext:", "ext:Upper", "ext:a b", "claude", long.as_str()] {
        let out = rup(Some(&socket), dir.path(), &["--as", bad, "ping"]).await;
        assert_eq!(out.status.code(), Some(2), "{bad}");
        assert!(stderr(&out).contains("--as takes ext:<name>"), "{bad}");
    }
    assert!(!socket.exists());
}

#[tokio::test]
async fn cl2_as_with_an_agent_command_is_refused() {
    let project = start_daemon(None);
    let home = project.dir.path();

    for hook in ["signal", "context", "permission"] {
        let out = rup(Some(&project.socket), home, &["--as", "ext:x", hook, "a1"]).await;
        assert_eq!(out.status.code(), Some(1), "{hook}");
        assert!(stderr(&out).contains("Agent hooks"));
    }
    let both = rup(Some(&project.socket), home, &["--as", "ext:x", "mcp", "a1"]).await;
    assert_eq!(both.status.code(), Some(2));
    let json_mcp = rup(Some(&project.socket), home, &["--json", "mcp"]).await;
    assert_eq!(json_mcp.status.code(), Some(2));
}

#[tokio::test]
async fn cl2_an_ext_actor_mcp_call_is_a_touch_under_its_name() {
    let project = start_daemon(None);
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["--as", "ext:claude-code", "mcp"])
        .env("RUPD_SOCKET", &project.socket)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let shim = tokio::time::timeout(Duration::from_secs(20), ().serve(transport))
        .await
        .unwrap()
        .unwrap();

    let args = json!({"title": "x"});
    let made = shim
        .call_tool(
            CallToolRequestParams::new("todo_create")
                .with_arguments(args.as_object().unwrap().clone()),
        )
        .await
        .unwrap();

    assert_eq!(made.is_error, Some(false));
    let watcher = client_as(&project.socket, Actor::user()).await;
    let history = watcher
        .request("provenance.history", json!({"item": "todo:1"}))
        .await
        .unwrap();
    let touches: Vec<Touch> = serde_json::from_value(history).unwrap();
    assert!(
        touches
            .iter()
            .any(|t| t.verb == Verb::Wrote && t.actor == ext("claude-code"))
    );
    assert!(touches.iter().all(|t| t.actor != Actor::user()));
}

#[tokio::test]
async fn cl3_an_ext_actor_is_forbidden_what_the_daemon_forbids_it() {
    let project = daemon::start(&[]);
    let id = project.spawn_agent(&project.client().await).await.id;
    let outside = client_as(project.socket(), ext("claude-code")).await;

    for method in ["agent.context", "agent.brief", "agent.actionHistory"] {
        let err = outside
            .request(method, json!({ "id": id }))
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::FORBIDDEN, "{method}");
    }
}

#[tokio::test]
async fn cl3_an_ext_actor_todo_and_pad_calls_touch_under_its_name() {
    let project = start_daemon(None);
    let outside = client_as(&project.socket, ext("claude-code")).await;

    outside
        .request("todo.create", json!({"title": "t"}))
        .await
        .unwrap();
    outside
        .request("pad.create", json!({"name": "notes"}))
        .await
        .unwrap();

    for item in ["todo:1", "pad:notes"] {
        let history = outside
            .request("provenance.history", json!({ "item": item }))
            .await
            .unwrap();
        let touches: Vec<Touch> = serde_json::from_value(history).unwrap();
        assert!(!touches.is_empty() && touches.iter().all(|t| t.actor == ext("claude-code")));
    }
}

#[tokio::test]
async fn cl3_an_ext_actor_decision_answer_needs_the_proof() {
    let project = start_daemon(Some("secret"));
    let outside = client_as(&project.socket, ext("claude-code")).await;

    let without = outside
        .request("decision.answer", json!({"id": "d1", "answer": "yes"}))
        .await
        .unwrap_err();
    let with = outside
        .request(
            "decision.answer",
            json!({"id": "d1", "answer": "yes", "proof": "secret"}),
        )
        .await
        .unwrap_err();

    assert_eq!(without.code, rpc::code::FORBIDDEN);
    assert_ne!(with.code, rpc::code::FORBIDDEN);
}

#[tokio::test]
async fn cl4_help_lists_each_command_and_who_may_run_it() {
    let home = tempfile::tempdir().unwrap();

    for args in [&["help"][..], &["--help"], &[]] {
        let out = rup(None, home.path(), args).await;
        assert_eq!(out.status.code(), Some(0), "{args:?}");
        let help = stdout(&out);
        let lines: Vec<&str> = help.lines().collect();
        for (command, who) in [
            ("ping", "User: yes   Ext: yes"),
            ("mcp", "User: yes   Ext: yes"),
            ("signal", "User: no    Ext: no"),
            ("context", "User: no    Ext: no"),
            ("permission", "User: no    Ext: no"),
        ] {
            let at = lines
                .iter()
                .position(|l| l.trim_start().starts_with(command))
                .unwrap_or_else(|| panic!("{command} in {help}"));
            assert!(lines[at + 1].contains(who), "{command}: {}", lines[at + 1]);
        }
        for word in [
            "--as",
            "--json",
            "RUPD_SOCKET",
            "~/.roundup/rupd.sock",
            "rup ping",
        ] {
            assert!(help.contains(word), "{word}");
        }
    }
}

#[tokio::test]
async fn cl4_an_unknown_command_exits_2_with_the_help() {
    let home = tempfile::tempdir().unwrap();

    let out = rup(None, home.path(), &["padd"]).await;

    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).starts_with("rup: unknown command \"padd\"\n"));
    assert!(stderr(&out).contains("User: yes   Ext: yes"));
    assert!(stdout(&out).is_empty());
}

#[path = "common/served.rs"]
mod common;

#[tokio::test]
async fn cl2706a_outside_callers_read_current_rail_names() {
    let fx = common::NamedRail::start().await;
    let (_decision, pending) = fx.decision().await;
    for prefix in [vec!["mcp"], vec!["--as", "ext:observer", "mcp"]] {
        let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
            .args(prefix)
            .env("RUPD_SOCKET", fx.served.socket())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let transport = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
        let shim = tokio::time::timeout(Duration::from_secs(20), ().serve(transport))
            .await
            .unwrap()
            .unwrap();
        let tools = shim.list_all_tools().await.unwrap();
        assert!(!tools.iter().any(|tool| tool.name == "workstream_handoff"));
        for renamed in [false, true] {
            let name = if renamed { "Planning" } else { "Research" };
            if renamed {
                fx.rename().await;
            } else {
                for (id, name) in [
                    (&fx.door, "Research"),
                    (&fx.child, "Writer"),
                    (&fx.peer, "Reviewer"),
                ] {
                    fx.user
                        .request("rail.rename", json!({"id":id,"name":name}))
                        .await
                        .unwrap();
                }
            }
            for (tool, args) in [
                ("rail_move", json!({"id":fx.door,"parent":null,"index":0})),
                ("rail_tree", json!({})),
                ("decision_list", json!({})),
            ] {
                let result = shim
                    .call_tool(
                        CallToolRequestParams::new(tool)
                            .with_arguments(args.as_object().unwrap().clone()),
                    )
                    .await
                    .unwrap();
                assert_eq!(result.is_error, Some(false), "{result:?}");
                let raw = &result.content[0].as_text().unwrap().text;
                match tool {
                    "rail_move" => assert_eq!(raw, &format!("moved {name} to Project root")),
                    "rail_tree" => {
                        let nodes: Value = serde_json::from_str(raw).unwrap();
                        assert_eq!(nodes[0]["name"], name);
                        assert!(
                            nodes
                                .as_array()
                                .unwrap()
                                .iter()
                                .filter(|node| !node["parent"].is_null())
                                .all(|node| node["parent_name"] == name)
                        );
                    }
                    _ => {
                        let decisions: Value = serde_json::from_str(raw).unwrap();
                        assert_eq!(decisions[0]["agent"], fx.child);
                        assert_eq!(
                            decisions[0]["agent_name"],
                            if renamed { "Author" } else { "Writer" }
                        );
                    }
                }
            }
            let disposable = fx.spawn("Disposable").await;
            let discarded_name = if renamed { "Archived" } else { "Disposable" };
            if renamed {
                fx.user
                    .request(
                        "rail.rename",
                        json!({"id":disposable,"name":discarded_name}),
                    )
                    .await
                    .unwrap();
            }
            let discarded = shim
                .call_tool(
                    CallToolRequestParams::new("agent_discard")
                        .with_arguments(json!({"id":disposable}).as_object().unwrap().clone()),
                )
                .await
                .unwrap();
            assert_eq!(discarded.is_error, Some(false), "{discarded:?}");
            assert_eq!(
                discarded.content[0].as_text().unwrap().text,
                format!("discarded Worktree of Agent {discarded_name}")
            );
            let nodes = fx.user.request("rail.tree", ()).await.unwrap();
            assert!(
                nodes
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|node| node["id"] != disposable)
            );
            let forbidden = shim
                .call_tool(CallToolRequestParams::new("agent_context"))
                .await
                .unwrap();
            assert_eq!(forbidden.is_error, Some(true));
        }
    }
    pending.abort();
}

#[tokio::test]
async fn cl2706a_help_explains_rail_names() {
    let project = start_daemon(None);
    for args in [vec![], vec!["help"], vec!["--help"], vec!["-h"]] {
        let output = rup(Some(&project.socket), project.dir.path(), &args).await;
        assert_eq!(output.status.code(), Some(0));
        let help = stdout(&output);
        assert!(
            help.contains("Rail name")
                && help.contains("--json")
                && help.contains("IDs remain command arguments"),
            "{help}"
        );
    }
}
