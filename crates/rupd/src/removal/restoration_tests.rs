use super::tests::call;
use super::*;
use serde_json::json;

#[tokio::test]
async fn u3787a_reversible_rail_removal_restores_original_identity() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute("INSERT INTO nodes(kind,name,parent,ord,conversation_id,conversation_cwd,spawn_prompt,model,effort,creator,finished) VALUES('agent','chosen',NULL,0,'retained','/original','first','opaque','opaque','maker',3)",[]).unwrap();
    let node = json!({"id":db.last_insert_rowid().to_string()});
    db.execute(
        "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','promoted',?,0)",
        [node["id"].as_str().unwrap()],
    )
    .unwrap();
    let owner = contracts::Actor {
        kind: contracts::ActorKind::Agent,
        id: node["id"].as_str().unwrap().into(),
        parent: None,
    };
    let todo = call(
        &daemon,
        "todo.create",
        json!({"title":"owned","owner":owner}),
    )
    .await
    .unwrap();
    let prompt = call(&daemon, "agent.spawnPrompt", node.clone())
        .await
        .unwrap();
    let instructions = call(&daemon, "agent.instructions", node.clone())
        .await
        .unwrap();
    let before = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let removed = call(
        &daemon,
        "rail.remove",
        json!({"id":node["id"],"operation":"chosen"}),
    )
    .await
    .unwrap();
    assert_eq!(removed["deletion"]["operation"], "chosen");
    let after = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert_eq!(after.as_array().unwrap().len(), 1);
    assert!(after[0]["parent"].is_null());
    assert!(
        call(&daemon, "todo.get", json!({"id":todo["id"]}))
            .await
            .unwrap()["owner"]
            .is_null()
    );
    call(&daemon, "rail.restore", removed["deletion"].clone())
        .await
        .unwrap();
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":todo["id"]}))
            .await
            .unwrap(),
        todo
    );
    assert_eq!(
        call(&daemon, "agent.spawnPrompt", node.clone())
            .await
            .unwrap(),
        prompt
    );
    assert_eq!(
        call(&daemon, "agent.instructions", node).await.unwrap(),
        instructions
    );
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap(),
        before
    );
    assert_eq!(
        call(&daemon, "terminal.list", Value::Null).await.unwrap(),
        json!([])
    );
}
#[tokio::test]
async fn u3787a_workstream_cascade_restores_pads_blockers_and_homes() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let home = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"}))
        .await
        .unwrap()["id"]
        .clone();
    let other = call(&daemon, "rail.createWorkstream", json!({"name":"other"}))
        .await
        .unwrap()["id"]
        .clone();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','finished',?,0)",
        [home.as_str().unwrap()],
    )
    .unwrap();
    let owner = contracts::Actor {
        kind: contracts::ActorKind::Agent,
        id: db.last_insert_rowid().to_string(),
        parent: Some(home.as_str().unwrap().into()),
    };
    for title in ["chosen", "open", "dependent"] {
        call(&daemon, "todo.create", json!({"title":title}))
            .await
            .unwrap();
    }
    call(&daemon, "todo.move", json!({"id":1,"home":home}))
        .await
        .unwrap();
    call(&daemon, "todo.move", json!({"id":2,"home":home}))
        .await
        .unwrap();
    call(&daemon, "todo.move", json!({"id":3,"home":other}))
        .await
        .unwrap();
    call(&daemon, "todo.setBlockers", json!({"id":3,"blockers":[1]}))
        .await
        .unwrap();
    call(&daemon, "todo.complete", json!({"id":1}))
        .await
        .unwrap();
    call(
        &daemon,
        "todo.comment",
        json!({"id":1,"body":"original comment"}),
    )
    .await
    .unwrap();
    for name in ["user", "agent"] {
        call(
            &daemon,
            "pad.create",
            json!({"name":name,"text":"exact content"}),
        )
        .await
        .unwrap();
        call(&daemon, "pad.move", json!({"name":name,"home":home}))
            .await
            .unwrap();
    }
    call(
        &daemon,
        "pad.setOwner",
        json!({"name":"agent","owner":owner}),
    )
    .await
    .unwrap();
    db.execute(
        "INSERT INTO workstream_queue(workstream,ord,after_todo) VALUES(?,0,2)",
        [home.as_str().unwrap()],
    )
    .unwrap();
    let queue = call(&daemon, "workstream.queue", Value::Null)
        .await
        .unwrap();
    let value=json!({"kind":"interval","category":"tool","clock":"retained","start_unix_ns":"1","end_unix_ns":"4"}).to_string();
    db.execute("INSERT INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES('retained','original','fixture',?,'1',?,'Original maker',1000,?,'[]')",params![owner.id,home.as_str().unwrap(),value]).unwrap();
    db.execute("UPDATE measurement_state SET revision=revision+1", [])
        .unwrap();
    let measurements = call(&daemon, "project.measurements", Value::Null)
        .await
        .unwrap()["contributions"]
        .clone();
    assert!(!measurements.as_array().unwrap().is_empty());
    let publication=call(&daemon,"deliverable.publish",json!({"key":"retained","title":"Original result","target":{"kind":"external","url":"https://example.test/original"}})).await.unwrap();
    let publication_id = json!({"project":publication["project"],"id":publication["id"]});
    call(
        &daemon,
        "deliverable.move",
        json!({"project":publication["project"],"id":publication["id"],"home":home}),
    )
    .await
    .unwrap();
    let publication = call(&daemon, "deliverable.get", publication_id.clone())
        .await
        .unwrap();
    call(&daemon, "todo.assign", json!({"id":2,"owner":owner}))
        .await
        .unwrap();
    let rail = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let todos = call(&daemon, "todo.list", Value::Null).await.unwrap();
    let pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
    let comments = call(&daemon, "todo.comments", json!({"id":1}))
        .await
        .unwrap();
    let history = call(&daemon, "todo.getHistory", json!({"id":1}))
        .await
        .unwrap();
    let mut emitted = daemon.bus.subscribe();
    let deleted = call(
        &daemon,
        "rail.remove",
        json!({"id":home,"operation":"cascade"}),
    )
    .await
    .unwrap();
    let mut moved_events = Vec::new();
    while let Ok(event) = emitted.try_recv() {
        if let contracts::EventData::TodoUpdated(todo) = event.data
            && todo.id == 2
        {
            moved_events.push(todo);
        }
    }
    assert_eq!(moved_events.len(), 1);
    assert!(moved_events[0].home.is_none());
    assert!(moved_events[0].owner.is_none());
    assert_eq!(
        call(&daemon, "todo.list", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        call(&daemon, "pad.list", Value::Null).await.unwrap(),
        json!([])
    );
    call(&daemon, "rail.restore", deleted["deletion"].clone())
        .await
        .unwrap();
    assert_eq!(
        call(&daemon, "workstream.queue", Value::Null)
            .await
            .unwrap(),
        queue
    );
    assert_eq!(
        call(&daemon, "project.measurements", Value::Null)
            .await
            .unwrap()["contributions"],
        measurements
    );
    assert_eq!(
        call(&daemon, "deliverable.get", publication_id)
            .await
            .unwrap(),
        publication
    );
    assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), rail);
    assert_eq!(
        call(&daemon, "todo.list", Value::Null).await.unwrap(),
        todos
    );
    assert_eq!(call(&daemon, "pad.list", Value::Null).await.unwrap(), pads);
    assert_eq!(
        call(&daemon, "todo.comments", json!({"id":1}))
            .await
            .unwrap(),
        comments
    );
    assert_eq!(
        call(&daemon, "todo.getHistory", json!({"id":1}))
            .await
            .unwrap(),
        history
    );
    assert_eq!(
        call(&daemon, "terminal.list", Value::Null).await.unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn u3787a_conflict_rolls_back_graph_and_mirrors_and_allows_retry() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let home = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"}))
        .await
        .unwrap()["id"]
        .clone();
    call(&daemon, "todo.create", json!({"title":"retained"}))
        .await
        .unwrap();
    call(&daemon, "todo.move", json!({"id":1,"home":home}))
        .await
        .unwrap();
    call(&daemon, "todo.complete", json!({"id":1}))
        .await
        .unwrap();
    call(&daemon, "pad.setStorage", json!({"files":true}))
        .await
        .unwrap();
    call(
        &daemon,
        "pad.create",
        json!({"name":"chosen","text":"original bytes"}),
    )
    .await
    .unwrap();
    call(&daemon, "pad.move", json!({"name":"chosen","home":home}))
        .await
        .unwrap();
    let before = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let deletion = call(
        &daemon,
        "rail.remove",
        json!({"id":home,"operation":"rollback"}),
    )
    .await
    .unwrap()["deletion"]
        .clone();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    // Collision is after Rail and Pad restore participation, proving the whole transaction.
    db.execute(
        "INSERT INTO todos(id,title,body,creator,created_at,pos) VALUES(1,'replacement','',?,0,1)",
        [serde_json::to_string(&Actor::user()).unwrap()],
    )
    .unwrap();
    let touches: i64 = db
        .query_row("SELECT COUNT(*) FROM touches", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        call(&daemon, "rail.restore", deletion.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap(),
        json!([])
    );
    assert_eq!(
        call(&daemon, "pad.list", Value::Null).await.unwrap(),
        json!([])
    );
    assert!(!dir.path().join("pads/chosen.md").exists());
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM touches", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        touches
    );
    assert_eq!(
        call(&daemon, "todo.get", json!({"id":1})).await.unwrap()["title"],
        "replacement"
    );
    assert_eq!(
        call(&daemon, "rail.deletion", deletion.clone())
            .await
            .unwrap()["deletion"]["restored"],
        false
    );
    db.execute("DELETE FROM todos WHERE id=1", []).unwrap();
    call(&daemon, "rail.restore", deletion.clone())
        .await
        .unwrap();
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap(),
        before
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("pads/chosen.md")).unwrap(),
        "original bytes"
    );
    let touches: i64 = db
        .query_row("SELECT COUNT(*) FROM touches", [], |r| r.get(0))
        .unwrap();
    let again = call(&daemon, "rail.restore", deletion.clone())
        .await
        .unwrap();
    assert_eq!(again["deletion"]["restored"], true);
    assert_eq!(
        call(
            &daemon,
            "rail.remove",
            json!({"id":home,"operation":"rollback"})
        )
        .await
        .unwrap(),
        again
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM touches", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        touches
    );
}

