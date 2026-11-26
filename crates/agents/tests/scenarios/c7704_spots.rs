//! C7704 `agent.postSpots` and `agent.spots` (`scenarios/spots.md`).

use std::path::{Path, PathBuf};

use agents::worktree::Git;
use contracts::{Actor, ActorKind};
use rpc::{Module, RpcError, code};
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}");
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned()
}

fn write(dir: &Path, name: &str, text: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, text).unwrap();
    path
}

const NINE: &str = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";

/// A project with Worktrees on and one Agent in its own, holding `src/a.rs` and `src/b.rs`.
async fn worktree() -> (Fixture, String, PathBuf) {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    f.call("project.setWorktrees", json!({"on": true, "check": null}))
        .await
        .unwrap();
    let node = f.spawn(None, None).await.unwrap();
    let path = std::fs::canonicalize(node.worktree().expect("a Worktree").path).unwrap();
    write(&path, "src/a.rs", NINE);
    write(&path, "src/b.rs", NINE);
    (f, node.base.id, path)
}

async fn as_agent(
    f: &Fixture,
    caller: &str,
    method: &str,
    params: Value,
) -> Result<Value, RpcError> {
    let actor = Actor {
        kind: ActorKind::Agent,
        id: caller.to_owned(),
        parent: None,
    };
    let ctx = rpc::Ctx { actor, ..f.ctx() };
    Module::call(&f.agents, &ctx, method, params).await
}

async fn post(f: &Fixture, id: &str, source: &str, spots: Value) -> Result<Value, RpcError> {
    as_agent(
        f,
        id,
        "agent.postSpots",
        json!({"id": id, "source": source, "spots": spots}),
    )
    .await
}

async fn spots(f: &Fixture, id: &str) -> Value {
    f.call("agent.spots", json!({"id": id})).await.unwrap()["spots"].clone()
}

fn at(path: &str, start: u32, end: u32, message: &str) -> Value {
    json!({"path": path, "start": start, "end": end, "message": message})
}

fn tool(name: &str, path: &str, start: u32, end: u32, message: &str, stale: bool) -> Value {
    json!({"source": {"kind": "tool", "name": name}, "path": path, "start": start, "end": end,
           "message": message, "stale": stale})
}

#[tokio::test]
async fn c7704b_a_post_is_read_back_under_its_source() {
    let (f, id, _) = worktree().await;

    post(
        &f,
        &id,
        "oxlint",
        json!([at("src/a.rs", 3, 5, "unused variable")]),
    )
    .await
    .unwrap();

    assert_eq!(
        spots(&f, &id).await,
        json!([tool("oxlint", "src/a.rs", 3, 5, "unused variable", false)])
    );
}

#[tokio::test]
async fn c7704c_a_second_post_replaces_its_source_and_keeps_another() {
    let (f, id, _) = worktree().await;
    post(
        &f,
        &id,
        "oxlint",
        json!([at("src/a.rs", 3, 5, "unused variable")]),
    )
    .await
    .unwrap();
    post(
        &f,
        &id,
        "tests",
        json!([at("src/a.rs", 7, 7, "assertion failed")]),
    )
    .await
    .unwrap();

    post(&f, &id, "oxlint", json!([at("src/b.rs", 1, 2, "shadowed")]))
        .await
        .unwrap();

    assert_eq!(
        spots(&f, &id).await,
        json!([
            tool("tests", "src/a.rs", 7, 7, "assertion failed", false),
            tool("oxlint", "src/b.rs", 1, 2, "shadowed", false),
        ])
    );
    post(&f, &id, "oxlint", json!([])).await.unwrap();
    assert_eq!(
        spots(&f, &id).await,
        json!([tool("tests", "src/a.rs", 7, 7, "assertion failed", false)])
    );
}

#[tokio::test]
async fn c7704d_a_write_to_the_file_makes_its_spots_stale() {
    let (f, id, path) = worktree().await;
    post(
        &f,
        &id,
        "oxlint",
        json!([at("src/a.rs", 3, 5, "a"), at("src/b.rs", 1, 1, "b")]),
    )
    .await
    .unwrap();

    write(&path, "src/a.rs", &NINE.replace('5', "five"));

    assert_eq!(
        spots(&f, &id).await,
        json!([
            tool("oxlint", "src/a.rs", 3, 5, "a", true),
            tool("oxlint", "src/b.rs", 1, 1, "b", false),
        ])
    );
}

