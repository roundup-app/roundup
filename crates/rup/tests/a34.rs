//! A34: removing a Workstream deletes its done Todos and the Pads no kept Agent owns, against a
//! real `rupd`.

#![allow(dead_code)]
#[path = "e2e/daemon.rs"]
mod daemon;

use contracts::agent::RailNode;
use contracts::todo::Todo;
use contracts::{Actor, ActorKind};
use daemon::{Project, start};
use serde_json::{Value, json};

async fn workstream(client: &rpc::Client, name: &str) -> String {
    let node = client
        .request(
            "rail.createWorkstream",
            json!({ "name": name, "parent": null }),
        )
        .await
        .unwrap();
    node["id"].as_str().unwrap().to_owned()
}

async fn agent_in(project: &Project, client: &rpc::Client, parent: &str) -> String {
    let node = client
        .request(
            "agent.spawn",
            json!({ "cwd": project.dir.path(), "prompt": null, "parent": parent }),
        )
        .await
        .unwrap();
    serde_json::from_value::<RailNode>(node).unwrap().id
}

async fn todo_in(client: &rpc::Client, title: &str, home: Option<&str>, done: bool) -> u32 {
    let todo = client
        .request("todo.create", json!({ "title": title }))
        .await
        .unwrap();
    let id = serde_json::from_value::<Todo>(todo).unwrap().id;
    client
        .request("todo.move", json!({ "id": id, "home": home }))
        .await
        .unwrap();
    if done {
        client
            .request("todo.complete", json!({ "id": id }))
            .await
            .unwrap();
    }
    id
}

async fn todos(client: &rpc::Client) -> Vec<Todo> {
    serde_json::from_value(client.request("todo.list", json!(null)).await.unwrap()).unwrap()
}

async fn pad_in(client: &rpc::Client, name: &str, home: &str, owner: Option<&str>) {
    client
        .request("pad.create", json!({ "name": name }))
        .await
        .unwrap();
    if let Some(owner) = owner {
        let owner = Actor {
            kind: ActorKind::Agent,
            id: owner.to_owned(),
            parent: None,
        };
        client
            .request("pad.setOwner", json!({ "name": name, "owner": owner }))
            .await
            .unwrap();
    }
    client
        .request("pad.move", json!({ "name": name, "home": home }))
        .await
        .unwrap();
}

async fn pads(client: &rpc::Client) -> Vec<(String, Value)> {
    let listed = client.request("pad.list", json!(null)).await.unwrap();
    let mut pads: Vec<_> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|pad| {
            (
                pad["name"].as_str().unwrap().to_owned(),
                pad["home"].clone(),
            )
        })
        .collect();
    pads.sort_by(|a, b| a.0.cmp(&b.0));
    pads
}

#[tokio::test]
async fn a34_done_todos_are_deleted_and_open_ones_move() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let finished = todo_in(&client, "finished", Some(&ws), true).await;
    let open = todo_in(&client, "open", Some(&ws), false).await;

    let removal = client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    assert_eq!(
        removal,
        json!({
            "removed": [{"id": finished.to_string(), "kind": "todo", "name": "finished"}],
            "kept": [{"id": open.to_string(), "kind": "todo", "name": "open", "reason": "open"}],
        })
    );
    let left = todos(&client).await;
    assert_eq!(left.len(), 1);
    assert_eq!((left[0].id, left[0].home.clone()), (open, None));
}

#[tokio::test]
async fn a34_a_blocker_deleted_leaves_the_kept_todos_list() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let blocker = todo_in(&client, "blocker", Some(&ws), true).await;
    let kept = todo_in(&client, "kept", Some(&ws), false).await;
    client
        .request(
            "todo.setBlockers",
            json!({ "id": kept, "blockers": [blocker] }),
        )
        .await
        .unwrap();

    client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    let left = todos(&client).await;
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].blockers, Vec::<u32>::new());
    assert!(!left[0].blocked);
}