#[tokio::test]
async fn u3787a_retained_rail_authority_and_unknown_calls() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let home = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"}))
        .await
        .unwrap()["id"]
        .clone();
    let deletion = call(
        &daemon,
        "rail.remove",
        json!({"id":home,"operation":"authority"}),
    )
    .await
    .unwrap()["deletion"]
        .clone();
    let (events, _) = tokio::sync::mpsc::unbounded_channel();
    for actor in [
        contracts::Actor {
            kind: contracts::ActorKind::Agent,
            id: "1".into(),
            parent: None,
        },
        contracts::Actor {
            kind: contracts::ActorKind::User,
            id: "other".into(),
            parent: None,
        },
    ] {
        let mut conn = crate::Conn {
            actor,
            peer: None,
            events: events.clone(),
            output: None,
        };
        assert_eq!(
            daemon
                .route(&mut conn, "rail.restore", deletion.clone())
                .await
                .unwrap_err()
                .code,
            rpc::code::FORBIDDEN
        );
    }
    let mut foreign = deletion.clone();
    foreign["project"] = json!("another-project");
    assert_eq!(
        call(&daemon, "rail.restore", foreign)
            .await
            .unwrap_err()
            .code,
        rpc::code::FORBIDDEN
    );
    assert_eq!(
        call(
            &daemon,
            "rail.remove",
            json!({"id":"another-node","operation":"authority"})
        )
        .await
        .unwrap_err()
        .code,
        rpc::code::CONFLICT
    );
    let mut unknown = deletion.clone();
    unknown["operation"] = json!("unknown");
    assert!(
        call(&daemon, "rail.deletion", unknown.clone())
            .await
            .unwrap()
            .is_null()
    );
    assert_eq!(
        call(&daemon, "rail.restore", unknown)
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
    call(&daemon, "rail.restore", deletion).await.unwrap();
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap()[0]["id"],
        home
    );
}

