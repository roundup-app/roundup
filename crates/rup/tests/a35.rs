//! A35: durable Checkpoint Marks against a real `rupd`, a fake `claude` and real git.
#![allow(dead_code)]

#[path = "e2e/daemon.rs"]
mod daemon;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use contracts::agent::RailNode;
use contracts::{Actor, ActorKind, IdentifyParams, Kind};
use daemon::{Project, rail_tree};
use serde_json::{Value, json};

struct Fix {
    project: Project,
    log: PathBuf,
    conversations: PathBuf,
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

fn prompts(log: &Path) -> Vec<Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|p| !p["prompt"].as_str().unwrap().starts_with("{\"name\""))
        .collect()
}

async fn fixture() -> Fix {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "roundup"]);
    git(dir.path(), &["config", "user.email", "roundup@example.com"]);
    std::fs::write(dir.path().join("README"), "keep").unwrap();
    std::fs::write(
        dir.path().join(".gitignore"),
        "claude-config/\nprompts.jsonl\nconversations.jsonl\nhold-start\nrupd.sock\nignored\n",
    )
    .unwrap();
    git(dir.path(), &["add", "README", ".gitignore"]);
    git(dir.path(), &["commit", "-qm", "base"]);
    let log = dir.path().join("prompts.jsonl");
    let conversations = dir.path().join("conversations.jsonl");
    let tool = json!({"name": "todo_list", "arguments": {}}).to_string();
    let hold = dir.path().join("hold-start");
    std::fs::write(&hold, "ready").unwrap();
    let hold = hold.to_str().unwrap().to_owned();
    let project = daemon::start_in(
        dir,
        tempfile::tempdir().unwrap(),
        &[
            ("FAKE_CLAUDE_ON_PROMPT", &tool),
            ("FAKE_CLAUDE_HOLD_START", &hold),
            ("FAKE_CLAUDE_MARKS", "1"),
            (
                "FAKE_CLAUDE_CONVERSATION_LOG",
                conversations.to_str().unwrap(),
            ),
            ("FAKE_CLAUDE_PASTE_WHOLE", "1"),
            ("FAKE_CLAUDE_PROMPT_LOG", log.to_str().unwrap()),
        ],
    );
    let user = project.client().await;
    user.request("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let ws = user
        .request(
            "rail.createWorkstream",
            json!({"name": "team", "parent": null}),
        )
        .await
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    user.request("rail.startDoor", json!({"id": ws}))
        .await
        .unwrap();
    idle(&user, &ws).await;
    let spawn = |parent: Value, client: rpc::Client| {
        let cwd = project.dir.path().to_owned();
        async move {
            let node = client
                .request(
                    "agent.spawn",
                    json!({"cwd": cwd, "prompt": null, "parent": parent}),
                )
                .await
                .unwrap();
            serde_json::from_value::<RailNode>(node).unwrap().id
        }
    };
    let a = spawn(json!(ws), project.client().await).await;
    let b = spawn(Value::Null, as_actor(&project, ActorKind::Agent, &a).await).await;
    until("all SessionStart acknowledgements", || {
        let entries = std::fs::read_to_string(&conversations).unwrap_or_default();
        (entries.lines().count() >= 3).then_some(())
    })
    .await;
    let mut events = project.subscribed().await;
    let mut pending = std::collections::HashSet::new();
    for id in [&ws, &a, &b] {
        let sent = user
            .request(
                "message.send",
                json!({"to": id, "kind": "note", "body": "begin"}),
            )
            .await
            .unwrap();
        pending.insert(serde_json::from_value::<u32>(sent["id"].clone()).unwrap());
    }
    // Earlier prompts can already have logged ready. Delivery acknowledges the
    // begin prompt's UserPromptSubmit, so Idle after it cannot be an earlier Stop.
    while !pending.is_empty() {
        let delivered = daemon::next(&mut events, |event| match event {
            contracts::EventData::MessageDelivered(message) if pending.contains(&message.id) => {
                Some(message.id)
            }
            _ => None,
        })
        .await;
        pending.remove(&delivered);
    }
    for id in [&ws, &a, &b] {
        idle(&user, id).await;
    }
    until("each initial ask has stopped", || {
        let entries = std::fs::read_to_string(&conversations).unwrap_or_default();
        let ready: std::collections::HashSet<String> = entries
            .lines()
            .filter_map(|line| {
                let entry: Value = serde_json::from_str(line).ok()?;
                (entry["ready"] == true).then(|| entry["cwd"].as_str().unwrap().to_owned())
            })
            .collect();
        (ready.len() == 3).then_some(())
    })
    .await;
    Fix {
        project,
        log,
        conversations,
        user,
        ws,
        a,
        b,
    }
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

fn launcher(fx: &Fix) -> agents::claude_code::Launcher {
    agents::claude_code::Launcher::new(
        "claude",
        fx.project.dir.path().join("claude-config/.claude.json"),
        "rup".into(),
        None,
    )
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
async fn a35_write_records_a_mark_per_agent() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let fx = fixture().await;
    let roots = roots(&fx).await;
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
    let marks = store(&fx).marks(&fx.ws, 1, 1).unwrap();
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
        let conversation = &mark.conversation;
        assert!(String::from_utf8_lossy(conversation).contains("before mark"));
    }
}

