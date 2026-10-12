//! A32: clearing a Workstream against a real `rupd`, a fake `claude` and real git.
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
    /// While this file exists the fake `claude` plays its `SessionStart`; a start without it hangs.
    hold: PathBuf,
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

/// Idle and staying idle: Subagents' digests keep steering a Door for a moment after they change.
async fn settle(client: &rpc::Client, id: &str) {
    let mut quiet = Instant::now();
    loop {
        let kind = node(client, id)
            .await
            .and_then(|n| n.status)
            .map(|s| s.kind);
        match kind {
            Some(Kind::Idle) if quiet.elapsed() > Duration::from_millis(1500) => return,
            Some(Kind::Idle) => {}
            Some(Kind::Done | Kind::Error) | None => return,
            _ => quiet = Instant::now(),
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Who is on the Rail and under whom.
async fn shape(client: &rpc::Client) -> Vec<(String, Option<String>)> {
    rail_tree(client)
        .await
        .into_iter()
        .map(|n| (n.id, n.parent))
        .collect()
}

fn prompts(log: &Path) -> Vec<Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|p| !p["prompt"].as_str().unwrap().starts_with("{\"name\""))
        .collect()
}

async fn fixture_with(bound_ms: &str) -> Fix {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "roundup"]);
    git(dir.path(), &["config", "user.email", "roundup@example.com"]);
    std::fs::write(dir.path().join("README"), "keep").unwrap();
    git(dir.path(), &["add", "README"]);
    git(dir.path(), &["commit", "-qm", "base"]);
    let log = dir.path().join("prompts.jsonl");
    let hold = dir.path().join("hold-start");
    std::fs::write(&hold, "").unwrap();
    let tool = json!({"name": "todo_list", "arguments": {}}).to_string();
    let project = daemon::start_in(
        dir,
        tempfile::tempdir().unwrap(),
        &[
            ("FAKE_CLAUDE_ON_PROMPT", &tool),
            ("FAKE_CLAUDE_PASTE_WHOLE", "1"),
            ("FAKE_CLAUDE_PROMPT_LOG", log.to_str().unwrap()),
            ("FAKE_CLAUDE_HOLD_START", hold.to_str().unwrap()),
            ("ROUNDUP_HANDOFF_BOUND_MS", bound_ms),
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
    Fix {
        project,
        log,
        hold,
        user,
        ws,
        a,
        b,
    }
}

async fn fixture() -> Fix {
    fixture_with("60000").await
}

/// A clear that has been asked for: the call's reply and the connection that sees how it ends.
struct Pending {
    events: rpc::Client,
    reply: Result<Value, rpc::RpcError>,
}

impl Pending {
    /// The Iteration `workstream.cleared` names, or the code and text of `workstream.clearFailed`.
    async fn end(&mut self) -> Result<u32, (i32, String)> {
        assert_eq!(self.reply.as_ref().unwrap(), &json!({"pending": true}));
        daemon::next(&mut self.events, |data| match data {
            contracts::EventData::WorkstreamCleared(cleared) => Some(Ok(cleared.iteration)),
            contracts::EventData::WorkstreamClearFailed(failed) => {
                Some(Err((failed.code, failed.message)))
            }
            _ => None,
        })
        .await
    }
}

impl Fix {
    /// A Todo: the user's, or `by`'s (an Agent's lands in the Workstream, T14).
    async fn todo(&self, by: Option<&str>, title: &str) -> u32 {
        let client = match by {
            Some(id) => as_actor(&self.project, ActorKind::Agent, id).await,
            None => self.project.client().await,
        };
        let todo = client
            .request(
                "todo.create",
                json!({"title": title, "body": format!("{title} body")}),
            )
            .await
            .unwrap();
        let id = todo["id"].as_u64().unwrap() as u32;
        if by.is_none() {
            client
                .request("todo.move", json!({"id": id, "home": self.ws}))
                .await
                .unwrap();
        }
        id
    }

    async fn pad(&self, by: Option<&str>, name: &str) {
        let client = match by {
            Some(id) => as_actor(&self.project, ActorKind::Agent, id).await,
            None => self.project.client().await,
        };
        client
            .request(
                "pad.create",
                json!({"name": name, "text": format!("{name} text")}),
            )
            .await
            .unwrap();
        if by.is_none() {
            client
                .request("pad.move", json!({"name": name, "home": self.ws}))
                .await
                .unwrap();
        }
    }

    /// Settle the Door, then call `workstream.clear`; its events are read from `Pending::end`.
    async fn clear(&self, reason: &str, without: bool) -> Pending {
        settle(&self.user, &self.ws).await;
        let events = self.project.subscribed().await;
        let params = if without {
            json!({"id": self.ws, "reason": reason, "without_handoff": true})
        } else {
            json!({"id": self.ws, "reason": reason})
        };
        let reply = self.user.request("workstream.clear", params).await;
        Pending { events, reply }
    }

    async fn asked(&self) -> String {
        let log = self.log.clone();
        until("the Door was asked", || {
            prompts(&log).iter().find_map(|p| {
                p["prompt"]
                    .as_str()
                    .filter(|t| t.contains("workstream_handoff"))
                    .map(str::to_owned)
            })
        })
        .await
    }

    async fn hand_off(&self, params: Value) -> Result<Value, rpc::RpcError> {
        as_actor(&self.project, ActorKind::Agent, &self.ws)
            .await
            .request("workstream.handoff", params)
            .await
    }

    async fn todos(&self) -> Vec<Value> {
        self.user
            .request("todo.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }

    async fn pads(&self) -> Vec<Value> {
        self.user
            .request("pad.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .clone()
    }

    async fn full(&self) -> (u32, u32) {
        let keep = self.todo(None, "build the login page").await;
        let fluff = self.todo(Some(&self.a), "refactor everything").await;
        self.pad(None, "notes").await;
        self.pad(Some(&self.b), "scratch").await;
        settle(&self.user, &self.ws).await;
        (keep, fluff)
    }
}

fn names(items: &[Value], key: &str) -> Vec<String> {
    items
        .iter()
        .map(|i| i[key].to_string().trim_matches('"').to_owned())
        .collect()
}

#[tokio::test]
async fn a32_an_empty_reason_changes_nothing() {
    let fx = fixture().await;
    let before = shape(&fx.user).await;
    let asked = prompts(&fx.log).len();
    for reason in ["", "  \n ", &"x".repeat(2001)] {
        let err = fx
            .user
            .request("workstream.clear", json!({"id": fx.ws, "reason": reason}))
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::INVALID_PARAMS);
    }
    let missing = fx
        .user
        .request("workstream.clear", json!({"id": "9999", "reason": "r"}))
        .await
        .unwrap_err();
    assert_eq!(missing.code, rpc::code::NOT_FOUND);
    let sub = fx
        .user
        .request("workstream.clear", json!({"id": fx.a, "reason": "r"}))
        .await
        .unwrap_err();
    assert_eq!(sub.code, rpc::code::INVALID_PARAMS);
    assert_eq!(shape(&fx.user).await, before);
    assert_eq!(prompts(&fx.log).len(), asked);
}

#[tokio::test]
async fn a32_a_valid_clear_only_asks_the_door() {
    let fx = fixture().await;
    fx.user
        .request(
            "message.send",
            json!({"to": fx.ws, "kind": "note", "body": "I want a login page"}),
        )
        .await
        .unwrap();
    let (keep, fluff) = fx.full().await;
    let before = shape(&fx.user).await;
    let task = fx.clear("too much fluff", false).await;
    let ask = fx.asked().await;
    assert!(ask.contains("too much fluff"), "{ask}");
    assert!(ask.contains("1. I want a login page"), "{ask}");
    assert!(
        ask.contains(&format!("{keep} \"build the login page\"")),
        "{ask}"
    );
    assert!(
        ask.contains(&format!("{fluff} \"refactor everything\"")),
        "{ask}"
    );
    assert!(ask.contains("scratch (owner "), "{ask}");
    assert_eq!(
        shape(&fx.user).await,
        before,
        "nothing leaves the Rail before the Handoff"
    );
    assert_eq!(fx.todos().await.len(), 2);
    let second = fx
        .user
        .request("workstream.clear", json!({"id": fx.ws, "reason": "again"}))
        .await
        .unwrap_err();
    assert_eq!(second.code, rpc::code::CONFLICT);
    drop(task);
}

#[tokio::test]
async fn a32_only_the_door_may_hand_off() {
    let fx = fixture().await;
    let params = json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []});
    let none = fx.hand_off(params.clone()).await.unwrap_err();
    assert_eq!(none.code, rpc::code::CONFLICT);
    let task = fx.clear("r", false).await;
    fx.asked().await;
    for who in [
        as_actor(&fx.project, ActorKind::Agent, &fx.a).await,
        fx.project.client().await,
    ] {
        let err = who
            .request("workstream.handoff", params.clone())
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::FORBIDDEN);
    }
    drop(task);
}

