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
            ("agent.wake", json!({"ids":[selector]}), "/ids/0"),
            (
                "workstream.rewind",
                json!({"turns":[{"agent":selector,"turn":"t"}]}),
                "/turns/0/agent",
            ),
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

#[tokio::test]
async fn m14_an_agent_cannot_set_a_route_to_itself() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch("INSERT INTO nodes(id,kind,name,ord,parent) VALUES(1,'workstream','m',0,NULL),(2,'agent','a',0,1),(3,'agent','b',1,1),(4,'workstream','g',1,NULL),(5,'agent','c',0,4);").unwrap();
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

    let refused = daemon
        .route(
            &mut conn,
            "route.set",
            json!({ "from": "2", "to": "1", "delivery": "auto" }),
        )
        .await;

    assert_eq!(refused.unwrap_err().code, code::FORBIDDEN);
}

#[tokio::test]
async fn m14_an_agent_sets_a_route_between_nodes_in_its_reach() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch("INSERT INTO nodes(id,kind,name,ord,parent) VALUES(1,'workstream','m',0,NULL),(2,'agent','a',0,1),(3,'agent','b',1,1),(4,'workstream','g',1,NULL),(5,'agent','c',0,4);").unwrap();
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

    daemon
        .route(
            &mut conn,
            "route.set",
            json!({ "from": "2", "to": "3", "delivery": "drop" }),
        )
        .await
        .unwrap();

    let routes = tests::ask(&daemon, r#"{"id":1,"method":"route.list"}"#).await["result"].clone();
    assert_eq!(
        routes,
        json!([{ "from": "2", "to": "3", "delivery": "drop" }])
    );
}

#[tokio::test]
async fn m14_a_node_outside_the_reach_is_forbidden() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch("INSERT INTO nodes(id,kind,name,ord,parent) VALUES(1,'workstream','m',0,NULL),(2,'agent','a',0,1),(3,'agent','b',1,1),(4,'workstream','g',1,NULL),(5,'agent','c',0,4);").unwrap();
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

    for (from, to) in [("2", "5"), ("5", "2")] {
        let refused = daemon
            .route(
                &mut conn,
                "route.set",
                json!({ "from": from, "to": to, "delivery": "drop" }),
            )
            .await;
        assert_eq!(refused.unwrap_err().code, code::FORBIDDEN);
    }
    assert_eq!(
        tests::ask(&daemon, r#"{"id":1,"method":"route.list"}"#).await["result"],
        json!([])
    );
}

#[tokio::test]
async fn m14_an_agent_cannot_route_or_replace_the_users_routes() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch("INSERT INTO nodes(id,kind,name,ord,parent) VALUES(1,'workstream','m',0,NULL),(2,'agent','a',0,1),(3,'agent','b',1,1),(4,'workstream','g',1,NULL),(5,'agent','c',0,4);").unwrap();
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    };
    daemon
        .route(
            &mut conn,
            "route.set",
            json!({ "from": "2", "to": "3", "delivery": "drop" }),
        )
        .await
        .unwrap();

    conn.actor = Actor {
        kind: ActorKind::Agent,
        id: "1".into(),
        parent: None,
    };
    let replaced = daemon
        .route(
            &mut conn,
            "route.set",
            json!({ "from": "2", "to": "3", "delivery": "auto" }),
        )
        .await;
    let from_user = daemon
        .route(
            &mut conn,
            "route.set",
            json!({ "from": "you", "to": "2", "delivery": "drop" }),
        )
        .await;

    assert_eq!(replaced.unwrap_err().code, code::FORBIDDEN);
    assert_eq!(from_user.unwrap_err().code, code::FORBIDDEN);
    let routes = tests::ask(&daemon, r#"{"id":1,"method":"route.list"}"#).await["result"].clone();
    assert_eq!(routes[0]["delivery"], "drop");
}