#[tokio::test]
async fn a35_marks_survive_a_restart() {
    let mut fx = fixture().await;
    write(&fx).await;
    let saved = store(&fx).marks(&fx.ws, 1, 1).unwrap();
    for mark in &saved.agents {
        std::fs::write(Path::new(&mark.worktree).join("README"), "later files").unwrap();
    }
    fx.project.restart(&[]);
    fx.user = fx.project.client().await;
    assert_eq!(listed(&fx).await[0]["rewindable"], true);
    assert_eq!(store(&fx).marks(&fx.ws, 1, 1).unwrap(), saved);
    for mark in &saved.agents {
        assert_eq!(regular(mark, b"README"), b"keep");
    }
}

#[tokio::test]
async fn a35_an_old_checkpoint_is_not_rewindable() {
    let fx = fixture().await;
    // A historical M10 card has no Marks: reproduce its old writer, never seed a Rail.
    let db = rusqlite::Connection::open(fx.project.data_dir().join("checkpoints.db")).unwrap();
    db.execute(
        "INSERT INTO checkpoints (workstream,id,at,title,blocks) VALUES (?1,1,1,'old',?2)",
        rusqlite::params![fx.ws, json!([{"kind":"text","text":"facts"}]).to_string()],
    )
    .unwrap();
    assert_eq!(listed(&fx).await[0]["rewindable"], false);
    write(&fx).await;
    write(&fx).await;
    store(&fx).invalidate_after(&fx.ws, 2).unwrap();
    let cards = listed(&fx).await;
    assert_eq!(cards.as_array().unwrap().len(), 3);
    assert_eq!(cards[1]["rewindable"], true);
    assert_eq!(cards[2]["rewindable"], false);
    assert_eq!(
        store(&fx).marks(&fx.ws, 3, 1).unwrap_err().code,
        rpc::code::CONFLICT
    );
    assert_eq!(
        store(&fx).marks(&fx.ws, 2, 2).unwrap_err().code,
        rpc::code::CONFLICT
    );
}

#[tokio::test]
async fn a35_a_clear_makes_earlier_marks_unusable() {
    let fx = fixture().await;
    write(&fx).await;
    let mut events = fx.project.subscribed().await;
    // A pushed Digest can make the Door busy after Idle is observed. Clear reports
    // BUSY without writing a prompt (rupd/src/clear.rs); only that failure is safe to retry.
    tokio::time::timeout(Duration::from_secs(30), async {
        loop {
            idle(&fx.user, &fx.ws).await;
            fx.user
                .request(
                    "workstream.clear",
                    json!({"id": fx.ws, "reason": "next iteration"}),
                )
                .await
                .unwrap();
            tokio::select! {
                _ = until("the Door's Handoff request", || {
                    prompts(&fx.log)
                        .iter()
                        .any(|p| p["prompt"].as_str().unwrap().contains("workstream_handoff"))
                        .then_some(())
                }) => break,
                failed = daemon::next(&mut events, |event| match event {
                    contracts::EventData::WorkstreamClearFailed(data) if data.id == fx.ws => Some(data),
                    _ => None,
                }) => assert_eq!(i64::from(failed.code), rpc::code::BUSY, "{failed:?}"),
            }
        }
    })
    .await
    .expect("the Door accepted the Clear within 30 seconds");
    as_actor(&fx.project, ActorKind::Agent, &fx.ws)
        .await
        .request(
            "workstream.handoff",
            json!({"id": fx.ws, "summary": "next", "keep_todos": [], "keep_pads": []}),
        )
        .await
        .unwrap();
    daemon::next(&mut events, |event| match event {
        contracts::EventData::WorkstreamCleared(data) => Some(data.iteration),
        _ => None,
    })
    .await;
    assert_eq!(listed(&fx).await[0]["rewindable"], false);
    write(&fx).await;
    assert_eq!(listed(&fx).await[1]["rewindable"], true);
    assert_eq!(store(&fx).marks(&fx.ws, 2, 2).unwrap().agents.len(), 1);
}

