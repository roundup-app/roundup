use super::{tests::call, *};
use serde_json::json;

fn redo(restored: &Value, operation: &str) -> Value {
    json!({"project":restored["deletion"]["project"],"source":restored["deletion"]["operation"],"restoration":restored["deletion"]["restoration"],"operation":operation})
}

#[tokio::test]
async fn u3787a_rail_redo_preserves_arrivals_and_restores_exact_participants() {
    for kind in ["agent", "workstream"] {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute("INSERT INTO nodes(kind,name,ord,conversation_id,spawn_prompt,creator) VALUES(?,'chosen',0,'original-conversation','original prompt','maker')",[kind]).unwrap();
        let id = db.last_insert_rowid().to_string();
        db.execute("INSERT INTO nodes(kind,name,parent,ord,conversation_id) VALUES('agent','original child',?,0,'child-conversation')",[&id]).unwrap();
        let child = db.last_insert_rowid().to_string();
        let home = call(&daemon, "rail.createWorkstream", json!({"name":"other"}))
            .await
            .unwrap()["id"]
            .clone();
        let owner = json!({"kind":"agent","id":child,"parent":null});
        let todo = call(&daemon, "todo.create", json!({"title":"chosen done"}))
            .await
            .unwrap();
        let open = call(
            &daemon,
            "todo.create",
            json!({"title":"open","owner":owner}),
        )
        .await
        .unwrap();
        let dependent = call(
            &daemon,
            "todo.create",
            json!({"title":"dependent","blockers":[todo["id"]]}),
        )
        .await
        .unwrap();
        let pad = call(
            &daemon,
            "pad.create",
            json!({"name":"chosen pad","text":"original bytes"}),
        )
        .await
        .unwrap();
        if kind == "workstream" {
            for t in [&todo, &open] {
                call(&daemon, "todo.move", json!({"id":t["id"],"home":id}))
                    .await
                    .unwrap();
            }
            call(&daemon, "pad.move", json!({"name":"chosen pad","home":id}))
                .await
                .unwrap();
        }
        call(&daemon, "todo.complete", json!({"id":todo["id"]}))
            .await
            .unwrap();
        let original = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        let original_pad = call(&daemon, "pad.read", json!({"name":"chosen pad"}))
            .await
            .unwrap();
        let removed = call(&daemon, "rail.remove", json!({"id":id,"operation":"first"}))
            .await
            .unwrap();
        let restored = call(&daemon, "rail.restore", removed["deletion"].clone())
            .await
            .unwrap();
        // A later child belongs to the live graph, never to the authorized removal set.
        db.execute(
            "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','arrival',?,9)",
            [&id],
        )
        .unwrap();
        let arrival = db.last_insert_rowid().to_string();
        let later = call(&daemon, "todo.create", json!({"title":"arrival"}))
            .await
            .unwrap();
        call(&daemon, "todo.complete", json!({"id":later["id"]}))
            .await
            .unwrap();
        call(
            &daemon,
            "todo.move",
            json!({"id":later["id"],"home":if kind=="workstream" {json!(id)} else {home.clone()}}),
        )
        .await
        .unwrap();
        call(
            &daemon,
            "pad.create",
            json!({"name":"arrival pad","text":"new work"}),
        )
        .await
        .unwrap();
        if kind == "workstream" {
            call(&daemon, "pad.move", json!({"name":"arrival pad","home":id}))
                .await
                .unwrap();
        }
        let mut current = restored;
        for cycle in ["second", "third"] {
            let request = redo(&current, cycle);
            let redone = call(&daemon, "rail.redo", request.clone()).await.unwrap();
            let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
            assert!(!tree.as_array().unwrap().iter().any(|n| n["id"] == id));
            assert!(tree.as_array().unwrap().iter().any(|n| n["id"] == arrival));
            assert_eq!(
                tree.as_array().unwrap().iter().any(|n| n["id"] == child),
                kind == "agent"
            );
            assert_eq!(
                call(&daemon, "todo.get", json!({"id":later["id"]}))
                    .await
                    .unwrap()["home"],
                if kind == "workstream" {
                    Value::Null
                } else {
                    home.clone()
                }
            );
            assert_eq!(
                call(&daemon, "pad.read", json!({"name":"arrival pad"}))
                    .await
                    .unwrap()["text"],
                "new work"
            );
            if kind == "workstream" {
                assert_eq!(
                    call(&daemon, "todo.get", json!({"id":todo["id"]}))
                        .await
                        .unwrap_err()
                        .code,
                    rpc::code::NOT_FOUND
                );
                assert_eq!(
                    call(&daemon, "todo.get", json!({"id":dependent["id"]}))
                        .await
                        .unwrap()["blockers"],
                    json!([])
                );
                assert_eq!(
                    call(&daemon, "pad.read", json!({"name":"chosen pad"}))
                        .await
                        .unwrap_err()
                        .code,
                    rpc::code::NOT_FOUND
                );
                assert!(
                    call(&daemon, "todo.get", json!({"id":open["id"]}))
                        .await
                        .unwrap()["owner"]
                        .is_null()
                );
            }
            let touches: i64 = db
                .query_row("SELECT count(*) FROM touches", [], |r| r.get(0))
                .unwrap();
            assert_eq!(
                call(&daemon, "rail.redo", request.clone()).await.unwrap(),
                redone
            );
            assert_eq!(
                db.query_row("SELECT count(*) FROM touches", [], |r| r.get::<_, i64>(0))
                    .unwrap(),
                touches
            );
            current = call(&daemon, "rail.restore", redone["deletion"].clone())
                .await
                .unwrap();
            assert_eq!(call(&daemon, "rail.redo", request).await.unwrap(), current);
            let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
            for chosen in original.as_array().unwrap() {
                let live = tree
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|n| n["id"] == chosen["id"])
                    .unwrap();
                let mut expected = chosen.clone();
                expected["order"] = live["order"].clone();
                assert_eq!(live, &expected);
            }
            assert_eq!(
                call(&daemon, "pad.read", json!({"name":"chosen pad"}))
                    .await
                    .unwrap(),
                original_pad
            );
            assert_eq!(
                call(&daemon, "todo.get", json!({"id":dependent["id"]}))
                    .await
                    .unwrap()["blockers"],
                json!([todo["id"]])
            );
            assert_eq!(
                call(&daemon, "todo.get", json!({"id":open["id"]}))
                    .await
                    .unwrap()["owner"],
                owner
            );
            assert_eq!(
                call(&daemon, "terminal.list", Value::Null).await.unwrap(),
                json!([])
            );
        }
        assert!(!pad["incarnation"].is_null());
    }
}

