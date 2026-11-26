//! U7853a: every file the Changes view lists opens its diff for an Agent with no Worktree of its
//! own (`scenarios/ui-changes-remote-main.md`).

use std::path::{Path, PathBuf};

use agents::worktree::Git;
use rpc::code;
use serde_json::{Value, json};

use crate::common::Fixture;

fn git(dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_owned()
}

fn write(dir: &Path, name: &str, text: &str) -> String {
    let path = dir.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, text).unwrap();
    path.display().to_string()
}

/// A project on `main` with an origin, no Worktree setting and one Agent in the shared folder.
async fn shared_checkout() -> (Fixture, String, PathBuf, tempfile::TempDir) {
    let f = Fixture::in_git_project("sleep 30", Git::from_env());
    let project = std::fs::canonicalize(f.dir.path()).unwrap();
    write(&project, "seed.txt", "a\nb\n");
    git(&project, &["add", "-A"]);
    git(&project, &["commit", "-q", "-m", "seed"]);
    let origin = tempfile::tempdir().unwrap();
    git(origin.path(), &["init", "-q", "--bare", "-b", "main"]);
    let url = origin.path().display().to_string();
    git(&project, &["remote", "add", "origin", &url]);
    git(&project, &["push", "-q", "origin", "main"]);
    git(&project, &["fetch", "-q", "origin"]);
    git(&project, &["remote", "set-head", "origin", "main"]);
    let node = f.spawn(None, None).await.unwrap();
    assert!(node.worktree().is_none(), "the Agent has no Worktree");
    (f, node.base.id, project, origin)
}

/// The Agent's file-writing tool call ends, as the vendor's hook reports it.
async fn wrote(f: &Fixture, id: &str, path: &str) {
    let payload = json!({"hook_event_name": "PostToolUse", "tool_name": "Write", "tool_input": {"file_path": path}});
    f.call(
        "agent.signal",
        json!({"id": id, "attempt": f.attempt(id).await, "payload": payload}),
    )
    .await
    .unwrap();
}

async fn read(
    f: &Fixture,
    id: &str,
    path: &str,
    group: &Value,
    to: Option<&str>,
) -> Result<Value, rpc::RpcError> {
    let mut params = json!({"id": id, "path": path, "group": group});
    if let Some(to) = to {
        params["to"] = json!(to);
    }
    f.call("agent.compareFile", params).await
}

fn key(group: &Value) -> Value {
    json!({"repo": group["repo"], "branch": group["branch"]})
}

#[tokio::test]
async fn u7853a_every_listed_file_opens_for_an_agent_without_a_worktree() {
    let (f, id, project, _origin) = shared_checkout().await;
    // The Agent edits a tracked file, creates one, and works in a git worktree it made itself.
    let edited = write(&project, "seed.txt", "a\nchanged\n");
    let created = write(&project, "docs/new.txt", "new\n");
    let linked = tempfile::tempdir().unwrap();
    let linked_dir = std::fs::canonicalize(linked.path()).unwrap().join("wt");
    git(
        &project,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "own/linked",
            &linked_dir.display().to_string(),
        ],
    );
    let inside = write(&linked_dir, "lin.txt", "lin\n");
    for path in [&edited, &created, &inside] {
        wrote(&f, &id, path).await;
    }

    let owned = f
        .call("agent.ownedChanges", json!({"id": id}))
        .await
        .unwrap();
    let groups = owned["groups"].as_array().unwrap();
    let branches: Vec<&str> = groups
        .iter()
        .map(|g| g["branch"].as_str().unwrap())
        .collect();
    assert_eq!(branches, ["main", "own/linked"]);
    let mut opened = Vec::new();
    for group in groups {
        let top = if group["branch"] == "main" {
            &project
        } else {
            &linked_dir
        };
        for file in group["files"].as_array().unwrap() {
            let path = file["path"].as_str().unwrap();
            let read = read(&f, &id, path, &key(group), None).await.unwrap();
            assert_eq!(
                read["new"]["text"],
                std::fs::read_to_string(top.join(path)).unwrap()
            );
            opened.push((
                read["newPath"].as_str().unwrap().to_owned(),
                read["status"].clone(),
                read["old"]["text"].clone(),
            ));
        }
    }
    assert_eq!(
        opened,
        [
            ("docs/new.txt".to_owned(), json!("untracked"), Value::Null),
            ("seed.txt".to_owned(), json!("modified"), json!("a\nb\n")),
            ("lin.txt".to_owned(), json!("untracked"), Value::Null),
        ]
    );
}

#[tokio::test]
async fn u7853a_a_read_stays_inside_the_repositories_the_agent_wrote_in() {
    let (f, id, project, _origin) = shared_checkout().await;
    wrote(&f, &id, &write(&project, "seed.txt", "a\nchanged\n")).await;
    let owned = f
        .call("agent.ownedChanges", json!({"id": id}))
        .await
        .unwrap();
    let mine = key(&owned["groups"][0]);

    // A repository the Agent never wrote in is not read, whatever the caller names.
    let other = tempfile::tempdir().unwrap();
    let other_dir = std::fs::canonicalize(other.path()).unwrap();
    git(&other_dir, &["init", "-q", "-b", "main"]);
    write(&other_dir, "secret.txt", "s\n");
    git(&other_dir, &["add", "-A"]);
    git(
        &other_dir,
        &[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-q",
            "-m",
            "s",
        ],
    );
    let outside_repo = json!({"repo": other_dir.display().to_string(), "branch": "main"});
    let wrong_branch = json!({"repo": mine["repo"], "branch": "other"});
    for group in [outside_repo, wrong_branch] {
        let err = read(&f, &id, "secret.txt", &group, None).await.unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS);
        assert!(err.message.starts_with("unsafe_path: "), "{}", err.message);
    }

    // Inside it, a path stays within the checkout, as U2540a requires.
    std::os::unix::fs::symlink(&other_dir, project.join("leak")).unwrap();
    for path in ["../outside", "/etc/hosts", "leak/secret.txt", ".git/config"] {
        let err = read(&f, &id, path, &mine, None).await.unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{path}");
        assert!(
            err.message.starts_with("unsafe_path: "),
            "{path}: {}",
            err.message
        );
    }
}

#[tokio::test]
async fn u7853a_a_group_is_read_as_changes_never_as_tree_or_branch() {
    let (f, id, project, _origin) = shared_checkout().await;
    wrote(&f, &id, &write(&project, "seed.txt", "a\nchanged\n")).await;
    let owned = f
        .call("agent.ownedChanges", json!({"id": id}))
        .await
        .unwrap();
    let err = read(
        &f,
        &id,
        "seed.txt",
        &key(&owned["groups"][0]),
        Some("branch"),
    )
    .await
    .unwrap_err();
    assert_eq!(err.code, code::INVALID_PARAMS);
    assert!(err.message.starts_with("group_target: "), "{}", err.message);
}