#[tokio::test]
async fn a35_the_original_conversation_is_untouched() {
    let fx = fixture().await;
    write(&fx).await;
    let mark = store(&fx)
        .marks(&fx.ws, 1, 1)
        .unwrap()
        .agents
        .into_iter()
        .find(|m| m.agent == fx.b)
        .unwrap();
    idle(&fx.user, &fx.b).await;
    fx.user
        .request("agent.prompt", json!({"id": fx.b, "text": "after mark"}))
        .await
        .unwrap();
    let entries: Vec<Value> = std::fs::read_to_string(&fx.conversations)
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    let cwd = Path::new(&mark.cwd).canonicalize().unwrap();
    let original = entries
        .iter()
        .find(|e| e["cwd"] == cwd.to_str().unwrap())
        .unwrap_or_else(|| panic!("cwd {cwd:?}, entries {entries:?}"));
    let path = Path::new(original["path"].as_str().unwrap());
    let before = std::fs::read(path).unwrap();
    assert!(String::from_utf8_lossy(&before).contains("after mark"));
    let adapter = launcher(&fx);
    let id = adapter
        .copy_conversation(Path::new(&mark.cwd), &mark.conversation)
        .unwrap();
    assert_ne!(id, original["id"].as_str().unwrap());
    let copy = adapter
        .record_conversation(Path::new(&mark.cwd), &id)
        .unwrap();
    let copied = String::from_utf8(copy).unwrap();
    assert!(copied.contains("before mark"));
    assert!(!copied.contains("after mark"));
    for line in copied.lines() {
        assert_eq!(
            serde_json::from_str::<Value>(line).unwrap()["sessionId"],
            id
        );
    }
    assert_eq!(std::fs::read(path).unwrap(), before);
}

#[tokio::test]
async fn a35_a_missing_saved_conversation_is_a_recording_failure() {
    let fx = fixture().await;
    let cwd = roots(&fx)
        .await
        .into_iter()
        .find(|(id, _)| id == &fx.b)
        .unwrap()
        .1
        .canonicalize()
        .unwrap();
    let entries: Vec<Value> = std::fs::read_to_string(&fx.conversations)
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    let original = entries
        .iter()
        .find(|e| e["cwd"] == cwd.to_str().unwrap())
        .unwrap();
    std::fs::remove_file(original["path"].as_str().unwrap()).unwrap();
    let error = as_actor(&fx.project, ActorKind::Agent, &fx.ws)
        .await
        .request(
            "checkpoint.write",
            json!({"title": "failed", "blocks": [{"kind": "text", "text": "facts"}]}),
        )
        .await
        .unwrap_err();
    assert!(error.message.contains("cannot record Mark"), "{error:?}");
    assert_eq!(listed(&fx).await[0]["rewindable"], false);
    assert_eq!(
        store(&fx).marks(&fx.ws, 1, 1).unwrap_err().code,
        rpc::code::CONFLICT
    );
}

#[tokio::test]
async fn a35_marks_keep_door_only_write_authorization() {
    let fx = fixture().await;
    for client in [
        fx.project.client().await,
        as_actor(&fx.project, ActorKind::Agent, &fx.b).await,
    ] {
        let error = client
            .request(
                "checkpoint.write",
                json!({"title": "forbidden", "blocks": [{"kind": "text", "text": "facts"}]}),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::FORBIDDEN);
    }
    assert_eq!(listed(&fx).await, json!([]));
}

