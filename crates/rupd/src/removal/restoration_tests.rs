use super::tests::call;
use super::*;
use serde_json::json;

/// T30: restoring a Todo's owner or blockers is a Change, so `updated_at` moves; the rest returns.
fn without_updated_at(mut value: Value) -> Value {
    if let Some(todos) = value.as_array_mut() {
        todos.iter_mut().for_each(|todo| {
            todo.as_object_mut()
                .map(|object| object.remove("updated_at"));
        });
    } else if let Some(object) = value.as_object_mut() {
        object.remove("updated_at");
    }
    value
}

#[tokio::test]
async fn u3787a_rail_undo_preserves_unrelated_changes() {
    for kind in ["agent", "workstream"] {
        for change in ["immediate", "reorder", "new-agent", "legacy-reorder"] {
            let dir = tempfile::tempdir().unwrap();
            let daemon = crate::test_daemon(dir.path()).unwrap();
            let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
            for (kind, name, order) in [
                ("workstream", "first", 0),
                (kind, "chosen", 1),
                ("workstream", "following", 2),
                ("workstream", "last", 3),
            ] {
                db.execute(
                    "INSERT INTO nodes(kind,name,ord) VALUES(?,?,?)",
                    params![kind, name, order],
                )
                .unwrap();
            }
            let original = call(&daemon, "rail.tree", Value::Null).await.unwrap();
            let deletion = call(
                &daemon,
                "rail.remove",
                json!({"id":"2","operation":"independent"}),
            )
            .await
            .unwrap()["deletion"]
                .clone();
            // These are the normal refresh reads after the removal event.
            call(&daemon, "rail.tree", Value::Null).await.unwrap();
            call(&daemon, "todo.list", Value::Null).await.unwrap();
            call(&daemon, "pad.list", Value::Null).await.unwrap();
            if change == "legacy-reorder" {
                db.execute("UPDATE rail_deletions SET boundary=(SELECT json_group_array(json_array(json_extract(value,'$.id'),json_extract(value,'$.parent'),json_extract(value,'$.order'))) FROM json_each(json_extract(boundary,'$.after')))", []).unwrap();
            }
            if change.ends_with("reorder") {
                call(
                    &daemon,
                    "rail.move",
                    json!({"id":"4","parent":null,"index":0}),
                )
                .await
                .unwrap();
            } else if change == "new-agent" {
                db.execute(
                    "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','new',4,0)",
                    [],
                )
                .unwrap();
            }
            let changed = call(&daemon, "rail.tree", Value::Null).await.unwrap();
            call(&daemon, "rail.restore", deletion.clone())
                .await
                .unwrap_or_else(|e| panic!("{kind}/{change}: {e}"));
            let restored = call(&daemon, "rail.tree", Value::Null).await.unwrap();
            let chosen = restored
                .as_array()
                .unwrap()
                .iter()
                .find(|n| n["id"] == "2")
                .unwrap();
            let mut expected = original[1].clone();
            expected["order"] = chosen["order"].clone();
            assert_eq!(chosen, &expected);
            let root: Vec<_> = restored
                .as_array()
                .unwrap()
                .iter()
                .filter(|n| n["parent"].is_null())
                .map(|n| n["id"].clone())
                .collect();
            assert_eq!(
                root,
                if change.ends_with("reorder") {
                    vec![json!("4"), json!("1"), json!("2"), json!("3")]
                } else {
                    vec![json!("1"), json!("2"), json!("3"), json!("4")]
                }
            );
            if change == "new-agent" {
                assert_eq!(
                    restored
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|n| n["name"] == "new"),
                    changed
                        .as_array()
                        .unwrap()
                        .iter()
                        .find(|n| n["name"] == "new")
                );
            }
            assert_eq!(
                call(&daemon, "terminal.list", Value::Null).await.unwrap(),
                json!([])
            );
            call(&daemon, "rail.restore", deletion).await.unwrap();
            assert_eq!(
                call(&daemon, "rail.tree", Value::Null).await.unwrap(),
                restored
            );
        }
    }
}

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
        without_updated_at(
            call(&daemon, "todo.get", json!({"id":todo["id"]}))
                .await
                .unwrap()
        ),
        without_updated_at(todo)
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
    db.execute(
        "INSERT INTO workstream_queue(workstream,ord,after_todo) VALUES(?,0,2)",
        [home.as_str().unwrap()],
    )
    .unwrap();
    let queue = call(&daemon, "workstream.queue", Value::Null)
        .await
        .unwrap();
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
        call(&daemon, "deliverable.get", publication_id)
            .await
            .unwrap(),
        publication
    );
    assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), rail);
    assert_eq!(
        without_updated_at(call(&daemon, "todo.list", Value::Null).await.unwrap()),
        without_updated_at(todos)
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
    for cause in ["parent", "identity"] {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        let parent = call(&daemon, "rail.createWorkstream", json!({"name":"Planning"}))
            .await
            .unwrap()["id"]
            .clone();
        db.execute(
            "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','Research',?,0)",
            [parent.as_str().unwrap()],
        )
        .unwrap();
        let chosen = db.last_insert_rowid().to_string();
        call(
            &daemon,
            "todo.create",
            json!({"title":"kept work","owner":{"kind":"agent","id":chosen,"parent":parent}}),
        )
        .await
        .unwrap();
        call(
            &daemon,
            "pad.create",
            json!({"name":"notes","text":"keep exact bytes"}),
        )
        .await
        .unwrap();
        let receipt = call(
            &daemon,
            "rail.remove",
            json!({"id":chosen,"operation":"retained"}),
        )
        .await
        .unwrap()["deletion"]
            .clone();
        let blocking = if cause == "parent" {
            Some(
                call(
                    &daemon,
                    "rail.remove",
                    json!({"id":parent,"operation":"blocking"}),
                )
                .await
                .unwrap()["deletion"]
                    .clone(),
            )
        } else {
            let config = rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER;
            db.set_db_config(config, false).unwrap();
            db.execute(
                "INSERT INTO nodes(id,kind,name,parent,ord) VALUES(?,'agent','Replacement',?,0)",
                params![chosen, parent.as_str().unwrap()],
            )
            .unwrap();
            db.set_db_config(config, true).unwrap();
            None
        };
        let rail = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        let todos = call(&daemon, "todo.list", Value::Null).await.unwrap();
        let pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
        let error = call(&daemon, "rail.restore", receipt.clone())
            .await
            .unwrap_err();
        assert_eq!(error.code, rpc::code::CONFLICT);
        assert!(
            matches!(error.data, Some(contracts::RpcErrorData::UndoParent { ref id, .. }) if cause == "parent" && id == parent.as_str().unwrap())
                || matches!(error.data, Some(contracts::RpcErrorData::UndoIdentity { ref id, .. }) if cause == "identity" && id == &chosen)
        );
        assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), rail);
        assert_eq!(
            call(&daemon, "todo.list", Value::Null).await.unwrap(),
            todos
        );
        assert_eq!(call(&daemon, "pad.list", Value::Null).await.unwrap(), pads);
        assert_eq!(
            call(&daemon, "rail.deletion", receipt.clone())
                .await
                .unwrap()["deletion"]["restored"],
            false
        );
        if let Some(blocking) = blocking {
            call(&daemon, "rail.restore", blocking).await.unwrap();
        } else {
            call(
                &daemon,
                "rail.remove",
                json!({"id":chosen,"operation":"free-identity"}),
            )
            .await
            .unwrap();
        }
        call(&daemon, "rail.restore", receipt.clone())
            .await
            .unwrap();
        let restored = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        call(&daemon, "rail.restore", receipt).await.unwrap();
        assert_eq!(
            call(&daemon, "rail.tree", Value::Null).await.unwrap(),
            restored
        );
    }
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
    call(&daemon, "rail.restore", deletion).await.unwrap();
    let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == child)
            .unwrap()["parent"],
        b
    );
    assert_eq!(
        tree.as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == chosen)
            .unwrap()["parent"],
        a
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
async fn u3787a_workstream_restores_home_pads_and_promoted_agents() {
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
    call(
        &daemon,
        "pad.create",
        json!({"name":"kept","text":"owned work"}),
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
    assert_eq!(moved, json!([]));
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

#[tokio::test]
async fn u3787a_rail_redo_reuses_restored_identity_and_reconciles_reply() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let home = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"})).await.unwrap();
    let original = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let removed = call(&daemon, "rail.remove", json!({"id":home["id"],"operation":"first"})).await.unwrap();
    let restored = call(&daemon, "rail.restore", removed["deletion"].clone()).await.unwrap();
    let request = json!({"project":restored["deletion"]["project"],"source":"first","restoration":restored["deletion"]["restoration"],"operation":"again"});
    let redone = call(&daemon, "rail.redo", request.clone()).await.unwrap();
    assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), json!([]));
    assert_eq!(call(&daemon, "rail.redo", request).await.unwrap(), redone);
    assert_eq!(call(&daemon, "rail.deletion", redone["deletion"].clone()).await.unwrap(), redone);
    assert_eq!(call(&daemon, "rail.remove", json!({"id":home["id"],"operation":"first"})).await.unwrap(), restored);
    call(&daemon, "rail.restore", redone["deletion"].clone()).await.unwrap();
    assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), original);
    assert_eq!(call(&daemon, "terminal.list", Value::Null).await.unwrap(), json!([]));
}
