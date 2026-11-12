use super::*;

pub(super) async fn question_to(shim: &mut Shim, project: &Project, to: &str) -> Value {
    let sent = shim
        .call(
            "message_send",
            json!({ "to": to, "kind": "question", "body": "which file?" }),
        )
        .await;
    let user = project.client().await;
    let listed = user
        .request("message.list", json!({ "to": to }))
        .await
        .unwrap();
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == sent["id"] && m["body"] == "which file?"),
        "{listed}"
    );
    sent
}

#[tokio::test]
pub(super) async fn e5_ask_to_is_a_valid_recipient_for_a_door_and_for_the_user() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;

    for id in [&rail.a, &rail.c] {
        let mut shim = Shim::start(&project, id).await;
        let context: Context =
            serde_json::from_value(shim.call("agent_context", json!({})).await).unwrap();
        question_to(&mut shim, &project, &context.ask.to).await;
    }
    let mut shim = Shim::start(&project, &rail.a).await;
    question_to(&mut shim, &project, &rail.b).await;
}

#[tokio::test]
pub(super) async fn e3_rup_context_prints_the_brief_verbatim_and_exits_0() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let brief = user
        .request("agent.brief", json!({ "id": rail.a }))
        .await
        .unwrap();

    let out = Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["context", &rail.a])
        .env("RUPD_SOCKET", socket(&project))
        .output()
        .unwrap();

    assert_eq!(out.status.code(), Some(0));
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        brief["stdout"].as_str().unwrap()
    );
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    let other = as_a
        .request("agent.brief", json!({ "id": rail.b }))
        .await
        .unwrap_err();
    assert_eq!(other.code, rpc::code::FORBIDDEN);
    let missing = user
        .request("agent.brief", json!({ "id": "nobody" }))
        .await
        .unwrap_err();
    assert_eq!(missing.code, rpc::code::NOT_FOUND);
}

#[tokio::test]
pub(super) async fn e3_a_dead_daemon_gives_one_stderr_line_no_stdout_and_exit_0() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("none.sock");

    let out = Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["context", "a1"])
        .env("RUPD_SOCKET", &socket)
        .output()
        .unwrap();

    assert_eq!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(stderr.lines().count(), 1, "{stderr}");
    assert!(stderr.contains(socket.to_str().unwrap()), "{stderr}");
}

#[tokio::test]
pub(super) async fn e3_a_daemon_that_never_answers_is_given_up_on_within_five_seconds() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("hung.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((stream, _)) = listener.accept().await {
            held.push(stream);
        }
    });

    let started = std::time::Instant::now();
    let out = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["context", "a1"])
        .env("RUPD_SOCKET", &socket)
        .output()
        .await
        .unwrap();

    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(out.status.code(), Some(0));
    assert!(out.stdout.is_empty());
    assert_eq!(String::from_utf8_lossy(&out.stderr).lines().count(), 1);
}

pub(super) async fn next_channel(client: &mut rpc::Client, id: &str) -> Channel {
    next(client, |data| match data {
        EventData::AgentChannel(event) if event.id == id => Some(event.channel),
        _ => None,
    })
    .await
}