#[tokio::test]
async fn a35_marks_do_not_follow_a_replaced_directory_symlink() {
    let fx = fixture().await;
    let root = roots(&fx)
        .await
        .into_iter()
        .find(|(id, _)| id == &fx.b)
        .unwrap()
        .1;
    std::fs::create_dir(root.join("folder")).unwrap();
    std::fs::write(root.join("folder/file"), "tracked").unwrap();
    git(&root, &["add", "folder/file"]);
    std::fs::remove_dir_all(root.join("folder")).unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("file"), "outside the Worktree").unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("folder")).unwrap();
    write(&fx).await;
    let marks = store(&fx).marks(&fx.ws, 1, 1).unwrap();
    let mark = marks.agents.iter().find(|mark| mark.agent == fx.b).unwrap();
    assert!(!mark.files.iter().any(|file| file.path == b"folder/file"));
    assert!(matches!(
        mark.files
            .iter()
            .find(|file| file.path == b"folder")
            .unwrap()
            .content,
        checkpoints::FileContent::Symlink { .. }
    ));
}

#[tokio::test]
async fn a35_plan_lists_each_agent_and_changes_nothing() {
    let fx = fixture().await;
    let checkpoint = write(&fx).await;
    let before = rail_tree(&fx.user).await;
    let plan = fx
        .user
        .request(
            "workstream.rewindPlan",
            json!({"id": fx.ws, "checkpoint": checkpoint["id"]}),
        )
        .await
        .unwrap();
    assert_eq!(plan["agents"].as_array().unwrap().len(), 3);
    assert_eq!(plan["files_changed"], false);
    assert_eq!(rail_tree(&fx.user).await, before);
}

async fn rewind(fx: &Fix, files: &str, takeover: Vec<String>) -> Value {
    fx.user.request("workstream.rewind", json!({"id": fx.ws, "checkpoint": 1, "files": files, "takeover": takeover, "proof": "0".repeat(64)})).await.unwrap()
}

#[tokio::test]
async fn a35_keep_changes_no_file() {
    let fx = fixture().await;
    write(&fx).await;
    let roots = roots(&fx).await;
    for (_, root) in &roots {
        std::fs::write(root.join("README"), "after").unwrap();
        std::fs::write(root.join("new"), "new").unwrap();
    }
    let before = rail_tree(&fx.user).await;
    let done = rewind(&fx, "keep", vec![]).await;
    assert_eq!(done["rewound"].as_array().unwrap().len(), 3);
    for (_, root) in &roots {
        assert_eq!(std::fs::read(root.join("README")).unwrap(), b"after");
        assert_eq!(std::fs::read(root.join("new")).unwrap(), b"new");
    }
    let after = rail_tree(&fx.user).await;
    for n in before {
        let restarted = after.iter().find(|a| a.id == n.id).unwrap();
        assert_ne!(restarted.attempt, n.attempt);
        assert_eq!(restarted.iteration, n.iteration);
    }
}

#[tokio::test]
async fn a35_restore_returns_each_worktree_to_its_snapshot() {
    let fx = fixture().await;
    write(&fx).await;
    let roots = roots(&fx).await;
    let mut heads = Vec::new();
    for (_, root) in &roots {
        std::fs::write(root.join("README"), "committed later").unwrap();
        git(root, &["add", "README"]);
        git(root, &["commit", "-qm", "later"]);
        heads.push(git(root, &["rev-parse", "HEAD"]));
        std::fs::write(root.join("new"), "new").unwrap();
        std::fs::remove_file(root.join(".gitignore")).unwrap();
    }
    rewind(&fx, "restore", vec![]).await;
    for ((_, root), head) in roots.iter().zip(heads) {
        assert_eq!(std::fs::read(root.join("README")).unwrap(), b"keep");
        assert!(!root.join("new").exists());
        assert!(root.join(".gitignore").exists());
        assert_eq!(git(root, &["rev-parse", "HEAD"]), head);
    }
}