#[tokio::test]
async fn a32_a_bad_id_in_the_handoff_keeps_the_clear_pending() {
    let fx = fixture().await;
    let (keep, _) = fx.full().await;
    let mut task = fx.clear("r", false).await;
    fx.asked().await;
    for bad in [
        json!({"keep_todos": [999], "keep_pads": []}),
        json!({"keep_todos": [], "keep_pads": ["nope"]}),
        json!({"keep_todos": [], "keep_pads": [], "summary": " "}),
    ] {
        let mut params = json!({"id": fx.ws, "summary": "s"});
        params
            .as_object_mut()
            .unwrap()
            .extend(bad.as_object().unwrap().clone());
        let err = fx.hand_off(params).await.unwrap_err();
        assert_eq!(err.code, rpc::code::INVALID_PARAMS);
    }
    assert_eq!(fx.todos().await.len(), 2, "a bad Handoff changes nothing");
    fx.hand_off(json!({"id": fx.ws, "summary": "ok", "keep_todos": [keep], "keep_pads": []}))
        .await
        .unwrap();
    task.end().await.unwrap();
}

#[tokio::test]
async fn a32_unkept_todos_and_pads_are_archived_not_lost() {
    let fx = fixture().await;
    let (keep, fluff) = fx.full().await;
    let mut task = fx.clear("bloat", false).await;
    fx.asked().await;
    fx.hand_off(json!({"id": fx.ws, "summary": "Login page wanted.", "keep_todos": [keep], "keep_pads": ["notes"]})).await.unwrap();
    task.end().await.unwrap();

    assert_eq!(names(&fx.todos().await, "id"), [keep.to_string()]);
    let pads = fx.pads().await;
    assert_eq!(names(&pads, "name").len(), 2);
    let archive = pads
        .iter()
        .find(|p| p["name"] == "archive-1")
        .expect("the archive Pad");
    assert_eq!(archive["owner"]["kind"], "user");
    let text = archive["text"].as_str().unwrap();
    assert!(
        text.contains(&format!(
            "## refactor everything (todo {fluff}, owner {})",
            fx.a
        )),
        "{text}"
    );
    assert!(text.contains("refactor everything body"), "{text}");
    assert!(text.contains("## scratch (pad, owner "), "{text}");
    assert!(text.contains("scratch text"), "{text}");
    assert!(!text.contains("build the login page"), "{text}");
}

