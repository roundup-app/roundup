use super::*;

#[tokio::test]
async fn c4_wire_envelope_bytes_match_before_migration() {
    // Captured from e9485a975 through the real Daemon before migrating the contracts.
    #[derive(serde::Deserialize)]
    struct Envelope {
        request: String,
        reply: String,
    }
    let before: Vec<Envelope> =
        serde_json::from_str(include_str!("fixtures/c4-before-envelopes.json")).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    for envelope in before {
        let request: Value = serde_json::from_str(&envelope.request).unwrap();
        assert_eq!(
            serde_json::to_vec(&request).unwrap(),
            envelope.request.as_bytes()
        );
        let reply = tests::ask(&daemon, &envelope.request).await;
        assert_eq!(
            serde_json::to_vec(&reply).unwrap(),
            envelope.reply.as_bytes()
        );
    }
}

#[tokio::test]
async fn u4593_agent_inputs_resolve_before_dispatch() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Peer',0)",
        [],
    )
    .unwrap();
    let actor = Actor {
        kind: ActorKind::Agent,
        id: "1".into(),
        parent: None,
    };
    db.execute_batch("INSERT INTO nodes(id,kind,name,ord) VALUES(2,'agent','me',1),(3,'agent','1',2),(4,'agent','name:Peer',3);").unwrap();
    for (selector, expected) in [
        ("me", "1"),
        ("name:me", "2"),
        ("1", "1"),
        ("name:1", "3"),
        ("name:name:Peer", "4"),
        ("Peer", "1"),
    ] {
        for (method, params, pointer) in [
            ("agent.instructions", json!({"id":selector}), "/id"),
            (
                "rail.rename",
                json!({"id":selector,"name":"New name"}),
                "/id",
            ),
            ("rail.move", json!({"parent":selector}), "/parent"),
            ("agent.spawn", json!({"parent":selector}), "/parent"),
            ("todo.hand", json!({"agent":selector}), "/agent"),
            ("route.set", json!({"from":selector,"to":"you"}), "/from"),
            ("message.send", json!({"to":selector}), "/to"),
            ("message.list", json!({"to":selector}), "/to"),
            ("message.progress", json!({"id":selector}), "/id"),
            ("message.report", json!({"id":selector}), "/id"),
            ("deliverable.list", json!({"maker":selector}), "/maker"),
            (
                "provenance.touched",
                json!({"actor_id":selector}),
                "/actor_id",
            ),
            ("terminal.read", json!({"reader":selector}), "/reader"),
            ("workstream.rewindPlan", json!({"agent":selector}), "/agent"),
            ("agent.wake", json!({"ids":[selector]}), "/ids/0"),
            (
                "reaction.create",
                json!({"target":selector,"condition":{"kind":"agents","ids":[selector]}}),
                "/condition/ids/0",
            ),
        ] {
            let caller = if method == "agent.spawn" && selector != "me" {
                Actor::user()
            } else {
                actor.clone()
            };
            let resolved = daemon
                .resolve_agent_inputs(&caller, method, params)
                .await
                .unwrap();
            assert_eq!(
                resolved.pointer(pointer).unwrap(),
                expected,
                "{method} {selector}"
            );
        }
    }
    for owner in [
        json!("Peer"),
        json!({"kind":"agent","id":"Peer"}),
        json!("1"),
    ] {
        let response = tests::ask(
            &daemon,
            &json!({"id":1,"method":"todo.create","params":{"title":"Selected", "owner":owner}})
                .to_string(),
        )
        .await;
        assert!(response.get("error").is_none(), "{response}");
        assert_eq!(
            response["result"]["owner"],
            json!({"kind":"agent","id":"1","parent":null})
        );
    }
}