#[tokio::test]
async fn u3787a_failed_removal_retains_no_partial_cascade() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let home = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"}))
        .await
        .unwrap()["id"]
        .clone();
    call(&daemon, "todo.create", json!({"title":"chosen"}))
        .await
        .unwrap();
    call(&daemon, "todo.move", json!({"id":1,"home":home}))
        .await
        .unwrap();
    call(&daemon, "todo.complete", json!({"id":1}))
        .await
        .unwrap();
    call(&daemon, "pad.setStorage", json!({"files":true}))
        .await
        .unwrap();
    call(
        &daemon,
        "pad.create",
        json!({"name":"chosen","text":"keep"}),
    )
    .await
    .unwrap();
    call(&daemon, "pad.move", json!({"name":"chosen","home":home}))
        .await
        .unwrap();
    let before = call(&daemon, "todo.list", Value::Null).await.unwrap();
    let pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch("CREATE TRIGGER fail_rail_delete BEFORE DELETE ON nodes BEGIN SELECT RAISE(ABORT,'refused'); END;").unwrap();
    assert!(
        call(
            &daemon,
            "rail.remove",
            json!({"id":home,"operation":"rollback"})
        )
        .await
        .is_err()
    );
    assert_eq!(
        call(&daemon, "todo.list", Value::Null).await.unwrap(),
        before
    );
    assert_eq!(call(&daemon, "pad.list", Value::Null).await.unwrap(), pads);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("pads/chosen.md")).unwrap(),
        "keep"
    );
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap()[0]["id"],
        home
    );
    db.execute_batch("DROP TRIGGER fail_rail_delete;").unwrap();
    let removed = call(
        &daemon,
        "rail.remove",
        json!({"id":home,"operation":"rollback"}),
    )
    .await
    .unwrap();
    call(&daemon, "rail.restore", removed["deletion"].clone())
        .await
        .unwrap();
}