#[tokio::test]
async fn a32_kept_items_keep_their_ids_and_owners() {
    let fx = fixture().await;
    let (keep, fluff) = fx.full().await;
    fx.user
        .request("todo.setBlockers", json!({"id": keep, "blockers": [fluff]}))
        .await
        .unwrap();
    let before = fx
        .todos()
        .await
        .into_iter()
        .find(|t| t["id"] == keep)
        .unwrap();
    let mut task = fx.clear("r", false).await;
    fx.asked().await;
    fx.hand_off(
        json!({"id": fx.ws, "summary": "s", "keep_todos": [keep], "keep_pads": ["scratch"]}),
    )
    .await
    .unwrap();
    task.end().await.unwrap();

    let after = fx
        .todos()
        .await
        .into_iter()
        .find(|t| t["id"] == keep)
        .unwrap();
    assert_eq!(
        after["blockers"],
        json!([]),
        "an archived blocker leaves the list"
    );
    assert_eq!(
        (&after["title"], &after["creator"], &after["home"]),
        (&before["title"], &before["creator"], &before["home"])
    );
    let scratch = fx
        .pads()
        .await
        .into_iter()
        .find(|p| p["name"] == "scratch")
        .unwrap();
    assert_eq!(
        scratch["owner"]["kind"], "user",
        "a Pad of a removed Subagent becomes the user's"
    );
    assert_eq!(scratch["home"], json!(fx.ws));
}

