//! The whole Daemon as the App runs it. Todo creation runs real Claude against aimock; the rest keep the stub while E10 migrates.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![allow(clippy::panic, clippy::indexing_slicing)]
#[path = "e2e/contexts.rs"]
mod contexts;
#[path = "e2e/daemon.rs"]
#[allow(dead_code)]
mod daemon;
#[path = "e2e/door_mcp.rs"]
mod door_mcp;
#[path = "e2e/identity.rs"]
mod identity;
#[path = "e2e/notes.rs"]
mod notes;
#[path = "e2e/public_discovery.rs"]
mod public_discovery;
#[path = "e2e/terminals.rs"]
mod terminals;
#[path = "e2e/wake.rs"]
mod wake;

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use contexts::*;
use contracts::agent::{Channel, Context, ParentNode, RailNode};
use contracts::pad::Pad;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, EventData, IdentifyParams, Kind, Touch};
use daemon::{
    Project, TEN_IDLE_BOUND, entry_of, h21_poll, next, next_kind, rail_tree, signal, start,
    start_door, wait_until_idle,
};
use identity::*;
use serde_json::{Value, json};
use terminals::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

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

/// The pushes to `to` once one satisfies `want`; fails after five seconds.
async fn push_where(
    client: &rpc::Client,
    to: &str,
    want: impl Fn(&Value, &Value) -> bool,
) -> (Value, Value) {
    let (deadline, mut polls) = (Instant::now() + Duration::from_secs(5), 0_u32);
    loop {
        let pushes = digest_pushes(client, to).await;
        if let Some(found) = pushes.iter().rev().find(|(m, e)| want(m, e)) {
            return found.clone();
        }
        assert!(Instant::now() < deadline, "no such push yet: {pushes:?}");
        notes::carry_quiet_notes(client, to, &mut polls).await;
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

fn socket(project: &Project) -> PathBuf {
    project.dir.path().join("rupd.sock")
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
        .flat_map(|message| {
            let body = message["body"].as_str().unwrap();
            daemon::rollup_entries(body)
                .into_iter()
                .map(|text| (message.clone(), entry_of(&text)))
                .collect::<Vec<_>>()
        })
        .collect()
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
    assert_eq!(keys, ["kind", "last", "link", "name", "pads", "todos"]);

    // A Pad.
    let as_a = client_as(&project, actor(ActorKind::Agent, &rail.a)).await;
    as_a.request("pad.create", json!({ "name": "notes", "text": "ZEBRA" }))
        .await
        .unwrap();
    let (_, entry) = push_where(&user, &rail.m, |_, e| e["pads"] == json!(["notes"])).await;
    assert_eq!(entry["name"], a_name.as_str());
    assert!(!entry.to_string().contains("ZEBRA"));
}
