//! A35: durable Checkpoint Marks against a real `rupd`, the pinned real `claude` on aimock and real git.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use contracts::agent::{Channel, RailNode};
use contracts::{Actor, ActorKind, IdentifyParams, Kind};
use daemon::{Project, rail_tree};
use serde_json::{Value, json};

struct Fix {
    project: Project,
    user: rpc::Client,
    ws: String,
    a: String,
    b: String,
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

async fn until<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(found) = probe() {
            return found;
        }
        assert!(Instant::now() < deadline, "never: {what}");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn as_actor(project: &Project, kind: ActorKind, id: &str) -> rpc::Client {
    let client = project.client().await;
    let actor = Actor {
        kind,
        id: id.into(),
        parent: None,
    };
    client
        .request("daemon.identify", IdentifyParams { actor })
        .await
        .unwrap();
    client
}

async fn node(client: &rpc::Client, id: &str) -> Option<RailNode> {
    rail_tree(client).await.into_iter().find(|n| n.id == id)
}

async fn idle(client: &rpc::Client, id: &str) {
    for _ in 0..1200 {
        if node(client, id)
            .await
            .and_then(|n| n.status)
            .is_some_and(|s| s.kind == Kind::Idle)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("{id} never became idle: {:?}", node(client, id).await);
}

async fn fixture() -> Fix {
    let project = daemon::start_real("a35_marks", &[("ROUNDUP_INTERRUPT_BOUND_MS", "60000")]);
    let dir = project.dir.path();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "user.name", "roundup"]);
    git(dir, &["config", "user.email", "roundup@example.com"]);
    std::fs::write(dir.join("README"), "keep").unwrap();
    std::fs::write(
        dir.join(".gitignore"),
        "claude-config/\nhome/\nrupd.sock\nignored\n",
    )
    .unwrap();
    git(dir, &["add", "README", ".gitignore"]);
    git(dir, &["commit", "-qm", "base"]);
    let mut events = project.subscribed().await;
    events
        .request("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let ws = events
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    events
        .request("rail.startDoor", json!({"id": ws}))
        .await
        .unwrap();
    let model = project.model.as_ref().unwrap();
    let node = |result: Value| {
        serde_json::from_str::<RailNode>(result["content"].as_str().unwrap())
            .unwrap()
            .id
    };
    let a = node(model.tool_result("toolu_a35_child").await);
    let b = node(model.tool_result("toolu_a35_grandchild").await);
    // Wait through all three real turns so a late unmatched request cannot escape aimock's journal.
    let mut working = std::collections::HashSet::new();
    let mut stopped = std::collections::HashSet::new();
    while stopped.len() < 3 {
        let status = daemon::next(&mut events, |event| match event {
            contracts::EventData::AgentStatus(status) if [&ws, &a, &b].contains(&&status.id) => {
                Some(status)
            }
            _ => None,
        })
        .await;
        match status.status.kind {
            Kind::Working => {
                working.insert(status.id);
            }
            Kind::Idle if working.contains(&status.id) => {
                stopped.insert(status.id);
            }
            _ => {}
        }
    }
    project.model.as_ref().unwrap().assert_matched();
    let user = project.client().await;
    let fx = Fix {
        project,
        user,
        ws,
        a,
        b,
    };
    // Claude Code writes a turn's records to its conversation file after the turn's Stop Signal.
    // A Mark recorded before then holds no message, and a rewind's resume of it finds no
    // conversation.
    for node in rail_tree(&fx.user).await {
        let cwd = node.worktree.map_or_else(
            || fx.project.dir.path().to_owned(),
            |tree| PathBuf::from(tree.path),
        );
        daemon::h21_poll(
            "each turn's end in its conversation file",
            async || match conversations(&fx, &cwd).as_slice() {
                [file] => ended(file).then_some(()),
                _ => None,
            },
        )
        .await;
    }
    fx
}

/// The conversation files real Claude has saved for an Agent working in `cwd`.
fn conversations(fx: &Fix, cwd: &Path) -> Vec<PathBuf> {
    let project: String = cwd
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let dir = fx
        .project
        .dir
        .path()
        .join("claude-config/projects")
        .join(project);
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .collect()
}

/// Whether the conversation file holds a turn's end: after the reply, Claude Code writes the turn's
/// duration.
fn ended(file: &Path) -> bool {
    let records: Vec<Value> = std::fs::read_to_string(file)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    records
        .iter()
        .rposition(|record| record["type"] == "assistant")
        .is_some_and(|reply| {
            records[reply..]
                .iter()
                .any(|record| record["type"] == "system" && record["subtype"] == "turn_duration")
        })
}

async fn write(fx: &Fix) -> Value {
    as_actor(&fx.project, ActorKind::Agent, &fx.ws)
        .await
        .request(
            "checkpoint.write",
            json!({"title": "ready", "blocks": [{"kind": "text", "text": "facts"}]}),
        )
        .await
        .unwrap()
}

fn store(fx: &Fix) -> checkpoints::Checkpoints {
    checkpoints::Checkpoints::open(&fx.project.data_dir()).unwrap()
}

async fn listed(fx: &Fix) -> Value {
    fx.user
        .request("checkpoint.list", json!({"workstream": fx.ws}))
        .await
        .unwrap()
}

fn regular(mark: &checkpoints::Mark, path: &[u8]) -> Vec<u8> {
    match &mark
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap()
        .content
    {
        checkpoints::FileContent::Regular { bytes, .. } => bytes.clone(),
        other => panic!("not a regular file: {other:?}"),
    }
}

async fn roots(fx: &Fix) -> Vec<(String, PathBuf)> {
    rail_tree(&fx.user)
        .await
        .into_iter()
        .map(|node| (node.id, node.worktree.unwrap().path.into()))
        .collect()
}

#[tokio::test]
async fn a35_write_records_a_mark_per_agent_and_a_plan_changes_nothing() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let fx = fixture().await;
    let roots = roots(&fx).await;
    // A tracked folder replaced by a symlink to outside the Worktree: the Mark does not follow it.
    let child_root = roots.iter().find(|(id, _)| id == &fx.b).unwrap().1.clone();
    std::fs::create_dir(child_root.join("folder")).unwrap();
    std::fs::write(child_root.join("folder/file"), "tracked").unwrap();
    git(&child_root, &["add", "folder/file"]);
    std::fs::remove_dir_all(child_root.join("folder")).unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("file"), "outside the Worktree").unwrap();
    symlink(outside.path(), child_root.join("folder")).unwrap();
    let mut before = Vec::new();
    for (id, root) in &roots {
        std::fs::write(root.join("README"), "staged").unwrap();
        git(root, &["add", "README"]);
        std::fs::write(root.join("README"), format!("working {id}")).unwrap();
        std::fs::write(root.join("untracked\nfile"), [0, 1, 255]).unwrap();
        std::fs::set_permissions(
            root.join("untracked\nfile"),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        std::fs::write(root.join("ignored"), "private").unwrap();
        symlink("missing target", root.join("link")).unwrap();
        let index = root.join(git(root, &["rev-parse", "--git-path", "index"]).trim());
        let refs = git(root, &["show-ref"]);
        let branch = git(root, &["symbolic-ref", "HEAD"]);
        let status = git(root, &["status", "--porcelain=v1"]);
        before.push((
            index.clone(),
            std::fs::read(index).unwrap(),
            refs,
            branch,
            status,
        ));
    }
    let card = write(&fx).await;
    assert_eq!(card["title"], "ready");
    assert_eq!(card["blocks"], json!([{"kind": "text", "text": "facts"}]));
    assert_eq!(listed(&fx).await[0]["rewindable"], true);
    let marks = store(&fx).marks(&fx.ws, 1).unwrap();
    let mut ids: Vec<_> = marks
        .agents
        .iter()
        .map(|mark| mark.agent.as_str())
        .collect();
    ids.sort();
    let mut expected = vec![fx.ws.as_str(), fx.a.as_str(), fx.b.as_str()];
    expected.sort();
    assert_eq!(ids, expected, "Door and nested Subagents all have Marks");
    for (mark, (index, bytes, refs, branch, status)) in marks.agents.iter().zip(before) {
        let root = Path::new(&mark.worktree);
        assert_eq!(std::fs::read(index).unwrap(), bytes, "index is untouched");
        assert_eq!(git(root, &["show-ref"]), refs, "no branch or remote moved");
        assert_eq!(git(root, &["symbolic-ref", "HEAD"]), branch);
        assert_eq!(git(root, &["status", "--porcelain=v1"]), status);
        assert_eq!(
            regular(mark, b"README"),
            format!("working {}", mark.agent).as_bytes()
        );
        assert_eq!(regular(mark, b"untracked\nfile"), [0, 1, 255]);
        assert!(matches!(
            mark.files
                .iter()
                .find(|f| f.path == b"untracked\nfile")
                .unwrap()
                .content,
            checkpoints::FileContent::Regular {
                executable: true,
                ..
            }
        ));
        assert!(
            matches!(&mark.files.iter().find(|f| f.path == b"link").unwrap().content, checkpoints::FileContent::Symlink { target } if target == b"missing target")
        );
        assert!(!mark.files.iter().any(|f| f.path == b"ignored"));
        assert_eq!(
            std::fs::read(root.join("README")).unwrap(),
            format!("working {}", mark.agent).as_bytes()
        );
        assert!(String::from_utf8_lossy(&mark.conversation).contains("from-name"));
    }
    let linked = marks.agents.iter().find(|mark| mark.agent == fx.b).unwrap();
    assert!(!linked.files.iter().any(|file| file.path == b"folder/file"));
    assert!(matches!(
        linked
            .files
            .iter()
            .find(|file| file.path == b"folder")
            .unwrap()
            .content,
        checkpoints::FileContent::Symlink { .. }
    ));
    // A plan lists each Agent with its changes since the Mark, and changes nothing.
    let root = |id: &str| roots.iter().find(|(r, _)| r == id).unwrap().1.clone();
    std::fs::write(root(&fx.a).join("README"), "after").unwrap();
    let later = spawn_later(&fx, &fx.b).await;
    let tree = rail_tree(&fx.user).await;
    let listing = plan(&fx, None).await.unwrap();
    let agents = listing["agents"].as_array().unwrap();
    assert_eq!(agents.len(), 3);
    let entry = |id: &str| agents.iter().find(|a| a["agent"] == id).unwrap();
    assert_eq!(entry(&fx.a)["files_changed"], json!(["README"]));
    assert_eq!(entry(&fx.a)["created_after"], false);
    assert_eq!(entry(&fx.b)["files_changed"], json!([]));
    assert_eq!(entry(&later.id)["created_after"], true);
    assert_eq!(entry(&later.id)["files_changed"], json!([]));
    assert_eq!(listing["files_changed"], true);
    assert_eq!(std::fs::read(root(&fx.a).join("README")).unwrap(), b"after");
    assert_eq!(attempts(&rail_tree(&fx.user).await), attempts(&tree));
    fx.project.model.as_ref().unwrap().assert_matched();
}