#[tokio::test]
async fn a34_pads_follow_a_kept_agent_and_the_rest_go() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let running = agent_in(&project, &client, &ws).await;
    let stopped = agent_in(&project, &client, &ws).await;
    client
        .request("agent.stop", json!({ "id": stopped }))
        .await
        .unwrap();
    pad_in(&client, "by-running", &ws, Some(&running)).await;
    pad_in(&client, "by-stopped", &ws, Some(&stopped)).await;
    pad_in(&client, "by-user", &ws, None).await;

    let db = rusqlite::Connection::open(project.data_dir().join("project.db")).unwrap();
    let running_source = pads::source(&db, "by-running").unwrap().unwrap();
    let stopped_source = pads::source(&db, "by-stopped").unwrap().unwrap();
    let user_source = pads::source(&db, "by-user").unwrap().unwrap();
    let removal = client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    let after = pads::source(&db, "by-running").unwrap().unwrap();
    assert_eq!(after.incarnation, running_source.incarnation);
    assert_eq!(after.pad.home, None);
    for incarnation in [stopped_source.incarnation, user_source.incarnation] {
        assert_eq!(
            pads::source_state(&db, incarnation).unwrap(),
            pads::PadSourceState::Deleted(pads::PadDeletion::Cleanup)
        );
    }
    assert_eq!(
        pads(&client).await,
        [("by-running".to_owned(), Value::Null)]
    );
    let kept: Vec<&Value> = removal["kept"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "pad")
        .collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0]["name"], "by-running");
    assert_eq!(kept[0]["reason"], "running");
    let gone: Vec<&str> = removal["removed"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "pad")
        .map(|item| item["name"].as_str().unwrap())
        .collect();
    assert_eq!(gone, ["by-stopped", "by-user"]);
}

#[tokio::test]
async fn a34_other_workstreams_are_untouched() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let other = workstream(&client, "other").await;
    let theirs = todo_in(&client, "theirs", Some(&other), true).await;
    let rooted = todo_in(&client, "rooted", None, true).await;
    pad_in(&client, "theirs", &other, None).await;
    client
        .request("pad.create", json!({ "name": "rooted" }))
        .await
        .unwrap();

    client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    let ids: Vec<u32> = todos(&client).await.into_iter().map(|t| t.id).collect();
    assert_eq!(ids, [theirs, rooted]);
    assert_eq!(
        pads(&client).await,
        [
            ("rooted".to_owned(), Value::Null),
            ("theirs".to_owned(), json!(other))
        ]
    );
}

#[tokio::test]
async fn a34_removing_an_agent_still_returns_null() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let agent = agent_in(&project, &client, &ws).await;

    let result = client
        .request("rail.remove", json!({ "id": agent }))
        .await
        .unwrap();

    assert_eq!(result, Value::Null);
}

#[tokio::test]
async fn a34_a_failed_pad_removal_changes_nothing_and_retries() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    todo_in(&client, "finished", Some(&ws), true).await;
    todo_in(&client, "open", Some(&ws), false).await;
    pad_in(&client, "earlier", &ws, None).await;
    pad_in(&client, "failure", &ws, None).await;
    client
        .request("pad.setStorage", json!({ "files": true }))
        .await
        .unwrap();
    let files = project.data_dir().join("pads");
    let failing = files.join("failure.md");
    std::fs::remove_file(&failing).unwrap();
    std::fs::create_dir(&failing).unwrap();
    let rail_before = client.request("rail.tree", Value::Null).await.unwrap();
    let todos_before = client.request("todo.list", Value::Null).await.unwrap();
    let pads_before = client.request("pad.list", Value::Null).await.unwrap();
    let earlier_before = std::fs::read(files.join("earlier.md")).unwrap();
    let touches_before = client
        .request("provenance.touched", json!({ "actor_id": "rupd" }))
        .await
        .unwrap();

    let error = client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap_err();
    assert_eq!(error.code, rpc::code::INTERNAL);
    assert_eq!(
        client.request("rail.tree", Value::Null).await.unwrap(),
        rail_before
    );
    assert_eq!(
        client.request("todo.list", Value::Null).await.unwrap(),
        todos_before
    );
    assert_eq!(
        client.request("pad.list", Value::Null).await.unwrap(),
        pads_before
    );
    assert_eq!(
        std::fs::read(files.join("earlier.md")).unwrap(),
        earlier_before
    );
    assert!(failing.is_dir());
    assert_eq!(
        client
            .request("provenance.touched", json!({ "actor_id": "rupd" }))
            .await
            .unwrap(),
        touches_before
    );

    std::fs::remove_dir(&failing).unwrap();
    std::fs::write(&failing, "").unwrap();
    client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();
    assert!(
        client
            .request("rail.tree", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    let left = todos(&client).await;
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].title, "open");
    assert_eq!(left[0].home, None);
    assert!(pads(&client).await.is_empty());
}

