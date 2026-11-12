use super::*;

#[tokio::test]
pub(super) async fn m13_a_read_through_mcp_changes_no_screen_or_status_and_logs_no_touch() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    let run = m13_run(&as_a, &rail.a, "echo quiet; read line; sleep 30").await;
    let mut shim = Shim::start(&project, &rail.a).await;
    m13_until_read(&mut shim, &run, "quiet").await;
    let touches = || user.request("provenance.touched", json!({ "actor_id": rail.a }));

    let before = (
        user.request("terminal.snapshot", json!({ "id": run }))
            .await
            .unwrap(),
        user.request("terminal.list", Value::Null).await.unwrap(),
        touches().await.unwrap(),
    );

    for (tool, arguments) in [
        ("terminal_screen", json!({ "id": run })),
        ("terminal_read", json!({ "id": run, "after": 0 })),
        ("terminal_search", json!({ "id": run, "pattern": "quiet" })),
    ] {
        shim.call(tool, arguments).await;
    }

    let after = (
        user.request("terminal.snapshot", json!({ "id": run }))
            .await
            .unwrap(),
        user.request("terminal.list", Value::Null).await.unwrap(),
        touches().await.unwrap(),
    );
    assert_eq!(before, after);
}

#[tokio::test]
pub(super) async fn d8_memory_and_cpu_sum_the_whole_tree_and_two_calls_in_a_second_share_a_sample()
{
    let child = json!([
        "python3",
        "-c",
        "b = bytearray(50 * 1024 * 1024)\nb[::4096] = b'x' * len(b[::4096])\nwhile True: pass"
    ]);
    let project = start(&[("FAKE_CLAUDE_CHILD_PROCESS", &child.to_string())]);
    let client = project.client().await;
    let agent = project.spawn_agent(&client).await;

    let sampled = d8_resources_until(&client, |r| {
        r.agents
            .iter()
            .any(|a| a.memory_bytes > 50_000_000 && a.cpu_percent > 50.0)
    })
    .await;
    let again: contracts::project::Resources = serde_json::from_value(
        client
            .request("project.resources", Value::Null)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(again, sampled);
    assert_eq!(sampled.agents.len(), 1);
    assert_eq!(sampled.agents[0].id, agent.id);
    assert_eq!(sampled.agents[0].disk_bytes, None);
    assert_eq!(sampled.total.memory_bytes, sampled.agents[0].memory_bytes);
    assert_eq!(sampled.total.disk_bytes, None);
}

pub(super) async fn d8_resources(client: &rpc::Client) -> contracts::project::Resources {
    serde_json::from_value(
        client
            .request("project.resources", Value::Null)
            .await
            .unwrap(),
    )
    .unwrap()
}

pub(super) fn d8_listing(dir: &std::path::Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(next) = pending.pop() {
        for entry in std::fs::read_dir(next).unwrap().flatten() {
            let path = entry.path();
            found.push(format!(
                "{} {}",
                path.strip_prefix(dir).unwrap().display(),
                entry.metadata().unwrap().len()
            ));
            if path.is_dir() {
                pending.push(path);
            }
        }
    }
    found.sort();
    found
}

/// Threads and CPU ticks the Daemon has used, less AMG4's once-a-second sampler thread.
#[cfg(target_os = "linux")]
pub(super) fn d8_daemon_work(pid: u32) -> (u64, u64) {
    let (mut threads, mut ticks) = (0, 0);
    for task in std::fs::read_dir(format!("/proc/{pid}/task"))
        .unwrap()
        .flatten()
    {
        let read = |f: &str| std::fs::read_to_string(task.path().join(f));
        let (Ok(name), Ok(stat)) = (read("comm"), read("stat")) else {
            continue;
        };
        let fields = stat.rsplit_once(')').unwrap().1.split_whitespace().skip(11);
        if name.trim() != "memory-guard" {
            threads += 1;
            ticks += fields
                .take(2)
                .map(|f| f.parse::<u64>().unwrap())
                .sum::<u64>();
        }
    }
    (threads, ticks)
}

pub(super) fn m14_code(result: Result<Value, rpc::RpcError>) -> i64 {
    result.unwrap_err().code
}

#[tokio::test]
pub(super) async fn m14_route_set_is_a_touch_by_the_agent() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let mut shim = Shim::start(&project, &rail.m).await;

    shim.call(
        "route_set",
        json!({ "from": rail.a, "to": rail.b, "delivery": "drop" }),
    )
    .await;

    let touched = user
        .request("provenance.touched", json!({ "actor_id": rail.m }))
        .await
        .unwrap();
    assert!(
        touched
            .to_string()
            .contains(&format!("route:{}>{}", rail.a, rail.b)),
        "{touched}"
    );
}