#[tokio::test]
async fn a32_subagents_stop_deepest_first_and_leave_the_rail() {
    let fx = fixture().await;
    let mut events = fx.project.subscribed().await;
    let mut task = fx.clear("r", false).await;
    fx.asked().await;
    fx.hand_off(json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []}))
        .await
        .unwrap();
    task.end().await.unwrap();

    let tree = rail_tree(&fx.user).await;
    assert!(tree.iter().all(|n| n.id != fx.a && n.id != fx.b));
    assert!(tree.iter().any(|n| n.id == fx.ws));
    // The deeper Subagent's Worktree is handed off before the shallower one's.
    let handoff = prompts(&fx.log).into_iter().last().unwrap()["prompt"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        handoff
            .find(&format!("branch roundup/agent-{}", fx.a))
            .is_some(),
        "{handoff}"
    );
    let _ = daemon::next(&mut events, |data| {
        matches!(data, contracts::EventData::WorkstreamCleared(_)).then_some(())
    })
    .await;
}

#[tokio::test]
async fn a32_worktrees_and_branches_survive_even_dirty() {
    let fx = fixture().await;
    let nodes = rail_tree(&fx.user).await;
    let trees: Vec<_> = [&fx.a, &fx.b]
        .map(|id| {
            nodes
                .iter()
                .find(|n| &n.id == id)
                .unwrap()
                .worktree
                .clone()
                .unwrap()
        })
        .into();
    std::fs::write(Path::new(&trees[1].path).join("dirty.txt"), "unlanded").unwrap();
    let mut task = fx.clear("r", false).await;
    fx.asked().await;
    fx.hand_off(json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []}))
        .await
        .unwrap();
    task.end().await.unwrap();

    let branches = git(fx.project.dir.path(), &["branch", "--list"]);
    for tree in &trees {
        assert!(Path::new(&tree.path).is_dir(), "{} was removed", tree.path);
        assert!(branches.contains(&tree.branch), "{branches}");
    }
    assert!(Path::new(&trees[1].path).join("dirty.txt").is_file());
    let handoff = prompts(&fx.log).into_iter().last().unwrap()["prompt"]
        .as_str()
        .unwrap()
        .to_owned();
    for tree in &trees {
        assert!(
            handoff.contains(&tree.path) && handoff.contains(&tree.branch),
            "{handoff}"
        );
    }
}

#[tokio::test]
async fn a32_the_door_restarts_fresh_from_the_handoff() {
    let fx = fixture().await;
    fx.full().await;
    let first = node(&fx.user, &fx.ws).await.unwrap();
    let mut task = fx.clear("bloat", false).await;
    fx.asked().await;
    fx.hand_off(
        json!({"id": fx.ws, "summary": "Build the login page.", "keep_todos": [], "keep_pads": []}),
    )
    .await
    .unwrap();
    assert_eq!(task.end().await.unwrap(), 2);

    let after = node(&fx.user, &fx.ws).await.unwrap();
    assert_eq!(after.attempt, Some("2".to_owned()));
    assert_ne!(after.terminal_id, first.terminal_id);
    let last = prompts(&fx.log).into_iter().last().unwrap();
    assert_eq!(last["resume"], false);
    let text = last["prompt"].as_str().unwrap();
    assert!(text.starts_with("Build the login page."), "{text}");
    assert!(text.contains("archived in the Pad archive-1"), "{text}");
}

#[tokio::test]
async fn a32_no_slash_command_is_typed() {
    let fx = fixture().await;
    let mut task = fx.clear("/clear please", false).await;
    fx.asked().await;
    fx.hand_off(json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []}))
        .await
        .unwrap();
    task.end().await.unwrap();
    for typed in prompts(&fx.log) {
        let text = typed["prompt"].as_str().unwrap();
        assert!(!text.starts_with('/'), "{text}");
    }
}

#[tokio::test]
async fn a32_iteration_advances_once() {
    let fx = fixture().await;
    assert_eq!(node(&fx.user, &fx.ws).await.unwrap().iteration, Some(1));
    assert_eq!(node(&fx.user, &fx.a).await.unwrap().iteration, None);
    let mut events = fx.project.subscribed().await;
    let mut task = fx.clear("r", false).await;
    fx.asked().await;
    fx.hand_off(json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []}))
        .await
        .unwrap();
    task.end().await.unwrap();
    assert_eq!(node(&fx.user, &fx.ws).await.unwrap().iteration, Some(2));
    let cleared = daemon::next(&mut events, |data| match data {
        contracts::EventData::WorkstreamCleared(cleared) => Some(cleared),
        _ => None,
    })
    .await;
    assert_eq!(
        (cleared.id.as_str(), cleared.iteration),
        (fx.ws.as_str(), 2)
    );
    // A second clear starts from Iteration 2.
    settle(&fx.user, &fx.ws).await;
    let task = fx.clear("again", false).await;
    let ask = until("the second ask", || {
        let all: Vec<_> = prompts(&fx.log)
            .iter()
            .filter_map(|p| {
                p["prompt"]
                    .as_str()
                    .filter(|t| t.contains("workstream_handoff"))
                    .map(str::to_owned)
            })
            .collect();
        (all.len() == 2).then(|| all[1].clone())
    })
    .await;
    assert!(ask.contains("again"));
    drop(task);
}