#[tokio::test]
pub(super) async fn e6_only_the_agent_reports_its_channel_and_a_second_report_emits_nothing() {
    let project = start(&[("ROUNDUP_CHANNEL_DEADLINE_MS", "60000")]);
    let mut user = project.subscribed().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    let id = json!({ "id": rail.a });

    assert_eq!(
        user.request("agent.channelUp", id.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    let as_b = client_as(&project, actor(ActorKind::Agent, &rail.b)).await;
    assert_eq!(
        as_b.request("agent.channelUp", id.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    assert_eq!(
        as_a.request("agent.channelUp", json!({ "id": "nobody" }))
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
    as_a.request("agent.channelUp", id.clone()).await.unwrap();
    as_a.request("agent.channelUp", id).await.unwrap();

    assert_eq!(next_channel(&mut user, &rail.a).await, Channel::Up);
    as_a.request("daemon.ping", Value::Null).await.unwrap();
    let again =
        tokio::time::timeout(Duration::from_millis(300), next_channel(&mut user, &rail.a)).await;
    assert!(again.is_err(), "a second report emitted an event");
}

#[tokio::test]
pub(super) async fn e6_only_an_agent_with_a_live_terminal_has_a_channel() {
    let project = start(&[("ROUNDUP_CHANNEL_DEADLINE_MS", "60000")]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;

    let tree = rail_tree(&user).await;
    let channel = |id: &str| tree.iter().find(|n| n.id == id).unwrap().channel;

    assert_eq!(channel(&rail.a), Some(Channel::Pending));
    assert_eq!(channel(&rail.g), None);
}

pub(super) async fn todo_at(client: &rpc::Client, title: &str) -> u32 {
    let todo = client
        .request("todo.create", json!({ "title": title }))
        .await
        .unwrap();
    serde_json::from_value::<Todo>(todo).unwrap().id
}

pub(super) fn owner_json(kind: &str, id: &str) -> Value {
    json!({"kind": kind, "id": id, "parent": null})
}

pub(super) async fn owner_of(client: &rpc::Client, id: u32) -> Value {
    client
        .request("todo.get", json!({ "id": id }))
        .await
        .unwrap()["owner"]
        .clone()
}

/// T17: an owner Agent that stops keeps its Todos, and assigning one sends the Agent no Message.
#[tokio::test]
pub(super) async fn t17_a_stopped_agent_keeps_its_todos_and_assign_tells_no_agent() {
    let project = start(&[]);
    let mut events = project.subscribed().await;
    let client = project.client().await;
    let agent = agent_in(&project, &client, None).await;
    let id = todo_at(&client, "a").await;
    client
        .request(
            "todo.assign",
            json!({ "id": id, "owner": owner_json("agent", &agent) }),
        )
        .await
        .unwrap();
    let sent = client
        .request("message.list", json!({ "to": agent }))
        .await
        .unwrap();
    assert_eq!(sent, json!([]));
    for _ in 0..2 {
        next(&mut events, |data| {
            matches!(data, EventData::TodoUpdated(_) | EventData::TodoCreated(_)).then_some(())
        })
        .await;
    }

    client
        .request("agent.stop", json!({ "id": agent }))
        .await
        .unwrap();

    assert_eq!(owner_of(&client, id).await, owner_json("agent", &agent));
}

#[tokio::test]
pub(super) async fn t14_an_agent_under_a_workstream_creates_todos_with_the_nearest_workstream_as_home()
 {
    let project = start(&[]);
    let client = project.client().await;
    let outer = workstream(&client, "outer").await;
    let nested = agent_in(&project, &client, Some(&outer)).await;
    let deeper = agent_in_as(&project, &nested).await;
    let bare = agent_in(&project, &client, None).await;

    let create = |who: rpc::Client| async move {
        let todo = who
            .request("todo.create", json!({ "title": "t", "home": "ignored" }))
            .await
            .unwrap();
        todo["home"].clone()
    };
    for agent in [&nested, &deeper] {
        let by_nested = client_as(&project, actor(ActorKind::Agent, agent)).await;
        assert_eq!(create(by_nested).await, json!(outer));
    }
    let by_bare = client_as(&project, actor(ActorKind::Agent, &bare)).await;
    assert_eq!(create(by_bare).await, Value::Null);
    assert_eq!(create(project.client().await).await, Value::Null);
    let by_ext = client_as(&project, actor(ActorKind::Ext, "x")).await;
    assert_eq!(create(by_ext).await, Value::Null);
    let listed = client.request("todo.list", json!(null)).await.unwrap();
    assert_eq!(listed[0]["home"], json!(outer));
}

/// T14: a Door's Rail id is its Workstream's id, so its Todo's Home is that Workstream.
#[tokio::test]
pub(super) async fn t14_a_door_creates_todos_at_its_own_workstream() {
    let project = start(&[]);
    let client = project.client().await;
    for name in ["outer", "other"] {
        let door = workstream(&client, name).await;
        let who = client_as(&project, actor(ActorKind::Agent, &door)).await;
        let todo = who
            .request("todo.create", json!({ "title": "ship j4" }))
            .await
            .unwrap();
        assert_eq!(todo["home"], json!(door));
    }
}

/// P12: a Door's or nested Agent's Pad gets the nearest Workstream; every other caller gives null.
#[tokio::test]
pub(super) async fn p12_create_homes_a_pad_at_the_nearest_workstream() {
    let project = start(&[]);
    let client = project.client().await;
    let outer = workstream(&client, "outer").await;
    let nested = agent_in(&project, &client, Some(&outer)).await;
    let deeper = agent_in_as(&project, &nested).await;
    let bare = agent_in(&project, &client, None).await;
    for (who, expected) in [
        (actor(ActorKind::Agent, &outer), json!(outer)),
        (actor(ActorKind::Agent, &nested), json!(outer)),
        (actor(ActorKind::Agent, &deeper), json!(outer)),
        (actor(ActorKind::Agent, &bare), Value::Null),
        (actor(ActorKind::Ext, "x"), Value::Null),
    ] {
        let name = format!("pad-{}", who.id);
        let made = client_as(&project, who)
            .await
            .request("pad.create", json!({ "name": name, "home": "ignored" }))
            .await
            .unwrap();
        assert_eq!(made["home"], expected);
    }
    let made = client
        .request("pad.create", json!({ "name": "mine", "home": outer }))
        .await
        .unwrap();
    assert_eq!(made["home"], Value::Null);
}

pub(super) async fn ids_listed(client: &rpc::Client) -> Vec<u32> {
    let listed: Vec<Todo> =
        serde_json::from_value(client.request("todo.list", json!(null)).await.unwrap()).unwrap();
    listed.into_iter().map(|todo| todo.id).collect()
}

/// T10, U155: the order the user dropped a Todo into is the order `todo.list` gives after `rupd` restarts.
#[tokio::test]
pub(super) async fn t11_reordered_list_survives_a_restart() {
    let mut project = start(&[]);
    let client = project.client().await;
    for title in ["a", "b", "c"] {
        todo_at(&client, title).await;
    }
    client
        .request("todo.reorder", json!({ "id": 3, "before": 1 }))
        .await
        .unwrap();
    assert_eq!(ids_listed(&client).await, [3, 1, 2]);

    project.restart(&[]);
    assert_eq!(ids_listed(&project.client().await).await, [3, 1, 2]);
}

/// T10: an Agent's `todo_list`, `todo_create` and `agent.context` all read the user's order.
#[tokio::test]
pub(super) async fn t10_the_mcp_server_and_the_context_read_the_reordered_list() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let mut shim = Shim::start(&project, &rail.a).await;
    for title in ["a", "b", "c"] {
        shim.call("todo_create", json!({ "title": title })).await;
    }
    user.request("todo.reorder", json!({ "id": 3, "before": 1 }))
        .await
        .unwrap();
    let ids = |list: Value| -> Vec<u64> {
        list.as_array()
            .unwrap()
            .iter()
            .map(|todo| todo["id"].as_u64().unwrap())
            .collect()
    };
    assert_eq!(ids(shim.call("todo_list", json!({})).await), [3, 1, 2]);
    shim.call("todo_create", json!({ "title": "d" })).await;
    assert_eq!(ids(shim.call("todo_list", json!({})).await), [3, 1, 2, 4]);
    let context: Context =
        serde_json::from_value(shim.call("agent_context", json!({})).await).unwrap();
    let in_context: Vec<u32> = context.todos.iter().map(|todo| todo.id).collect();
    assert_eq!(in_context, [3, 1, 2, 4]);
}

// F2 to F5: a Door has no shell, starts children through `agent_spawn`, finds its `claude` shimmed,
// and has a stray vendor program flagged. `spikes/spawn-boundary/REPORT.md` is what the real
// Claude Code did (F1).

pub(super) fn executable(path: &std::path::Path, text: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, text).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// A directory holding a `claude` that prints `9.9.9`, ahead of the test's own `PATH`.
pub(super) fn path_with_fake_claude(root: &std::path::Path) -> String {
    let bin = root.join("path-bin");
    std::fs::create_dir_all(&bin).unwrap();
    executable(&bin.join("claude"), "#!/bin/sh\necho 9.9.9\n");
    format!("{}:{}", bin.display(), std::env::var("PATH").unwrap())
}

pub(super) fn rup_dir() -> String {
    std::path::Path::new(env!("CARGO_BIN_EXE_rup"))
        .parent()
        .unwrap()
        .display()
        .to_string()
}

pub(super) fn settings_of(project: &Project, id: &str) -> Value {
    let path = project
        .data_dir()
        .join(format!("agents/{id}.settings.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[tokio::test]
pub(super) async fn f2_an_ordinary_agent_runs_claude_directly_and_through_sh() {
    let root = tempfile::tempdir().unwrap();
    let report = root.path().join("run.json");
    let runs = json!([
        "claude --version",
        "sh -c 'claude --version'",
        ["claude", "--version"]
    ]);
    let project = start(&[
        ("PATH", &path_with_fake_claude(root.path())),
        ("FAKE_CLAUDE_RUN", &runs.to_string()),
        ("FAKE_CLAUDE_RUN_REPORT", report.to_str().unwrap()),
    ]);
    let client = project.client().await;

    let agent = project.spawn_agent(&client).await;
    let done = json_file(&report).await;

    for run in done.as_array().unwrap() {
        assert_eq!(
            (run["code"].as_i64(), run["stdout"].as_str()),
            (Some(0), Some("9.9.9\n"))
        );
    }
    let settings = settings_of(&project, &agent.id);
    assert_eq!(settings["env"]["ROUNDUP_AGENT_ID"], agent.id);
    let path = settings["env"]["PATH"].as_str().unwrap();
    assert!(path.starts_with(&format!("{}:", rup_dir())));
    assert!(!path.contains("/agents/"));
}

#[tokio::test]
pub(super) async fn f3_an_actor_that_is_no_node_is_refused_and_nothing_changes() {
    let project = start(&[]);
    let client = project.client().await;
    let id = "999".to_owned();
    let before = rail_tree(&client).await;
    let as_terminal = client_as(&project, actor(ActorKind::Agent, &id)).await;

    let refused = as_terminal
        .request(
            "agent.spawn",
            json!({"cwd": project.dir.path(), "prompt": null, "parent": null}),
        )
        .await
        .unwrap_err();

    assert_eq!(refused.code, rpc::code::FORBIDDEN);
    assert_eq!(rail_tree(&client).await, before);
}

/// A script named `claude` that leaves its pid in `pid` and sleeps.
pub(super) fn stray_script(root: &std::path::Path) -> (PathBuf, PathBuf) {
    let folder = root.join("stray");
    std::fs::create_dir_all(&folder).unwrap();
    let script = folder.join("claude");
    let pid = root.join("stray.pid");
    executable(
        &script,
        &format!(
            "#!/bin/sh\necho $$ > '{}'\nsleep 60 & wait\n",
            pid.display()
        ),
    );
    (script, pid)
}

pub(super) async fn next_stray(client: &mut rpc::Client) -> contracts::agent::StrayEvent {
    next(client, |data| match data {
        EventData::AgentStray(event) => Some(event),
        _ => None,
    })
    .await
}

#[tokio::test]
pub(super) async fn f5_a_stray_claude_under_a_door_is_flagged_once_and_cleared_once_when_it_exits()
{
    let root = tempfile::tempdir().unwrap();
    let (script, pid) = stray_script(root.path());
    let project = start(&[
        ("ROUNDUP_SCAN_MS", "100"),
        ("FAKE_CLAUDE_STRAY", script.to_str().unwrap()),
    ]);
    let mut client = project.subscribed().await;
    let door = start_door(&client).await;
    let status = rail_tree(&client)
        .await
        .into_iter()
        .find(|n| n.id == door)
        .unwrap()
        .status;

    let flagged = next_stray(&mut client).await;
    let pid_found: u32 = json_file_text(&pid).await.trim().parse().unwrap();

    assert_eq!(flagged.id, door);
    assert_eq!(flagged.stray.len(), 1);
    assert_eq!(flagged.stray[0].pid, pid_found);
    assert!(flagged.stray[0].command.contains("claude"), "{flagged:?}");
    let node = rail_tree(&client)
        .await
        .into_iter()
        .find(|n| n.id == door)
        .unwrap();
    assert_eq!(node.stray, flagged.stray);
    assert_eq!(node.status, status);
    assert_eq!(node.kind, contracts::agent::NodeKind::Workstream);

    assert!(
        Command::new("kill")
            .arg(pid_found.to_string())
            .status()
            .unwrap()
            .success()
    );
    let cleared = next_stray(&mut client).await;
    assert_eq!((cleared.id, cleared.stray), (door.clone(), vec![]));
    let node = rail_tree(&client)
        .await
        .into_iter()
        .find(|n| n.id == door)
        .unwrap();
    assert!(node.stray.is_empty());
}

#[tokio::test]
pub(super) async fn f5_a_program_a_users_mcp_server_starts_is_flagged() {
    let root = tempfile::tempdir().unwrap();
    let (script, _) = stray_script(root.path());
    let project = start(&[
        ("ROUNDUP_SCAN_MS", "100"),
        ("FAKE_CLAUDE_MCP_STRAY", script.to_str().unwrap()),
    ]);
    let mut client = project.subscribed().await;
    let door = start_door(&client).await;

    let flagged = next_stray(&mut client).await;

    assert_eq!((flagged.id, flagged.stray.len()), (door, 1));
}

/// A31: a Daemon whose HOME is a fixture folder, with one user Skill, one Project Skill and every
/// command P9 bans.
pub(super) fn a31_project() -> (Project, tempfile::TempDir) {
    let home = tempfile::tempdir().unwrap();
    let skill = |base: &std::path::Path, name: &str, banned: bool| {
        let dir = base.join(".claude/skills").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let text = format!("---\nname: {name}\ndescription: does {name}\n---\n");
        std::fs::write(dir.join("SKILL.md"), text).unwrap();
        banned
    };
    skill(home.path(), "reduce", false);
    for name in ["model", "effort", "compact", "clear"] {
        skill(home.path(), name, true);
    }
    let project = start(&[("HOME", home.path().to_str().unwrap())]);
    skill(project.dir.path(), "project-only", false);
    (project, home)
}

pub(super) async fn a31_names(
    client: &rpc::Client,
    id: &str,
) -> Result<Vec<String>, rpc::RpcError> {
    let reply = client.request("agent.skills", json!({ "id": id })).await?;
    Ok(reply["skills"]
        .as_array()
        .unwrap()
        .iter()
        .map(|skill| skill["name"].as_str().unwrap().to_owned())
        .collect())
}

#[tokio::test]
pub(super) async fn a31_a_workstream_id_resolves_to_its_door() {
    let (project, _home) = a31_project();
    let client = project.client().await;
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name": "ws", "parent": null}),
        )
        .await
        .unwrap();

    let names = a31_names(&client, workstream["id"].as_str().unwrap())
        .await
        .unwrap();

    assert_eq!(names, ["project-only", "reduce"]);
}

/// A33: an idle Agent whose Todo waits on an open blocker reads `blocked`; idle again once it clears.
pub(super) async fn a33_blocked_agent(fixture: &str) -> (Project, rpc::Client, RailNode) {
    let project = daemon::start_real(fixture, &[]);
    let client = project.client().await;
    let agent: RailNode = serde_json::from_value(
        tokio::time::timeout(
            project.bound(),
            client.request(
                "agent.spawn",
                json!({
                    "cwd": project.dir.path(), "prompt": "E10 create a blocked todo"
                }),
            ),
        )
        .await
        .expect("agent.spawn answered within the bound")
        .unwrap(),
    )
    .unwrap();
    let result = project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_waiting")
        .await;
    assert!(
        result["content"].as_str().unwrap().contains("waiting"),
        "{result}"
    );
    (project, client, agent)
}

/// X11, X12: a Terminal the user opens is a bubble's, not a Rail node: it is written to, read back
/// and closed, and a connection ending closes nothing.
#[tokio::test]
pub(super) async fn x12_a_real_daemon_opens_writes_reads_back_and_closes_a_terminal() {
    for project_owned in [false, true] {
        x12_open_write_close(project_owned).await;
    }
}

#[tokio::test]
pub(super) async fn x12_an_agent_cannot_open_a_project_terminal() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let agent = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    for params in [json!({}), json!({"workstream": null})] {
        let error = agent.request("terminal.open", params).await.unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN);
    }
    let listed = user.request("terminal.list", Value::Null).await.unwrap();
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["owner"] != json!(project.dir.path().to_string_lossy()))
    );
}

#[tokio::test]
pub(super) async fn x12_an_agent_cannot_access_a_project_terminal() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let agent = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    let opened = user.request("terminal.open", json!({})).await.unwrap();
    for method in [
        "terminal.screen",
        "terminal.close",
        "terminal.kill",
        "terminal.show",
        "terminal.write",
        "terminal.resize",
        "terminal.read",
        "terminal.search",
        "terminal.snapshot",
    ] {
        let error = agent
            .request(method, json!({"id": opened["terminal_id"], "data": "eA==", "cols": 80, "rows": 24, "reader": rail.a, "pattern": "x"}))
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN, "{method}");
    }
    let listed = user.request("terminal.list", Value::Null).await.unwrap();
    assert_eq!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["owner"] == json!(project.dir.path().to_string_lossy()))
            .count(),
        1
    );
}