#[tokio::test]
pub(super) async fn m14_a_spawned_terminal_is_owned_by_the_caller() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let mut shim = Shim::start(&project, &rail.a).await;

    let spawned = shim
        .call(
            "terminal_spawn",
            json!({ "cwd": "/", "command": ["/bin/sh", "-c", "sleep 30"],
                    "env": {}, "cols": 80, "rows": 24 }),
        )
        .await;

    let listed = user.request("terminal.list", Value::Null).await.unwrap();
    let info = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == spawned["id"])
        .unwrap();
    assert_eq!(info["owner"], json!(rail.a));
}

/// M14: the observer is the real Daemon over a real `rup mcp`; no `claude`.
#[tokio::test]
pub(super) async fn m14_an_agent_types_into_its_own_terminal() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let mut shim = Shim::start(&project, &rail.a).await;
    let spawned = shim
        .call(
            "terminal_spawn",
            json!({ "cwd": "/", "command": ["/bin/sh"], "env": {}, "cols": 80, "rows": 24 }),
        )
        .await;
    let id = spawned["id"].as_str().unwrap().to_owned();

    // base64 of "echo typed-by-agent\n"
    shim.call(
        "terminal_write",
        json!({ "id": id, "data": "ZWNobyB0eXBlZC1ieS1hZ2VudAo=" }),
    )
    .await;

    m13_until_read(&mut shim, &id, "typed-by-agent").await;
    shim.call(
        "terminal_resize",
        json!({ "id": id, "cols": 100, "rows": 30 }),
    )
    .await;
    shim.call("terminal_kill", json!({ "id": id })).await;
}

/// M14: a call to a Held Message's settle through the shim is refused, since no tool exists for it.
#[tokio::test]
pub(super) async fn m14_an_agent_has_no_tool_to_deliver_or_drop() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    for id in [&rail.m, &rail.a] {
        let mut shim = Shim::start(&project, id).await;
        for name in ["message_drop"] {
            let result = shim
                .request(
                    "tools/call",
                    json!({ "name": name, "arguments": { "id": "1" } }),
                )
                .await;
            assert!(result["content"].is_null(), "{id} settled with {name}");
        }
    }
}

/// The next Event `client` is pushed that is a Todo created with `title`, with every number seen on the way.
pub(super) async fn until_created(client: &mut rpc::Client, title: &str) -> Vec<(u64, bool)> {
    let mut seen = Vec::new();
    loop {
        let event = tokio::time::timeout(Duration::from_secs(30), client.next_event())
            .await
            .expect("the Daemon sends the Events")
            .expect("the connection stays open");
        let hit = matches!(&event.data, EventData::TodoCreated(todo) if todo.title == title);
        seen.extend(event.seq.map(|seq| (seq, hit)));
        if hit {
            return seen;
        }
    }
}