/// The Door's own rewind call: the only caller A35 allows.
async fn rewind_as(
    fx: &Fix,
    caller: &str,
    id: &str,
    agent: Option<&str>,
    files: &str,
) -> Result<Value, rpc::RpcError> {
    as_actor(&fx.project, ActorKind::Agent, caller)
        .await
        .request(
            "workstream.rewind",
            json!({"id": id, "checkpoint": 1, "files": files, "agent": agent}),
        )
        .await
}

async fn rewind(fx: &Fix, agent: Option<&str>, files: &str) -> Value {
    rewind_as(fx, &fx.ws, &fx.ws, agent, files).await.unwrap()
}

async fn plan(fx: &Fix, agent: Option<&str>) -> Result<Value, rpc::RpcError> {
    as_actor(&fx.project, ActorKind::Agent, &fx.ws)
        .await
        .request(
            "workstream.rewindPlan",
            json!({"id": fx.ws, "checkpoint": 1, "agent": agent}),
        )
        .await
}

fn attempts(tree: &[RailNode]) -> Vec<(String, Option<String>)> {
    tree.iter()
        .map(|n| (n.id.clone(), n.attempt.clone()))
        .collect()
}

/// A child spawned after the Mark, as the Rail holds it once the real turn of its default order has
/// ended (A9 has named it), so that turn's model requests are in aimock's journal before anything
/// rewinds or removes it.
async fn spawn_later(fx: &Fix, parent: &str) -> RailNode {
    let mut events = fx.project.subscribed().await;
    let later: RailNode = serde_json::from_value(
        as_actor(&fx.project, ActorKind::Agent, parent)
            .await
            .request(
                "agent.spawn",
                json!({"cwd": fx.project.dir.path(), "prompt": null}),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    // O2: with neither prompt nor order the Agent is Steered nothing, so its SessionStart is its `idle`.
    // The node is stable once it is Idle and its Channel is Up: a read before the Channel connects
    // shows Pending, and a later read shows Up.
    let (mut idle, mut up) = (false, false);
    while !(idle && up) {
        let seen = daemon::next(&mut events, |event| match event {
            contracts::EventData::AgentStatus(status) if status.id == later.id => {
                Some((Some(status.status.kind), false))
            }
            contracts::EventData::AgentChannel(channel)
                if channel.id == later.id && channel.channel == Channel::Up =>
            {
                Some((None, true))
            }
            _ => None,
        })
        .await;
        match seen {
            (Some(Kind::Idle), _) => idle = true,
            (None, true) => up = true,
            _ => {}
        }
    }
    node(&fx.user, &later.id).await.unwrap()
}

/// One Mark, then each way to rewind it, one after the other on the same Agents: the plan names no
/// control, a selected child alone is rewound, `keep` leaves the files and `restore` returns them,
/// a refused call changes nothing and `workstream.rewound` is emitted once after the last restart.
#[tokio::test]
async fn a35_rewind_applies_the_selection_and_files_it_is_given() {
    let fx = fixture().await;
    write(&fx).await;
    let roots = roots(&fx).await;
    let root = |id: &str| roots.iter().find(|(r, _)| r == id).unwrap().1.clone();
    let attempt = |tree: &[RailNode], id: &str| attempt_of(tree, id);

    // The plan names no control, consent or takeover; a selected child applies in the call and the
    // other child's file stays; a refused call changes nothing.
    std::fs::write(root(&fx.a).join("README"), "after").unwrap();
    std::fs::write(root(&fx.b).join("README"), "after").unwrap();
    let listing = plan(&fx, None).await.unwrap();
    for entry in listing["agents"].as_array().unwrap() {
        assert!(
            entry
                .as_object()
                .unwrap()
                .keys()
                .all(|k| !k.contains("control")
                    && !k.contains("consent")
                    && !k.contains("takeover")),
            "{entry}"
        );
    }
    let done = rewind(&fx, Some(&fx.a), "restore").await;
    let agents = done["agents"].as_array().unwrap();
    assert_eq!(agents.len(), 1, "{done}");
    assert_eq!(agents[0]["state"], "rewound", "{done}");
    assert_ne!(std::fs::read(root(&fx.a).join("README")).unwrap(), b"after");
    assert_eq!(std::fs::read(root(&fx.b).join("README")).unwrap(), b"after");
    let before = attempts(&rail_tree(&fx.user).await);
    let refused = rewind_as(&fx, &fx.ws, &fx.ws, Some("nobody"), "keep").await;
    assert!(refused.is_err(), "{refused:?}");
    assert_eq!(attempts(&rail_tree(&fx.user).await), before);

    // Unselected Agents keep their files and conversations.
    let before = rail_tree(&fx.user).await;
    for id in [&fx.ws, &fx.a, &fx.b] {
        std::fs::write(root(id).join("README"), format!("later {id}")).unwrap();
    }
    rewind(&fx, Some(&fx.b), "restore").await;
    assert_eq!(std::fs::read(root(&fx.b).join("README")).unwrap(), b"keep");
    for id in [&fx.ws, &fx.a] {
        assert_eq!(
            std::fs::read(root(id).join("README")).unwrap(),
            format!("later {id}").into_bytes()
        );
        assert_eq!(
            attempt(&rail_tree(&fx.user).await, id),
            attempt(&before, id)
        );
    }

    // `restore` returns each Worktree's files and moves no branch and pushes nothing.
    let child_root = root(&fx.b);
    let remote = tempfile::tempdir().unwrap();
    git(remote.path(), &["init", "-q", "--bare"]);
    git(
        &child_root,
        &["remote", "add", "origin", remote.path().to_str().unwrap()],
    );
    std::fs::write(child_root.join("README"), "committed later").unwrap();
    git(&child_root, &["add", "README"]);
    git(&child_root, &["commit", "-qm", "later"]);
    let state = |root: &Path| {
        (
            git(root, &["symbolic-ref", "HEAD"]),
            git(root, &["rev-parse", "HEAD"]),
            git(root, &["remote", "-v"]),
        )
    };
    let states: Vec<_> = roots.iter().map(|(_, root)| state(root)).collect();
    for (_, root) in &roots {
        std::fs::write(root.join("README"), "later").unwrap();
        std::fs::write(root.join("new"), "new").unwrap();
        std::fs::remove_file(root.join(".gitignore")).unwrap();
    }
    rewind(&fx, None, "restore").await;
    assert_eq!(
        roots
            .iter()
            .map(|(_, root)| state(root))
            .collect::<Vec<_>>(),
        states
    );
    assert_eq!(git(remote.path(), &["for-each-ref"]), "");
    for id in [&fx.a, &fx.b] {
        assert_eq!(std::fs::read(root(id).join("README")).unwrap(), b"keep");
        assert!(!root(id).join("new").exists());
        assert!(root(id).join(".gitignore").exists());
    }

    // `keep` changes no file, and a call without it or with another value is refused.
    for (_, root) in &roots {
        std::fs::write(root.join("README"), "after").unwrap();
        std::fs::write(root.join("new"), "new").unwrap();
    }
    for params in [
        json!({"id": fx.ws, "checkpoint": 1}),
        json!({"id": fx.ws, "checkpoint": 1, "files": "always"}),
    ] {
        let error = as_actor(&fx.project, ActorKind::Agent, &fx.ws)
            .await
            .request("workstream.rewind", params)
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::INVALID_PARAMS);
    }
    let before = rail_tree(&fx.user).await;
    let done = rewind(&fx, None, "keep").await;
    assert_eq!(done["files"], "keep");
    for (_, root) in &roots {
        assert_eq!(std::fs::read(root.join("README")).unwrap(), b"after");
        assert_eq!(std::fs::read(root.join("new")).unwrap(), b"new");
    }
    let after = rail_tree(&fx.user).await;
    for id in [&fx.a, &fx.b] {
        assert_ne!(attempt(&after, id), attempt(&before, id));
    }

    // One child, then all: the first call invalidated nothing the second needs, and the Door stays.
    let before = rail_tree(&fx.user).await;
    let one = rewind(&fx, Some(&fx.b), "keep").await;
    assert_eq!(one["agents"].as_array().unwrap().len(), 1);
    assert_eq!(one["agents"][0]["agent"], fx.b.as_str());
    assert_eq!(one["agents"][0]["state"], "rewound");
    let after = rail_tree(&fx.user).await;
    assert_ne!(attempt(&after, &fx.b), attempt(&before, &fx.b));
    assert_eq!(attempt(&after, &fx.a), attempt(&before, &fx.a));
    assert_eq!(attempt(&after, &fx.ws), attempt(&before, &fx.ws));
    let all = rewind(&fx, None, "keep").await;
    let mut ids: Vec<_> = all["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["agent"].as_str().unwrap().to_owned())
        .collect();
    ids.sort();
    let mut expected = vec![fx.a.clone(), fx.b.clone()];
    expected.sort();
    assert!(
        all["agents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["state"] == "rewound"),
        "an unselected child's Mark remains usable: {all}"
    );
    assert_eq!(ids, expected);
    assert_eq!(
        attempt(&rail_tree(&fx.user).await, &fx.ws),
        attempt(&before, &fx.ws),
        "the Door is not restarted"
    );

    // Only the Door's MCP shim offers the tools; an ordinary Agent's call has no effect.
    let before = rail_tree(&fx.user).await;
    let door = mcp(&fx, &fx.ws, &[("tools/list", json!({}))]).await;
    let plain = mcp(
        &fx,
        &fx.b,
        &[
            ("tools/list", json!({})),
            (
                "tools/call",
                json!({"name": "workstream_rewind", "arguments": {"checkpoint": 1, "files": "keep"}}),
            ),
        ],
    )
    .await;
    let names = |reply: &Value| -> Vec<String> {
        reply["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_owned())
            .collect()
    };
    for tool in ["workstream_rewindPlan", "workstream_rewind"] {
        assert!(names(&door[0]).contains(&tool.to_owned()));
        assert!(!names(&plain[0]).contains(&tool.to_owned()));
    }
    assert!(
        plain[1].is_null() || plain[1]["isError"] == true,
        "{}",
        plain[1]
    );
    assert_eq!(rail_tree(&fx.user).await, before);
    let done = mcp(
        &fx,
        &fx.ws,
        &[(
            "tools/call",
            json!({"name": "workstream_rewind", "arguments": {"checkpoint": 1, "files": "keep", "agent": fx.b}}),
        )],
    )
    .await;
    let body: Value =
        serde_json::from_str(done[0]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(body["agents"][0]["state"], "rewound");
    assert_ne!(
        attempt(&rail_tree(&fx.user).await, &fx.b),
        attempt(&before, &fx.b)
    );

    // A restart that fails leaves the others rewound, and a retry rewinds only what is left.
    let before = rail_tree(&fx.user).await;
    let cwd = before
        .iter()
        .find(|n| n.id == fx.b)
        .unwrap()
        .worktree
        .as_ref()
        .unwrap()
        .path
        .clone();
    let dir = transcript_dir(&fx, Path::new(&cwd));
    let held = dir.with_extension("held");
    std::fs::rename(&dir, &held).unwrap();
    std::fs::write(&dir, "blocks the copy").unwrap();
    let error = rewind_as(&fx, &fx.ws, &fx.ws, None, "keep")
        .await
        .unwrap_err();
    assert!(!error.message.is_empty());
    let failed = rail_tree(&fx.user).await;
    assert_ne!(
        attempt(&failed, &fx.a),
        attempt(&before, &fx.a),
        "a was rewound"
    );
    assert_eq!(attempt(&failed, &fx.b), attempt(&before, &fx.b));
    std::fs::remove_file(&dir).unwrap();
    std::fs::rename(&held, &dir).unwrap();
    let mut events = fx.project.subscribed().await;
    let done = rewind(&fx, None, "keep").await;
    assert_eq!(done["agents"].as_array().unwrap().len(), 2);
    let retried = rail_tree(&fx.user).await;
    assert_eq!(
        attempt(&retried, &fx.a),
        attempt(&failed, &fx.a),
        "a is not rewound twice"
    );
    assert_ne!(attempt(&retried, &fx.b), attempt(&before, &fx.b));
    daemon::next(&mut events, |event| match event {
        contracts::EventData::WorkstreamRewound(_) => Some(()),
        _ => None,
    })
    .await;

    // `workstream.rewound` is emitted once, after the last session start; RO2's overview announcements pass first.
    let mut events = fx.project.subscribed().await;
    let before = rail_tree(&fx.user).await;
    let rail = |e| matches!(e, contracts::EventData::RailChanged).then_some(());
    let wait = Duration::from_millis(1500);
    while tokio::time::timeout(wait, daemon::next(&mut events, rail))
        .await
        .is_ok()
    {}
    rewind(&fx, None, "keep").await;
    let restarted = std::cell::RefCell::new(std::collections::HashSet::new());
    daemon::next(&mut events, |e| {
        match e {
            contracts::EventData::AgentStatus(status) if status.status.kind == Kind::Idle => {
                if before
                    .iter()
                    .any(|n| n.id == status.id && n.attempt.as_ref() != Some(&status.attempt))
                {
                    restarted.borrow_mut().insert(status.id.clone());
                }
            }
            contracts::EventData::WorkstreamRewound(data) => {
                assert_eq!((data.id.as_str(), data.checkpoint), (fx.ws.as_str(), 1));
                return Some(());
            }
            _ => {}
        }
        None
    })
    .await;
    let quiet = tokio::time::timeout(Duration::from_millis(500), async {
        daemon::next(&mut events, |e| match e {
            contracts::EventData::WorkstreamRewound(_) => Some(()),
            _ => None,
        })
        .await
    })
    .await;
    assert!(quiet.is_err(), "workstream.rewound was emitted twice");

    // Each Agent resumes a copy of its conversation cut at its Mark, and no slash command is typed.
    for agent in [&fx.a, &fx.b] {
        ask(&fx, agent, "after mark").await;
    }
    rewind(&fx, None, "restore").await;
    for agent in [&fx.a, &fx.b] {
        idle(&fx.user, agent).await;
    }
    for agent in [&fx.a, &fx.b] {
        ask(&fx, agent, "after rewind").await;
    }
    let journal = fx.project.model.as_ref().unwrap().journal();
    let asked: Vec<_> = journal
        .iter()
        .filter(|e| e["body"].to_string().contains("after rewind"))
        .collect();
    assert_eq!(asked.len(), 2);
    for entry in asked {
        let body = entry["body"].to_string();
        assert!(body.contains("from-name"), "earlier turns stay");
        assert!(!body.contains("after mark"), "later turns left the context");
    }
    let projects = fx.project.dir.path().join("claude-config/projects");
    for dir in std::fs::read_dir(projects).unwrap() {
        for file in jsonl(&dir.unwrap().path()) {
            let text = std::fs::read_to_string(&file).unwrap();
            assert!(
                !text.contains("<command-name>/"),
                "a slash command ran in {file:?}"
            );
        }
    }
    for entry in &journal {
        for message in entry["body"]["messages"].as_array().unwrap() {
            if message["role"] == "user" {
                assert!(
                    !message["content"]
                        .to_string()
                        .trim_start_matches(['"', '['])
                        .starts_with('/'),
                    "{message}"
                );
            }
        }
    }
    fx.project.model.as_ref().unwrap().assert_matched();

    // A Subagent made after the Mark leaves the Rail and keeps its Worktree.
    let later = spawn_later(&fx, &fx.b).await;
    let descendant = spawn_later(&fx, &later.id).await;
    let later_root = PathBuf::from(&later.worktree.as_ref().unwrap().path);
    std::fs::write(later_root.join("keep-later"), "kept").unwrap();
    let branch = git(&later_root, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let done = rewind(&fx, None, "restore").await;
    let entry = done["agents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["agent"] == later.id)
        .unwrap();
    assert_eq!(entry["state"], "removed");
    assert!(node(&fx.user, &descendant.id).await.is_none());
    assert!(node(&fx.user, &later.id).await.is_none());
    assert_eq!(
        std::fs::read(later_root.join("keep-later")).unwrap(),
        b"kept"
    );
    assert_eq!(
        git(&later_root, &["rev-parse", "--abbrev-ref", "HEAD"]),
        branch
    );

    // Messages, Todos, Pads and every Checkpoint stay through a rewind.
    as_actor(&fx.project, ActorKind::Agent, &fx.ws)
        .await
        .request(
            "checkpoint.write",
            json!({"title": "later", "blocks": [{"kind": "text", "text": "more"}]}),
        )
        .await
        .unwrap();
    fx.user
        .request("todo.create", json!({"title": "keep me"}))
        .await
        .unwrap();
    fx.user
        .request("pad.create", json!({"name": "notes", "text": "kept"}))
        .await
        .unwrap();
    let state = || async {
        (
            fx.user.request("todo.list", json!(null)).await.unwrap(),
            fx.user.request("pad.list", json!(null)).await.unwrap(),
        )
    };
    let before = state().await;
    rewind(&fx, None, "keep").await;
    assert_eq!(state().await, before);
    let listed = listed(&fx).await;
    let entries = listed.as_array().unwrap();
    assert_eq!(entries.len(), 2, "every Checkpoint stays stored");
    assert!(
        entries
            .iter()
            .all(|c| c["rewindable"] == false || c["id"] == 1)
    );
    assert_eq!(entries[1]["rewindable"], false);
}

/// The replies of `rup mcp <id>` to `calls`, in order, over one stdio session.
async fn mcp(fx: &Fix, id: &str, calls: &[(&str, Value)]) -> Vec<Value> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["mcp", id])
        .env("RUPD_SOCKET", fx.project.socket())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let mut stdin = child.stdin.take().unwrap();
    let mut out = vec![];
    let init = json!({"protocolVersion": "2025-06-18", "capabilities": {},
        "clientInfo": {"name": "t", "version": "0"}});
    let all = [("initialize", init)]
        .into_iter()
        .chain(calls.iter().map(|(m, p)| (*m, p.clone())));
    for (n, (method, params)) in all.enumerate() {
        let line = json!({"jsonrpc": "2.0", "id": n + 1, "method": method, "params": params});
        stdin
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
        let reply = tokio::time::timeout(Duration::from_secs(30), lines.next_line())
            .await
            .expect("the shim answered")
            .unwrap()
            .expect("the shim is open");
        let reply: Value = serde_json::from_str(&reply).unwrap();
        if n > 0 {
            out.push(if reply["error"].is_null() {
                reply["result"].clone()
            } else {
                json!({"isError": true, "error": reply["error"]})
            });
        } else {
            let note = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
            stdin
                .write_all(format!("{note}\n").as_bytes())
                .await
                .unwrap();
        }
    }
    out
}

fn jsonl(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .collect();
    files.sort();
    files
}

/// Send `text` to `agent` as the user and wait until its turn has been saved and ended.
async fn ask(fx: &Fix, agent: &str, text: &str) {
    let cwd = node(&fx.user, agent).await.unwrap().worktree.unwrap().path;
    let dir = transcript_dir(fx, Path::new(&cwd));
    fx.user
        .request("agent.prompt", json!({"id": agent, "text": text}))
        .await
        .unwrap();
    until("the prompt saved", || {
        jsonl(&dir)
            .iter()
            .any(|f| std::fs::read_to_string(f).is_ok_and(|t| t.contains(text)))
            .then_some(())
    })
    .await;
    idle(&fx.user, agent).await;
}

fn transcript_dir(fx: &Fix, cwd: &Path) -> PathBuf {
    let project: String = cwd
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    fx.project
        .dir
        .path()
        .join("claude-config/projects")
        .join(project)
}

/// Restart the Daemon on the pinned `claude`, with a fresh model server for the same fixture.
fn attempt_of(tree: &[RailNode], id: &str) -> Option<String> {
    tree.iter().find(|n| n.id == id).unwrap().attempt.clone()
}

async fn no_rewound(events: &mut rpc::Client) {
    let seen = tokio::time::timeout(Duration::from_millis(600), async {
        daemon::next(events, |e| match e {
            contracts::EventData::WorkstreamRewound(_) => Some(()),
            _ => None,
        })
        .await
    })
    .await;
    assert!(seen.is_err(), "workstream.rewound came too early");
}

// M16: the Door does through its MCP what the user does to a child, and no more.

/// The Door's MCP replies to `tools/call` of each `(tool, arguments)`, in order.
async fn door_calls(fx: &Fix, calls: &[(&str, Value)]) -> Vec<Value> {
    let calls: Vec<(&str, Value)> = calls
        .iter()
        .map(|(name, arguments)| ("tools/call", json!({"name": name, "arguments": arguments})))
        .collect();
    mcp(fx, &fx.ws, &calls).await
}

/// One call's result, which must have succeeded.
fn answered(reply: &Value) -> Value {
    assert_ne!(reply["isError"], true, "{reply}");
    let raw = reply["content"][0]["text"].as_str().unwrap();
    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_owned()))
}

fn typed(text: &str) -> Value {
    use base64::{Engine, engine::general_purpose::STANDARD};
    json!(STANDARD.encode(text))
}

async fn working(events: &mut rpc::Client, id: &str) {
    daemon::next(events, |event| match event {
        contracts::EventData::AgentStatus(status)
            if status.id == id && status.status.kind == Kind::Working =>
        {
            Some(())
        }
        _ => None,
    })
    .await;
}

#[tokio::test]
async fn m16_a_door_can_perform_each_user_action_on_a_child_and_only_on_its_own() {
    let fx = fixture().await;
    write(&fx).await;
    let model = fx.project.model.as_ref().unwrap();
    for child in [fx.a.clone(), fx.b.clone()] {
        let mut events = fx.project.subscribed().await;

        // Prompt and interrupt: the child runs a slow turn on the prompt, and the interrupt ends it early.
        let started = Instant::now();
        let reply = door_calls(
            &fx,
            &[(
                "agent_prompt",
                json!({"id": child, "text": "m16 slow turn"}),
            )],
        )
        .await;
        answered(&reply[0]);
        working(&mut events, &child).await;
        answered(&door_calls(&fx, &[("agent_interrupt", json!({"id": child}))]).await[0]);
        idle(&fx.user, &child).await;
        assert!(
            started.elapsed() < Duration::from_secs(8),
            "the turn ran to its end"
        );

        // Terminal bytes: typed into a Terminal the child owns, they reach its program.
        let spawned = mcp(
            &fx,
            &child,
            &[(
                "tools/call",
                json!({"name": "terminal_spawn", "arguments": {"cwd": "/", "command": ["/bin/cat"],
                    "env": {}, "cols": 80, "rows": 24}}),
            )],
        )
        .await;
        let run = answered(&spawned[0])["id"].as_str().unwrap().to_owned();
        answered(
            &door_calls(
                &fx,
                &[(
                    "terminal_write",
                    json!({"id": run, "data": typed("m16-bytes\n")}),
                )],
            )
            .await[0],
        );
        daemon::h21_poll("the bytes in the child's Terminal", async || {
            let screen = fx
                .user
                .request("terminal.screen", json!({"id": run}))
                .await
                .unwrap();
            screen["lines"]
                .to_string()
                .contains("m16-bytes")
                .then_some(())
        })
        .await;

        // Stop and resume: the conversation stays saved and the child runs again.
        answered(&door_calls(&fx, &[("agent_stop", json!({"id": child}))]).await[0]);
        daemon::h21_poll("the stopped child can resume", async || {
            node(&fx.user, &child).await.filter(|n| n.can_resume)
        })
        .await;
        answered(&door_calls(&fx, &[("agent_resume", json!({"id": child}))]).await[0]);
        idle(&fx.user, &child).await;

        // Rewind to the stored Checkpoint: the child restarts on a new attempt.
        let before = attempt_of(&rail_tree(&fx.user).await, &child);
        let reply = door_calls(
            &fx,
            &[(
                "workstream_rewind",
                json!({"checkpoint": 1, "files": "keep", "agent": child}),
            )],
        )
        .await;
        assert_eq!(answered(&reply[0])["agents"][0]["state"], "rewound");
        assert_ne!(attempt_of(&rail_tree(&fx.user).await, &child), before);
        idle(&fx.user, &child).await;
    }
    model.assert_matched();

    // The same calls on an Agent of another Workstream are refused and change nothing.
    let other = fx
        .user
        .request(
            "rail.createWorkstream",
            json!({"name": "other", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let stranger = serde_json::from_value::<RailNode>(
        fx.user
            .request(
                "agent.spawn",
                json!({"cwd": fx.project.dir.path(), "prompt": null, "parent": other}),
            )
            .await
            .unwrap(),
    )
    .unwrap()
    .id;
    idle(&fx.user, &stranger).await;
    let run = fx
        .user
        .request(
            "agent.run",
            json!({"id": stranger, "command": ["/bin/cat"]}),
        )
        .await
        .unwrap()["terminal_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let own = node(&fx.user, &fx.ws).await.unwrap().terminal_id.unwrap();
    let before = (attempts(&rail_tree(&fx.user).await), terminals(&fx).await);

    let forbidden = door_calls(
        &fx,
        &[
            (
                "agent_prompt",
                json!({"id": stranger, "text": "after mark"}),
            ),
            ("agent_interrupt", json!({"id": stranger})),
            ("agent_stop", json!({"id": stranger})),
            ("agent_resume", json!({"id": stranger})),
            ("terminal_write", json!({"id": run, "data": typed("x\n")})),
            ("terminal_read", json!({"id": run, "after": 0})),
            ("terminal_write", json!({"id": own, "data": typed("x\n")})),
            (
                "workstream_rewind",
                json!({"checkpoint": 1, "files": "keep", "agent": stranger}),
            ),
        ],
    )
    .await;
    for reply in &forbidden {
        assert_eq!(reply["isError"], true, "{reply}");
        assert!(
            reply["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains(&rpc::code::FORBIDDEN.to_string()),
            "{reply}"
        );
    }

    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        before,
        (attempts(&rail_tree(&fx.user).await), terminals(&fx).await)
    );
    let screen = fx
        .user
        .request("terminal.screen", json!({"id": run}))
        .await
        .unwrap();
    assert!(!screen["lines"].to_string().contains('x'), "{screen}");
}

/// Each Terminal's id, owner and whether it runs; titles change with the programs' own spinners.
async fn terminals(fx: &Fix) -> Vec<(Value, Value, Value)> {
    let listed = fx.user.request("terminal.list", Value::Null).await.unwrap();
    listed
        .as_array()
        .unwrap()
        .iter()
        .map(|t| (t["id"].clone(), t["owner"].clone(), t["running"].clone()))
        .collect()
}