#[tokio::test]
async fn a32_no_handoff_times_out_and_changes_nothing() {
    let fx = fixture_with("600").await;
    fx.full().await;
    let rail = shape(&fx.user).await;
    let (todos, pads) = (fx.todos().await, fx.pads().await);
    let (code, _) = fx.clear("r", false).await.end().await.unwrap_err();
    assert_eq!(code, rpc::code::NOT_ACKED as i32);
    assert_eq!(
        (shape(&fx.user).await, fx.todos().await, fx.pads().await),
        (rail, todos, pads)
    );

    // The clear is no longer pending, and a Door that is not running is a CONFLICT.
    fx.user
        .request("agent.stop", json!({"id": fx.ws}))
        .await
        .unwrap();
    let stopped = fx.clear("r", false).await.reply.unwrap_err();
    assert_eq!(stopped.code, rpc::code::CONFLICT);
}

#[tokio::test]
async fn a32_without_handoff_archives_everything() {
    let fx = fixture_with("600").await;
    fx.full().await;
    let (code, _) = fx.clear("bloat", false).await.end().await.unwrap_err();
    assert_eq!(code, rpc::code::NOT_ACKED as i32);
    assert_eq!(fx.clear("bloat", true).await.end().await.unwrap(), 2);

    assert!(fx.todos().await.is_empty());
    let pads = fx.pads().await;
    assert_eq!(names(&pads, "name"), ["archive-1"]);
    let text = pads[0]["text"].as_str().unwrap();
    for lost in [
        "build the login page",
        "refactor everything",
        "## notes",
        "## scratch",
    ] {
        assert!(text.contains(lost), "{lost} is lost: {text}");
    }
    let last = prompts(&fx.log).into_iter().last().unwrap();
    assert!(last["prompt"].as_str().unwrap().contains("bloat"));
    assert!(rail_tree(&fx.user).await.iter().all(|n| n.id != fx.a));
}

#[tokio::test]
async fn a32_the_workstream_and_its_terminals_survive() {
    let fx = fixture().await;
    let opened = fx
        .user
        .request("terminal.open", json!({"workstream": fx.ws}))
        .await
        .unwrap();
    let terminal = opened["terminal_id"]
        .as_str()
        .expect("the opened Terminal")
        .to_owned();
    let before = node(&fx.user, &fx.ws).await.unwrap();
    let mut task = fx.clear("r", false).await;
    fx.asked().await;
    fx.hand_off(json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []}))
        .await
        .unwrap();
    task.end().await.unwrap();

    let tree = rail_tree(&fx.user).await;
    let after = tree.iter().find(|n| n.id == fx.ws).unwrap();
    assert_eq!(
        (&after.name, &after.parent, after.order),
        (&before.name, &before.parent, before.order)
    );
    let terminals = fx.user.request("terminal.list", Value::Null).await.unwrap();
    let kept = terminals
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == terminal.as_str())
        .expect("the Terminal stays");
    assert_eq!(kept["running"], true);
    assert!(Path::new(&fx.project.dir.path().join("README")).is_file());
}