#[tokio::test]
pub(super) async fn d12_a_client_resumes_after_a_killed_daemon() {
    let mut project = start(&[]);
    let mut first = project.subscribed().await;
    let caller = project.client().await;
    caller
        .request("todo.create", json!({ "title": "a" }))
        .await
        .unwrap();
    let n = until_created(&mut first, "a").await.last().unwrap().0;
    // Saved before the kill, never read by `first`.
    for title in ["b", "c"] {
        caller
            .request("todo.create", json!({ "title": title }))
            .await
            .unwrap();
    }
    drop((first, caller));
    project.crash();
    project.restart(&[]);

    let mut resumed = project.client().await;
    resumed
        .request("events.subscribe", json!({ "after": n }))
        .await
        .unwrap();
    project
        .client()
        .await
        .request("todo.create", json!({ "title": "d" }))
        .await
        .unwrap();
    let got: Vec<u64> = until_created(&mut resumed, "d")
        .await
        .into_iter()
        .map(|(seq, _)| seq)
        .collect();
    let last = *got.last().unwrap();
    assert_eq!(
        got,
        (n + 1..=last).collect::<Vec<_>>(),
        "each number once, in order"
    );
    assert!(got.len() >= 3, "b, c and d each saved an Event: {got:?}");
}

pub(super) const M16_START: [&str; 3] = ["agent_run", "terminal_spawn", "terminal_open"];

impl Shim {
    /// The whole JSON-RPC reply of a `tools/call`, an error included.
    pub(super) async fn call_reply(&mut self, name: &str, arguments: Value) -> Value {
        self.next += 1;
        let line = json!({ "jsonrpc": "2.0", "id": self.next, "method": "tools/call",
                           "params": { "name": name, "arguments": arguments } });
        self.send(&line).await;
        let reply = tokio::time::timeout(Duration::from_secs(30), self.lines.next_line())
            .await
            .expect("the shim answered")
            .unwrap()
            .expect("the shim is open");
        serde_json::from_str(&reply).unwrap()
    }
}

pub(super) fn m16_arguments(name: &str) -> Value {
    match name {
        "agent_run" => json!({ "command": ["/bin/sh", "-c", "sleep 30"] }),
        "terminal_spawn" => json!({ "cwd": "/", "command": ["/bin/sh", "-c", "sleep 30"],
                                    "env": {}, "cols": 80, "rows": 24 }),
        _ => json!({ "workstream": "m", "cwd": "/", "cols": 80, "rows": 24 }),
    }
}

#[tokio::test]
pub(super) async fn m16_calling_an_unoffered_tool_has_no_effect() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let mut door = Shim::start(&project, &rail.m).await;
    let before = user.request("terminal.list", Value::Null).await.unwrap();

    for name in M16_START {
        let reply = door.call_reply(name, m16_arguments(name)).await;
        assert!(reply["result"].is_null(), "{name}: {reply}");
        assert!(
            reply["error"]["message"]
                .as_str()
                .unwrap()
                .contains(&format!("no tool named {name}")),
            "{reply}"
        );
    }

    let after = user.request("terminal.list", Value::Null).await.unwrap();
    assert_eq!(before, after);
}

#[tokio::test]
pub(super) async fn m16_a_child_keeps_its_terminal_tools() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let mut child = Shim::start(&project, &rail.a).await;
    let before = user.request("terminal.list", Value::Null).await.unwrap();

    let spawned = child
        .call("terminal_spawn", m16_arguments("terminal_spawn"))
        .await;

    let after = user.request("terminal.list", Value::Null).await.unwrap();
    assert_eq!(
        after.as_array().unwrap().len(),
        before.as_array().unwrap().len() + 1
    );
    let id = spawned["id"].as_str().unwrap();
    let screen = child.call("terminal_screen", json!({ "id": id })).await;
    assert!(screen.is_object(), "{screen}");
    child.call("terminal_kill", json!({ "id": id })).await;
}

