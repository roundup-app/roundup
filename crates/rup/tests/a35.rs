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
    let project = daemon::start_in(
        dir,
        tempfile::tempdir().unwrap(),
        &[
            ("FAKE_CLAUDE_ON_PROMPT", &tool),
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
    for id in [&ws, &a, &b] {
        user.request(
            "message.send",
            json!({"to": id, "kind": "note", "body": "begin"}),
        )
        .await
        .unwrap();
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
    idle(&fx.user, &fx.ws).await;
    let mut events = fx.project.subscribed().await;
    fx.user
        .request(
            "workstream.clear",
            json!({"id": fx.ws, "reason": "next iteration"}),
        )
        .await
        .unwrap();
    until("the Door's Handoff request", || {
        prompts(&fx.log)
            .iter()
            .any(|p| p["prompt"].as_str().unwrap().contains("workstream_handoff"))
            .then_some(())
    })
    .await;
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