#[tokio::test]
async fn n5467b_incomplete_reaction_records_refuse_without_firing() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Target',0),(2,'agent','Watched',1);",
    )
    .unwrap();
    let created = tests::ask(&daemon, &json!({"id":1,"method":"reaction.create","params":{"operation":"current","name":"Observe","target":"1","instruction":"Continue","reason":"Wait for the prerequisite.","condition":{"kind":"agents","ids":["2"]},"expires_at":"2099-01-01T00:00:00Z"}}).to_string()).await;
    assert!(created.get("error").is_none(), "{created}");
    let id = created["result"]["id"].as_str().unwrap();
    let original: String = db
        .query_row("SELECT record FROM reactions WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .unwrap();
    for field in [
        "reason",
        "observation.health_code",
        "observation.cause_code",
        "observation.gap_code",
        "observation.recovery_code",
    ] {
        db.execute(
            "UPDATE reactions SET record=json_remove(?1, ?2) WHERE id=?3",
            rusqlite::params![original, format!("$.{field}"), id],
        )
        .unwrap();
        for (method, params) in [
            ("reaction.get", json!({"id":id})),
            ("reaction.list", Value::Null),
            ("reaction.run", json!({"id":id,"operation":"refused"})),
        ] {
            let reply = tests::ask(
                &daemon,
                &json!({"id":2,"method":method,"params":params}).to_string(),
            )
            .await;
            assert!(reply.get("error").is_some(), "{field}: {reply}");
        }
    }
    db.execute(
        "UPDATE reactions SET record=?1 WHERE id=?2",
        rusqlite::params![original, id],
    )
    .unwrap();
    let watch: String = db
        .query_row(
            "SELECT state FROM reaction_watch WHERE reaction=?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    let current: contracts::reaction::Reaction = serde_json::from_str(&original).unwrap();
    for field in [
        "before_rearm",
        "health_code",
        "cause_code",
        "gap_code",
        "recovery_code",
    ] {
        db.execute(
            "UPDATE reaction_watch SET state=json_remove(?1, ?2) WHERE reaction=?3",
            rusqlite::params![watch, format!("$.{field}"), id],
        )
        .unwrap();
        let incomplete: String = db
            .query_row(
                "SELECT state FROM reaction_watch WHERE reaction=?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        daemon.evaluator().unwrap().observe(&current, None).await;
        for (method, params) in [
            ("reaction.get", json!({"id":id})),
            ("reaction.run", json!({"id":id,"operation":"refused"})),
        ] {
            let reply = tests::ask(
                &daemon,
                &json!({"id":2,"method":method,"params":params}).to_string(),
            )
            .await;
            assert!(reply.get("error").is_some(), "Watch {field}: {reply}");
        }
        let retained: String = db
            .query_row(
                "SELECT state FROM reaction_watch WHERE reaction=?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(retained, incomplete, "Watch {field} was rewritten");
    }
    assert_eq!(
        db.query_row("SELECT count(*) FROM reaction_firings", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn c5461a_retired_methods_are_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let methods = tests::ask(&daemon, r#"{"id":1,"method":"daemon.methods"}"#).await;
    let descriptions = tests::ask(&daemon, r#"{"id":2,"method":"api.list"}"#).await;
    for (namespace, member) in [("attachment", "save"), ("rail", "list")] {
        let name = format!("{namespace}.{member}");
        assert!(
            !methods["result"].as_array().unwrap().contains(&json!(name)),
            "{methods}"
        );
        assert!(
            descriptions["result"]["methods"]
                .as_array()
                .unwrap()
                .iter()
                .all(|row| row["name"] != name),
            "{descriptions}"
        );
        let description = tests::ask(
            &daemon,
            &json!({"id":3,"method":"api.describe","params":{"method":name}}).to_string(),
        )
        .await;
        assert_eq!(
            description["error"]["code"],
            code::METHOD_NOT_FOUND,
            "{description}"
        );
        let reply = tests::ask(&daemon, &json!({"id":4,"method":name}).to_string()).await;
        assert_eq!(reply["error"]["code"], code::METHOD_NOT_FOUND, "{reply}");
    }
}