#[tokio::test]
async fn a32_message_list_spans_iterations() {
    let fx = fixture().await;
    let send = |body: &'static str| {
        fx.user.request(
            "message.send",
            json!({"to": fx.ws, "kind": "note", "body": body}),
        )
    };
    send("first ask").await.unwrap();
    settle(&fx.user, &fx.ws).await;
    let mut task = fx.clear("r", false).await;
    fx.asked().await;
    fx.hand_off(json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []}))
        .await
        .unwrap();
    task.end().await.unwrap();
    settle(&fx.user, &fx.ws).await;
    send("second ask").await.unwrap();

    let listed = fx
        .user
        .request("message.list", json!({"id": fx.ws}))
        .await
        .unwrap();
    let seen: Vec<(String, u64)> = listed
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| !m["body"].as_str().unwrap().starts_with("[digest]"))
        .map(|m| {
            (
                m["body"].as_str().unwrap().to_owned(),
                m["iteration"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        seen,
        [("first ask".to_owned(), 1), ("second ask".to_owned(), 2)]
    );
}

/// Leave Subagent `fx.a` mid-resume, which no stop can claim: it was stopped, and the fake
/// `claude` holds the `SessionStart` that would acknowledge its resume.
async fn hold_a_resume(fx: &Fix) {
    fx.user
        .request("agent.stop", json!({"id": fx.a}))
        .await
        .unwrap();
    std::fs::remove_file(&fx.hold).unwrap();
    let client = fx.project.client().await;
    let a = fx.a.clone();
    tokio::spawn(async move { client.request("agent.resume", json!({"id": a})).await });
    tokio::time::sleep(Duration::from_millis(500)).await;
}

#[tokio::test]
async fn a32_a_failed_stop_retries_without_double_archive() {
    let fx = fixture().await;
    fx.full().await;
    let mut clear = fx.clear("bloat", false).await;
    fx.asked().await;
    hold_a_resume(&fx).await;
    fx.hand_off(json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []}))
        .await
        .unwrap();
    let (code, message) = clear.end().await.unwrap_err();
    assert_eq!(code, rpc::code::CONFLICT as i32, "{message}");

    let ids: Vec<_> = shape(&fx.user)
        .await
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert!(!ids.contains(&fx.b), "the deepest Subagent stopped first");
    assert!(ids.contains(&fx.a), "{ids:?}");
    assert!(ids.contains(&fx.ws));
    assert_eq!(node(&fx.user, &fx.ws).await.unwrap().iteration, Some(1));
    let sections = |pads: &[Value]| {
        let archive = pads.iter().find(|p| p["name"] == "archive-1").unwrap();
        archive["text"].as_str().unwrap().matches("\n## ").count()
            + usize::from(archive["text"].as_str().unwrap().starts_with("## "))
    };
    assert_eq!(sections(&fx.pads().await), 4, "every item archived once");

    std::fs::write(&fx.hold, "").unwrap();
    idle(&fx.user, &fx.a).await;
    let mut retry = fx.clear("bloat", false).await;
    assert_eq!(retry.end().await.unwrap(), 2);
    let ids: Vec<_> = shape(&fx.user)
        .await
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert_eq!(ids.iter().filter(|id| **id == fx.ws).count(), 1);
    assert!(!ids.contains(&fx.a));
    assert_eq!(
        sections(&fx.pads().await),
        4,
        "a retry archives nothing twice"
    );
    let last = prompts(&fx.log).into_iter().last().unwrap();
    assert!(last["prompt"].as_str().unwrap().contains("archive-1"));
}

#[tokio::test]
async fn a32_a_failed_restart_keeps_the_workstream() {
    let fx = fixture().await;
    let before = node(&fx.user, &fx.ws).await.unwrap();
    std::fs::remove_file(&fx.hold).unwrap();
    let mut clear = fx.clear("bloat", false).await;
    fx.asked().await;
    fx.hand_off(json!({"id": fx.ws, "summary": "s", "keep_todos": [], "keep_pads": []}))
        .await
        .unwrap();
    let (code, message) = clear.end().await.unwrap_err();
    assert_eq!(code, rpc::code::CONFLICT as i32, "{message}");

    let after = node(&fx.user, &fx.ws).await.unwrap();
    assert_eq!(after.iteration, Some(1), "the Iteration stays");
    assert_eq!(after.terminal_id, None, "the Door stays stopped");
    assert_eq!(after.name, before.name);
    let ids: Vec<_> = shape(&fx.user)
        .await
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert!(!ids.contains(&fx.a) && !ids.contains(&fx.b));

    std::fs::write(&fx.hold, "").unwrap();
    fx.user
        .request("rail.startDoor", json!({"id": fx.ws}))
        .await
        .unwrap();
    let resumed = node(&fx.user, &fx.ws).await.unwrap();
    assert!(resumed.terminal_id.is_some());
    assert_eq!(resumed.iteration, Some(1));
}