#[tokio::test]
async fn a35_a_takeover_agent_is_skipped_unless_named() {
    let fx = fixture().await;
    write(&fx).await;
    fx.user
        .request("takeover.begin", json!({"agent": fx.b}))
        .await
        .unwrap();
    let before = node(&fx.user, &fx.b).await.unwrap();
    let root = before.worktree.as_ref().unwrap().path.clone();
    std::fs::write(Path::new(&root).join("README"), "under takeover").unwrap();
    let done = rewind(&fx, "restore", vec![]).await;
    assert_eq!(done["skipped"], json!([fx.b]));
    assert_eq!(node(&fx.user, &fx.b).await.unwrap().attempt, before.attempt);
    assert_eq!(
        std::fs::read(Path::new(&root).join("README")).unwrap(),
        b"under takeover"
    );
    assert!(
        fx.user
            .request(
                "workstream.rewindPlan",
                json!({"id": fx.ws, "checkpoint": 1})
            )
            .await
            .unwrap()["agents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["agent"] == fx.b && a["takeover"] == true)
    );
}

#[tokio::test]
async fn a35_a_named_takeover_agent_is_rewound() {
    let fx = fixture().await;
    write(&fx).await;
    fx.user
        .request("takeover.begin", json!({"agent": fx.b}))
        .await
        .unwrap();
    let before = node(&fx.user, &fx.b).await.unwrap();
    let done = rewind(&fx, "keep", vec![fx.b.clone()]).await;
    assert!(done["rewound"].as_array().unwrap().contains(&json!(fx.b)));
    assert_ne!(node(&fx.user, &fx.b).await.unwrap().attempt, before.attempt);
}

#[tokio::test]
async fn a35_an_agent_cannot_name_a_takeover_agent() {
    let fx = fixture().await;
    write(&fx).await;
    fx.user
        .request("takeover.begin", json!({"agent": fx.b}))
        .await
        .unwrap();
    let before = rail_tree(&fx.user).await;
    let client = as_actor(&fx.project, ActorKind::Agent, &fx.ws).await;
    let err = client.request("workstream.rewind", json!({"id": fx.ws, "checkpoint": 1, "files": "keep", "takeover": [fx.b], "proof": "0".repeat(64)})).await.unwrap_err();
    assert_eq!(err.code, rpc::code::FORBIDDEN);
    assert_eq!(rail_tree(&fx.user).await, before);
}

#[tokio::test]
async fn a35_each_agent_resumes_a_copy_cut_at_its_mark() {
    let fx = fixture().await;
    write(&fx).await;
    let original: Vec<Value> = std::fs::read_to_string(&fx.conversations)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|v| v["path"].is_string())
        .collect();
    let marks = store(&fx).marks(&fx.ws, 1, 1).unwrap();
    for mark in &marks.agents {
        fx.user
            .request(
                "agent.prompt",
                json!({"id": mark.agent, "text": "after mark"}),
            )
            .await
            .unwrap();
    }
    for mark in &marks.agents {
        idle(&fx.user, &mark.agent).await;
    }
    let saved: Vec<_> = original
        .iter()
        .map(|v| {
            let path = v["path"].as_str().unwrap();
            (path.to_owned(), std::fs::read(path).unwrap())
        })
        .collect();
    rewind(&fx, "keep", vec![]).await;
    let entries: Vec<Value> = std::fs::read_to_string(&fx.conversations)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|v| v["path"].is_string())
        .collect();
    for mark in &marks.agents {
        let cwd = Path::new(&mark.cwd).canonicalize().unwrap();
        let copy = entries
            .iter()
            .rev()
            .find(|v| v["cwd"] == cwd.to_str().unwrap())
            .unwrap();
        let bytes = std::fs::read(copy["path"].as_str().unwrap()).unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("before mark"));
        assert!(!String::from_utf8_lossy(&bytes).contains("after mark"));
        assert!(original.iter().all(|v| v["id"] != copy["id"]));
    }
    for (path, bytes) in saved {
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
    assert!(
        prompts(&fx.log)
            .iter()
            .all(|p| !p["prompt"].as_str().unwrap().starts_with('/'))
    );
    let notes = fx
        .user
        .request("message.list", json!({"to": fx.ws, "status": null}))
        .await
        .unwrap();
    assert_eq!(
        notes
            .as_array()
            .unwrap()
            .iter()
            .filter(|n| n["from"]["kind"] == "user"
                && n["body"]
                    .as_str()
                    .unwrap()
                    .contains("rewound to the Checkpoint"))
            .count(),
        1
    );
}