// M13: an Agent reads Terminals through its MCP server.

impl Shim {
    /// The tool's error body, or `None` when it succeeded.
    pub(super) async fn refused(&mut self, name: &str, arguments: Value) -> Option<Value> {
        let result = self
            .request(
                "tools/call",
                json!({ "name": name, "arguments": arguments }),
            )
            .await;
        (result["isError"] == true)
            .then(|| serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap())
    }
}

pub(super) async fn m13_run(client: &rpc::Client, agent: &str, script: &str) -> String {
    let run = client
        .request(
            "agent.run",
            json!({ "id": agent, "command": ["/bin/sh", "-c", script] }),
        )
        .await
        .unwrap();
    run["terminal_id"].as_str().unwrap().to_owned()
}

#[tokio::test]
pub(super) async fn m13_an_agent_reads_its_own_runs_and_its_workstreams_terminals() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    let run = m13_run(&as_a, &rail.a, "printf 'built ok\\nFAIL x\\n'; sleep 30").await;
    let mut shim = Shim::start(&project, &rail.a).await;

    m13_until_read(&mut shim, &run, "FAIL x").await;
    let found = shim
        .call("terminal_search", json!({ "id": run, "pattern": "^FAIL" }))
        .await;
    assert_eq!(found["matches"][0]["text"], "FAIL x");
    let screen = shim.call("terminal_screen", json!({ "id": run })).await;
    assert_eq!(screen["lines"], json!(["built ok", "FAIL x"]));

    // The Workstream's own Terminal: owned by `m`, the Workstream `a` sits in.
    let opened = user
        .request("terminal.open", json!({ "workstream": rail.m }))
        .await
        .unwrap();
    let shell = opened["terminal_id"].as_str().unwrap();
    shim.call("terminal_screen", json!({ "id": shell })).await;
}