#[tokio::test]
async fn u3787a_promoted_child_conflict_preserves_placement_for_retry() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let a = call(&daemon, "rail.createWorkstream", json!({"name":"a"}))
        .await
        .unwrap()["id"]
        .clone();
    let b = call(&daemon, "rail.createWorkstream", json!({"name":"b"}))
        .await
        .unwrap()["id"]
        .clone();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','chosen',?,0)",
        [a.as_str().unwrap()],
    )
    .unwrap();
    let chosen = db.last_insert_rowid().to_string();
    db.execute(
        "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','child',?,0)",
        [&chosen],
    )
    .unwrap();
    let child = db.last_insert_rowid().to_string();
    let before = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let deletion = call(
        &daemon,
        "rail.remove",
        json!({"id":chosen,"operation":"placement"}),
    )
    .await
    .unwrap()["deletion"]
        .clone();
    call(
        &daemon,
        "rail.move",
        json!({"id":child,"parent":b,"index":0}),
    )
    .await
    .unwrap();
    let changed = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert_eq!(
        call(&daemon, "rail.restore", deletion.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap(),
        changed
    );
    call(
        &daemon,
        "rail.move",
        json!({"id":child,"parent":a,"index":0}),
    )
    .await
    .unwrap();
    call(&daemon, "rail.restore", deletion).await.unwrap();
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap(),
        before
    );
}

