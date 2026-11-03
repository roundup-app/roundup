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
async fn b5_the_user_sets_non_agent_routes_through_daemon_dispatch() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let created = tests::ask(
        &daemon,
        r#"{"id":1,"method":"rail.createWorkstream","params":{"name":"Receiver"}}"#,
    )
    .await;
    assert!(created.get("error").is_none(), "{created}");
    let to = &created["result"]["id"];
    let daemon_sender = Actor::daemon().id;
    for from in ["ext:audit", daemon_sender.as_str(), "you"] {
        for delivery in ["auto", "drop"] {
            let route = json!({"from":from,"to":to,"delivery":delivery});
            let mut events = daemon.bus.subscribe();
            let response = tests::ask(
                &daemon,
                &json!({"id":2,"method":"route.set","params":route}).to_string(),
            )
            .await;
            assert_eq!(response["result"], route, "{response}");
            let listed = tests::ask(&daemon, r#"{"id":3,"method":"route.list"}"#).await;
            assert!(listed["result"].as_array().unwrap().contains(&route));
            let mut changed = Vec::new();
            while let Ok(event) = events.try_recv() {
                if let contracts::EventData::RouteChanged(route) = event.data {
                    changed.push(serde_json::to_value(route).unwrap());
                }
            }
            assert_eq!(changed, [route]);
        }
    }
}

// Exercise the authenticated connection through production request dispatch.
async fn send_note_from(daemon: &Daemon, from: &str, to: &str, body: &str) -> Value {
    let (events, _) = mpsc::unbounded_channel();
    let mut conn = Conn {
        actor: Actor {
            kind: ActorKind::Ext,
            id: from.into(),
            parent: None,
        },
        peer: None,
        events,
        output: None,
    };
    let response = daemon
        .dispatch(
            &mut conn,
            &json!({"id":1,"method":"message.send","params":{"to":to,"kind":"note","body":body}})
                .to_string(),
            None,
        )
        .await
        .unwrap()
        .into_value();
    assert!(response.get("error").is_none(), "{response}");
    response["result"].clone()
}

#[tokio::test]
async fn b2_a_user_set_non_agent_auto_route_reaches_the_inbox() {
    let daemon_sender = Actor::daemon().id;
    for from in ["ext:audit", daemon_sender.as_str()] {
        let dir = tempfile::tempdir().unwrap();
        let (daemon, state) = test_support::reply_daemon(dir.path(), false);
        let route = tests::ask(
            &daemon,
            &json!({"id":1,"method":"route.set","params":{"from":from,"to":"2","delivery":"auto"}})
                .to_string(),
        )
        .await;
        assert!(route.get("error").is_none(), "{route}");
        let sent = send_note_from(&daemon, from, "2", "Audit result").await;
        assert_eq!(sent["status"], "pending");
        assert_eq!(sent["from"]["id"], from);
        let id = sent["id"].as_u64().unwrap() as u32;
        state.status("2", contracts::Kind::Idle);
        tokio::time::timeout(std::time::Duration::from_secs(2), state.written.notified())
            .await
            .expect("idle writes the inbox");
        assert_eq!(
            *state.entries.lock().unwrap(),
            [("2".into(), id, from.into(), "Audit result".into())]
        );
        let pending = tests::ask(
            &daemon,
            &json!({"id":2,"method":"message.get","params":{"id":id}}).to_string(),
        )
        .await;
        assert_eq!(pending["result"], sent);
        state
            .messages
            .get()
            .unwrap()
            .upgrade()
            .unwrap()
            .confirm_inbox("2", &[id]);
        let delivered = tests::ask(
            &daemon,
            &json!({"id":3,"method":"message.get","params":{"id":id}}).to_string(),
        )
        .await;
        assert_eq!(delivered["result"]["status"], "delivered");
        assert_eq!(*state.terminal_writes.lock().unwrap(), 0);
    }
}

#[tokio::test]
async fn b4_a_user_set_non_agent_drop_route_drops_the_message() {
    let daemon_sender = Actor::daemon().id;
    for from in ["ext:audit", daemon_sender.as_str()] {
        let dir = tempfile::tempdir().unwrap();
        let (daemon, state) = test_support::reply_daemon(dir.path(), false);
        state.status("2", contracts::Kind::Idle);
        let route = tests::ask(
            &daemon,
            &json!({"id":1,"method":"route.set","params":{"from":from,"to":"2","delivery":"drop"}})
                .to_string(),
        )
        .await;
        assert!(route.get("error").is_none(), "{route}");
        let mut events = daemon.bus.subscribe();
        let sent = send_note_from(&daemon, from, "2", "Audit result").await;
        assert_eq!(sent["status"], "dropped");
        assert_eq!(sent["from"]["id"], from);
        let mut dropped = Vec::new();
        while let Ok(event) = events.try_recv() {
            if let contracts::EventData::MessageDropped(message) = event.data {
                dropped.push(serde_json::to_value(message).unwrap());
            }
        }
        assert_eq!(dropped, [sent]);
        assert!(state.entries.lock().unwrap().is_empty());
        assert_eq!(*state.terminal_writes.lock().unwrap(), 0);
    }
}