#[tokio::test]
async fn u3787a_rail_redo_refuses_changed_placement_without_mutation_and_retries() {
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
    call(
        &daemon,
        "pad.create",
        json!({"name":"chosen","text":"bytes"}),
    )
    .await
    .unwrap();
    call(&daemon, "pad.move", json!({"name":"chosen","home":home}))
        .await
        .unwrap();
    let removed = call(
        &daemon,
        "rail.remove",
        json!({"id":home,"operation":"first"}),
    )
    .await
    .unwrap();
    let restored = call(&daemon, "rail.restore", removed["deletion"].clone())
        .await
        .unwrap();
    let request = redo(&restored, "retry");
    call(&daemon, "pad.move", json!({"name":"chosen","home":other}))
        .await
        .unwrap();
    let before = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    let touches: i64 = db
        .query_row("SELECT count(*) FROM touches", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        call(&daemon, "rail.redo", request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null).await.unwrap(),
        before
    );
    assert_eq!(call(&daemon, "pad.list", Value::Null).await.unwrap(), pads);
    assert_eq!(
        call(
            &daemon,
            "rail.deletion",
            json!({"project":restored["deletion"]["project"],"operation":"retry"})
        )
        .await
        .unwrap(),
        Value::Null
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM touches", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        touches
    );
    call(&daemon, "pad.move", json!({"name":"chosen","home":home}))
        .await
        .unwrap();
    call(&daemon, "rail.redo", request).await.unwrap();
    assert_eq!(
        call(&daemon, "pad.list", Value::Null).await.unwrap(),
        json!([])
    );
}