/// A34's storage failure observer uses real SQLite failure triggers and the public RPC lists.
/// The trigger is repaired before retry, so no fault-injection switch enters the product.
async fn failed_storage_removal(database: &str, trigger: &str) {
    use std::time::Duration;
    let project = start(&[]);
    let mut client = project.client().await;
    let ws = workstream(&client, "w").await;
    let live = agent_in(&project, &client, &ws).await;
    let gone = agent_in(&project, &client, &ws).await;
    client
        .request("agent.stop", json!({ "id": gone }))
        .await
        .unwrap();
    todo_in(&client, "earlier", Some(&ws), true).await;
    todo_in(&client, "failure", Some(&ws), true).await;
    todo_in(&client, "earlier-open", Some(&ws), false).await;
    todo_in(&client, "failure-open", Some(&ws), false).await;
    pad_in(&client, "a-earlier", &ws, None).await;
    pad_in(&client, "b-failure", &ws, None).await;
    pad_in(&client, "c-earlier-kept", &ws, Some(&live)).await;
    pad_in(&client, "d-failure-kept", &ws, Some(&live)).await;
    let other = workstream(&client, "other").await;
    todo_in(&client, "unrelated", Some(&other), true).await;
    pad_in(&client, "unrelated", &other, None).await;
    client
        .request("pad.setStorage", json!({ "files": true }))
        .await
        .unwrap();
    let files = project.data_dir().join("pads");
    // Preserve the actual file, even when it differs from the mirrored database text.
    std::fs::write(files.join("a-earlier.md"), "external edit\n").unwrap();
    let listed = client.request("pad.list", Value::Null).await.unwrap();
    let file_before: Vec<_> = listed
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            let name = p["name"].as_str().unwrap();
            (
                name.to_owned(),
                std::fs::read(files.join(format!("{name}.md"))).unwrap(),
            )
        })
        .collect();
    let rail_before = client.request("rail.tree", Value::Null).await.unwrap();
    let todos_before = client.request("todo.list", Value::Null).await.unwrap();
    let pads_before = client.request("pad.list", Value::Null).await.unwrap();
    let daemon_touches = client
        .request("provenance.touched", json!({ "actor_id": "rupd" }))
        .await
        .unwrap();
    let user_touches = client
        .request("provenance.touched", json!({ "actor_id": "you" }))
        .await
        .unwrap();
    let db = rusqlite::Connection::open(project.data_dir().join(database)).unwrap();
    db.execute_batch(trigger).unwrap();
    client
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();

    let err = client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap_err();
    assert_eq!(err.code, rpc::code::INTERNAL);
    assert_eq!(
        client.request("rail.tree", Value::Null).await.unwrap(),
        rail_before
    );
    assert_eq!(
        client.request("todo.list", Value::Null).await.unwrap(),
        todos_before
    );
    assert_eq!(
        client.request("pad.list", Value::Null).await.unwrap(),
        pads_before
    );
    for (name, bytes) in &file_before {
        assert_eq!(
            std::fs::read(files.join(format!("{name}.md"))).unwrap(),
            *bytes
        );
    }
    assert_eq!(
        client
            .request("provenance.touched", json!({ "actor_id": "rupd" }))
            .await
            .unwrap(),
        daemon_touches
    );
    assert_eq!(
        client
            .request("provenance.touched", json!({ "actor_id": "you" }))
            .await
            .unwrap(),
        user_touches
    );
    // A negative observation has no completion event to await: bound the no-event window.
    assert!(
        tokio::time::timeout(Duration::from_millis(100), client.next_event())
            .await
            .is_err()
    );

    db.execute_batch("DROP TRIGGER a34_fail").unwrap();
    client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();
    let tree = client.request("rail.tree", Value::Null).await.unwrap();
    assert!(!tree.as_array().unwrap().iter().any(|n| n["id"] == ws));
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .any(|n| n["id"] == live && n["parent"].is_null())
    );
    assert!(!tree.as_array().unwrap().iter().any(|n| n["id"] == gone));
    assert!(!files.join("a-earlier.md").exists());
    assert!(files.join("c-earlier-kept.md").exists());
}

#[tokio::test]
async fn a34_a_failed_todo_deletion_rolls_back_earlier_items_and_retries() {
    failed_storage_removal("project.db", "CREATE TRIGGER a34_fail BEFORE DELETE ON todos WHEN old.title = 'failure' BEGIN SELECT RAISE(FAIL, 'A34 Todo delete'); END;").await;
}

#[tokio::test]
async fn a34_a_failed_todo_move_rolls_back_earlier_items_and_retries() {
    failed_storage_removal("project.db", "CREATE TRIGGER a34_fail BEFORE UPDATE OF home ON todos WHEN old.title = 'failure-open' BEGIN SELECT RAISE(FAIL, 'A34 Todo move'); END;").await;
}

#[tokio::test]
async fn a34_a_failed_pad_deletion_rolls_back_earlier_items_and_retries() {
    failed_storage_removal("project.db", "CREATE TRIGGER a34_fail BEFORE DELETE ON pads WHEN old.name = 'b-failure' BEGIN SELECT RAISE(FAIL, 'A34 Pad delete'); END;").await;
}

#[tokio::test]
async fn a34_a_failed_pad_move_rolls_back_earlier_items_and_retries() {
    failed_storage_removal("project.db", "CREATE TRIGGER a34_fail BEFORE UPDATE OF home ON pads WHEN old.name = 'd-failure-kept' BEGIN SELECT RAISE(FAIL, 'A34 Pad move'); END;").await;
}

