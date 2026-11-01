//! N20 current-store reopen and N5467a older-store refusal.
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
    ] {
        let dir = tempfile::tempdir().unwrap();
        let ctx = Ctx {
            actor: if name == "messages" {
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
        text: "payload".into(),
        updated_at: 42,
        revision: 1,
        home: Some("door".into()),
    }];
    let sources = messages::digest::Sources {
        touches: vec![contracts::Touch {
            actor: Actor {
                kind: ActorKind::Agent,
                id: "child".into(),
                parent: None,
            },
            verb: contracts::Verb::Wrote,
            item: "pad:kept".into(),
            at: 42,
        }],
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

#[test]
fn n5467a_daemon_reports_the_reset_folder() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("project.db");
    let db = rusqlite::Connection::open(&path).unwrap();
    db.execute_batch("CREATE TABLE sentinel(value); INSERT INTO sentinel VALUES ('retained');")
        .unwrap();
    drop(db);
    for _ in 0..2 {
        let message = match rupd::Daemon::open(dir.path()) {
            Ok(_) => panic!("older data returned a usable Daemon"),
            Err(error) => error.to_string(),
        };
        assert!(
            message.contains("incompatible with this build"),
            "{message}"
        );
        assert!(message.contains(dir.path().to_str().unwrap()), "{message}");
        assert!(
            message.contains("close roundup") && message.contains("delete"),
            "{message}"
        );
        let db = rusqlite::Connection::open(&path).unwrap();
        assert_eq!(
            db.query_row("SELECT value FROM sentinel", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "retained"
        );
    }
}