#[tokio::test]
pub(super) async fn e2704a_context_digest_and_wake_errors_use_names() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    user.request("rail.rename", json!({"id":rail.a,"name":"reader"}))
        .await
        .unwrap();
    user.request("rail.rename", json!({"id":rail.b,"name":"writer"}))
        .await
        .unwrap();
    let caller = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    for (method, noun) in [
        ("agent.context", "Context"),
        ("agent.brief", "Context"),
        ("agent.digest", "digest"),
    ] {
        let err = caller
            .request(method, json!({"id":rail.b}))
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::FORBIDDEN);
        assert_eq!(
            err.message,
            format!("reader may not read the {noun} of writer")
        );
    }
    for method in ["agent.context", "agent.brief", "agent.skills"] {
        let missing = user
            .request(method, json!({"id":"7013"}))
            .await
            .unwrap_err();
        assert_eq!(missing.code, rpc::code::NOT_FOUND);
        assert!(missing.message.contains("reader, writer"));
    }

    let repeated = caller
        .request("agent.wake", json!({"ids":[rail.b, rail.b]}))
        .await
        .unwrap_err();
    assert_eq!(repeated.code, rpc::code::INVALID_PARAMS);
    assert_eq!(repeated.message, "writer is named twice");
    let err = caller
        .request("agent.wake", json!({"ids":["7013"]}))
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::NOT_FOUND);
    assert!(err.message.contains("reader, writer"));
}

#[tokio::test]
pub(super) async fn e2704a_a_door_answers_with_its_context_name() {
    let reports = tempfile::tempdir().unwrap();
    let report = reports.path().join("name.json");
    let project = start(&[
        ("FAKE_CLAUDE_BRIEF_REPORT", report.to_str().unwrap()),
        ("FAKE_CLAUDE_NAME_REPORT", "1"),
    ]);
    let user = project.client().await;
    let workstream = user
        .request("rail.createWorkstream", json!({"name":"sad","parent":null}))
        .await
        .unwrap();
    user.request("rail.startDoor", json!({"id":workstream["id"]}))
        .await
        .unwrap();
    seen_at(&report).await;
    let seen: Value = serde_json::from_str(&std::fs::read_to_string(report).unwrap()).unwrap();
    let additional = seen["startup"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|output| output["hookSpecificOutput"]["additionalContext"].as_str())
        .expect("SessionStart's decoded Context");
    assert!(additional.starts_with("Your Rail name is sad. Say it, never an id, when you speak of yourself or another Agent."), "{seen}");
    assert_eq!(seen["context"]["self"]["name"], "sad");
    assert_eq!(seen["reply"], "I am sad.");
    assert!(
        !seen["reply"]
            .as_str()
            .unwrap()
            .contains(workstream["id"].as_str().unwrap())
    );
}