#[tokio::test]
async fn a35_a_failed_step_retries_without_repeating_work() {
    let fx = fixture().await;
    write(&fx).await;
    fx.user
        .request("takeover.begin", json!({"agent": fx.b}))
        .await
        .unwrap();
    let entries: Vec<Value> = std::fs::read_to_string(&fx.conversations)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|v| v["path"].is_string())
        .collect();
    let before = node(&fx.user, &fx.b).await.unwrap();
    let cwd = Path::new(&before.worktree.as_ref().unwrap().path)
        .canonicalize()
        .unwrap();
    let path = PathBuf::from(
        entries
            .iter()
            .find(|v| v["cwd"] == cwd.to_str().unwrap())
            .unwrap()["path"]
            .as_str()
            .unwrap(),
    );
    let directory = path.parent().unwrap();
    let backup = directory.with_extension("held");
    std::fs::rename(directory, &backup).unwrap();
    std::fs::write(directory, "block copy creation").unwrap();
    let params = json!({"id": fx.ws, "checkpoint": 1, "files": "keep", "takeover": [fx.b], "proof": "0".repeat(64)});
    assert!(
        fx.user
            .request("workstream.rewind", params.clone())
            .await
            .is_err()
    );
    let after_failure = rail_tree(&fx.user).await;
    let door_attempt = after_failure
        .iter()
        .find(|n| n.id == fx.ws)
        .unwrap()
        .attempt
        .clone();
    assert_eq!(
        after_failure.iter().find(|n| n.id == fx.b).unwrap().attempt,
        before.attempt
    );
    std::fs::remove_file(directory).unwrap();
    std::fs::rename(backup, directory).unwrap();
    let result = fx.user.request("workstream.rewind", params).await.unwrap();
    assert_eq!(result["rewound"].as_array().unwrap().len(), 3);
    assert_eq!(node(&fx.user, &fx.ws).await.unwrap().attempt, door_attempt);
    assert_ne!(node(&fx.user, &fx.b).await.unwrap().attempt, before.attempt);
}

