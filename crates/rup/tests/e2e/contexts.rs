use super::*;

/// A Daemon whose one Agent has called `todo_create`; the Todo exists once this returns.
pub(super) async fn agent_created_a_todo(fixture: &str) -> (Project, RailNode, Todo) {
    let project = daemon::start_real(fixture, &[]);
    let mut client = project.subscribed().await;
    let agent: RailNode = serde_json::from_value(
        client
            .request(
                "agent.spawn",
                json!({
                    "cwd": project.dir.path(), "prompt": "E10 create split checkout"
                }),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    let todo = project
        .next(&mut client, |data| match data {
            EventData::TodoCreated(todo) => Some(*todo),
            _ => None,
        })
        .await;
    let result = project
        .model
        .as_ref()
        .unwrap()
        .tool_result("toolu_create_todo")
        .await;
    assert!(
        result["content"]
            .as_str()
            .unwrap()
            .contains("split checkout"),
        "{result}"
    );
    (project, agent, todo)
}

#[tokio::test]
pub(super) async fn e11_a_tool_result_matches_the_next_turn() {
    let (project, agent, todo) =
        agent_created_a_todo("d3_the_todo_the_agent_created_is_listed").await;

    let listed: Vec<Todo> = serde_json::from_value(
        project
            .client()
            .await
            .request("todo.list", json!(null))
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, todo.id);
    assert_eq!(listed[0].title, "split checkout");
    let history: Vec<Touch> = serde_json::from_value(
        project
            .client()
            .await
            .request(
                "provenance.history",
                json!({ "item": format!("todo:{}", todo.id) }),
            )
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(history.len(), 1);
    assert_eq!(history[0].actor.kind, ActorKind::Agent);
    assert_eq!(history[0].actor.id, agent.id);
}

/// A16: `rail.remove` has no `pads` or `todos` dependency in `crates/agents`, so this proves it
/// against a real Daemon instead. Removing an Agent that owns a Pad and has made a Todo must
/// leave both exactly as they were; the user still reclaims the Pad by `pad.setOwner` (U18).
#[tokio::test]
pub(super) async fn a16_removing_an_agent_leaves_its_pads_and_todos_untouched() {
    let (project, agent, _todo) =
        agent_created_a_todo("a16_removing_an_agent_leaves_its_pads_and_todos_untouched").await;
    let client = project.client().await;
    client
        .request("pad.create", json!({"name": "notes", "text": null}))
        .await
        .unwrap();
    let todos_before: Vec<Todo> =
        serde_json::from_value(client.request("todo.list", json!(null)).await.unwrap()).unwrap();
    let pads_before: Vec<Pad> =
        serde_json::from_value(client.request("pad.list", json!(null)).await.unwrap()).unwrap();

    client
        .request("rail.remove", json!({"id": agent.id}))
        .await
        .unwrap();

    let todos_after: Vec<Todo> =
        serde_json::from_value(client.request("todo.list", json!(null)).await.unwrap()).unwrap();
    assert_eq!(todos_after, todos_before);
    let pads_after: Vec<Pad> =
        serde_json::from_value(client.request("pad.list", json!(null)).await.unwrap()).unwrap();
    assert_eq!(pads_after, pads_before);
}

/// How much memory the Daemon allows its own share of ten idle Agents (rule 7).
pub(super) const BUDGET_MB: u64 = 150;

pub(super) fn resident_kb(pid: u32) -> u64 {
    let ps = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .unwrap();
    String::from_utf8(ps.stdout)
        .unwrap()
        .trim()
        .parse()
        .unwrap()
}

#[tokio::test]
pub(super) async fn d4_ten_idle_agents_cost_the_daemon_less_than_150_mb() {
    let launches = tempfile::NamedTempFile::new().unwrap();
    let project = start(&[("FAKE_CLAUDE_LAUNCH_LOG", launches.path().to_str().unwrap())]);
    let mut client = project.subscribed().await;
    let before = resident_kb(project.pid());

    // One deadline for all ten Agents together, from the first spawn (scenario D4): moving this
    // inside the loop would reset it on every spawn and let a slow first Agent dodge the bound.
    let deadline = Instant::now() + TEN_IDLE_BOUND;
    let mut ids = Vec::new();
    for _ in 0..10 {
        ids.push(project.spawn_agent(&client).await.id);
    }
    wait_until_idle(&mut client, &ids, deadline)
        .await
        .unwrap_or_else(|report| panic!("{report}"));

    let growth_kb = resident_kb(project.pid()).saturating_sub(before);
    println!("d4: the Daemon's resident memory grew by {growth_kb} kB with 10 idle Agents");
    assert!(growth_kb < BUDGET_MB * 1024);
}

/// A test that passes by waiting longer is not a pass (scenario D4): the wait must return once
/// every watched Agent is Idle, not sit until the deadline.
#[tokio::test]
pub(super) async fn d4_wait_returns_once_every_watched_agent_is_idle_not_at_the_deadline() {
    let project = start(&[]);
    let mut client = project.subscribed().await;
    let mut ids = Vec::new();
    for _ in 0..3 {
        let agent = project.spawn_agent(&client).await;
        signal(
            &client,
            &agent.id,
            json!({ "hook_event_name": "SessionStart" }),
        )
        .await;
        ids.push(agent.id);
    }

    let started = Instant::now();
    wait_until_idle(&mut client, &ids, started + TEN_IDLE_BOUND)
        .await
        .unwrap();

    let elapsed = started.elapsed();
    assert!(
        elapsed < TEN_IDLE_BOUND / 3,
        "wait_until_idle took {elapsed:?} to return once every Agent was Idle, \
         with a deadline of {TEN_IDLE_BOUND:?} still ahead of it"
    );
}

/// Scenario D4's failure output: a miss names each Agent not yet Idle, the status last seen on
/// the event stream and the Daemon's own `rail.tree` view of it.
#[tokio::test]
pub(super) async fn d4_a_miss_names_the_not_idle_agents_their_last_status_and_the_rail_tree() {
    let project = start(&[]);
    let mut client = project.subscribed().await;
    let agent = project.spawn_agent(&client).await;
    // A Signal that does arrive, so "last seen" is never trivially None; it never reaches Idle.
    signal(
        &client,
        &agent.id,
        json!({ "hook_event_name": "UserPromptSubmit" }),
    )
    .await;

    let report = wait_until_idle(
        &mut client,
        std::slice::from_ref(&agent.id),
        Instant::now() + Duration::from_millis(200),
    )
    .await
    .unwrap_err();

    let line = report
        .lines()
        .find(|line| line.starts_with(&format!("  {}:", agent.id)))
        .unwrap_or_else(|| panic!("no line for {}: {report}", agent.id));
    assert!(line.contains("last saw Some("), "{line}");
    assert!(
        line.contains("rail.tree shows Some(Status { kind: Working"),
        "{line}"
    );
    assert!(
        !line.contains("(Idle in the tree but not seen on the stream)"),
        "{line}"
    );
}

/// The `ids` guard: a Status for an Agent nobody is waiting on must not count toward the wait.
#[tokio::test]
pub(super) async fn d4_an_agent_not_in_ids_does_not_count_toward_idle() {
    let project = start(&[]);
    let mut client = project.subscribed().await;
    let watched = project.spawn_agent(&client).await;
    let other = project.spawn_agent(&client).await;
    // `other` reaches Idle quickly; only `watched` is in the `ids` this wait names.
    signal(
        &client,
        &other.id,
        json!({ "hook_event_name": "SessionStart" }),
    )
    .await;

    let report = wait_until_idle(
        &mut client,
        std::slice::from_ref(&watched.id),
        Instant::now() + Duration::from_millis(300),
    )
    .await
    .unwrap_err();

    assert!(
        report.starts_with("1 of 1 Agents were not Idle"),
        "{report}"
    );
    assert!(report.contains(&format!("  {}:", watched.id)), "{report}");
}

/// The not-Idle filter: an Agent that already reached Idle must not get a line of its own.
#[tokio::test]
pub(super) async fn d4_a_miss_report_omits_agents_already_idle() {
    let project = start(&[]);
    let mut client = project.subscribed().await;
    let pending = project.spawn_agent(&client).await;
    let done = project.spawn_agent(&client).await;
    signal(
        &client,
        &done.id,
        json!({ "hook_event_name": "SessionStart" }),
    )
    .await;

    let report = wait_until_idle(
        &mut client,
        &[pending.id.clone(), done.id.clone()],
        Instant::now() + Duration::from_millis(300),
    )
    .await
    .unwrap_err();

    assert!(
        report.starts_with("1 of 2 Agents were not Idle"),
        "{report}"
    );
    assert!(report.contains(&format!("  {}:", pending.id)), "{report}");
    assert!(!report.contains(&format!("  {}:", done.id)), "{report}");
}

/// A Status the Daemon already holds but this client never saw (it never subscribed) is told
/// apart from a Daemon that is merely slow to reach the watched Agent.
#[tokio::test]
pub(super) async fn d4_an_event_not_seen_on_the_stream_is_told_from_a_slow_daemon() {
    let project = start(&[]);
    let client = project.client().await;
    let agent = project.spawn_agent(&client).await;
    signal(
        &client,
        &agent.id,
        json!({ "hook_event_name": "SessionStart" }),
    )
    .await;

    // Never subscribed, so it can never see the Idle event, however long it waits.
    let mut unsubscribed = project.client().await;
    let report = wait_until_idle(
        &mut unsubscribed,
        std::slice::from_ref(&agent.id),
        Instant::now() + Duration::from_millis(200),
    )
    .await
    .unwrap_err();

    assert!(report.contains("last saw None"), "{report}");
    assert!(
        report.contains("rail.tree shows Some(Status { kind: Idle"),
        "{report}"
    );
    assert!(
        report.contains("(Idle in the tree but not seen on the stream)"),
        "{report}"
    );
}

/// A connection that closes mid-wait is reported as closed, not folded into the usual report
/// (which would need `rail.tree` on a connection that can no longer answer).
#[tokio::test]
pub(super) async fn d4_a_miss_tells_a_closed_connection_from_a_slow_daemon() {
    let project = start(&[]);
    let mut client = project.subscribed().await;
    let agent = project.spawn_agent(&client).await;
    drop(project);

    let report = wait_until_idle(
        &mut client,
        std::slice::from_ref(&agent.id),
        Instant::now() + Duration::from_secs(5),
    )
    .await
    .unwrap_err();

    assert!(report.contains("connection closed"), "{report}");
}

/// H15's last clause: a Signal that changes the Kind reaches a subscribed client as a Status event,
/// within the bound every e2e wait uses. The keystroke-to-render budget itself is rule 7's
/// `just perf-keystroke`; a wall-clock assertion of it here would only measure the CI runner.
#[tokio::test]
pub(super) async fn h15_a_signal_reaches_a_subscribed_client_as_a_status_event() {
    let project = start(&[]);
    let mut client = project.subscribed().await;
    let agent = project.spawn_agent(&client).await;

    signal(&client, &agent.id, json!({"hook_event_name": "Stop"})).await;

    assert_eq!(next_kind(&mut client).await, Kind::Idle);
}

pub(super) fn git_at(project: &std::path::Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(project)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

#[tokio::test]
pub(super) async fn g6_crashed_agent_provision_is_recovered_without_touching_user_worktree() {
    interrupted_worktree(false).await;
}

#[tokio::test]
pub(super) async fn g6_crashed_door_provision_retains_workstream_and_children() {
    interrupted_worktree(true).await;
}

/// What the fake `claude` read from its argv and its `rup mcp`: the Brief file and the tool list.
pub(super) struct Seen {
    pub(super) brief: String,
    pub(super) tools: Vec<String>,
}

/// The tool names a Brief puts in backticks.
pub(super) fn advertised(brief: &str) -> Vec<String> {
    let mut names: Vec<String> = brief
        .lines()
        .filter_map(|line| line.strip_prefix("- `")?.split('`').next())
        .map(str::to_owned)
        .collect();
    names.sort();
    names
}

/// Q11: style text belongs to the plugin, never the Brief.
pub(super) const HOLD_PLAIN: &str = include_str!("../../../agents/assets/hold-plain.md");

/// Q6: the two pinned skills every Brief carries.
pub(super) const REDUCE: &str = include_str!("../../../agents/assets/reduce.md");

pub(super) const SHOW_ME: &str = include_str!("../../../agents/assets/show-me.md");

#[tokio::test]
pub(super) async fn e1_an_agents_brief_advertises_exactly_the_tools_its_rup_mcp_lists() {
    let report = tempfile::tempdir().unwrap().keep().join("seen.json");
    let project = start(&[("FAKE_CLAUDE_BRIEF_REPORT", report.to_str().unwrap())]);
    let client = project.client().await;
    let agent = project.spawn_agent(&client).await;

    let seen = seen_at(&report).await;

    let mut listed = seen.tools.clone();
    listed.sort();
    assert_eq!(advertised(&seen.brief), listed);
    assert!(!seen.brief.contains(&format!("Agent id is {}", agent.id)));
    assert!(!seen.brief.contains("Workstream's coordinating Door"));
    assert!(
        !seen.brief.contains(HOLD_PLAIN),
        "Q11: the Brief must not duplicate the plugin style"
    );
    assert!(
        seen.brief.contains(REDUCE) && seen.brief.contains(SHOW_ME),
        "Q6: the pinned reduce and show-me bodies"
    );
}

// E2 to E6: an Agent is told where it stands and asks again.

pub(super) fn actor(kind: ActorKind, id: &str) -> Actor {
    Actor {
        kind,
        id: id.into(),
        parent: None,
    }
}

pub(super) async fn client_as(project: &Project, who: Actor) -> rpc::Client {
    let client = project.client().await;
    client
        .request("daemon.identify", IdentifyParams { actor: who })
        .await
        .unwrap();
    client
}

pub(super) async fn workstream(client: &rpc::Client, name: &str) -> String {
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({ "name": name, "parent": null }),
        )
        .await
        .unwrap();
    workstream["id"].as_str().unwrap().to_owned()
}

pub(super) async fn agent_in(
    project: &Project,
    client: &rpc::Client,
    parent: Option<&str>,
) -> String {
    let node = client
        .request(
            "agent.spawn",
            json!({ "cwd": project.dir.path(), "prompt": null, "parent": parent }),
        )
        .await
        .unwrap();
    serde_json::from_value::<RailNode>(node).unwrap().id
}

/// The id of the Agent that Agent `caller` starts (F3, A26).
pub(super) async fn agent_in_as(project: &Project, caller: &str) -> String {
    let as_caller = client_as(project, actor(ActorKind::Agent, caller)).await;
    let node = as_caller
        .request(
            "agent.spawn",
            json!({ "cwd": project.dir.path(), "prompt": null, "parent": null, "role": "job" }),
        )
        .await
        .unwrap();
    serde_json::from_value::<RailNode>(node).unwrap().id
}

/// `a` and `b` under the Door `m`, and `c` under the plain Group `g`.
pub(super) struct Rail {
    pub(super) m: String,
    pub(super) a: String,
    pub(super) b: String,
    pub(super) g: String,
    pub(super) c: String,
}

pub(super) async fn rail(project: &Project, client: &rpc::Client) -> Rail {
    let m = workstream(client, "m").await;
    client
        .request("rail.startDoor", json!({ "id": m }))
        .await
        .unwrap();
    let a = agent_in(project, client, Some(&m)).await;
    let b = agent_in(project, client, Some(&m)).await;
    let g = workstream(client, "g").await;
    let c = agent_in(project, client, Some(&g)).await;
    Rail { m, a, b, g, c }
}

pub(super) async fn context_of(client: &rpc::Client, id: &str) -> Result<Context, rpc::RpcError> {
    let reply = client.request("agent.context", json!({ "id": id })).await?;
    Ok(serde_json::from_value(reply).unwrap())
}

pub(super) async fn digest_of(client: &rpc::Client, id: &str) -> Result<Value, rpc::RpcError> {
    client.request("agent.digest", json!({ "id": id })).await
}

#[tokio::test]
pub(super) async fn b23_a_pad_already_told_is_not_named_again_after_a_restart() {
    let mut project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    as_a.request("pad.create", json!({ "name": "notes", "text": "x" }))
        .await
        .unwrap();
    push_where(&user, &rail.m, |_, e| e["pads"] == json!(["notes"])).await;
    settled(&user, &rail.m).await;

    project.restart(&[]);
    let user = project.client().await;
    let as_m = client_as(&project, actor(ActorKind::Agent, &rail.m)).await;
    let asked = digest_of(&as_m, &rail.m).await.unwrap();
    for child in asked["children"].as_array().unwrap() {
        assert_eq!(child["pads"], json!([]), "{child}");
    }
    assert_eq!(digest_of(&user, &rail.m).await.unwrap(), asked);
}

#[tokio::test]
pub(super) async fn b21_a_child_with_no_door_above_it_pushes_nothing() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    settled(&user, &rail.m).await;

    signal(&user, &rail.c, json!({"hook_event_name": "Stop"})).await;
    let as_c = client_as(&project, actor(ActorKind::Agent, &rail.c)).await;
    as_c.request("pad.create", json!({ "name": "c-notes", "text": "x" }))
        .await
        .unwrap();
    settled(&user, &rail.m).await;

    for to in [&rail.g, &rail.c, &rail.m] {
        let pushes = digest_pushes(&user, to).await;
        assert!(
            pushes.iter().all(|(_, e)| e["pads"] != json!(["c-notes"])),
            "{to}: {pushes:?}"
        );
    }
    assert!(digest_pushes(&user, &rail.g).await.is_empty());
}

#[tokio::test]
pub(super) async fn e2_an_agent_reads_its_own_context_and_no_one_elses() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;

    let a = context_of(&as_a, &rail.a).await.unwrap();
    let parent = a.parent.unwrap();
    assert_eq!(
        (parent.id, parent.node),
        (rail.m.clone(), ParentNode::Agent)
    );
    assert_eq!(a.ask.to, rail.m);
    assert_eq!(
        a.peers.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(),
        [rail.b.as_str()]
    );
    let c = context_of(&user, &rail.c).await.unwrap();
    assert_eq!(c.ask.to, "you");
    assert!(c.peers.is_empty());
    assert_eq!(c.parent.unwrap().node, ParentNode::Group);

    let other = context_of(&as_a, &rail.b).await.unwrap_err();
    assert_eq!(other.code, rpc::code::FORBIDDEN);
    let missing = context_of(&user, "nobody").await.unwrap_err();
    assert_eq!(missing.code, rpc::code::NOT_FOUND);
    let touches: Vec<Touch> = serde_json::from_value(
        user.request("provenance.touched", json!({ "actor_id": rail.a }))
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(touches.is_empty(), "{touches:?}");
}

/// A raw MCP client of `rup mcp <id>`: the tool's text, or its error text.
pub(super) struct Shim {
    pub(super) child: tokio::process::Child,
    pub(super) lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    pub(super) next: u32,
}

impl Shim {
    pub(super) async fn start(project: &Project, id: &str) -> Shim {
        Shim::start_at(&socket(project), id).await
    }

    pub(super) async fn start_at(socket: &std::path::Path, id: &str) -> Shim {
        let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
            .args(["mcp", id])
            .env("RUPD_SOCKET", socket)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let mut shim = Shim {
            child,
            lines,
            next: 0,
        };
        shim.request(
            "initialize",
            json!({ "protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": { "name": "t", "version": "0" } }),
        )
        .await;
        shim.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await;
        shim
    }

    pub(super) async fn send(&mut self, frame: &Value) {
        let stdin = self.child.stdin.as_mut().unwrap();
        stdin
            .write_all(format!("{frame}\n").as_bytes())
            .await
            .unwrap();
    }

    pub(super) async fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let line = json!({ "jsonrpc": "2.0", "id": self.next, "method": method, "params": params });
        self.send(&line).await;
        let reply = tokio::time::timeout(Duration::from_secs(30), self.lines.next_line())
            .await
            .expect("the shim answered")
            .unwrap()
            .expect("the shim is open");
        serde_json::from_str::<Value>(&reply).unwrap()["result"].clone()
    }

    pub(super) async fn call(&mut self, name: &str, arguments: Value) -> Value {
        let result = self
            .request(
                "tools/call",
                json!({ "name": name, "arguments": arguments }),
            )
            .await;
        assert_ne!(result["isError"], true, "{result}");
        let raw = result["content"][0]["text"].as_str().unwrap();
        serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_owned()))
    }
}