#[tokio::test]
async fn c7704e_a_post_outside_the_tree_is_refused_with_its_cause_and_stores_nothing() {
    let (f, id, path) = worktree().await;
    let beside = write(path.parent().unwrap(), "beside.txt", "x\n");
    let elsewhere = tempfile::tempdir().unwrap();
    let away = write(elsewhere.path(), "away.rs", "x\n");
    post(&f, &id, "keep", json!([at("src/a.rs", 1, 1, "kept")]))
        .await
        .unwrap();
    let refused = [
        ("outside_tree", at(&away.display().to_string(), 1, 1, "m")),
        (
            "outside_tree",
            at(
                &format!("../{}", beside.file_name().unwrap().to_str().unwrap()),
                1,
                1,
                "m",
            ),
        ),
        ("no_file", at("src/missing.rs", 1, 1, "m")),
        ("bad_range", at("src/a.rs", 4, 3, "m")),
        ("bad_range", at("src/a.rs", 0, 3, "m")),
        ("bad_message", at("src/a.rs", 1, 1, "  ")),
    ];

    for (cause, spot) in refused {
        let error = post(&f, &id, "oxlint", json!([at("src/b.rs", 1, 1, "ok"), spot]))
            .await
            .unwrap_err();
        assert_eq!(error.code, code::INVALID_PARAMS);
        assert!(
            error.message.starts_with(cause),
            "{cause}: {}",
            error.message
        );
    }
    let error = post(&f, &id, " ", json!([])).await.unwrap_err();
    assert!(error.message.starts_with("bad_source"), "{}", error.message);
    assert_eq!(
        spots(&f, &id).await,
        json!([tool("keep", "src/a.rs", 1, 1, "kept", false)])
    );
}

#[tokio::test]
async fn c7704f_an_agent_without_a_worktree_posts_and_is_read_through_its_group() {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let project = std::fs::canonicalize(f.dir.path()).unwrap();
    let id = f.spawn(None, None).await.unwrap().base.id;
    let file = write(&project, "src/a.rs", NINE);
    let payload = json!({"hook_event_name": "PostToolUse", "tool_name": "Write",
                         "tool_input": {"file_path": file.display().to_string()}});
    f.call(
        "agent.signal",
        json!({"id": id, "attempt": f.attempt(&id).await, "payload": payload}),
    )
    .await
    .unwrap();
    let other = tempfile::tempdir().unwrap();
    git(other.path(), &["init", "-q", "-b", "main"]);
    let unwritten = write(other.path(), "x.rs", NINE);
    let group = json!({"repo": project.display().to_string(), "branch": git(&project, &["rev-parse", "--abbrev-ref", "HEAD"])});

    post(
        &f,
        &id,
        "oxlint",
        json!([at(&file.display().to_string(), 2, 4, "unused")]),
    )
    .await
    .unwrap();

    let read = f
        .call("agent.spots", json!({"id": id, "group": group}))
        .await
        .unwrap();
    assert_eq!(
        read["spots"],
        json!([tool("oxlint", "src/a.rs", 2, 4, "unused", false)])
    );
    let error = post(
        &f,
        &id,
        "oxlint",
        json!([at(&unwritten.display().to_string(), 1, 1, "m")]),
    )
    .await
    .unwrap_err();
    assert!(
        error.message.starts_with("outside_tree"),
        "{}",
        error.message
    );
    let stranger = json!({"repo": other.path().display().to_string(), "branch": "main"});
    let error = f
        .call("agent.spots", json!({"id": id, "group": stranger}))
        .await
        .unwrap_err();
    assert!(
        error.message.starts_with("unsafe_path"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn c7704g_an_agent_may_post_and_only_the_user_reads() {
    let (f, id, _) = worktree().await;
    let peer = f.spawn(None, None).await.unwrap().base.id;

    post(&f, &id, "oxlint", json!([at("src/a.rs", 1, 1, "m")]))
        .await
        .unwrap();

    let read = as_agent(&f, &id, "agent.spots", json!({"id": id}))
        .await
        .unwrap_err();
    assert_eq!(read.code, code::FORBIDDEN);
    let foreign = as_agent(
        &f,
        &id,
        "agent.postSpots",
        json!({"id": peer, "source": "oxlint", "spots": []}),
    )
    .await
    .unwrap_err();
    assert_eq!(foreign.code, code::FORBIDDEN);
    assert_eq!(spots(&f, &id).await.as_array().unwrap().len(), 1);
}
