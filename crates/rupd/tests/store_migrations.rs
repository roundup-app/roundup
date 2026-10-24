//! N20: current standalone stores still write and reopen; no historical fixtures.
use std::{path::Path, sync::Arc};

use contracts::{Actor, ActorKind, Verb};
use rpc::{Bus, Ctx, Module};
use serde_json::{Value, json};

mod storage {
    include!("support/store_migrations.rs");
}

fn agents(dir: &Path, bus: Bus) -> Arc<agents::Agents> {
    let terminals = Arc::new(terminal::Terminals::open(dir, bus.clone()).unwrap());
    Arc::new(
        agents::Agents::open_in(
            dir,
            dir,
            bus,
            terminals,
            agents::claude_code::Launcher::new(
                "unused",
                dir.join("claude.json"),
                dir.join("rup"),
                None,
            ),
            agents::worktree::Git::from_env(),
        )
        .unwrap(),
    )
}

fn module(name: &str, dir: &Path, ctx: &Ctx) -> Arc<dyn Module> {
    match name {
        "agents" => agents(dir, ctx.bus.clone()),
        "todos" => Arc::new(todos::Todos::open(dir, ctx.bus.clone()).unwrap()),
        "pads" => Arc::new(pads::Pads::open(dir, ctx.bus.clone()).unwrap()),
        "messages" => Arc::new(
            messages::Messages::open_with(
                dir,
                ctx.bus.clone(),
                agents(dir, ctx.bus.clone()),
                messages::Env::system(ctx.touches.clone()),
            )
            .unwrap(),
        ),
        "checkpoints" => Arc::new(checkpoints::Checkpoints::open(dir).unwrap()),
        _ => unreachable!(),
    }
}

#[tokio::test]
async fn n20_current_store_opens() {
    // Each case exercises the real store interface and then reads through a fresh open.
    for (name, write, input, read, params, field, expected) in [
        (
            "agents",
            "rail.createWorkstream",
            json!({"name":"kept"}),
            "rail.tree",
            Value::Null,
            "name",
            "kept",
        ),
        (
            "todos",
            "todo.create",
            json!({"title":"kept"}),
            "todo.list",
            Value::Null,
            "title",
            "kept",
        ),
        (
            "pads",
            "pad.create",
            json!({"name":"kept","text":"payload"}),
            "pad.list",
            Value::Null,
            "text",
            "payload",
        ),
        (
            "messages",
            "message.send",
            json!({"to":"you","kind":"note","body":"kept"}),
            "message.list",
            json!({}),
            "body",
            "kept",
        ),
        (
            "checkpoints",
            "checkpoint.write",
            json!({"title":"kept","blocks":[{"kind":"text","text":"facts"}]}),
            "checkpoint.list",
            json!({"workstream":"door"}),
            "title",
            "kept",
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let ctx = Ctx {
            actor: if matches!(name, "messages" | "checkpoints") {
                Actor {
                    kind: ActorKind::Agent,
                    id: "door".into(),
                    parent: None,
                }
            } else {
                Actor::user()
            },
            bus: Bus::new(),
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
        };
        let store = module(name, dir.path(), &ctx);
        store.call(&ctx, write, input).await.unwrap();
        if name == "agents" {
            storage::write_ask(&rusqlite::Connection::open(dir.path().join("agents.db")).unwrap());
        }
        drop(store);
        let reopened = module(name, dir.path(), &ctx);
        let result = reopened.call(&ctx, read, params).await.unwrap();
        assert_eq!(result[0][field], expected, "{name}");
        if name == "agents" {
            let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
            storage::read_ask(&db);
            let mut memory = rusqlite::Connection::open_in_memory().unwrap();
            agents::schema::open(&mut memory, Path::new("agents")).unwrap();
            assert_eq!(storage::schema(&db), storage::schema(&memory));
        }
    }

    // Provenance is also used in memory by current callers.
    for memory in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("provenance.db");
        let touches = if memory {
            provenance::Touches::in_memory().unwrap()
        } else {
            provenance::Touches::open(&path).unwrap()
        };
        touches
            .record(&Actor::user(), Verb::Wrote, "pad:kept")
            .unwrap();
        let touches = if memory {
            touches
        } else {
            drop(touches);
            provenance::Touches::open(&path).unwrap()
        };
        let history = touches.history("pad:kept").unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].actor, Actor::user());
        assert_eq!(history[0].verb, Verb::Wrote);
    }

    // Digest's durable Pad cursor suppresses an already named Pad after reopen.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("digest.db");
    let nodes = serde_json::from_value::<Vec<contracts::agent::RailNode>>(json!([
        {"id":"door","kind":"workstream","name":"Door","attempt":"1","order":0,"can_resume":false,"stray":[]},
        {"id":"child","kind":"agent","name":"Child","parent":"door","status":{"kind":"done","label":"Done","since":0,"finished":"0"},"order":0,"can_resume":false,"stray":[]}
    ])).unwrap();
    let actor = Actor {
        kind: ActorKind::Agent,
        id: "door".into(),
        parent: None,
    };
    let pads = [contracts::pad::Pad {
        incarnation: "1".into(),
        name: "kept".into(),
        owner: Actor {
            kind: ActorKind::Agent,
            id: "child".into(),
            parent: Some("door".into()),
        },
        text: "payload".into(),
        updated_at: 42,
        revision: 1,
        home: Some("door".into()),
    }];
    let sources = messages::digest::Sources {
        nodes: &nodes,
        todos: &[],
        pads: &pads,
        messages: &[],
    };
    let seen = messages::digest::Seen::open(&path).unwrap();
    let first = serde_json::to_value(seen.ask(&actor, "door", &sources).unwrap()).unwrap();
    assert_eq!(first["children"][0]["pads"], json!(["kept"]));
    drop(seen);
    let seen = messages::digest::Seen::open(&path).unwrap();
    let reopened = serde_json::to_value(seen.ask(&actor, "door", &sources).unwrap()).unwrap();
    assert_eq!(reopened["children"][0]["pads"], json!([]));
}