#[tokio::test]
async fn u4593_unknown_and_ambiguous_agents_leave_no_trace() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch("INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Peer',0),(2,'agent','Peer',1),(3,'workstream','Not an Agent',2);").unwrap();
    let before = daemon.touches.sequence().unwrap();
    let mut events = daemon.bus.subscribe();
    for (owner, code) in [
        (json!("Missing"), code::NOT_FOUND),
        (json!("peer"), code::NOT_FOUND),
        (json!("Peer"), code::CONFLICT),
        (json!("Not an Agent"), code::NOT_FOUND),
        (json!("me"), code::INVALID_PARAMS),
    ] {
        let result = tests::ask(&daemon, &json!({"id":1,"method":"todo.create","params":{"title":"Must not exist","owner":owner}}).to_string()).await;
        assert_eq!(result["error"]["code"], code, "{result}");
        if owner == "Missing" {
            assert!(
                result["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("Peer")
            );
        }
    }
    let result = tests::ask(
        &daemon,
        &json!({"id":1,"method":"agent.wake","params":{"ids":["1","Missing"]}}).to_string(),
    )
    .await;
    assert_eq!(result["error"]["code"], code::NOT_FOUND);
    assert_eq!(daemon.touches.sequence().unwrap(), before);
    assert!(events.try_recv().is_err());
    assert_eq!(
        tests::ask(&daemon, r#"{"id":1,"method":"todo.list"}"#).await["result"],
        json!([])
    );
}

#[tokio::test]
async fn u4593_selection_preserves_authority() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Caller',0),(2,'agent','Peer',1);",
    )
    .unwrap();
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: "1".into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    for (method, params) in [
        ("agent.stop", json!({"id":"me"})),
        ("agent.prompt", json!({"id":"Peer","text":"No authority"})),
    ] {
        let error = daemon.route(&mut conn, method, params).await.unwrap_err();
        assert_eq!(error.code, code::FORBIDDEN, "{error:?}");
    }
}

#[tokio::test]
async fn u4593_reaction_keeps_resolved_identities() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Target',0),(2,'agent','Watched',1);",
    )
    .unwrap();
    let created = tests::ask(&daemon, &json!({"id":1,"method":"reaction.create","params":{"operation":"names","name":"Observe","target":"Target","instruction":"Continue","reason":"Wait for the prerequisite.","condition":{"kind":"agents","ids":["Watched"]},"expires_at":"2099-01-01T00:00:00Z"}}).to_string()).await;
    assert!(created.get("error").is_none(), "{created}");
    db.execute_batch("UPDATE nodes SET name='Renamed' WHERE id=1; UPDATE nodes SET name='Also renamed' WHERE id=2; INSERT INTO nodes(id,kind,name,ord) VALUES(3,'agent','Target',2),(4,'agent','Watched',3);").unwrap();
    let read = tests::ask(
        &daemon,
        &json!({"id":1,"method":"reaction.get","params":{"id":created["result"]["id"]}})
            .to_string(),
    )
    .await;
    assert_eq!(read["result"]["target"], "1");
    assert_eq!(read["result"]["condition"]["ids"], json!(["2"]));
}

#[tokio::test]
async fn p14_pad_ask_is_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let created = tests::ask(
        &daemon,
        r#"{"id":1,"method":"pad.create","params":{"name":"notes","text":"start"}}"#,
    )
    .await;
    assert!(created.get("error").is_none(), "{created}");
    let before = tests::ask(&daemon, r#"{"id":2,"method":"rail.tree"}"#).await;
    let history = tests::ask(
        &daemon,
        r#"{"id":3,"method":"provenance.history","params":{"item":"pad:notes"}}"#,
    )
    .await;

    let reply = tests::ask(
        &daemon,
        r#"{"id":4,"method":"pad.ask","params":{"name":"notes","text":"shorten"}}"#,
    )
    .await;

    assert_eq!(reply["error"]["code"], code::METHOD_NOT_FOUND);
    assert_eq!(
        tests::ask(&daemon, r#"{"id":2,"method":"rail.tree"}"#).await,
        before
    );
    assert_eq!(
        tests::ask(
            &daemon,
            r#"{"id":3,"method":"provenance.history","params":{"item":"pad:notes"}}"#,
        )
        .await,
        history
    );
}

#[tokio::test]
async fn p14_pad_has_no_scribe_field() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let created = tests::ask(
        &daemon,
        r#"{"id":1,"method":"pad.create","params":{"name":"notes","text":"start"}}"#,
    )
    .await;
    assert!(created.get("error").is_none(), "{created}");

    let read = tests::ask(
        &daemon,
        r#"{"id":2,"method":"pad.read","params":{"name":"notes"}}"#,
    )
    .await;
    let listed = tests::ask(&daemon, r#"{"id":3,"method":"pad.list"}"#).await;

    assert_eq!(read["result"]["name"], "notes", "{read}");
    assert_eq!(listed["result"][0]["name"], "notes", "{listed}");
    assert!(read["result"].get("scribe").is_none());
    assert!(listed["result"][0].get("scribe").is_none());
}

#[tokio::test]
async fn m10_a_block_over_its_limit_is_invalid_params() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'workstream','Door',0)",
        [],
    )
    .unwrap();
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: "1".into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    let text = |n: usize| json!({ "kind": "text", "text": "x".repeat(n) });
    let rows = |n: usize| {
        let row = json!({ "label": "a", "value": "b" });
        json!({ "kind": "rows", "rows": vec![row; n] })
    };
    let bad = [
        json!({ "title": "x".repeat(81), "blocks": [text(1)] }),
        json!({ "title": "t", "blocks": [] }),
        json!({ "title": "t", "blocks": vec![text(1); 9] }),
        json!({ "title": "t", "blocks": [{ "kind": "chart", "text": "x" }] }),
        json!({ "title": "t", "blocks": [rows(13)] }),
        json!({ "title": "t", "blocks": [{ "kind": "table", "head": ["1","2","3","4","5","6","7"], "rows": [] }] }),
        json!({ "title": "t", "blocks": [{ "kind": "table", "head": ["1"], "rows": vec![json!(["a"]); 13] }] }),
        json!({ "title": "t", "blocks": [{ "kind": "diagram", "mermaid": "x".repeat(2001) }] }),
        json!({ "title": "t", "blocks": [text(401)] }),
    ];

    for params in bad {
        let err = daemon
            .route(&mut conn, "checkpoint.write", params.clone())
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{params}");
    }

    let listed = daemon
        .route(&mut conn, "checkpoint.list", json!({ "workstream": "1" }))
        .await
        .unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 0);
    let at_limits = json!({ "title": "x".repeat(80), "blocks": [
        text(400), rows(12), json!({ "kind": "diagram", "mermaid": "x".repeat(2000) }),
        json!({ "kind": "table", "head": ["1","2","3","4","5","6"], "rows": vec![json!(["a"]); 12] }),
    ] });
    daemon
        .route(&mut conn, "checkpoint.write", at_limits)
        .await
        .unwrap();
}

