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