#[tokio::test]
async fn u3787a_rail_redo_identity_and_authority_refusals_leave_every_participant() {
    for conflict in [
        "actor",
        "agent",
        "project",
        "restoration",
        "pad-incarnation",
        "todo-home",
        "rail-identity",
        "rail-home",
        "kept-home",
        "kept-owner",
    ] {
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
        db.execute("INSERT INTO nodes(kind,name,parent,ord,conversation_id) VALUES('agent','retained',?,0,'original')",[home.as_str().unwrap()]).unwrap();
        let child = db.last_insert_rowid().to_string();
        let todo = call(&daemon, "todo.create", json!({"title":"done"}))
            .await
            .unwrap();
        call(&daemon, "todo.move", json!({"id":todo["id"],"home":home}))
            .await
            .unwrap();
        if !conflict.starts_with("kept-") {
            call(&daemon, "todo.complete", json!({"id":todo["id"]}))
                .await
                .unwrap();
        }
        if conflict == "kept-owner" {
            call(
                &daemon,
                "todo.assign",
                json!({"id":todo["id"],"owner":{"kind":"agent","id":child}}),
            )
            .await
            .unwrap();
        }
        call(
            &daemon,
            "pad.create",
            json!({"name":"chosen","text":"bytes"}),
        )
        .await
        .unwrap();
        call(&daemon, "pad.move", json!({"name":"chosen","home":home}))
            .await
            .unwrap();
        let removed = call(
            &daemon,
            "rail.remove",
            json!({"id":home,"operation":"first"}),
        )
        .await
        .unwrap();
        let restored = call(&daemon, "rail.restore", removed["deletion"].clone())
            .await
            .unwrap();
        let mut request = redo(&restored, "refused");
        if conflict == "project" {
            request["project"] = json!("foreign");
        }
        if conflict == "restoration" {
            request["restoration"] = json!("stale");
        }
        if conflict == "pad-incarnation" {
            call(&daemon, "pad.delete", json!({"name":"chosen"}))
                .await
                .unwrap();
            call(
                &daemon,
                "pad.create",
                json!({"name":"chosen","text":"replacement"}),
            )
            .await
            .unwrap();
        }
        if conflict == "todo-home" || conflict == "kept-home" {
            call(&daemon, "todo.move", json!({"id":todo["id"],"home":other}))
                .await
                .unwrap();
        }
        if conflict == "kept-owner" {
            call(
                &daemon,
                "todo.assign",
                json!({"id":todo["id"],"owner":Actor::user()}),
            )
            .await
            .unwrap();
        }
        if conflict == "rail-home" {
            call(
                &daemon,
                "rail.move",
                json!({"id":child,"parent":other,"index":0}),
            )
            .await
            .unwrap();
        }
        if conflict == "rail-identity" {
            db.execute(
                "UPDATE nodes SET conversation_id='replacement' WHERE id=?",
                [&child],
            )
            .unwrap();
        }
        let before = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        let todos = call(&daemon, "todo.list", Value::Null).await.unwrap();
        let pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
        let touches: i64 = db
            .query_row("SELECT count(*) FROM touches", [], |r| r.get(0))
            .unwrap();
        let error = if conflict == "actor" || conflict == "agent" {
            let (events, _) = tokio::sync::mpsc::unbounded_channel();
            let mut conn = crate::Conn {
                actor: Actor {
                    kind: if conflict == "agent" {
                        contracts::ActorKind::Agent
                    } else {
                        contracts::ActorKind::User
                    },
                    id: "other".into(),
                    parent: None,
                },
                peer: None,
                events,
                output: None,
            };
            daemon
                .route(&mut conn, "rail.redo", request.clone())
                .await
                .unwrap_err()
        } else {
            call(&daemon, "rail.redo", request.clone())
                .await
                .unwrap_err()
        };
        assert_eq!(
            error.code,
            if ["actor", "agent", "project"].contains(&conflict) {
                rpc::code::FORBIDDEN
            } else {
                rpc::code::CONFLICT
            },
            "{conflict}: {error}"
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM touches", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            touches
        );
        assert_eq!(
            call(&daemon, "rail.tree", Value::Null).await.unwrap(),
            before
        );
        assert_eq!(
            call(&daemon, "todo.list", Value::Null).await.unwrap(),
            todos
        );
        assert_eq!(call(&daemon, "pad.list", Value::Null).await.unwrap(), pads);
        if conflict == "kept-owner" {
            call(
                &daemon,
                "todo.assign",
                json!({"id":todo["id"],"owner":{"kind":"agent","id":child}}),
            )
            .await
            .unwrap();
            call(&daemon, "rail.redo", request.clone()).await.unwrap();
        }
        if conflict == "rail-home" {
            call(
                &daemon,
                "rail.move",
                json!({"id":child,"parent":home,"index":0}),
            )
            .await
            .unwrap();
            call(&daemon, "rail.redo", request.clone()).await.unwrap();
        }
        if conflict == "todo-home" || conflict == "kept-home" {
            call(&daemon, "todo.move", json!({"id":todo["id"],"home":home}))
                .await
                .unwrap();
            call(&daemon, "rail.redo", request).await.unwrap();
        }
    }
}