#[tokio::test]
async fn u3787a_live_terminal_and_worktree_removal_never_advertise_undo() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let home = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"}))
        .await
        .unwrap()["id"]
        .clone();
    let terminal = call(
        &daemon,
        "terminal.spawn",
        json!({"cwd":dir.path(),"command":["/bin/cat"],"env":{},"cols":80,"rows":24}),
    )
    .await
    .unwrap()["id"]
        .clone();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "UPDATE nodes SET terminal_id=? WHERE CAST(id AS TEXT)=?",
        params![terminal.as_str().unwrap(), home.as_str().unwrap()],
    )
    .unwrap();
    let refused = call(
        &daemon,
        "rail.remove",
        json!({"id":home,"operation":"live"}),
    )
    .await;
    // Always reap the process created by this test, including on a failed assertion.
    call(&daemon, "terminal.kill", json!({"id":terminal}))
        .await
        .unwrap();
    assert_eq!(refused.unwrap_err().code, rpc::code::CONFLICT);
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap()[0]["id"],
        home
    );
    db.execute("UPDATE nodes SET terminal_id=NULL,worktree_path='/retained',worktree_branch='kept',worktree_base='base' WHERE CAST(id AS TEXT)=?",[home.as_str().unwrap()]).unwrap();
    assert_eq!(
        call(
            &daemon,
            "rail.remove",
            json!({"id":home,"operation":"worktree"})
        )
        .await
        .unwrap_err()
        .code,
        rpc::code::CONFLICT
    );
    db.execute("UPDATE nodes SET worktree_path=NULL,worktree_branch=NULL,worktree_base=NULL WHERE CAST(id AS TEXT)=?",[home.as_str().unwrap()]).unwrap();
    // Existing confirmed removal remains available and does not claim restoration.
    let irreversible = call(&daemon, "rail.remove", json!({"id":home}))
        .await
        .unwrap();
    assert!(irreversible.get("deletion").is_none());
}

#[tokio::test]
async fn u3787a_workstream_restores_promoted_agents_and_their_pad_incarnations() {
    use std::process::Command;
    let dir = tempfile::tempdir().unwrap();
    // A dirty retained Worktree makes A34 keep its finished Agent. No vendor starts.
    for args in [
        vec!["init", "-b", "base"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "commit",
            "--allow-empty",
            "-m",
            "base",
        ],
        vec!["branch", "kept"],
    ] {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(dir.path())
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    std::fs::write(dir.path().join("unfinished"), "keep this work").unwrap();
    let daemon = crate::test_daemon_with_agents(dir.path(), |agents| agents).unwrap();
    let home = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"}))
        .await
        .unwrap()["id"]
        .clone();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute("INSERT INTO nodes(kind,name,parent,ord,worktree_path,worktree_branch,worktree_base) VALUES('agent','kept',?,0,?,'kept','base')",params![home.as_str().unwrap(),dir.path().to_str().unwrap()]).unwrap();
    let owner = contracts::Actor {
        kind: contracts::ActorKind::Agent,
        id: db.last_insert_rowid().to_string(),
        parent: Some(home.as_str().unwrap().into()),
    };
    call(
        &daemon,
        "pad.create",
        json!({"name":"kept","text":"owned work"}),
    )
    .await
    .unwrap();
    call(
        &daemon,
        "pad.setOwner",
        json!({"name":"kept","owner":owner}),
    )
    .await
    .unwrap();
    call(&daemon, "pad.move", json!({"name":"kept","home":home}))
        .await
        .unwrap();
    let before = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
    let deletion = call(
        &daemon,
        "rail.remove",
        json!({"id":home,"operation":"promoted"}),
    )
    .await
    .unwrap();
    assert_eq!(deletion["kept"][0]["reason"], "dirty");
    let moved = call(&daemon, "pad.list", Value::Null).await.unwrap();
    assert!(moved[0]["home"].is_null());
    assert_eq!(moved[0]["incarnation"], pads[0]["incarnation"]);
    call(&daemon, "rail.restore", deletion["deletion"].clone())
        .await
        .unwrap();
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap(),
        before
    );
    assert_eq!(call(&daemon, "pad.list", Value::Null).await.unwrap(), pads);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("unfinished")).unwrap(),
        "keep this work"
    );
    assert_eq!(
        call(&daemon, "terminal.list", Value::Null).await.unwrap(),
        json!([])
    );
}