#[tokio::test]
async fn b5_a_non_agent_route_change_preserves_the_pending_message() {
    let daemon_sender = Actor::daemon().id;
    for from in ["ext:audit", daemon_sender.as_str()] {
        let dir = tempfile::tempdir().unwrap();
        let (daemon, state) = test_support::reply_daemon(dir.path(), false);
        let route = tests::ask(
            &daemon,
            &json!({"id":1,"method":"route.set","params":{"from":from,"to":"2","delivery":"auto"}})
                .to_string(),
        )
        .await;
        assert!(route.get("error").is_none(), "{route}");
        let sent = send_note_from(&daemon, from, "2", "Audit result").await;
        assert_eq!(sent["status"], "pending");
        let mut events = daemon.bus.subscribe();
        let changed = tests::ask(
            &daemon,
            &json!({"id":1,"method":"route.set","params":{"from":from,"to":"2","delivery":"drop"}})
                .to_string(),
        )
        .await;
        assert!(changed.get("error").is_none(), "{changed}");
        let pending = tests::ask(
            &daemon,
            &json!({"id":2,"method":"message.get","params":{"id":sent["id"]}}).to_string(),
        )
        .await;
        assert_eq!(pending["result"], sent);
        while let Ok(event) = events.try_recv() {
            assert!(
                !matches!(
                    event.data,
                    contracts::EventData::MessageSent(_)
                        | contracts::EventData::MessageDelivered(_)
                        | contracts::EventData::MessageDropped(_)
                ),
                "{event:?}"
            );
        }
        assert!(state.entries.lock().unwrap().is_empty());
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
    let daemon_sender = Actor::daemon().id;
    let named_daemon = format!("name:{daemon_sender}");
    db.execute("INSERT INTO nodes(id,kind,name,ord) VALUES(5,'agent','you',4),(6,'agent',?1,5),(7,'agent','ext:audit',6)", [&daemon_sender]).unwrap();
    for (from, to, expected_from, expected_to) in [
        ("Peer", "name:me", "1", "2"),
        ("1", "2", "1", "2"),
        ("you", "Peer", "you", "1"),
        (daemon_sender.as_str(), "Peer", daemon_sender.as_str(), "1"),
        ("ext:audit", "Peer", "ext:audit", "1"),
        ("name:you", named_daemon.as_str(), "5", "6"),
        (named_daemon.as_str(), "name:ext:audit", "6", "7"),
        ("name:ext:audit", "name:you", "7", "5"),
    ] {
        let result = tests::ask(
            &daemon,
            &json!({"id":1,"method":"route.set","params":{"from":from,"to":to,"delivery":"auto"}})
                .to_string(),
        )
        .await;
        let expected = json!({"from":expected_from,"to":expected_to,"delivery":"auto"});
        assert_eq!(result["result"], expected, "{result}");
        let routes = tests::ask(&daemon, r#"{"id":2,"method":"route.list"}"#).await;
        assert!(routes["result"].as_array().unwrap().contains(&expected));
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
    assert_eq!(replaced.unwrap_err().code, code::FORBIDDEN);
    let before = daemon.touches.sequence().unwrap();
    let mut observed = daemon.bus.subscribe();
    let daemon_sender = Actor::daemon().id;
    for from in ["you", "ext:audit", daemon_sender.as_str()] {
        let response = daemon.dispatch(&mut conn, &json!({"id":1,"method":"route.set","params":{"from":from,"to":"2","delivery":"drop"}}).to_string(), None).await.unwrap().into_value();
        assert_eq!(response["error"]["code"], code::FORBIDDEN, "{response}");
    }
    assert_eq!(daemon.touches.sequence().unwrap(), before);
    while let Ok(event) = observed.try_recv() {
        assert!(!matches!(event.data, contracts::EventData::RouteChanged(_)));
    }
    let routes = tests::ask(&daemon, r#"{"id":1,"method":"route.list"}"#).await["result"].clone();
    assert_eq!(routes, json!([{"from":"2","to":"3","delivery":"drop"}]));
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

#[tokio::test]
async fn u5740b_removed_methods_are_unknown() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let methods = tests::ask(&daemon, r#"{"id":1,"method":"daemon.methods"}"#).await;
    let descriptions = tests::ask(&daemon, r#"{"id":2,"method":"api.list"}"#).await;
    assert!(
        methods["result"]
            .as_array()
            .unwrap()
            .iter()
            .all(|name| !name.as_str().unwrap().starts_with("reaction."))
    );
    assert!(
        descriptions["result"]["methods"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| !row["name"].as_str().unwrap().starts_with("reaction."))
    );
    let baseline = tests::ask(&daemon, r#"{"id":1,"method":"retired.unknown"}"#).await;
    for method in [
        "reaction.create",
        "reaction.preview",
        "reaction.list",
        "reaction.get",
        "reaction.stop",
        "reaction.run",
    ] {
        let reply = tests::ask(&daemon, &json!({"id":1,"method":method}).to_string()).await;
        assert_eq!(
            reply["error"]["code"], baseline["error"]["code"],
            "{method}"
        );
        assert_eq!(
            reply["error"]["message"],
            format!("method not found: {method}")
        );
    }
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM messages", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
}