#[tokio::test]
async fn a34_a_failed_agent_deletion_rolls_back_storage_and_retries() {
    failed_storage_removal("project.db", "CREATE TRIGGER a34_fail BEFORE DELETE ON nodes WHEN old.kind = 'agent' BEGIN SELECT RAISE(FAIL, 'A34 Agent delete'); END;").await;
}

#[tokio::test]
async fn n18_failed_removal_rolls_back_all_concerns() {
    failed_storage_removal("project.db", "CREATE TRIGGER a34_fail BEFORE DELETE ON nodes WHEN old.kind = 'workstream' BEGIN SELECT RAISE(FAIL, 'A34 Workstream delete'); END;").await;
}

#[tokio::test]
async fn a34_a_failed_touch_rolls_back_storage_and_retries() {
    failed_storage_removal("project.db", "CREATE TRIGGER a34_fail BEFORE INSERT ON touches WHEN new.item = 'pad:b-failure' AND new.actor_id = 'rupd' BEGIN SELECT RAISE(FAIL, 'A34 Touch'); END;").await;
}

fn git_at(path: &std::path::Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .current_dir(path)
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

async fn failed_worktree_removal(failure: &str) {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let dir = tempfile::tempdir().unwrap();
    git_at(dir.path(), &["init", "-q", "-b", "main"]);
    git_at(dir.path(), &["config", "user.email", "a34@example.com"]);
    git_at(dir.path(), &["config", "user.name", "A34"]);
    std::fs::write(dir.path().join(".gitignore"), "ignored*\n").unwrap();
    std::fs::write(dir.path().join("original"), "preserve\n").unwrap();
    git_at(dir.path(), &["add", "."]);
    git_at(dir.path(), &["commit", "-qm", "A34"]);
    let wrapper_dir = tempfile::tempdir().unwrap();
    let real_git = std::process::Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .unwrap();
    let real_git = String::from_utf8(real_git.stdout).unwrap();
    let wrapper = wrapper_dir.path().join("git");
    std::fs::write(
        &wrapper,
        format!("#!/bin/sh\nexec '{}' \"$@\"\n", real_git.trim()),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = format!(
        "{}:{}",
        wrapper_dir.path().display(),
        std::env::var("PATH").unwrap()
    );
    let project = daemon::start_in(dir, tempfile::tempdir().unwrap(), &[("PATH", &path)]);
    let client = project.client().await;
    client
        .request("project.setWorktrees", json!({ "on": true, "check": null }))
        .await
        .unwrap();
    let ws = workstream(&client, "w").await;
    let mut agents = Vec::new();
    for _ in 0..2 {
        let id = agent_in(&project, &client, &ws).await;
        client
            .request("agent.stop", json!({ "id": id }))
            .await
            .unwrap();
        let tree: Vec<RailNode> =
            serde_json::from_value(client.request("rail.tree", Value::Null).await.unwrap())
                .unwrap();
        let node = tree.into_iter().find(|n| n.id == id).unwrap();
        let worktree = node.worktree.unwrap();
        let ignored = std::path::Path::new(&worktree.path).join("ignored");
        std::fs::write(&ignored, "ignored work\n").unwrap();
        std::fs::set_permissions(&ignored, std::fs::Permissions::from_mode(0o640)).unwrap();
        std::os::unix::fs::symlink(
            "original",
            std::path::Path::new(&worktree.path).join("ignored-link"),
        )
        .unwrap();
        std::os::unix::fs::symlink(
            "missing",
            std::path::Path::new(&worktree.path).join("ignored-dangling"),
        )
        .unwrap();
        agents.push((id, worktree));
    }
    let identities: Vec<_> = agents
        .iter()
        .map(|(_, w)| {
            let m = std::fs::metadata(std::path::Path::new(&w.path).join("ignored")).unwrap();
            (m.dev(), m.ino())
        })
        .collect();
    todo_in(&client, "done", Some(&ws), true).await;
    todo_in(&client, "open", Some(&ws), false).await;
    pad_in(&client, "pad", &ws, None).await;
    client
        .request("pad.setStorage", json!({ "files": true }))
        .await
        .unwrap();
    let mut before = client.request("rail.tree", Value::Null).await.unwrap();
    let todos_before = client.request("todo.list", Value::Null).await.unwrap();
    let pads_before = client.request("pad.list", Value::Null).await.unwrap();
    let branches = git_at(project.dir.path(), &["branch", "--list"]);
    let worktrees = git_at(project.dir.path(), &["worktree", "list", "--porcelain"]);
    let touches_before = client
        .request("provenance.touched", json!({ "actor_id": "rupd" }))
        .await
        .unwrap();
    let user_touches = client
        .request("provenance.touched", json!({ "actor_id": "you" }))
        .await
        .unwrap();
    let db = rusqlite::Connection::open(project.data_dir().join("project.db")).unwrap();
    let second = &agents[1].1;
    let late_commit = (failure == "advance").then(|| {
        git_at(
            project.dir.path(),
            &[
                "commit-tree",
                "HEAD^{tree}",
                "-p",
                "HEAD",
                "-m",
                "A34 late commit",
            ],
        )
        .trim()
        .to_owned()
    });
    let changed = wrapper_dir.path().join("changed");
    let change_script = wrapper_dir.path().join("change.py");
    if failure == "tree" {
        std::fs::write(&change_script, format!(
            "import sqlite3\nconn=sqlite3.connect({})\nconn.execute(\"UPDATE nodes SET parent=NULL WHERE id=?\", ({},))\nconn.commit()\n",
            serde_json::to_string(&project.data_dir().join("project.db").to_string_lossy()).unwrap(),
            serde_json::to_string(&agents[0].0).unwrap(),
        )).unwrap();
        for node in before.as_array_mut().unwrap() {
            if node["id"] == agents[0].0 {
                node["parent"] = Value::Null;
            }
        }
    }
    let condition = match failure {
        // Inject before the first retention move so the early tree recheck restores
        // ignored and external files together, rather than encountering a new path.
        "tree" => format!(
            "[ \"$1\" = worktree ] && [ \"$2\" = list ] && [ ! -e '{}' ]",
            changed.display()
        ),
        "directory" => format!(
            "[ \"$1\" = worktree ] && [ \"$2\" = remove ] && [ \"$3\" = '{}' ]",
            second.path
        ),
        "branch" => format!(
            "[ \"$1\" = update-ref ] && [ \"$2\" = -d ] && [ \"$3\" = 'refs/heads/{}' ]",
            second.branch
        ),
        "advance" => format!(
            "[ \"$1\" = update-ref ] && [ \"$2\" = -d ] && [ \"$3\" = 'refs/heads/{}' ]",
            second.branch
        ),
        "judgement" => format!("[ \"$1\" = status ] && [ . -ef '{}' ]", second.path),
        "rail" => {
            db.execute_batch("CREATE TRIGGER a34_fail BEFORE DELETE ON nodes WHEN old.kind = 'workstream' BEGIN SELECT RAISE(FAIL, 'A34 last step'); END;").unwrap();
            "false".to_owned()
        }
        _ => unreachable!(),
    };
    let reject = if let Some(commit) = &late_commit {
        format!(
            "'{}' update-ref 'refs/heads/{}' '{}'; exec '{}' \"$@\"",
            real_git.trim(),
            second.branch,
            commit,
            real_git.trim()
        )
    } else if failure == "tree" {
        format!(
            "mkdir -p '{}'; printf 'external files\\n' > '{}/external'; python3 '{}'; touch '{}'; exec '{}' \"$@\"",
            agents[0].1.path,
            agents[0].1.path,
            change_script.display(),
            changed.display(),
            real_git.trim()
        )
    } else {
        "echo 'A34 injected git failure' >&2; exit 1".to_owned()
    };
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nif {condition}; then {reject}; fi\nexec '{}' \"$@\"\n",
            real_git.trim()
        ),
    )
    .unwrap();

    assert!(
        client
            .request("rail.remove", json!({ "id": ws }))
            .await
            .is_err()
    );
    if failure == "tree" {
        let path = std::path::Path::new(&agents[0].1.path);
        assert_eq!(
            std::fs::read_to_string(path.join("ignored")).unwrap(),
            "ignored work\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join("external")).unwrap(),
            "external files\n"
        );
        before
            .as_array_mut()
            .unwrap()
            .sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        let mut actual = client.request("rail.tree", Value::Null).await.unwrap();
        actual
            .as_array_mut()
            .unwrap()
            .sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        assert_eq!(actual, before);
    } else {
        assert_eq!(
            client.request("rail.tree", Value::Null).await.unwrap(),
            before
        );
    }
    assert_eq!(
        client.request("todo.list", Value::Null).await.unwrap(),
        todos_before
    );
    assert_eq!(
        client.request("pad.list", Value::Null).await.unwrap(),
        pads_before
    );
    assert!(project.data_dir().join("pads/pad.md").is_file());
    assert_eq!(git_at(project.dir.path(), &["branch", "--list"]), branches);
    let actual_worktrees = git_at(project.dir.path(), &["worktree", "list", "--porcelain"]);
    if let Some(commit) = &late_commit {
        let original = git_at(project.dir.path(), &["rev-parse", "HEAD"])
            .trim()
            .to_owned();
        let expected = worktrees
            .split("\n\n")
            .map(|record| {
                if record
                    .lines()
                    .any(|line| line == format!("branch refs/heads/{}", second.branch))
                {
                    record.replace(&original, commit)
                } else {
                    record.to_owned()
                }
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        assert_eq!(actual_worktrees, expected);
        assert_eq!(
            git_at(project.dir.path(), &["rev-parse", &second.branch]).trim(),
            commit
        );
    } else {
        assert_eq!(actual_worktrees, worktrees);
    }
    for ((_, w), identity) in agents.iter().zip(&identities) {
        let path = std::path::Path::new(&w.path);
        assert_eq!(
            std::fs::read_link(path.join("ignored-link")).unwrap(),
            std::path::Path::new("original")
        );
        assert_eq!(
            std::fs::read_link(path.join("ignored-dangling")).unwrap(),
            std::path::Path::new("missing")
        );
        let m = std::fs::metadata(path.join("ignored")).unwrap();
        assert_eq!((m.dev(), m.ino()), *identity);
        assert_eq!(
            std::fs::read_to_string(path.join("original")).unwrap(),
            "preserve\n"
        );
        assert_eq!(
            std::fs::read_to_string(path.join("ignored")).unwrap(),
            "ignored work\n"
        );
        assert_eq!(
            std::fs::metadata(path.join("ignored"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        if failure != "tree" || w.path != agents[0].1.path {
            assert!(git_at(path, &["status", "--porcelain"]).is_empty());
        }
    }
    assert_eq!(
        client
            .request("provenance.touched", json!({ "actor_id": "rupd" }))
            .await
            .unwrap(),
        touches_before
    );
    assert_eq!(
        client
            .request("provenance.touched", json!({ "actor_id": "you" }))
            .await
            .unwrap(),
        user_touches
    );

    std::fs::write(
        &wrapper,
        format!("#!/bin/sh\nexec '{}' \"$@\"\n", real_git.trim()),
    )
    .unwrap();
    if failure == "rail" {
        db.execute_batch("DROP TRIGGER a34_fail").unwrap();
    }
    client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();
    let left = client.request("rail.tree", Value::Null).await.unwrap();
    if let Some(commit) = &late_commit {
        assert_eq!(left.as_array().unwrap().len(), 1);
        assert_eq!(left[0]["id"], agents[1].0);
        assert!(left[0]["parent"].is_null());
        assert!(std::path::Path::new(&second.path).exists());
        assert_eq!(
            git_at(project.dir.path(), &["rev-parse", &second.branch]).trim(),
            commit
        );
        assert!(!std::path::Path::new(&agents[0].1.path).exists());
    } else if failure == "tree" {
        assert_eq!(left.as_array().unwrap().len(), 1);
        assert_eq!(left[0]["id"], agents[0].0);
        assert!(left[0]["parent"].is_null());
        assert!(std::path::Path::new(&agents[0].1.path).exists());
        assert!(!std::path::Path::new(&second.path).exists());
    } else {
        assert!(left.as_array().unwrap().is_empty());
        for (_, w) in &agents {
            assert!(!std::path::Path::new(&w.path).exists());
        }
    }
    assert!(!project.data_dir().join("pads/pad.md").exists());
}

#[tokio::test]
async fn a34_a_later_worktree_failure_restores_earlier_files_and_branches_and_retries() {
    failed_worktree_removal("directory").await;
}

#[tokio::test]
async fn a34_a_branch_failure_after_directory_removal_restores_all_worktrees_and_retries() {
    failed_worktree_removal("branch").await;
}

#[tokio::test]
async fn a34_a_last_step_failure_restores_worktrees_and_storage_and_retries() {
    failed_worktree_removal("rail").await;
}

#[tokio::test]
async fn a34_a_judgement_failure_leaves_every_store_and_worktree_untouched() {
    failed_worktree_removal("judgement").await;
}

#[tokio::test]
async fn n18_removal_commits_all_concerns_once() {
    use contracts::EventData;
    use std::time::Duration;
    let project = start(&[]);
    let mut client = project.client().await;
    let ws = workstream(&client, "w").await;
    let live = agent_in(&project, &client, &ws).await;
    let done = todo_in(&client, "done", Some(&ws), true).await;
    let open = todo_in(&client, "open", Some(&ws), false).await;
    pad_in(&client, "deleted", &ws, None).await;
    pad_in(&client, "moved", &ws, Some(&live)).await;
    client
        .request("events.subscribe", Value::Null)
        .await
        .unwrap();
    client
        .request("rail.remove", json!({ "id": ws }))
        .await
        .unwrap();

    let mut seen = Vec::new();
    while seen.len() < 5 {
        let event = tokio::time::timeout(Duration::from_secs(5), client.next_event())
            .await
            .unwrap()
            .unwrap();
        if matches!(event.data, EventData::MeasurementsChanged { .. }) {
            continue;
        }
        assert!(
            !client
                .request("rail.tree", Value::Null)
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["id"] == ws)
        );
        seen.push(serde_json::to_value(event.data).unwrap());
    }
    assert_eq!(
        seen,
        serde_json::to_value(vec![
            EventData::RailChanged,
            EventData::TodoDeleted(contracts::todo::TodoId { id: done }),
            EventData::TodoUpdated(
                todos(&client)
                    .await
                    .into_iter()
                    .find(|t| t.id == open)
                    .unwrap()
                    .into()
            ),
            EventData::PadDeleted(contracts::pad::PadName {
                name: "deleted".into()
            }),
            EventData::PadChanged(contracts::pad::PadName {
                name: "moved".into()
            }),
        ])
        .unwrap()
        .as_array()
        .unwrap()
        .clone()
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(100), async {
            while let Some(event) = client.next_event().await {
                assert!(
                    matches!(event.data, EventData::MeasurementsChanged { .. }),
                    "unexpected extra removal event: {event:?}"
                );
            }
            panic!("event stream closed during the duplicate-event observation");
        })
        .await
        .is_err()
    );
    for item in [
        format!("todo:{done}"),
        format!("todo:{open}"),
        "pad:deleted".to_owned(),
        "pad:moved".to_owned(),
    ] {
        let touches = client
            .request("provenance.history", json!({ "item": item }))
            .await
            .unwrap();
        let writes: Vec<_> = touches
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["actor"]["id"] == "rupd" && t["verb"] == "wrote")
            .collect();
        assert_eq!(writes.len(), 1);
    }
}

#[tokio::test]
async fn a34_a_late_branch_advance_is_kept_without_losing_earlier_worktrees() {
    failed_worktree_removal("advance").await;
}

#[tokio::test]
async fn t15_workstream_removal_records_deleted_blockers() {
    let project = start(&[]);
    let client = project.client().await;
    let ws = workstream(&client, "w").await;
    let blocker = todo_in(&client, "blocker", Some(&ws), true).await;
    let kept = todo_in(&client, "kept", None, false).await;
    client
        .request(
            "todo.setBlockers",
            json!({"id": kept, "blockers": [blocker]}),
        )
        .await
        .unwrap();
    client
        .request("rail.remove", json!({"id": ws}))
        .await
        .unwrap();
    let history = client
        .request("todo.getHistory", json!({"id": kept}))
        .await
        .unwrap();
    let changes = history["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 3);
    assert_eq!(changes[2]["before"]["blockers"], json!([blocker]));
    assert_eq!(changes[2]["after"]["blockers"], json!([]));
}

// Rule 10: retired duplicate wrappers and their remaining proofs:
// g9_removal_failure_renames_back_ignored_files → a34_a_branch_failure_after_directory_removal_restores_all_worktrees_and_retries.
// g9_storage_failure_restores_all_moves → a34_a_last_step_failure_restores_worktrees_and_storage_and_retries.
// g9_judgement_failure_preserves_original_files → a34_a_judgement_failure_leaves_every_store_and_worktree_untouched.
#[tokio::test]
async fn g9_workstream_removal_with_one_gb_ignored_file_finishes_under_one_second() {
    use std::io::Write;
    use std::os::unix::fs::MetadataExt;
    let dir = tempfile::tempdir().unwrap();
    git_at(dir.path(), &["init", "-q", "-b", "main"]);
    git_at(dir.path(), &["config", "user.email", "g9@example.com"]);
    git_at(dir.path(), &["config", "user.name", "G9"]);
    std::fs::write(dir.path().join(".gitignore"), "target/\n").unwrap();
    git_at(dir.path(), &["add", "."]);
    git_at(dir.path(), &["commit", "-qm", "G9"]);
    let project = daemon::start_in(dir, tempfile::tempdir().unwrap(), &[]);
    let client = project.client().await;
    client
        .request("project.setWorktrees", json!({"on":true,"check":null}))
        .await
        .unwrap();
    let ws = workstream(&client, "G9").await;
    let id = agent_in(&project, &client, &ws).await;
    client
        .request("agent.stop", json!({"id":id}))
        .await
        .unwrap();
    let tree: Vec<RailNode> =
        serde_json::from_value(client.request("rail.tree", Value::Null).await.unwrap()).unwrap();
    let w = tree
        .iter()
        .find(|n| n.id == id)
        .unwrap()
        .worktree
        .as_ref()
        .unwrap();
    let path = std::path::Path::new(&w.path);
    std::fs::create_dir(path.join("target")).unwrap();
    let mut file = std::fs::File::create(path.join("target/allocated")).unwrap();
    let block = vec![0x39; 1_000_000];
    for _ in 0..1000 {
        file.write_all(&block).unwrap();
    }
    file.sync_all().unwrap();
    let metadata = file.metadata().unwrap();
    assert_eq!(metadata.len(), 1_000_000_000);
    assert!(metadata.blocks() * 512 >= metadata.len());
    drop(file);
    assert!(git_at(path, &["status", "--porcelain"]).is_empty());
    let start = std::time::Instant::now();
    client
        .request("rail.remove", json!({"id":ws}))
        .await
        .unwrap();
    let elapsed = start.elapsed();
    println!("G9 removal elapsed={elapsed:?}, device={}", metadata.dev());
    assert!(
        elapsed < std::time::Duration::from_millis(1000),
        "elapsed={elapsed:?}, device={}",
        metadata.dev()
    );
    assert!(
        client
            .request("rail.tree", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(!path.exists());
    assert!(!git_at(project.dir.path(), &["branch", "--list"]).contains(&w.branch));
    assert_eq!(
        std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
        0
    );
}

#[tokio::test]
async fn g9_early_validation_failure_keeps_original_files_and_external_writes() {
    failed_worktree_removal("tree").await;
}

#[tokio::test]
async fn d9_workstream_removal_keeps_finite_shutdown_waits_within_the_app_bound() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixListener;

    let fixture = tempfile::tempdir().unwrap();
    let socket = fixture.path().join("shutdown.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let program = fixture.path().join("claude");
    // A descendant keeps the PTY open after its Agent is reaped, exercising
    // agents::KILL_WAIT_BOUND. Entry and release travel outside the PTY.
    std::fs::write(
        &program,
        r#"#!/usr/bin/env python3
import os, signal, socket, sys
# Model the capability probe, as e2e/fake_claude.py does, before
# creating descendants that deliberately hold the Agent's PTY open.
if sys.argv[1:3] == ["plugin", "test"]:
    print("Q11 runtime hook closure: 1 pass")
    sys.exit(0)
# Ignore the exit keys too (^C is SIGINT on this PTY), so only the kill ends the Agent.
signal.signal(signal.SIGINT, signal.SIG_IGN)
read, write = os.pipe()
if os.fork() == 0:
    os.close(write)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    ready = socket.socket(socket.AF_UNIX)
    ready.connect(os.environ["D9_SHUTDOWN_SOCKET"])
    ready.sendall(b"R")
    ready.close()
    os.read(read, 1)
    entered = socket.socket(socket.AF_UNIX)
    entered.settimeout(45)
    entered.connect(os.environ["D9_SHUTDOWN_SOCKET"])
    entered.sendall(b"S")
    entered.recv(1)
    entered.sendall(b"X")
    os._exit(0)
os.close(read)
while True:
    signal.pause()
"#,
    )
    .unwrap();
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
    let project = start(&[
        ("ROUNDUP_CLAUDE_BIN", program.to_str().unwrap()),
        ("D9_SHUTDOWN_SOCKET", socket.to_str().unwrap()),
    ]);
    let client = project.client().await;
    let ws = workstream(&client, "bounded removal").await;
    let mut ids = Vec::new();
    for _ in 0..16 {
        let id = agent_in(&project, &client, &ws).await;
        let (mut ready, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(ready.read_u8().await.unwrap(), b'R');
        daemon::signal(
            &client,
            &id,
            json!({"hook_event_name": "SessionEnd", "reason": "done"}),
        )
        .await;
        ids.push(id);
    }
    let began = tokio::time::Instant::now();
    // crates/desktop/src/config.rs: CALL_BOUND is the unchanged App policy.
    let deadline = began + Duration::from_secs(30);
    let removal = client.request("rail.remove", json!({"id": ws}));
    tokio::pin!(removal);
    let entered = async {
        let mut held = Vec::new();
        for _ in 0..16 {
            let (mut stream, _) = listener.accept().await.unwrap();
            assert_eq!(stream.read_u8().await.unwrap(), b'S');
            held.push(stream);
        }
        held
    };
    tokio::pin!(entered);
    let mut held = tokio::select! {
        held = tokio::time::timeout_at(deadline, &mut entered) => held.expect("all sixteen stops entered within CALL_BOUND"),
        result = &mut removal => panic!("removal replied before every shutdown entered: {result:?}"),
    };
    let result = tokio::time::timeout_at(deadline, &mut removal)
        .await
        .expect("finite shutdown waits fit CALL_BOUND")
        .unwrap();
    // Linux keeps reading a slave held by descendants; macOS may hang up when
    // the session leader exits. The signal-driven Agents test proves overlap on both.
    #[cfg(target_os = "linux")]
    assert!(began.elapsed() >= agents::KILL_WAIT_BOUND);
    for id in ids {
        assert!(
            result["removed"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["id"] == id)
        );
    }
    assert!(daemon::rail_tree(&client).await.is_empty());
    for stream in &mut held {
        stream.write_all(b"release").await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(5), stream.read_u8())
                .await
                .unwrap()
                .unwrap(),
            b'X'
        );
    }
}