#[tokio::test]
pub(super) async fn u2773a_captured_ask_never_reaches_equal_named_replacement() {
    let logs = tempfile::tempdir().unwrap();
    let prompts = logs.path().join("asks.jsonl");
    let project = start(&[
        ("FAKE_CLAUDE_PROMPT_LOG", prompts.to_str().unwrap()),
        ("FAKE_CLAUDE_EXACT_PROMPTS", "1"),
    ]);
    let other = start(&[]);
    let user = project.client().await;
    let other_user = other.client().await;
    let a = workstream(&user, "Same").await;
    let elsewhere = workstream(&other_user, "Same").await;
    user.request("rail.rename", json!({"id":a,"name":"Renamed"}))
        .await
        .unwrap();
    let b = workstream(&user, "Same").await;
    let exact = "  @Same /skill e\u{301} 🌿\n  ";
    let accepted = user
        .request(
            "ask.send",
            json!({"text":exact,"submission":"original-revision","workstream":a}),
        )
        .await
        .unwrap();
    // Rename again while delivery can still be starting the original Door.
    user.request("rail.rename", json!({"id":a,"name":"Renamed again"}))
        .await
        .unwrap();
    h21_poll("captured Ask delivery", async || {
        let asks = user.request("ask.list", Value::Null).await.unwrap();
        (asks[0]["parts"][0]["state"] == "typed").then_some(())
    })
    .await;
    let lines = h21_poll("exact Ask prompt", async || {
        let lines: Vec<Value> = std::fs::read_to_string(&prompts)
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        lines
            .iter()
            .any(|line| line["prompt"] == exact)
            .then_some(lines)
    })
    .await;
    assert_eq!(
        lines.iter().filter(|line| line["prompt"] == exact).count(),
        1
    );
    assert_eq!(accepted["text"], exact);
    assert_eq!(accepted["parts"][0]["placement"]["workstream"], a);
    let replay = user
        .request(
            "ask.send",
            json!({"text":exact,"submission":"original-revision","workstream":a}),
        )
        .await
        .unwrap();
    assert_eq!(replay["id"], accepted["id"]);
    let intentional = user
        .request(
            "ask.send",
            json!({"text":exact,"submission":"another-revision","workstream":a}),
        )
        .await
        .unwrap();
    assert_ne!(intentional["id"], accepted["id"]);
    h21_poll("two intentional equal-text prompts", async || {
        let count = std::fs::read_to_string(&prompts)
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .filter(|line| line["prompt"] == exact)
            .count();
        (count == 2).then_some(())
    })
    .await;

    let tree = user.request("rail.tree", Value::Null).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|node| node["id"] == b)
            .unwrap()["terminal_id"]
            .is_null()
    );
    assert!(
        other_user
            .request("ask.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        other_user
            .request("terminal.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty(),
        "other Project {elsewhere} receives no bytes"
    );
    user.request("rail.remove", json!({"id":a})).await.unwrap();
    let error = user
        .request(
            "ask.send",
            json!({"text":exact,"submission":"removed-revision","workstream":a}),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::NOT_FOUND);
    let asks = user.request("ask.list", Value::Null).await.unwrap();
    assert_eq!(asks.as_array().unwrap().len(), 2);
}

#[tokio::test]
pub(super) async fn u2773b_lost_intake_reply_reconciles_after_restart_without_another_effect() {
    use tokio::net::UnixStream;
    let mut project = start(&[]);
    let mut events = project.subscribed().await;
    let user = project.client().await;
    let original = workstream(&user, "Same").await;
    // The response socket is deliberately dropped unread after the durable intake event.
    let mut stream = UnixStream::connect(project.socket()).await.unwrap();
    let request = json!({"jsonrpc":"2.0","id":1,"method":"ask.send","params":{"text":"exact lost reply 🌿\n ","submission":"lost","workstream":original}});
    stream
        .write_all(format!("{request}\n").as_bytes())
        .await
        .unwrap();
    let accepted = next(&mut events, |data| match data {
        EventData::AskChanged { ask } if ask.submission.as_deref() == Some("lost") => Some(*ask),
        _ => None,
    })
    .await;
    drop(stream);
    project.restart(&[]);
    let user = project.client().await;
    let before = user.request("terminal.list", Value::Null).await.unwrap();
    let listed = user.request("ask.list", Value::Null).await.unwrap();
    assert_eq!(listed[0]["submission"], "lost");
    assert_eq!(listed[0]["parts"][0]["placement"]["workstream"], original);
    assert_eq!(listed[0]["text"], "exact lost reply 🌿\n ");
    assert_eq!(listed[0]["id"], accepted.id);
    assert_eq!(
        user.request("terminal.list", Value::Null).await.unwrap(),
        before
    );
    let replay = user
        .request("ask.send", request["params"].clone())
        .await
        .unwrap();
    assert_eq!(replay["id"], accepted.id);
    let conflict = user
        .request(
            "ask.send",
            json!({"text":"different","submission":"lost","workstream":original}),
        )
        .await
        .unwrap_err();
    assert_eq!(conflict.code, rpc::code::CONFLICT);
    assert_eq!(
        user.request("ask.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        user.request("terminal.list", Value::Null).await.unwrap(),
        before
    );
}

/// A shell that records every start and raw input byte independently of identity reads.
pub(super) fn terminal_identity_fixture() -> tempfile::TempDir {
    use std::os::unix::fs::PermissionsExt;
    let fixture = tempfile::tempdir().unwrap();
    let shell = fixture.path().join("shell");
    std::fs::write(fixture.path().join("writes"), "").unwrap();
    std::fs::write(&shell, format!(
        "#!/bin/sh\nstty -icanon -echo\nprintf 'start\\n' >> '{}'\nprintf '\\033]2;same name\\007vendor-editor-sentinel\\n'\ncat >> '{}'\n",
        fixture.path().join("starts").display(), fixture.path().join("writes").display()
    )).unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755)).unwrap();
    fixture
}