#[tokio::test]
async fn u3787a_rail_redo_reconciles_after_daemon_restart_and_preserves_mirror_edits() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let home = call(&daemon, "rail.createWorkstream", json!({"name":"chosen"}))
        .await
        .unwrap()["id"]
        .clone();
    call(&daemon, "pad.setStorage", json!({"files":true}))
        .await
        .unwrap();
    call(
        &daemon,
        "pad.create",
        json!({"name":"chosen","text":"original"}),
    )
    .await
    .unwrap();
    call(&daemon, "pad.move", json!({"name":"chosen","home":home}))
        .await
        .unwrap();
    let todo = call(&daemon, "todo.create", json!({"title":"chosen done"}))
        .await
        .unwrap();
    call(&daemon, "todo.move", json!({"id":todo["id"],"home":home}))
        .await
        .unwrap();
    call(&daemon, "todo.complete", json!({"id":todo["id"]}))
        .await
        .unwrap();
    let removed = call(
        &daemon,
        "rail.remove",
        json!({"id":home,"operation":"first"}),
    )
    .await
    .unwrap();
    let restored = call(&daemon, "rail.restore", removed["deletion"].clone())
        .await
        .unwrap();
    let request = redo(&restored, "unknown-reply");
    let mirror = dir.path().join("pads/chosen.md");
    std::fs::write(&mirror, "external work").unwrap();
    assert_eq!(
        call(&daemon, "rail.redo", request.clone())
            .await
            .unwrap_err()
            .code,
        rpc::code::CONFLICT
    );
    assert_eq!(std::fs::read_to_string(&mirror).unwrap(), "external work");
    assert_eq!(
        call(&daemon, "rail.tree", Value::Null)
            .await
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let retained = call(&daemon, "todo.get", json!({"id":todo["id"]}))
        .await
        .unwrap();
    assert_eq!(retained["home"], home);
    assert_eq!(retained["done"], true);
    std::fs::write(&mirror, "original").unwrap();
    let redone = call(&daemon, "rail.redo", request.clone()).await.unwrap();
    assert!(!mirror.exists());
    drop(daemon);
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    let touches: i64 = db
        .query_row("SELECT count(*) FROM touches", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        call(&daemon, "rail.redo", request.clone()).await.unwrap(),
        redone
    );
    assert_eq!(
        call(&daemon, "rail.deletion", redone["deletion"].clone())
            .await
            .unwrap(),
        redone
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM touches", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        touches
    );
    call(&daemon, "rail.restore", redone["deletion"].clone())
        .await
        .unwrap();
    assert_eq!(std::fs::read_to_string(&mirror).unwrap(), "original");
    assert_eq!(
        call(&daemon, "terminal.list", Value::Null).await.unwrap(),
        json!([])
    );
}

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
