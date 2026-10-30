//! The whole Daemon as the App runs it. Todo creation runs real Claude against aimock;
//! the remaining cases retain the stub while E10 is migrated.

#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
#[path = "e2e/notes.rs"]
mod notes;
#[path = "e2e/reaction.rs"]
mod reaction;
#[path = "e2e/wake.rs"]
mod wake;

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use contracts::agent::{Channel, Context, ParentNode, RailNode};
use contracts::pad::Pad;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, EventData, IdentifyParams, Kind, Touch};
use daemon::{
    Project, TEN_IDLE_BOUND, h21_poll, next, next_kind, rail_tree, signal, start, wait_until_idle,
};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// A Daemon whose one Agent has called `todo_create`; the Todo exists once this returns.
async fn agent_created_a_todo(fixture: &str) -> (Project, RailNode, Todo) {
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
    let todo = next(&mut client, |data| match data {
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
async fn e11_a_tool_result_matches_the_next_turn() {
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
async fn a16_removing_an_agent_leaves_its_pads_and_todos_untouched() {
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
const BUDGET_MB: u64 = 150;

fn resident_kb(pid: u32) -> u64 {
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
async fn d4_ten_idle_agents_cost_the_daemon_less_than_150_mb() {
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
async fn d4_wait_returns_once_every_watched_agent_is_idle_not_at_the_deadline() {
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
async fn d4_a_miss_names_the_not_idle_agents_their_last_status_and_the_rail_tree() {
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
async fn d4_an_agent_not_in_ids_does_not_count_toward_idle() {
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
async fn d4_a_miss_report_omits_agents_already_idle() {
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
async fn d4_an_event_not_seen_on_the_stream_is_told_from_a_slow_daemon() {
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
async fn d4_a_miss_tells_a_closed_connection_from_a_slow_daemon() {
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
async fn h15_a_signal_reaches_a_subscribed_client_as_a_status_event() {
    let project = start(&[]);
    let mut client = project.subscribed().await;
    let agent = project.spawn_agent(&client).await;

    signal(&client, &agent.id, json!({"hook_event_name": "Stop"})).await;

    assert_eq!(next_kind(&mut client).await, Kind::Idle);
}

fn git_at(project: &std::path::Path, args: &[&str]) -> String {
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

async fn interrupted_worktree(workstream: bool) {
    use std::os::unix::fs::PermissionsExt;
    let wrapper = tempfile::tempdir().unwrap();
    let real_git = String::from_utf8(
        Command::new("sh")
            .args(["-c", "command -v git"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    let marker = wrapper.path().join("wrapper-pid");
    let fifo = wrapper.path().join("hold");
    assert!(
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );
    let script = format!(
        "#!/bin/sh\nREAL='{}'\nif [ \"$1\" = worktree ] && [ \"$2\" = add ]; then\n \"$REAL\" \"$@\" || exit $?\n echo $$ > '{}'\n read release < '{}'\nelse exec \"$REAL\" \"$@\"; fi\n",
        real_git.trim(),
        marker.display(),
        fifo.display()
    );
    let executable = wrapper.path().join("git");
    std::fs::write(&executable, script).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = format!(
        "{}:{}",
        wrapper.path().display(),
        std::env::var("PATH").unwrap()
    );
    let mut project = start(&[("PATH", &path)]);
    let root = project.dir.path();
    git_at(root, &["init", "-q", "-b", "main"]);
    git_at(root, &["config", "user.name", "roundup"]);
    git_at(root, &["config", "user.email", "roundup@example.com"]);
    std::fs::write(root.join("README"), "keep").unwrap();
    git_at(root, &["add", "README"]);
    git_at(root, &["commit", "-qm", "base"]);
    let unrelated = wrapper.path().join("user-worktree");
    git_at(
        root,
        &[
            "worktree",
            "add",
            "-b",
            "user-owned",
            unrelated.to_str().unwrap(),
        ],
    );
    let before = (
        git_at(root, &["branch", "--list"]),
        git_at(root, &["worktree", "list"]),
    );
    let client = project.client().await;
    let ids = if workstream {
        let parent = client
            .request(
                "rail.createWorkstream",
                json!({"name":"workstream","parent":null}),
            )
            .await
            .unwrap();
        let child = client
            .request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "prompt": null, "parent": parent["id"]}),
            )
            .await
            .unwrap();
        Some((parent["id"].clone(), child["id"].clone()))
    } else {
        None
    };
    client
        .request("project.setWorktrees", json!({"on":true,"check":null}))
        .await
        .unwrap();
    let pending = if let Some((id, _)) = &ids {
        let id = id.clone();
        tokio::spawn(async move { client.request("rail.startDoor", json!({"id":id})).await })
    } else {
        let cwd = root.to_str().unwrap().to_owned();
        tokio::spawn(async move {
            client
                .request(
                    "agent.spawn",
                    json!({"cwd":cwd,"parent":null,"prompt":null}),
                )
                .await
        })
    };
    let pid = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            // The marker exists before its pid is written; an empty read is not yet.
            if let Some(pid) = std::fs::read_to_string(&marker)
                .ok()
                .and_then(|pid| pid.trim().parse::<u32>().ok())
            {
                break pid;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    project.crash();
    assert!(
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .unwrap()
            .success()
    );
    let _ = pending.await;
    project.restart(&[]);
    let root = project.dir.path();
    assert_eq!(
        (
            git_at(root, &["branch", "--list"]),
            git_at(root, &["worktree", "list"])
        ),
        before
    );
    assert!(git_at(root, &["for-each-ref", "refs/roundup/provisioning/"]).is_empty());
    let client = project.client().await;
    let nodes = rail_tree(&client).await;
    if let Some((parent, child)) = ids {
        assert_eq!(nodes.len(), 2);
        assert!(
            nodes
                .iter()
                .all(|n| n.terminal_id.is_none() && n.worktree.is_none())
        );
        assert_eq!(
            nodes
                .iter()
                .find(|n| json!(n.id) == child)
                .unwrap()
                .parent
                .as_deref(),
            parent.as_str()
        );
    } else {
        assert!(nodes.is_empty());
    }
    assert!(unrelated.join("README").exists());
}

#[tokio::test]
async fn g6_crashed_agent_provision_is_recovered_without_touching_user_worktree() {
    interrupted_worktree(false).await;
}

#[tokio::test]
async fn g6_crashed_door_provision_retains_workstream_and_children() {
    interrupted_worktree(true).await;
}

/// What the fake `claude` read from its argv and its `rup mcp`: the Brief file and the tool list.
struct Seen {
    brief: String,
    tools: Vec<String>,
}

async fn seen_at(report: &std::path::Path) -> Seen {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if let Ok(text) = std::fs::read_to_string(report)
                && let Ok(seen) = serde_json::from_str::<serde_json::Value>(&text)
            {
                return Seen {
                    brief: seen["brief"].as_str().unwrap().to_owned(),
                    tools: seen["tools"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|name| name.as_str().unwrap().to_owned())
                        .collect(),
                };
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the fake claude reported")
}

/// The tool names a Brief puts in backticks.
fn advertised(brief: &str) -> Vec<String> {
    let mut names: Vec<String> = brief
        .lines()
        .filter_map(|line| line.strip_prefix("- `")?.split('`').next())
        .map(str::to_owned)
        .collect();
    names.sort();
    names
}

/// Q11: style text belongs to the plugin, never the Brief.
const HOLD_PLAIN: &str = include_str!("../../agents/assets/hold-plain.md");

/// Q6: the two pinned skills every Brief carries.
const REDUCE: &str = include_str!("../../agents/assets/reduce.md");
const SHOW_ME: &str = include_str!("../../agents/assets/show-me.md");

#[tokio::test]
async fn e1_an_agents_brief_advertises_exactly_the_tools_its_rup_mcp_lists() {
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

#[tokio::test]
async fn b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp() {
    let project = daemon::start_real(
        "b24_a_door_reads_its_brief_then_creates_and_updates_a_todo_over_mcp",
        &[],
    );
    let mut client = project.subscribed().await;
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name": "workstream", "parent": null}),
        )
        .await
        .unwrap();
    let door = workstream["id"].as_str().unwrap().to_owned();
    client
        .request("rail.startDoor", json!({ "id": door }))
        .await
        .unwrap();

    let updated = next(&mut client, |data| match data {
        EventData::TodoUpdated(todo) if !todo.body.is_empty() => Some(todo),
        _ => None,
    })
    .await;
    let model = project.model.as_ref().unwrap();
    let result = model.tool_result("toolu_update_todo").await;
    assert!(
        result["content"]
            .as_str()
            .unwrap()
            .contains("owned files: none yet"),
        "{result}"
    );
    let journal = model.journal();
    let request = &journal
        .iter()
        .find(|entry| entry["body"]["tools"].is_array())
        .unwrap()["body"];
    let brief = request["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "system")
        .map(|m| m["content"].as_str().unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(brief.contains("coordinating Door"), "{request}");
    assert!(
        !brief.contains(HOLD_PLAIN),
        "LC3: the Door's Brief omits the pinned hold:Plain body"
    );
    assert!(
        brief.contains(REDUCE) && brief.contains(SHOW_ME),
        "Q6: the pinned reduce and show-me bodies"
    );
    assert!(!brief.contains(&format!("Agent id is {door}")));
    assert_eq!(updated.title, "plan the workstream");
    assert_eq!(updated.body, "owned files: none yet");
    assert_eq!(
        updated.creator,
        Actor {
            kind: ActorKind::Agent,
            id: door,
            parent: None
        }
    );
    let stored: Vec<Todo> = serde_json::from_value(
        project
            .client()
            .await
            .request("todo.list", json!(null))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(
        (&stored[0].title, &stored[0].body),
        (&updated.title, &updated.body)
    );
}

// E2 to E6: an Agent is told where it stands and asks again.

fn socket(project: &Project) -> PathBuf {
    project.dir.path().join("rupd.sock")
}

fn actor(kind: ActorKind, id: &str) -> Actor {
    Actor {
        kind,
        id: id.into(),
        parent: None,
    }
}

async fn client_as(project: &Project, who: Actor) -> rpc::Client {
    let client = project.client().await;
    client
        .request("daemon.identify", IdentifyParams { actor: who })
        .await
        .unwrap();
    client
}

async fn workstream(client: &rpc::Client, name: &str) -> String {
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({ "name": name, "parent": null }),
        )
        .await
        .unwrap();
    workstream["id"].as_str().unwrap().to_owned()
}

async fn agent_in(project: &Project, client: &rpc::Client, parent: Option<&str>) -> String {
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
async fn agent_in_as(project: &Project, caller: &str) -> String {
    let as_caller = client_as(project, actor(ActorKind::Agent, caller)).await;
    let node = as_caller
        .request(
            "agent.spawn",
            json!({ "cwd": project.dir.path(), "prompt": null, "parent": null }),
        )
        .await
        .unwrap();
    serde_json::from_value::<RailNode>(node).unwrap().id
}

/// `a` and `b` under the Door `m`, and `c` under the plain Group `g`.
struct Rail {
    m: String,
    a: String,
    b: String,
    g: String,
    c: String,
}

async fn rail(project: &Project, client: &rpc::Client) -> Rail {
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

async fn context_of(client: &rpc::Client, id: &str) -> Result<Context, rpc::RpcError> {
    let reply = client.request("agent.context", json!({ "id": id })).await?;
    Ok(serde_json::from_value(reply).unwrap())
}

async fn digest_of(client: &rpc::Client, id: &str) -> Result<Value, rpc::RpcError> {
    client.request("agent.digest", json!({ "id": id })).await
}

#[tokio::test]
async fn b19_a_childs_pads_reach_the_door_once_and_terminal_output_never() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    as_a.request("pad.create", json!({ "name": "notes", "text": "ZEBRA" }))
        .await
        .unwrap();
    let as_m = client_as(&project, actor(ActorKind::Agent, &rail.m)).await;

    // The change is pushed to `m` (B21), which is an envelope about the child, so it names the
    // Pad and no later envelope does.
    let (_, pushed) = push_where(&user, &rail.m, |_, e| e["pads"] == json!(["notes"])).await;
    let by_user = digest_of(&user, &rail.m).await.unwrap();
    let first = digest_of(&as_m, &rail.m).await.unwrap();

    assert_eq!(pushed["name"], by_user["children"][0]["name"]);
    assert_eq!(by_user["children"][0]["pads"], json!([]));
    assert_eq!(first["children"][0]["pads"], json!([]));
    assert!(!pushed.to_string().contains("ZEBRA"));
    assert!(!first.to_string().contains("ZEBRA"));
}

#[tokio::test]
async fn b23_a_pad_already_told_is_not_named_again_after_a_restart() {
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

/// B33: the entry that the text of a plain push spells, as the JSON of B19's entry.
fn entry_of(text: &str) -> Value {
    let mut lines = text.lines();
    let (name, kind) = lines.next().unwrap().rsplit_once(" is ").unwrap();
    let (mut last, mut todos, mut pads) = (String::new(), 0, Vec::new());
    for line in lines {
        if let Some(rest) = line.strip_prefix("  last: ") {
            last = rest.to_owned();
        } else if let Some(rest) = line.strip_prefix("  open todos: ") {
            todos = rest.parse::<u32>().unwrap();
        } else if let Some(rest) = line.strip_prefix("  pads: ") {
            pads = rest.split(", ").map(str::to_owned).collect();
        }
    }
    json!({"name": name, "kind": kind, "last": last, "todos": todos, "pads": pads})
}

/// The Messages the Daemon sent to `to`, each with its pushed entry.
async fn digest_pushes(client: &rpc::Client, to: &str) -> Vec<(Value, Value)> {
    let listed = client
        .request("message.list", json!({ "to": to }))
        .await
        .unwrap();
    listed
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| message["from"]["id"] == "rupd")
        .map(|message| {
            let body = message["body"].as_str().unwrap();
            let entry = body
                .strip_prefix("[digest] ")
                .expect("body is [digest] and an entry");
            (message.clone(), entry_of(entry))
        })
        .collect()
}

/// The pushes to `to` once one satisfies `want`; fails after five seconds.
async fn push_where(
    client: &rpc::Client,
    to: &str,
    want: impl Fn(&Value, &Value) -> bool,
) -> (Value, Value) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let pushes = digest_pushes(client, to).await;
        if let Some(found) = pushes.iter().rev().find(|(m, e)| want(m, e)) {
            return found.clone();
        }
        assert!(Instant::now() < deadline, "no such push yet: {pushes:?}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// Everything the Daemon has to say about the Rail so far has been said.
async fn settled(client: &rpc::Client, to: &str) -> usize {
    let mut seen = usize::MAX;
    loop {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let now = digest_pushes(client, to).await.len();
        if now == seen {
            return now;
        }
        seen = now;
    }
}

#[tokio::test]
async fn b21_a_childs_kind_pad_and_todo_changes_each_push_one_entry_to_its_door() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let a_name = rail_tree(&user)
        .await
        .into_iter()
        .find(|node| node.id == rail.a)
        .unwrap()
        .name;
    settled(&user, &rail.m).await;

    // A Kind change.
    signal(&user, &rail.a, json!({"hook_event_name": "Stop"})).await;
    let (message, entry) = push_where(&user, &rail.m, |_, e| {
        e["name"] == a_name.as_str() && e["kind"] == "idle"
    })
    .await;
    assert_eq!(message["kind"], "note");
    assert_eq!(message["from"]["id"], "rupd");
    let mut keys: Vec<_> = entry.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["kind", "last", "name", "pads", "todos"]);

    // A Pad.
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    as_a.request("pad.create", json!({ "name": "notes", "text": "ZEBRA" }))
        .await
        .unwrap();
    let (_, entry) = push_where(&user, &rail.m, |_, e| e["pads"] == json!(["notes"])).await;
    assert_eq!(entry["name"], a_name.as_str());
    assert!(!entry.to_string().contains("ZEBRA"));
}

#[tokio::test]
async fn b21_a_child_with_no_door_above_it_pushes_nothing() {
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
async fn e2_an_agent_reads_its_own_context_and_no_one_elses() {
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
struct Shim {
    child: tokio::process::Child,
    lines: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    next: u32,
}

impl Shim {
    async fn start(project: &Project, id: &str) -> Shim {
        let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
            .args(["mcp", id])
            .env("RUPD_SOCKET", socket(project))
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
        let stdin = shim.child.stdin.as_mut().unwrap();
        let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        stdin
            .write_all(format!("{note}\n").as_bytes())
            .await
            .unwrap();
        shim
    }

    async fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let line = json!({ "jsonrpc": "2.0", "id": self.next, "method": method, "params": params });
        let stdin = self.child.stdin.as_mut().unwrap();
        stdin
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
        let reply = tokio::time::timeout(Duration::from_secs(30), self.lines.next_line())
            .await
            .expect("the shim answered")
            .unwrap()
            .expect("the shim is open");
        serde_json::from_str::<Value>(&reply).unwrap()["result"].clone()
    }

    async fn call(&mut self, name: &str, arguments: Value) -> Value {
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
async fn e4_agent_context_returns_the_callers_context_after_a_move() {
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

async fn tool_names(shim: &mut Shim) -> Vec<String> {
    let listed = shim.request("tools/list", json!({})).await;
    listed["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn m1_offers_agent_digest_to_a_door_and_to_no_other_agent() {
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

async fn question_to(shim: &mut Shim, project: &Project, to: &str) -> Value {
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
async fn e5_ask_to_is_a_valid_recipient_for_a_door_and_for_the_user() {
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
async fn e3_rup_context_prints_the_brief_verbatim_and_exits_0() {
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
async fn e3_a_dead_daemon_gives_one_stderr_line_no_stdout_and_exit_0() {
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
async fn e3_a_daemon_that_never_answers_is_given_up_on_within_five_seconds() {
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

async fn next_channel(client: &mut rpc::Client, id: &str) -> Channel {
    next(client, |data| match data {
        EventData::AgentChannel(event) if event.id == id => Some(event.channel),
        _ => None,
    })
    .await
}

#[tokio::test]
async fn e6_only_the_agent_reports_its_channel_and_a_second_report_emits_nothing() {
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
async fn e6_only_an_agent_with_a_live_terminal_has_a_channel() {
    let project = start(&[("ROUNDUP_CHANNEL_DEADLINE_MS", "60000")]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;

    let tree = rail_tree(&user).await;
    let channel = |id: &str| tree.iter().find(|n| n.id == id).unwrap().channel;

    assert_eq!(channel(&rail.a), Some(Channel::Pending));
    assert_eq!(channel(&rail.g), None);
}

async fn todo_at(client: &rpc::Client, title: &str) -> u32 {
    let todo = client
        .request("todo.create", json!({ "title": title }))
        .await
        .unwrap();
    serde_json::from_value::<Todo>(todo).unwrap().id
}

fn owner_json(kind: &str, id: &str) -> Value {
    json!({"kind": kind, "id": id, "parent": null})
}

async fn owner_of(client: &rpc::Client, id: u32) -> Value {
    client
        .request("todo.get", json!({ "id": id }))
        .await
        .unwrap()["owner"]
        .clone()
}

/// T17: an owner Agent that stops keeps its Todos, and assigning one sends the Agent no Message.
#[tokio::test]
async fn t17_a_stopped_agent_keeps_its_todos_and_assign_tells_no_agent() {
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
async fn t14_an_agent_under_a_workstream_creates_todos_with_the_nearest_workstream_as_home() {
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
async fn t14_a_door_creates_todos_at_its_own_workstream() {
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
async fn p12_create_homes_a_pad_at_the_nearest_workstream() {
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

async fn ids_listed(client: &rpc::Client) -> Vec<u32> {
    let listed: Vec<Todo> =
        serde_json::from_value(client.request("todo.list", json!(null)).await.unwrap()).unwrap();
    listed.into_iter().map(|todo| todo.id).collect()
}

/// T10, U155: the order the user dropped a Todo into is the order `todo.list` gives after `rupd` restarts.
#[tokio::test]
async fn t11_reordered_list_survives_a_restart() {
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
async fn t10_the_mcp_server_and_the_context_read_the_reordered_list() {
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

fn executable(path: &std::path::Path, text: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, text).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// A directory holding a `claude` that prints `9.9.9`, ahead of the test's own `PATH`.
fn path_with_fake_claude(root: &std::path::Path) -> String {
    let bin = root.join("path-bin");
    std::fs::create_dir_all(&bin).unwrap();
    executable(&bin.join("claude"), "#!/bin/sh\necho 9.9.9\n");
    format!("{}:{}", bin.display(), std::env::var("PATH").unwrap())
}

fn rup_dir() -> String {
    std::path::Path::new(env!("CARGO_BIN_EXE_rup"))
        .parent()
        .unwrap()
        .display()
        .to_string()
}

async fn json_file(path: &std::path::Path) -> Value {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            if let Ok(text) = std::fs::read_to_string(path)
                && let Ok(value) = serde_json::from_str(&text)
            {
                return value;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the fake claude wrote its report")
}

async fn start_door(client: &rpc::Client) -> String {
    let id = workstream(client, "team").await;
    client
        .request("rail.startDoor", json!({ "id": id }))
        .await
        .unwrap();
    id
}

fn settings_of(project: &Project, id: &str) -> Value {
    let path = project
        .data_dir()
        .join(format!("agents/{id}.settings.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[tokio::test]
async fn f2_an_ordinary_agent_runs_claude_directly_and_through_sh() {
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
async fn f3_an_actor_that_is_no_node_is_refused_and_nothing_changes() {
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
fn stray_script(root: &std::path::Path) -> (PathBuf, PathBuf) {
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

async fn next_stray(client: &mut rpc::Client) -> contracts::agent::StrayEvent {
    next(client, |data| match data {
        EventData::AgentStray(event) => Some(event),
        _ => None,
    })
    .await
}

#[tokio::test]
async fn f5_a_stray_claude_under_a_door_is_flagged_once_and_cleared_once_when_it_exits() {
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

async fn json_file_text(path: &std::path::Path) -> String {
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            match std::fs::read_to_string(path) {
                Ok(text) if text.ends_with('\n') => return text,
                _ => tokio::time::sleep(Duration::from_millis(20)).await,
            }
        }
    })
    .await
    .expect("the file was written")
}

#[tokio::test]
async fn f5_a_program_a_users_mcp_server_starts_is_flagged() {
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

#[tokio::test]
async fn f5_only_a_doors_tree_is_scanned_and_a_registered_terminal_is_not_flagged() {
    let root = tempfile::tempdir().unwrap();
    let (script, pid) = stray_script(root.path());
    let shell = root.path().join("shell");
    std::fs::create_dir_all(&shell).unwrap();
    let named_claude = shell.join("claude");
    executable(&named_claude, "#!/bin/sh\nsleep 60 & wait\n");
    let project = start(&[
        ("ROUNDUP_SCAN_MS", "100"),
        ("SHELL", named_claude.to_str().unwrap()),
        ("FAKE_CLAUDE_STRAY", script.to_str().unwrap()),
    ]);
    let client = project.client().await;
    let agent = project.spawn_agent(&client).await;
    let workstream = client
        .request(
            "rail.createWorkstream",
            json!({"name": "w", "parent": null}),
        )
        .await
        .unwrap();
    client
        .request("terminal.open", json!({"workstream": workstream["id"]}))
        .await
        .unwrap();
    json_file_text(&pid).await;

    tokio::time::sleep(Duration::from_millis(600)).await;

    let tree = rail_tree(&client).await;
    assert!(tree.iter().any(|n| n.id == agent.id));
    assert!(tree.iter().all(|n| n.stray.is_empty()), "{tree:?}");
}

/// A31: a Daemon whose HOME is a fixture folder, with one user Skill, one Project Skill and every
/// command P9 bans.
fn a31_project() -> (Project, tempfile::TempDir) {
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

async fn a31_names(client: &rpc::Client, id: &str) -> Result<Vec<String>, rpc::RpcError> {
    let reply = client.request("agent.skills", json!({ "id": id })).await?;
    Ok(reply["skills"]
        .as_array()
        .unwrap()
        .iter()
        .map(|skill| skill["name"].as_str().unwrap().to_owned())
        .collect())
}

#[tokio::test]
async fn a31_a_workstream_id_resolves_to_its_door() {
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

fn card(title: &str) -> Value {
    json!({ "title": title, "blocks": [
        { "kind": "rows", "title": "done", "rows": [{ "label": "login", "value": "merged" }] },
        { "kind": "table", "head": ["agent", "state"], "rows": [["a", "idle"]] },
        { "kind": "diagram", "mermaid": "graph TD; A-->B" },
        { "kind": "text", "text": "next: the rail" },
    ] })
}

#[tokio::test]
async fn m10_write_returns_the_next_id_in_the_doors_workstream() {
    let project = start(&[]);
    let user = project.client().await;
    // No children: startup Digests must not race the checkpoint-only Message assertion.
    let workstream = workstream(&user, "m").await;
    user.request("rail.startDoor", json!({"id":workstream}))
        .await
        .unwrap();
    let mut door = Shim::start(&project, &workstream).await;
    let before = user.request("message.list", json!({})).await.unwrap();

    let first = door.call("checkpoint_write", card("login merged")).await;
    let second = door.call("checkpoint_write", card("rail next")).await;

    assert_eq!(
        (first["id"].as_u64(), second["id"].as_u64()),
        (Some(1), Some(2))
    );
    assert_eq!(first["workstream"], workstream.as_str());
    assert_eq!(first["title"], "login merged");
    assert_eq!(first["blocks"], card("")["blocks"]);
    assert!(first["at"].as_i64().unwrap() > 0);
    let after = user.request("message.list", json!({})).await.unwrap();
    assert_eq!(after, before);
}

#[tokio::test]
async fn m10_list_returns_checkpoints_in_order_after_a_restart() {
    let mut project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let door = client_as(&project, actor(ActorKind::Agent, &rail.m)).await;
    door.request("checkpoint.write", card("one")).await.unwrap();
    door.request("checkpoint.write", card("two")).await.unwrap();

    project.restart(&[]);
    let user = project.client().await;
    let door = client_as(&project, actor(ActorKind::Agent, &rail.m)).await;
    let listed = user
        .request("checkpoint.list", json!({ "workstream": rail.m }))
        .await
        .unwrap();
    let third = door
        .request("checkpoint.write", card("three"))
        .await
        .unwrap();

    let titles: Vec<_> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["one", "two"]);
    assert_eq!(third["id"], 3);
    let other = user
        .request("checkpoint.list", json!({ "workstream": rail.g }))
        .await
        .unwrap();
    assert_eq!(other.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn u467_checkpoints_survive_view_removal() {
    let mut project = start(&[]);
    let user = project.client().await;
    let workstream = workstream(&user, "m").await;
    user.request("rail.startDoor", json!({"id":workstream}))
        .await
        .unwrap();
    let mut door = Shim::start(&project, &workstream).await;
    let written = door.call("checkpoint_write", card("login merged")).await;
    drop(door);
    drop(user);

    project.restart(&[]);
    let user = project.client().await;
    let listed = user
        .request("checkpoint.list", json!({ "workstream": workstream }))
        .await
        .unwrap();

    assert_eq!(listed, json!([written]));
}

#[tokio::test]
async fn m10_write_emits_the_event_and_logs_a_touch() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let mut events = project.subscribed().await;
    let door = client_as(&project, actor(ActorKind::Agent, &rail.m)).await;

    door.request("checkpoint.write", card("one")).await.unwrap();

    let written = next(&mut events, |data| match data {
        EventData::CheckpointWritten(checkpoint) => Some(checkpoint),
        _ => None,
    })
    .await;
    assert_eq!(
        (written.id, written.workstream.as_str()),
        (1, rail.m.as_str())
    );
    assert_eq!(written.title, "one");
    let history: Vec<Touch> = serde_json::from_value(
        user.request(
            "provenance.history",
            json!({ "item": format!("checkpoint:{}:1", rail.m) }),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].actor.id, rail.m);
    assert_eq!(history[0].verb, contracts::Verb::Wrote);
}

/// A33: an idle Agent whose own Todo waits on an open blocker reads `blocked`, and idle again
/// once the blocker completes or the Todo is deleted.
async fn a33_blocked_agent(fixture: &str) -> (Project, rpc::Client, RailNode) {
    let project = daemon::start_real(fixture, &[]);
    let client = project.client().await;
    let agent: RailNode = serde_json::from_value(
        tokio::time::timeout(
            Duration::from_secs(30),
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

async fn a33_reading(client: &rpc::Client, id: &str, kind: Kind) -> contracts::Status {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let tree = rail_tree(client).await;
        let status = tree
            .into_iter()
            .find(|n| n.id == id)
            .unwrap()
            .status
            .unwrap();
        if status.kind == kind {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "{id} never read {kind:?}: {status:?}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[path = "e2e/todo_waits.rs"]
mod todo_waits;

/// X11, X12: a Terminal the user opens is a bubble's, not a Rail node: it is written to, read back
/// and closed, and a connection ending closes nothing.
#[tokio::test]
async fn x12_a_real_daemon_opens_writes_reads_back_and_closes_a_terminal() {
    for project_owned in [false, true] {
        x12_open_write_close(project_owned).await;
    }
}

async fn x12_open_write_close(project_owned: bool) {
    use base64::Engine as _;
    let project = start(&[("SHELL", "/bin/sh")]);
    let client = project.client().await;
    let owner = if project_owned {
        Value::Null
    } else {
        client
            .request(
                "rail.createWorkstream",
                json!({"name": "w", "parent": null}),
            )
            .await
            .unwrap()["id"]
            .clone()
    };
    let before = rail_tree(&client).await;
    let opened = client
        .request("terminal.open", json!({"workstream": owner}))
        .await
        .unwrap();
    let id = opened["terminal_id"].as_str().unwrap().to_owned();
    assert_eq!(rail_tree(&client).await, before);
    let listed = client.request("terminal.list", Value::Null).await.unwrap();
    assert_eq!(
        listed[0]["owner"],
        if project_owned {
            json!(project.dir.path().to_string_lossy())
        } else {
            owner
        }
    );

    // X12: a connection ending closes nothing.
    drop(client);
    let client = project.client().await;
    assert_eq!(
        client.request("terminal.list", Value::Null).await.unwrap(),
        listed
    );
    let data = base64::engine::general_purpose::STANDARD.encode("echo $((20 + 22))\n");
    client
        .request("terminal.write", json!({"id": id, "data": data}))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            let snapshot = client
                .request("terminal.snapshot", json!({"id": id}))
                .await
                .unwrap();
            let screen = base64::engine::general_purpose::STANDARD
                .decode(snapshot["data"].as_str().unwrap())
                .unwrap();
            // The typed command holds `20 + 22`; only the shell's answer holds `42`.
            if String::from_utf8_lossy(&screen).contains("42") {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the shell printed its answer");

    client
        .request("terminal.close", json!({"id": id}))
        .await
        .unwrap();

    let listed = client.request("terminal.list", Value::Null).await.unwrap();
    assert!(
        listed
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["id"] != id.as_str())
    );
}

#[tokio::test]
async fn x12_an_agent_cannot_open_a_project_terminal() {
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
async fn x12_an_agent_cannot_access_a_project_terminal() {
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
    async fn refused(&mut self, name: &str, arguments: Value) -> Option<Value> {
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

async fn m13_run(client: &rpc::Client, agent: &str, script: &str) -> String {
    let run = client
        .request(
            "agent.run",
            json!({ "id": agent, "command": ["/bin/sh", "-c", script] }),
        )
        .await
        .unwrap();
    run["terminal_id"].as_str().unwrap().to_owned()
}

/// Read `id` through `shim` until its text holds `needle`.
async fn m13_until_read(shim: &mut Shim, id: &str, needle: &str) {
    for _ in 0..200 {
        let read = shim
            .call("terminal_read", json!({ "id": id, "after": 0 }))
            .await;
        if read["text"].as_str().unwrap().contains(needle) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("{needle} was never readable");
}

/// D8: `project.resources` called until `done` accepts what it returned, one call a second.
async fn d8_resources_until(
    client: &rpc::Client,
    done: impl Fn(&contracts::project::Resources) -> bool,
) -> contracts::project::Resources {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let sampled: contracts::project::Resources = serde_json::from_value(
            client
                .request("project.resources", Value::Null)
                .await
                .unwrap(),
        )
        .unwrap();
        if done(&sampled) {
            return sampled;
        }
        assert!(Instant::now() < deadline, "no such sample: {sampled:?}");
        tokio::time::sleep(Duration::from_millis(1100)).await;
    }
}

#[tokio::test]
async fn m13_an_agent_reads_its_own_runs_and_its_workstreams_terminals() {
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

/// X16: the shim fills `reader` with the Agent id, so a second read holds only what is new, and a
/// second Agent's first read starts at the log's start.
#[tokio::test]
async fn x16_a_shims_reads_are_a_delta_per_agent() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_b = client_as(&project, actor(ActorKind::Agent, &rail.b)).await;
    let run = m13_run(&as_b, &rail.b, "echo ZEBRA; sleep 30").await;
    let mut door = Shim::start(&project, &rail.m).await;
    let mut other = Shim::start(&project, &rail.b).await;

    let mut first = door.call("terminal_read", json!({ "id": run })).await;
    for _ in 0..200 {
        if first["text"].as_str().unwrap().contains("ZEBRA") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        first = door.call("terminal_read", json!({ "id": run })).await;
    }
    assert!(first["text"].as_str().unwrap().contains("ZEBRA"));
    let again = door.call("terminal_read", json!({ "id": run })).await;
    assert_eq!(again["text"], "");
    let theirs = other.call("terminal_read", json!({ "id": run })).await;
    assert!(theirs["text"].as_str().unwrap().contains("ZEBRA"));
    let digest = digest_of(&user, &rail.m).await.unwrap();
    assert!(!digest.to_string().contains("ZEBRA"));
}

#[tokio::test]
async fn m13_another_workstreams_terminal_is_forbidden() {
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
async fn m13_an_ownerless_terminal_is_forbidden_to_an_agent() {
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

#[tokio::test]
async fn m13_a_read_through_mcp_changes_no_screen_or_status_and_logs_no_touch() {
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
async fn m13_a_full_log_read_through_mcp_is_capped() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    let run = m13_run(
        &as_a,
        &rail.a,
        "head -c 1048576 /dev/zero | tr '\\0' 'a' | fold -w 100; sleep 30",
    )
    .await;
    let mut shim = Shim::start(&project, &rail.a).await;
    m13_until_read(&mut shim, &run, "aaaa").await;
    tokio::time::sleep(Duration::from_secs(1)).await;

    let read = shim
        .call("terminal_read", json!({ "id": run, "after": 0 }))
        .await;
    let found = shim
        .call("terminal_search", json!({ "id": run, "pattern": "a" }))
        .await;
    let screen = shim.call("terminal_screen", json!({ "id": run })).await;

    assert!(read["text"].as_str().unwrap().len() <= 16_384);
    assert_eq!(read["truncated"], true);
    assert!(
        found.to_string().len() <= 16_384,
        "{}",
        found.to_string().len()
    );
    assert_eq!(found["truncated"], true);
    assert!(screen.to_string().len() <= 16_384);
}

#[tokio::test]
async fn d8_memory_and_cpu_sum_the_whole_tree_and_two_calls_in_a_second_share_a_sample() {
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

async fn d8_resources(client: &rpc::Client) -> contracts::project::Resources {
    serde_json::from_value(
        client
            .request("project.resources", Value::Null)
            .await
            .unwrap(),
    )
    .unwrap()
}

fn d8_listing(dir: &std::path::Path) -> Vec<String> {
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

#[tokio::test]
async fn d8_sampling_sends_the_agent_nothing_and_changes_nothing() {
    let scratch = tempfile::tempdir().unwrap();
    let input = scratch.path().join("typed");
    let project = start(&[("FAKE_CLAUDE_PROMPT_LOG", input.to_str().unwrap())]);
    let client = project.subscribed().await;
    let agent: RailNode = serde_json::from_value(
        client
            .request(
                "agent.spawn",
                json!({"cwd": project.dir.path(), "prompt": "d8 start"}),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    // A4452: the inbox receipt, then idle, bound startup without any typed prompt.
    h21_poll("startup coordination receipt", async || {
        let messages = client
            .request("message.list", json!({"to":agent.id}))
            .await
            .unwrap();
        messages
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["status"] == "delivered")
            .cloned()
    })
    .await;
    h21_poll("startup coordination stopped", async || {
        rail_tree(&client).await.into_iter().find(|node| {
            node.id == agent.id && node.status.as_ref().is_some_and(|s| s.kind == Kind::Idle)
        })
    })
    .await;
    let typed_before = std::fs::read_to_string(&input).unwrap_or_default();
    let tree_before = format!("{:?}", rail_tree(&client).await);
    let files_before = d8_listing(project.dir.path());

    for _ in 0..3 {
        assert_eq!(d8_resources(&client).await.agents.len(), 1);
        tokio::time::sleep(Duration::from_millis(1100)).await;
    }

    assert_eq!(
        std::fs::read_to_string(&input).unwrap_or_default(),
        typed_before
    );
    assert_eq!(format!("{:?}", rail_tree(&client).await), tree_before);
    assert_eq!(d8_listing(project.dir.path()), files_before);
}

/// Threads and CPU seconds the Daemon has used, from `/proc`.
#[cfg(target_os = "linux")]
fn d8_daemon_work(pid: u32) -> (u64, u64) {
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).unwrap();
    let threads = status
        .lines()
        .find_map(|l| l.strip_prefix("Threads:"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let fields: Vec<u64> = stat
        .rsplit_once(')')
        .unwrap()
        .1
        .split_whitespace()
        .skip(11)
        .take(2)
        .map(|f| f.parse().unwrap())
        .collect();
    (threads, fields[0] + fields[1])
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn d8_nothing_runs_between_calls() {
    let project = start(&[]);
    let client = project.client().await;
    let _ = d8_resources(&client).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let (threads, ticks) = d8_daemon_work(project.pid());

    tokio::time::sleep(Duration::from_secs(3)).await;
    let (threads_after, ticks_after) = d8_daemon_work(project.pid());

    assert_eq!(threads_after, threads);
    // At most a few ticks of 10 ms: nothing busy runs without a call.
    assert!(ticks_after - ticks <= 3, "{} ticks", ticks_after - ticks);
}

#[tokio::test]
async fn d8_ten_idle_agents_with_sampling_stay_under_the_budget() {
    let launches = tempfile::NamedTempFile::new().unwrap();
    let project = start(&[("FAKE_CLAUDE_LAUNCH_LOG", launches.path().to_str().unwrap())]);
    let mut client = project.subscribed().await;
    let before = resident_kb(project.pid());
    let sampler = project.client().await;
    let sampling = tokio::spawn(async move {
        loop {
            let _ = sampler.request("project.resources", Value::Null).await;
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });

    let deadline = Instant::now() + TEN_IDLE_BOUND;
    let mut ids = Vec::new();
    for _ in 0..10 {
        ids.push(project.spawn_agent(&client).await.id);
    }
    wait_until_idle(&mut client, &ids, deadline)
        .await
        .unwrap_or_else(|report| panic!("{report}"));
    let sampled = d8_resources(&project.client().await).await;
    sampling.abort();

    assert!(sampled.agents.len() <= 10);
    let growth_kb = resident_kb(project.pid()).saturating_sub(before);
    println!("d8: the Daemon grew by {growth_kb} kB with 10 idle Agents sampled every second");
    assert!(growth_kb < BUDGET_MB * 1024);
}

fn m14_code(result: Result<Value, rpc::RpcError>) -> i64 {
    result.unwrap_err().code
}

#[tokio::test]
async fn m14_route_set_is_a_touch_by_the_agent() {
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
async fn m14_a_spawned_terminal_is_owned_by_the_caller() {
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
async fn m14_an_agent_types_into_its_own_terminal() {
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

#[tokio::test]
async fn m14_an_ownerless_terminal_is_forbidden_to_write() {
    let project = start(&[]);
    let user = project.client().await;
    let rail = rail(&project, &user).await;
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    let ownerless = user
        .request(
            "terminal.spawn",
            json!({ "cwd": "/", "command": ["/bin/sh", "-c", "cat"], "env": {}, "cols": 80, "rows": 24 }),
        )
        .await
        .unwrap();

    let snapshot = || user.request("terminal.snapshot", json!({ "id": ownerless["id"] }));
    let before = snapshot().await.unwrap();

    let refused = as_a
        .request(
            "terminal.write",
            json!({ "id": ownerless["id"], "data": "eAo=" }),
        )
        .await;

    assert_eq!(m14_code(refused), rpc::code::FORBIDDEN);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(snapshot().await.unwrap(), before);
}

/// M14: a call to a Held Message's settle through the shim is refused, since no tool exists for it.
#[tokio::test]
async fn m14_an_agent_has_no_tool_to_deliver_or_drop() {
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
async fn until_created(client: &mut rpc::Client, title: &str) -> Vec<(u64, bool)> {
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
async fn d12_a_client_resumes_after_a_killed_daemon() {
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

/// U516: what the webview sends for a selected Turn: a fenced Excerpt and the Turn's facts.
const U516_BODY: &str = "why?\n\n```\n$ ls\nfile\n```\n\ncommand: ls\ncwd: /work\nexit: 0";

#[tokio::test]
async fn u516_message_list_holds_the_sent_excerpt() {
    let project = start(&[]);
    let client = project.client().await;
    let door = start_door(&client).await;
    let child = agent_in(&project, &client, Some(&door)).await;
    client
        .request(
            "message.send",
            json!({"to": child, "kind": "note", "body": U516_BODY}),
        )
        .await
        .unwrap();

    let listed = client
        .request("message.list", json!({"to": child}))
        .await
        .unwrap();
    let sent = listed
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["body"] == U516_BODY)
        .expect("message.list holds the Excerpt for an Agent with no Thread");
    assert_eq!(sent["from"]["kind"], "user");
    assert_eq!(sent["kind"], "note");
}

const M16_START: [&str; 3] = ["agent_run", "terminal_spawn", "terminal_open"];

impl Shim {
    /// The whole JSON-RPC reply of a `tools/call`, an error included.
    async fn call_reply(&mut self, name: &str, arguments: Value) -> Value {
        self.next += 1;
        let line = json!({ "jsonrpc": "2.0", "id": self.next, "method": "tools/call",
                           "params": { "name": name, "arguments": arguments } });
        let stdin = self.child.stdin.as_mut().unwrap();
        stdin
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
        let reply = tokio::time::timeout(Duration::from_secs(30), self.lines.next_line())
            .await
            .expect("the shim answered")
            .unwrap()
            .expect("the shim is open");
        serde_json::from_str(&reply).unwrap()
    }
}

fn m16_arguments(name: &str) -> Value {
    match name {
        "agent_run" => json!({ "command": ["/bin/sh", "-c", "sleep 30"] }),
        "terminal_spawn" => json!({ "cwd": "/", "command": ["/bin/sh", "-c", "sleep 30"],
                                    "env": {}, "cols": 80, "rows": 24 }),
        _ => json!({ "workstream": "m", "cwd": "/", "cols": 80, "rows": 24 }),
    }
}

#[tokio::test]
async fn m16_calling_an_unoffered_tool_has_no_effect() {
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
async fn m16_a_child_keeps_its_terminal_tools() {
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
async fn e2704a_context_digest_and_wake_errors_use_names() {
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
async fn e2704a_a_door_answers_with_its_context_name() {
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
async fn u2773a_captured_ask_never_reaches_equal_named_replacement() {
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
async fn u2773b_lost_intake_reply_reconciles_after_restart_without_another_effect() {
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
fn terminal_identity_fixture() -> tempfile::TempDir {
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
async fn terminal_identity_facts(client: &rpc::Client) -> Value {
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
async fn u2773a_terminal_identity_survives_reconnect_without_effects() {
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
async fn u2773c_terminal_identity_distinguishes_replacement() {
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