#[tokio::test]
pub(super) async fn m13_another_workstreams_terminal_is_forbidden() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    let run = m13_run(&as_a, &rail.a, "echo secret; sleep 30").await;
    let mut outsider = Shim::start(&project, &rail.c).await;
    let mut sibling = Shim::start(&project, &rail.b).await;

    for shim in [&mut outsider, &mut sibling] {
        for (tool, arguments) in [
            ("terminal_screen", json!({ "id": run })),
            ("terminal_read", json!({ "id": run, "after": 0 })),
            ("terminal_search", json!({ "id": run, "pattern": "secret" })),
        ] {
            let refused = shim.refused(tool, arguments).await.expect(tool);
            assert_eq!(refused["code"], rpc::code::FORBIDDEN, "{tool}");
            assert!(refused["message"].as_str().unwrap().contains(&run));
            assert!(!refused.to_string().contains("secret"));
        }
    }
}

#[tokio::test]
pub(super) async fn m13_an_ownerless_terminal_is_forbidden_to_an_agent() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let cwd = project.dir.path().to_string_lossy().into_owned();
    let spawned = user
        .request(
            "terminal.spawn",
            json!({ "cwd": cwd, "command": ["/bin/sh", "-c", "sleep 30"], "env": {}, "cols": 80, "rows": 24 }),
        )
        .await
        .unwrap();
    let id = spawned["id"].as_str().unwrap();
    let mut shim = Shim::start(&project, &rail.a).await;

    let refused = shim
        .refused("terminal_screen", json!({ "id": id }))
        .await
        .unwrap();
    assert_eq!(refused["code"], rpc::code::FORBIDDEN);
    // The user has no limit.
    user.request("terminal.screen", json!({ "id": id }))
        .await
        .unwrap();
}