fn legacy_agent(id: &str) -> String {
    json!({"kind": "agent", "id": id, "parent": null}).to_string()
}

/// Reopens the Project in this process and lists what a user sees of its Messages and Routes.
async fn reopened(dir: &Path, name: &str) -> (Value, Value) {
    let daemon = Arc::new(rupd::Daemon::open(dir).unwrap());
    let socket = dir.join(format!("{name}.sock"));
    let server = tokio::spawn(rupd::serve(
        tokio::net::UnixListener::bind(&socket).unwrap(),
        Arc::clone(&daemon),
    ));
    let client = rpc::Client::connect(&socket).await.unwrap();
    let messages = client.request("message.list", json!({})).await.unwrap();
    let routes = client.request("route.list", Value::Null).await.unwrap();
    assert_eq!(
        client.request("terminal.list", json!({})).await.unwrap(),
        json!([]),
        "an upgrade starts no Terminal"
    );
    server.abort();
    let _ = server.await;
    (messages, routes)
}

fn action_rows(db: &rusqlite::Connection) -> Vec<(i64, String, Vec<String>)> {
    let outcomes = |id: i64| -> Vec<String> {
        db.prepare("SELECT outcome FROM door_action_outcomes WHERE action = ?1 ORDER BY seq")
            .unwrap()
            .query_map([id], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    db.prepare("SELECT id, method FROM door_actions ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
        .unwrap()
        .map(|row| {
            let (id, method) = row.unwrap();
            (id, method, outcomes(id))
        })
        .collect()
}

#[tokio::test]
async fn b3563e_upgrade_preserves_messages_and_never_replays_old_actions() {
    let dir = tempfile::tempdir().unwrap();
    drop(rupd::Daemon::open(dir.path()).unwrap());

    // Make it the Project an older version left: the two latest migrations not yet run, Messages
    // behind each wait reason, both approval Routes, and Door actions waiting, started and done.
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    db.execute_batch(&format!("PRAGMA user_version = {}", version - 2))
        .unwrap();
    let user = json!({"kind": "user", "id": "you", "parent": null}).to_string();
    let message = |id,
                   from: &str,
                   to: &str,
                   status,
                   reason: Option<&str>,
                   reply_to: Option<i64>| {
        db.execute(
            "INSERT INTO messages (id, from_actor, to_id, kind, body, reply_to, status, reason, at, rank)
             VALUES (?1, ?2, ?3, 'note', ?4, ?5, ?6, ?7, 1, ?1)",
            rusqlite::params![id, from, to, format!("body {id}"), reply_to, status, reason],
        )
        .unwrap();
    };
    message(1, &legacy_agent("a"), "b", "pending", None, None);
    message(
        2,
        &legacy_agent("a"),
        "b",
        "held",
        Some("ask-first"),
        Some(1),
    );
    message(3, &user, "b", "held", Some("takeover"), None);
    message(4, &legacy_agent("c"), "b", "held", Some("inbox"), None);
    message(
        5,
        &legacy_agent("c"),
        "you",
        "held",
        Some("escalated"),
        None,
    );
    message(6, &legacy_agent("b"), "a", "delivered", None, Some(1));
    message(7, &user, "b", "dropped", Some("removed"), None);
    message(8, &legacy_agent("a"), "b", "pending", None, None);
    db.execute(
        "INSERT INTO message_flight (message_id, prompt) VALUES (8, 1)",
        [],
    )
    .unwrap();
    for (from, to, delivery) in [
        ("a", "b", "ask-first"),
        ("c", "b", "drop"),
        ("d", "b", "ask-first"),
    ] {
        db.execute(
            "INSERT INTO routes (from_id, to_id, delivery, set_by) VALUES (?1, ?2, ?3, ?1)",
            rusqlite::params![from, to, delivery],
        )
        .unwrap();
    }
    for (id, method, outcome) in [
        (
            1,
            "terminal.write",
            Some(r#"{"status":"waiting","reason":"takeover"}"#),
        ),
        (2, "agent.interrupt", Some(r#"{"status":"in-progress"}"#)),
        (3, "agent.stop", Some(r#"{"status":"completed"}"#)),
        (
            4,
            "agent.prompt",
            Some(r#"{"status":"dropped","reason":"takeover ended"}"#),
        ),
        (5, "rail.rename", None),
    ] {
        db.execute(
            "INSERT INTO door_actions (id, actor, agent, method, params) VALUES (?1, ?2, 'b', ?3, '{}')",
            rusqlite::params![id, legacy_agent("door"), method],
        )
        .unwrap();
        if let Some(outcome) = outcome {
            db.execute(
                "INSERT INTO door_action_outcomes (action, outcome) VALUES (?1, ?2)",
                rusqlite::params![id, outcome],
            )
            .unwrap();
        }
    }
    let before = action_rows(&db);
    drop(db);

    let (first, routes) = reopened(dir.path(), "first").await;
    let listed: Vec<(u64, &str, &str, Option<u64>)> = first
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            let (id, status) = (m["id"].as_u64().unwrap(), m["status"].as_str().unwrap());
            // Their receiver is no Agent of this Project, so the reopened Daemon may already have
            // dropped a wait as `receiver gone` (B8); none stays in a retired state.
            let status = match (status, m["reason"].as_str()) {
                ("dropped", Some("receiver gone")) if [1, 2, 3, 4, 8].contains(&id) => "pending",
                _ => status,
            };
            (
                id,
                m["body"].as_str().unwrap(),
                status,
                m["replyTo"].as_u64(),
            )
        })
        .collect();
    assert_eq!(
        listed,
        [
            (1, "body 1", "pending", None),
            (2, "body 2", "pending", Some(1)),
            (3, "body 3", "pending", None),
            (4, "body 4", "pending", None),
            (5, "body 5", "dropped", None),
            (6, "body 6", "delivered", Some(1)),
            (7, "body 7", "dropped", None),
            (8, "body 8", "pending", None),
        ]
    );
    assert_eq!(
        routes,
        json!([
            {"from": "a", "to": "b", "delivery": "auto"},
            {"from": "c", "to": "b", "delivery": "drop"},
            {"from": "d", "to": "b", "delivery": "auto"},
        ])
    );
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    let after = action_rows(&db);
    drop(db);
    let failed = r#"{"status":"dropped","reason":"deferred execution was removed"}"#;
    assert_eq!(
        after
            .iter()
            .map(|(id, method, outcomes)| (
                *id,
                method.as_str(),
                outcomes.len() - before[*id as usize - 1].2.len()
            ))
            .collect::<Vec<_>>(),
        [
            (1, "terminal.write", 1),
            (2, "agent.interrupt", 1),
            (3, "agent.stop", 0),
            (4, "agent.prompt", 0),
            (5, "rail.rename", 1),
        ],
        "only the waiting, started and unrecorded actions get an outcome"
    );
    for (id, outcomes) in [(1, 1), (2, 1), (5, 0)] {
        assert_eq!(after[id - 1].2.last().unwrap(), failed);
        assert_eq!(
            &after[id - 1].2[..outcomes],
            &before[id - 1].2[..],
            "earlier outcomes stay"
        );
    }
    assert_eq!(
        after[2].2, before[2].2,
        "a completed action is not repeated"
    );

    // A second open changes nothing.
    let (second, second_routes) = reopened(dir.path(), "second").await;
    assert_eq!((second, second_routes), (first, routes));
    let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
    assert_eq!(action_rows(&db), after);
}
