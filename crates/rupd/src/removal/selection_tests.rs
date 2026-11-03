use super::{redo_tests::redo, tests::call, *};
use serde_json::json;

#[tokio::test]
async fn u5690d_reversible_selection_is_one_undo_step() {
    let graph = |mut value: Value| {
        for node in value.as_array_mut().unwrap() {
            if let Some(status) = node["status"].as_object_mut() {
                status.remove("since");
            }
        }
        value
    };
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute("INSERT INTO nodes(id,kind,name,ord) VALUES(1,'group','group',0),(5,'workstream','second',1),(4,'workstream','other',2)", []).unwrap();
    db.execute("INSERT INTO nodes(id,kind,name,parent,ord) VALUES(2,'workstream','chosen',1,0),(3,'agent','explicit',2,0),(6,'group','unchosen nested group',2,1)", []).unwrap();
    for home in ["2", "5"] {
        let todo = call(
            &daemon,
            "todo.create",
            json!({"title":format!("done {home}")}),
        )
        .await
        .unwrap();
        call(&daemon, "todo.move", json!({"id":todo["id"],"home":home}))
            .await
            .unwrap();
        call(&daemon, "todo.complete", json!({"id":todo["id"]}))
            .await
            .unwrap();
        call(
            &daemon,
            "pad.create",
            json!({"name":format!("pad-{home}"),"text":"original"}),
        )
        .await
        .unwrap();
        call(
            &daemon,
            "pad.move",
            json!({"name":format!("pad-{home}"),"home":home}),
        )
        .await
        .unwrap();
    }
    let original = graph(call(&daemon, "rail.tree", Value::Null).await.unwrap());
    let pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
    let todos = call(&daemon, "todo.list", Value::Null).await.unwrap();
    let request = json!({"ids":["5","3","2","1","3"],"operation":"selection"});
    let removed = call(&daemon, "rail.removeSelection", request.clone())
        .await
        .unwrap();
    let remaining = graph(call(&daemon, "rail.tree", Value::Null).await.unwrap());
    assert_eq!(
        remaining
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["6", "4"]
    );
    assert_eq!(
        call(&daemon, "todo.list", Value::Null).await.unwrap(),
        json!([])
    );
    assert_eq!(
        call(&daemon, "pad.list", Value::Null).await.unwrap(),
        json!([])
    );
    drop(db);
    drop(daemon);
    let daemon = crate::test_daemon(dir.path()).unwrap();
    assert_eq!(
        call(&daemon, "rail.deletion", removed["deletion"].clone())
            .await
            .unwrap(),
        removed
    );
    assert_eq!(
        call(&daemon, "rail.removeSelection", request)
            .await
            .unwrap(),
        removed
    );
    let restored = call(&daemon, "rail.restore", removed["deletion"].clone())
        .await
        .unwrap();
    assert_eq!(
        graph(call(&daemon, "rail.tree", Value::Null).await.unwrap()),
        original
    );
    assert_eq!(call(&daemon, "pad.list", Value::Null).await.unwrap(), pads);
    assert_eq!(
        call(&daemon, "todo.list", Value::Null).await.unwrap(),
        todos
    );
    let redone = call(&daemon, "rail.redo", redo(&restored, "selection-redo"))
        .await
        .unwrap();
    assert_eq!(
        graph(call(&daemon, "rail.tree", Value::Null).await.unwrap()),
        remaining
    );
    assert_eq!(
        call(&daemon, "todo.list", Value::Null).await.unwrap(),
        json!([])
    );
    assert_eq!(
        call(&daemon, "pad.list", Value::Null).await.unwrap(),
        json!([])
    );
    call(&daemon, "rail.restore", redone["deletion"].clone())
        .await
        .unwrap();
    assert_eq!(
        graph(call(&daemon, "rail.tree", Value::Null).await.unwrap()),
        original
    );
    assert_eq!(
        call(&daemon, "terminal.list", Value::Null).await.unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn u5690d_overlapping_selection_removes_each_identity_once() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute("INSERT INTO nodes(id,kind,name,ord) VALUES(1,'workstream','chosen',0),(4,'agent','other',1)", []).unwrap();
    db.execute("INSERT INTO nodes(id,kind,name,parent,ord) VALUES(2,'agent','explicit',1,0),(3,'agent','kept',1,1)", []).unwrap();
    daemon.agents.set_status_for_test(
        "3",
        contracts::Status {
            kind: contracts::Kind::Idle,
            label: String::new(),
            since: 0,
            finished: "0".into(),
        },
    );
    let result = call(
        &daemon,
        "rail.removeSelection",
        json!({"ids":["1","2","2"]}),
    )
    .await
    .unwrap();
    let removed: Vec<_> = result["removed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(removed.len(), 2);
    assert!(removed.contains(&"1") && removed.contains(&"2"));
    let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["3", "4"]
    );
    assert!(tree[0]["parent"].is_null());
    assert!(result.get("deletion").is_none());
}

#[tokio::test]
async fn u5690d_selection_removal_preserves_unselected_work() {
    use std::process::Command;
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let git = |args: &[&str]| {
        let out = Command::new("git")
            .current_dir(&project)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    };
    git(&["init", "-b", "base"]);
    git(&[
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "base",
    ]);
    let chosen = dir.path().join("chosen");
    let unfinished = dir.path().join("unfinished");
    let other = dir.path().join("other");
    for (branch, path) in [
        ("chosen", &chosen),
        ("unfinished", &unfinished),
        ("other", &other),
    ] {
        git(&[
            "worktree",
            "add",
            "-b",
            branch,
            path.to_str().unwrap(),
            "base",
        ]);
    }
    std::fs::write(unfinished.join("draft"), "unlanded bytes").unwrap();
    std::fs::write(other.join("other"), "unselected bytes").unwrap();
    let daemon = crate::test_daemon_with_agents(&project, |agents| agents).unwrap();
    let db = rusqlite::Connection::open(project.join("project.db")).unwrap();
    db.execute("INSERT INTO nodes(id,kind,name,ord) VALUES(1,'workstream','selected home',0),(6,'workstream','other home',1)",[]).unwrap();
    db.execute("INSERT INTO nodes(id,kind,name,parent,ord) VALUES(2,'agent','selected live',1,0),(3,'agent','kept live',1,1),(4,'agent','kept unlanded',1,2),(5,'agent','selected worktree',NULL,2),(7,'agent','other worktree',6,0)",[]).unwrap();
    for (id, path, branch) in [
        ("5", &chosen, "chosen"),
        ("4", &unfinished, "unfinished"),
        ("7", &other, "other"),
    ] {
        db.execute(
            "UPDATE nodes SET worktree_path=?,worktree_branch=?,worktree_base='base' WHERE id=?",
            params![path.to_str().unwrap(), branch, id],
        )
        .unwrap();
    }
    daemon.agents.set_status_for_test(
        "4",
        contracts::Status {
            kind: contracts::Kind::Done,
            label: String::new(),
            since: 0,
            finished: "1".into(),
        },
    );
    daemon.agents.set_status_for_test(
        "3",
        contracts::Status {
            kind: contracts::Kind::Idle,
            label: String::new(),
            since: 0,
            finished: "0".into(),
        },
    );
    let mut terminals = Vec::new();
    for id in ["2", "3"] {
        let terminal = call(
            &daemon,
            "terminal.spawn",
            json!({"cwd":project,"command":["/bin/cat"],"env":{},"cols":80,"rows":24}),
        )
        .await
        .unwrap()["id"]
            .clone();
        db.execute(
            "UPDATE nodes SET terminal_id=? WHERE id=?",
            params![terminal.as_str().unwrap(), id],
        )
        .unwrap();
        terminals.push(terminal);
    }
    let todo = call(&daemon, "todo.create", json!({"title":"other Todo"}))
        .await
        .unwrap();
    call(&daemon, "todo.move", json!({"id":todo["id"],"home":"6"}))
        .await
        .unwrap();
    call(
        &daemon,
        "pad.create",
        json!({"name":"other-pad","text":"other Pad bytes"}),
    )
    .await
    .unwrap();
    call(&daemon, "pad.move", json!({"name":"other-pad","home":"6"}))
        .await
        .unwrap();
    let todos = call(&daemon, "todo.list", Value::Null).await.unwrap();
    let pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
    let result = call(
        &daemon,
        "rail.removeSelection",
        json!({"ids":["1","2","5"]}),
    )
    .await;
    let processes = call(&daemon, "terminal.list", Value::Null).await.unwrap();
    let selected_running = processes
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == terminals[0] && t["running"] == true);
    let kept_running = processes
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["id"] == terminals[1] && t["running"] == true);
    // Reap the process even if a later assertion detects a broken selection effect.
    call(&daemon, "terminal.kill", json!({"id":terminals[1]}))
        .await
        .unwrap();
    let result = result.unwrap();
    assert!(!selected_running);
    assert!(kept_running);
    assert!(result.get("deletion").is_none());
    let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["3", "4", "6", "7"]
    );
    for id in ["3", "4"] {
        assert!(
            tree.as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == id)
                .unwrap()["parent"]
                .is_null()
        );
    }
    assert_eq!(
        call(&daemon, "todo.list", Value::Null).await.unwrap(),
        todos
    );
    assert_eq!(call(&daemon, "pad.list", Value::Null).await.unwrap(), pads);
    assert!(!chosen.exists());
    assert!(!git(&["branch", "--list", "chosen"]).contains("chosen"));
    assert!(git(&["branch", "--list", "unfinished"]).contains("unfinished"));
    assert!(git(&["branch", "--list", "other"]).contains("other"));
    assert_eq!(
        std::fs::read_to_string(unfinished.join("draft")).unwrap(),
        "unlanded bytes"
    );
    assert_eq!(
        std::fs::read_to_string(other.join("other")).unwrap(),
        "unselected bytes"
    );
}