#[tokio::test]
async fn m10_a_subagent_cannot_write_a_checkpoint() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch("INSERT INTO nodes(id,kind,name,ord,parent) VALUES(1,'workstream','Door',0,NULL),(2,'agent','Child',0,1);").unwrap();
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    };
    for caller in [
        Actor {
            kind: ActorKind::Agent,
            id: "2".into(),
            parent: None,
        },
        Actor::user(),
    ] {
        conn.actor = caller;
        let err = daemon
            .route(
                &mut conn,
                "checkpoint.write",
                json!({"title":"nope","blocks":[{"kind":"text","text":"nope"}]}),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, code::FORBIDDEN);
    }
    let listed = daemon
        .route(&mut conn, "checkpoint.list", json!({"workstream":"1"}))
        .await
        .unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn a31_a_missing_id_is_not_found_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();

    let reply = tests::ask(
        &daemon,
        r#"{"id":1,"method":"agent.skills","params":{"id":"nobody"}}"#,
    )
    .await;

    assert_eq!(reply["error"]["code"], code::NOT_FOUND);
    let tree = tests::ask(&daemon, r#"{"id":2,"method":"rail.tree"}"#).await;
    assert_eq!(tree["result"], json!([]), "{tree}");
}

#[tokio::test]
async fn a31_a_call_on_an_existing_id_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Agent',0)",
        [],
    )
    .unwrap();
    let before = tests::ask(&daemon, r#"{"id":1,"method":"rail.tree"}"#).await;
    assert_eq!(before["result"].as_array().unwrap().len(), 1);

    let reply = tests::ask(
        &daemon,
        r#"{"id":2,"method":"agent.skills","params":{"id":"1"}}"#,
    )
    .await;

    assert!(reply["result"]["skills"].is_array(), "{reply}");
    assert_eq!(
        tests::ask(&daemon, r#"{"id":1,"method":"rail.tree"}"#).await,
        before
    );
    let touched = tests::ask(
        &daemon,
        r#"{"id":3,"method":"provenance.touched","params":{"actor_id":"1"}}"#,
    )
    .await;
    assert_eq!(touched["result"], json!([]), "{touched}");
}

#[tokio::test]
async fn m14_unknown_terminal_is_not_found_before_forbidden() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Agent',0)",
        [],
    )
    .unwrap();
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: "1".into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };

    for method in ["terminal.write", "terminal.kill", "terminal.close"] {
        let missing = daemon
            .route(&mut conn, method, json!({ "id": "9999", "data": "eAo=" }))
            .await
            .unwrap_err();
        assert_eq!(missing.code, code::NOT_FOUND, "{method}");
    }
}

#[tokio::test]
async fn m13_unknown_is_not_found_before_forbidden() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Agent',0)",
        [],
    )
    .unwrap();
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Agent,
            id: "1".into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };

    let missing = daemon
        .route(
            &mut conn,
            "terminal.read",
            json!({ "id": "9999", "after": 0 }),
        )
        .await
        .unwrap_err();
    assert_eq!(missing.code, code::NOT_FOUND);
}