#[tokio::test]
pub(super) async fn e4_agent_context_returns_the_callers_context_after_a_move() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let mut shim = Shim::start(&project, &rail.a).await;

    let before: Context =
        serde_json::from_value(shim.call("agent_context", json!({})).await).unwrap();
    user.request(
        "rail.move",
        json!({ "id": rail.a, "parent": rail.g, "index": 0 }),
    )
    .await
    .unwrap();
    let after: Context =
        serde_json::from_value(shim.call("agent_context", json!({})).await).unwrap();

    assert_eq!(before.this.id, rail.a);
    assert_eq!(before.ask.to, rail.m);
    assert_eq!(after.parent.unwrap().id, rail.g);
    assert_eq!(after.ask.to, "you");
    assert_eq!(
        after
            .peers
            .iter()
            .map(|peer| peer.id.as_str())
            .collect::<Vec<_>>(),
        [rail.c.as_str()]
    );
}

pub(super) async fn tool_names(shim: &mut Shim) -> Vec<String> {
    let listed = shim.request("tools/list", json!({})).await;
    listed["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
pub(super) async fn m1_offers_agent_digest_to_a_door_and_to_no_other_agent() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;

    let mut door = Shim::start(&project, &rail.m).await;
    let mut plain = Shim::start(&project, &rail.a).await;

    assert!(
        tool_names(&mut door)
            .await
            .contains(&"agent_digest".to_owned())
    );
    assert!(
        !tool_names(&mut plain)
            .await
            .contains(&"agent_digest".to_owned())
    );
    let digest = door.call("agent_digest", json!({})).await;
    assert_eq!(digest["children"].as_array().unwrap().len(), 2);
}