/// The title observation acknowledges that the shell has started and enabled raw input.
pub(super) async fn terminal_identity_facts(client: &rpc::Client) -> Value {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let listed = client.request("terminal.list", Value::Null).await.unwrap();
            if listed[0]["title"] == "same name" {
                break listed[0].clone();
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
pub(super) async fn u2773a_terminal_identity_survives_reconnect_without_effects() {
    let fixture = terminal_identity_fixture();
    let shell = fixture.path().join("shell");
    let env = [
        ("SHELL", shell.to_str().unwrap()),
        ("IDENTITY_SECRET", "credential-sentinel"),
    ];
    let projects = [start(&env), start(&env)];
    let mut identities = Vec::new();
    for current in &projects {
        let client = current.client().await;
        let home = client
            .request("rail.createWorkstream", json!({"name":"same home"}))
            .await
            .unwrap()["id"]
            .clone();
        client
            .request("terminal.open", json!({"workstream":home}))
            .await
            .unwrap();
        let facts = terminal_identity_facts(&client).await;
        let identity = facts["incarnation"]
            .as_str()
            .expect("public Terminal incarnation")
            .to_owned();
        assert!(!identity.is_empty());
        let mut keys: Vec<_> = facts
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "cwd",
                "exit_code",
                "id",
                "incarnation",
                "owner",
                "program",
                "program_pid",
                "running",
                "title"
            ]
        );
        let serialized = serde_json::to_string(&facts).unwrap();
        assert!(!serialized.contains(&"0".repeat(64))); // The harness's attached authentication Proof.
        assert!(!serialized.contains("vendor-editor-sentinel"));
        assert!(!serialized.contains("credential-sentinel"));
        assert_eq!(
            client.request("terminal.list", Value::Null).await.unwrap(),
            json!([facts])
        );
        drop(client);
        let reconnected = current.client().await;
        assert_eq!(
            reconnected
                .request("terminal.list", Value::Null)
                .await
                .unwrap(),
            json!([facts])
        );
        identities.push(identity);
    }
    assert_ne!(identities[0], identities[1]);
    assert_eq!(
        std::fs::read_to_string(fixture.path().join("starts")).unwrap(),
        "start\nstart\n"
    );
    assert_eq!(
        std::fs::read_to_string(fixture.path().join("writes")).unwrap(),
        ""
    );
}

#[tokio::test]
pub(super) async fn u2773c_terminal_identity_distinguishes_replacement() {
    let fixture = terminal_identity_fixture();
    let shell = fixture.path().join("shell");
    let env = [("SHELL", shell.to_str().unwrap())];
    let mut project = start(&env);
    let client = project.client().await;
    let owner = client
        .request("rail.createWorkstream", json!({"name":"same home"}))
        .await
        .unwrap()["id"]
        .clone();
    client
        .request("terminal.open", json!({"workstream":owner}))
        .await
        .unwrap();
    let original = terminal_identity_facts(&client).await;
    project.restart(&env);
    let client = project.client().await;
    assert_eq!(
        client.request("terminal.list", Value::Null).await.unwrap(),
        json!([])
    );
    assert_eq!(
        std::fs::read_to_string(fixture.path().join("starts")).unwrap(),
        "start\n"
    );
    client
        .request("terminal.open", json!({"workstream":owner}))
        .await
        .unwrap();
    let replacement = terminal_identity_facts(&client).await;
    assert!(
        !original["incarnation"]
            .as_str()
            .expect("public Terminal incarnation")
            .is_empty()
    );
    assert_ne!(replacement["incarnation"], original["incarnation"]);
    for key in ["id", "owner", "title", "program", "cwd"] {
        assert_eq!(replacement[key], original[key], "{key}");
    }
    assert_eq!(
        std::fs::read_to_string(fixture.path().join("starts")).unwrap(),
        "start\nstart\n"
    );
    assert_eq!(
        std::fs::read_to_string(fixture.path().join("writes")).unwrap(),
        ""
    );
}