#[tokio::test]
async fn a35_a_later_subagent_leaves_the_rail_and_keeps_its_worktree() {
    let fx = fixture().await;
    write(&fx).await;
    let later: RailNode = serde_json::from_value(
        as_actor(&fx.project, ActorKind::Agent, &fx.b)
            .await
            .request(
                "agent.spawn",
                json!({"cwd": fx.project.dir.path(), "prompt": null}),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    let root = PathBuf::from(&later.worktree.as_ref().unwrap().path);
    std::fs::write(root.join("keep-later"), "kept").unwrap();
    let branch = git(&root, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let done = rewind(&fx, "restore", vec![]).await;
    assert_eq!(done["removed"], json!([later.id]));
    assert!(node(&fx.user, &later.id).await.is_none());
    assert_eq!(std::fs::read(root.join("keep-later")).unwrap(), b"kept");
    assert_eq!(git(&root, &["rev-parse", "--abbrev-ref", "HEAD"]), branch);
}

#[tokio::test]
async fn a35_one_rewind_at_a_time() {
    let fx = fixture().await;
    write(&fx).await;
    std::fs::remove_file(fx.project.dir.path().join("hold-start")).unwrap();
    let client = fx.project.client().await;
    let params = json!({"id": fx.ws, "checkpoint": 1, "files": "keep"});
    let pending = tokio::spawn({
        let params = params.clone();
        async move { client.request("workstream.rewind", params).await }
    });
    let mut starting = false;
    for _ in 0..200 {
        if node(&fx.user, &fx.ws)
            .await
            .unwrap()
            .status
            .is_some_and(|s| s.label == "starting")
        {
            starting = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(starting, "rewind never selected the Door's next Attempt");
    let err = fx
        .user
        .request("workstream.rewind", params)
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::CONFLICT);
    std::fs::write(fx.project.dir.path().join("hold-start"), "ready").unwrap();
    pending.await.unwrap().unwrap();
}

#[tokio::test]
async fn a35_rewound_is_emitted_once_after_the_last_session_start() {
    let fx = fixture().await;
    write(&fx).await;
    let before = rail_tree(&fx.user).await;
    let mut events = fx.project.subscribed().await;
    rewind(&fx, "keep", vec![]).await;
    let rail_changes = std::cell::Cell::new(0);
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
            contracts::EventData::RailChanged => {
                assert_eq!(restarted.borrow().len(), 3);
                rail_changes.set(rail_changes.get() + 1);
            }
            contracts::EventData::WorkstreamRewound(data) => {
                assert_eq!(data.id, fx.ws);
                assert_eq!(data.checkpoint, 1);
                assert_eq!(rail_changes.get(), 1);
                return Some(());
            }
            _ => {}
        }
        None
    })
    .await;
}

#[tokio::test]
async fn a35_plan_refuses_an_unrewindable_checkpoint() {
    let fx = fixture().await;
    write(&fx).await;
    for (id, checkpoint, code) in [
        (&fx.ws, 2, rpc::code::NOT_FOUND),
        (&"unknown".to_owned(), 1, rpc::code::NOT_FOUND),
    ] {
        assert_eq!(
            fx.user
                .request(
                    "workstream.rewindPlan",
                    json!({"id": id, "checkpoint": checkpoint})
                )
                .await
                .unwrap_err()
                .code,
            code
        );
    }
    store(&fx).invalidate_after(&fx.ws, 0).unwrap();
    assert_eq!(
        fx.user
            .request(
                "workstream.rewindPlan",
                json!({"id": fx.ws, "checkpoint": 1})
            )
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
}

#[tokio::test]
async fn a35_messages_todos_pads_and_checkpoints_stay() {
    let fx = fixture().await;
    write(&fx).await;
    let later: RailNode = serde_json::from_value(
        as_actor(&fx.project, ActorKind::Agent, &fx.b)
            .await
            .request(
                "agent.spawn",
                json!({"cwd": fx.project.dir.path(), "prompt": null}),
            )
            .await
            .unwrap(),
    )
    .unwrap();
    for agent in [&fx.b, &later.id] {
        fx.user
            .request(
                "route.set",
                json!({"from": "you", "to": agent, "delivery": "ask-first"}),
            )
            .await
            .unwrap();
        fx.user
            .request(
                "message.send",
                json!({"to": agent, "kind": "note", "body": "held through rewind"}),
            )
            .await
            .unwrap();
    }
    let before = fx
        .user
        .request("message.list", json!({"to": null, "status": null}))
        .await
        .unwrap();
    fx.user
        .request("todo.create", json!({"title": "keep this Todo"}))
        .await
        .unwrap();
    fx.user
        .request(
            "pad.create",
            json!({"name": "kept", "text": "keep this Pad"}),
        )
        .await
        .unwrap();
    let todos = fx.user.request("todo.list", json!({})).await.unwrap();
    let pads = fx.user.request("pad.list", json!({})).await.unwrap();
    write(&fx).await;
    rewind(&fx, "keep", vec![]).await;
    let after = fx
        .user
        .request("message.list", json!({"to": null, "status": null}))
        .await
        .unwrap();
    for message in before.as_array().unwrap() {
        assert!(
            after.as_array().unwrap().contains(message),
            "Message changed: {message}"
        );
    }
    assert_eq!(
        fx.user.request("todo.list", json!({})).await.unwrap(),
        todos
    );
    assert_eq!(fx.user.request("pad.list", json!({})).await.unwrap(), pads);
    let cards = listed(&fx).await;
    assert_eq!(cards.as_array().unwrap().len(), 2);
    assert_eq!(cards[0]["rewindable"], true);
    assert_eq!(cards[1]["rewindable"], false);
    assert_eq!(node(&fx.user, &fx.ws).await.unwrap().iteration, Some(1));
}

#[tokio::test]
async fn a35_rewind_requires_a_file_choice() {
    let fx = fixture().await;
    write(&fx).await;
    let before = rail_tree(&fx.user).await;
    for params in [
        json!({"id": fx.ws, "checkpoint": 1}),
        json!({"id": fx.ws, "checkpoint": 1, "files": "always"}),
    ] {
        assert_eq!(
            fx.user
                .request("workstream.rewind", params)
                .await
                .unwrap_err()
                .code,
            rpc::code::INVALID_PARAMS
        );
    }
    assert_eq!(rail_tree(&fx.user).await, before);
}

#[tokio::test]
async fn a35_a_completed_checkpoint_can_be_rewound_again_after_more_turns() {
    let fx = fixture().await;
    write(&fx).await;
    rewind(&fx, "keep", vec![]).await;
    let first = node(&fx.user, &fx.ws).await.unwrap().attempt;
    fx.user
        .request("agent.prompt", json!({"id": fx.ws, "text": "a later turn"}))
        .await
        .unwrap();
    idle(&fx.user, &fx.ws).await;
    rewind(&fx, "keep", vec![]).await;
    assert_ne!(node(&fx.user, &fx.ws).await.unwrap().attempt, first);
}
