//! N16, U5740c: the Daemon over the Project schema `storage` owns.
use rusqlite::Connection;
use rusqlite_migration::Migrations;
use std::path::Path;

const STORES: [&str; 6] = [
    "agents",
    "todos",
    "pads",
    "provenance",
    "messages",
    "digest",
];

/// What the retired standalone Messages and Digest stores created, which the Project must still hold.
fn standalone_messages(current: &mut Connection, digest: bool) {
    let sql: &[&str] = if digest {
        &[
            include_str!("../../messages/migrations/001-digest/up.sql"),
            include_str!("../../messages/migrations/011-digest/up.sql"),
        ]
    } else {
        &[
            include_str!("../../messages/migrations/001/up.sql"),
            include_str!("../../messages/migrations/002/up.sql"),
            include_str!("../../messages/migrations/003/up.sql"),
            "CREATE TABLE message_sender_names (agent TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);",
            include_str!("../../messages/migrations/004/up.sql"),
            include_str!("../../messages/migrations/005/up.sql"),
            messages::evidence::SCHEMA,
            messages::continuation::SCHEMA,
            include_str!("../../messages/migrations/006/up.sql"),
            include_str!("../../messages/migrations/007/up.sql"),
            include_str!("../../messages/migrations/008/up.sql"),
            include_str!("../../messages/migrations/009/up.sql"),
            include_str!("../../messages/migrations/010/up.sql"),
            include_str!("../../messages/migrations/012/up.sql"),
        ]
    };
    for step in sql {
        current.execute_batch(step).unwrap();
    }
}

mod dump {
    include!("../../storage/src/tests/dump.rs");
}
use dump::{dump, dump_except};

mod standalone {
    include!("../tests/support/store_migrations.rs");
}

/// The Pads crate's migration files as a standalone store built them, for the expected schema.
fn pads_standalone(db: &mut Connection, _: &Path) -> rusqlite::Result<()> {
    use rusqlite_migration::M;
    Migrations::new(vec![
        M::up(include_str!("../../pads/migrations/001/up.sql")),
        M::up(include_str!("../../pads/migrations/002/up.sql")),
        M::up(include_str!("../../pads/migrations/003/up.sql")),
        M::up(include_str!("../../pads/migrations/004/up.sql")),
        M::up(include_str!("../../pads/migrations/005/up.sql")),
    ])
    .to_latest(db)
    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
}

// The prefix just before 0046-delete-reactions, the migration these tests retire tables with.
fn saved_prefix_before_reactions_retire() -> (tempfile::TempDir, Connection, usize) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Connection::open(dir.path().join("project.db")).unwrap();
    let prefix = storage::migrations().len() - 9;
    Migrations::new(storage::migrations()[..prefix].to_vec())
        .to_latest(&mut db)
        .unwrap();
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(5809,'workstream','saved work',7);
         INSERT INTO nodes(id,kind,name,ord) VALUES(5810,'workstream','more work',9);",
    )
    .unwrap();
    (dir, db, prefix)
}
#[tokio::test]
async fn n16_all_stores_share_one_project_database() {
    use crate::{Conn, Daemon};
    use contracts::Actor;
    use rpc::Ctx;
    use serde_json::{Value as Json, json};
    async fn call(daemon: &Daemon, method: &str, params: Json) -> Json {
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        daemon
            .route(
                &mut Conn {
                    actor: Actor::user(),
                    peer: None,
                    events,
                    output: None,
                },
                method,
                params,
            )
            .await
            .unwrap()
    }
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let main_files: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "db"))
        .collect();
    assert_eq!(main_files, [dir.path().join("project.db")]);
    let companions = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".db-wal") || name.ends_with(".db-shm"))
        .count();
    assert_eq!(companions, 2);
    let db = Connection::open(&main_files[0]).unwrap();
    let mut expected = std::collections::BTreeMap::new();
    for name in STORES {
        let mut current = Connection::open_in_memory().unwrap();
        if matches!(name, "messages" | "digest") {
            standalone_messages(&mut current, name == "digest");
            for (table, sql) in standalone::schema(&current) {
                expected.insert(table, sql);
            }
            continue;
        }
        let initialize: fn(&mut Connection, &Path) -> rusqlite::Result<()> = match name {
            "agents" => agents::schema::open,
            "todos" => todos_schema,
            "pads" => pads_standalone,
            "provenance" => {
                |db, _| db.execute_batch(include_str!("../../provenance/migrations/001/up.sql"))
            }
            _ => unreachable!(),
        };
        initialize(&mut current, Path::new(name)).unwrap();
        for (table, sql) in standalone::schema(&current) {
            let (table, sql) = if name == "pads" && table == "settings" {
                (
                    "pad_settings".to_owned(),
                    sql.replace("settings", "pad_settings"),
                )
            } else {
                (table, sql)
            };
            expected.insert(table, sql);
        }
    }
    let resize_schema = Connection::open_in_memory().unwrap();
    resize_schema
        .execute_batch(include_str!("../../storage/migrations/003/up.sql"))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    resize_schema
        .execute_batch(include_str!("../../storage/migrations/005/up.sql"))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    resize_schema
        .execute_batch(include_str!("../../storage/migrations/006/up.sql"))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    expected.insert(
        "message_sender_names".to_owned(),
        "CREATETABLEmessage_sender_names(agentTEXTPRIMARYKEYNOTNULL,nameTEXTNOTNULL)".to_owned(),
    );
    // Publications extend the Project owner, rather than a second standalone store.
    resize_schema
        .execute_batch(include_str!(
            "../../storage/migrations/project/0004-deliverables.sql"
        ))
        .unwrap();
    resize_schema
        .execute_batch(include_str!(
            "../../storage/migrations/project/0028-deliverable-files.sql"
        ))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    // Project-only retention observes the same Message admission/receipt transaction.
    resize_schema
        .execute_batch(include_str!("../../messages/migrations/001/up.sql"))
        .unwrap();
    resize_schema
        .execute_batch(include_str!("../../messages/migrations/002/up.sql"))
        .unwrap();
    resize_schema
        .execute_batch(include_str!(
            "../../storage/migrations/project/0034-door-session-restart.sql"
        ))
        .unwrap();
    resize_schema
        .execute_batch(include_str!(
            "../../storage/migrations/project/0013-instruction-messages.sql"
        ))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    let rail = include_str!("../../storage/migrations/project/0027-rail-deletions.sql");
    resize_schema.execute_batch(rail).unwrap();
    // B6506: the Messages' payload column is the one Project migration.
    resize_schema
        .execute_batch(include_str!(
            "../../storage/migrations/project/0052-message-payload.sql"
        ))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    let mut retention = Connection::open_in_memory().unwrap();
    agents::schema::open(&mut retention, Path::new("agents")).unwrap();
    retention
        .execute_batch(include_str!("../../messages/migrations/001/up.sql"))
        .unwrap();
    retention
        .execute_batch(include_str!("../../messages/migrations/002/up.sql"))
        .unwrap();
    retention
        .execute_batch(include_str!(
            "../../storage/migrations/project/0013-instruction-messages.sql"
        ))
        .unwrap();
    retention
        .execute_batch(include_str!(
            "../../storage/migrations/project/0033-coordination-instructions.sql"
        ))
        .unwrap();
    retention
        .execute_batch(include_str!(
            "../../storage/migrations/project/0041-user-order-instructions.sql"
        ))
        .unwrap();
    expected.extend(
        standalone::schema(&retention)
            .into_iter()
            .filter(|(name, _)| {
                name == "instruction_deliveries" || name.starts_with("instruction_message")
            }),
    );
    resize_schema
        .execute_batch(include_str!(
            "../../storage/migrations/project/0040-current-publications.sql"
        ))
        .unwrap();
    for name in [
        "deliverable_file_exclusive",
        "deliverable_blob_exclusive",
        "deliverable_blob_identity",
        "deliverable_bytes",
    ] {
        expected.remove(name);
    }
    // The standalone Agents store keeps its frozen head; the Project drops the answers table.
    expected.remove("decision_answers");
    expected.remove("decision_answers_agent");
    expected.remove("chains");
    expected.remove("iterations");
    let mut actual: std::collections::BTreeMap<_, _> =
        standalone::schema(&db).into_iter().collect();
    // The Project-only publication trigger is proved through the Daemon's U3787a RPC test.
    actual.remove("pad_publications_revoked");
    // DCL6: the Daemon's settlement markers have no standalone store; they are proved through its RPC.
    actual.remove("door_settlement");
    // M5159c: no migration drops the retired Checkpoint tables; no store creates or reads them.
    actual.remove("checkpoints");
    actual.remove("marks");
    assert_eq!(actual, expected);
    assert_eq!(
        Migrations::new(storage::migrations())
            .current_version(&db)
            .unwrap(),
        rusqlite_migration::SchemaVersion::Inside(
            std::num::NonZeroUsize::new(storage::migrations().len()).unwrap()
        )
    );
    standalone::write_ask(&db);
    let ws = call(
        &daemon,
        "rail.createWorkstream",
        json!({"name":"kept Workstream"}),
    )
    .await["id"]
        .as_str()
        .unwrap()
        .to_owned();
    call(&daemon, "todo.create", json!({"title":"kept Todo"})).await;
    call(
        &daemon,
        "pad.create",
        json!({"name":"kept Pad", "text":"persisted payload"}),
    )
    .await;
    call(
        &daemon,
        "route.set",
        json!({"from":"you","to":ws,"delivery":"drop"}),
    )
    .await;
    let ctx = Ctx {
        actor: Actor {
            kind: contracts::ActorKind::Agent,
            id: ws.clone(),
            parent: None,
        },
        bus: daemon.bus.clone(),
        touches: daemon.touches.clone(),
    };
    daemon.modules["message"]
        .call(
            &ctx,
            "message.send",
            json!({"to":"you","kind":"note","body":"kept Message"}),
        )
        .await
        .unwrap();
    // A stopped child is sufficient for Digest's persisted cursor; no Terminal or Message
    // delivery is needed to exercise that store's production write path.
    db.execute(
        "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent','stopped child',?,0)",
        [&ws],
    )
    .unwrap();
    let child = db.last_insert_rowid().to_string();
    db.execute("UPDATE pads SET home=?", [&ws]).unwrap();
    daemon
        .touches
        .record(
            &Actor {
                kind: contracts::ActorKind::Agent,
                id: child,
                parent: Some(ws.clone()),
            },
            contracts::Verb::Wrote,
            "pad:kept Pad",
        )
        .unwrap();
    db.execute("UPDATE nodes SET attempt=1 WHERE id=?", [&ws])
        .unwrap();
    let nodes: Vec<contracts::agent::RailNode> =
        serde_json::from_value(call(&daemon, "rail.tree", Json::Null).await).unwrap();
    let todos: Vec<contracts::todo::Todo> =
        serde_json::from_value(call(&daemon, "todo.list", Json::Null).await).unwrap();
    let pads: Vec<contracts::pad::Pad> =
        serde_json::from_value(call(&daemon, "pad.list", Json::Null).await).unwrap();
    let sources = messages::digest::Sources {
        completed: std::collections::HashMap::new(),
        project_key: "",
        touches: daemon.touches.history("pad:kept Pad").unwrap(),
        nodes: &nodes,
        todos: &todos,
        pads: &pads,
        messages: &[],
    };
    let first_digest =
        serde_json::to_value(daemon.digests.ask(&ctx.actor, &ws, &sources).unwrap()).unwrap();
    assert_eq!(first_digest["children"][0]["pads"], json!(["kept Pad"]));
    let door = ctx.actor.clone();
    let cursor: i64 = db
        .query_row("SELECT newest FROM pad_cursors WHERE door=?", [&ws], |r| {
            r.get(0)
        })
        .unwrap();
    let touch_sequence = daemon.touches.sequence().unwrap();
    assert!(touch_sequence > 0);
    drop(ctx);
    drop(daemon);
    drop(db);
    let daemon = crate::test_daemon(dir.path()).unwrap();
    let reopened_digest =
        serde_json::to_value(daemon.digests.ask(&door, &ws, &sources).unwrap()).unwrap();
    assert_eq!(reopened_digest["children"][0]["pads"], json!([]));
    assert_eq!(
        call(&daemon, "rail.tree", Json::Null).await[0]["name"],
        "kept Workstream"
    );
    assert_eq!(
        call(&daemon, "todo.list", Json::Null).await[0]["title"],
        "kept Todo"
    );
    assert_eq!(
        call(&daemon, "pad.list", Json::Null).await[0]["text"],
        "persisted payload"
    );
    assert_eq!(
        call(&daemon, "message.list", json!({})).await[0]["body"],
        "kept Message"
    );
    assert_eq!(daemon.touches.sequence().unwrap(), touch_sequence);
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    standalone::read_ask(&db);
    assert_eq!(
        db.query_row("SELECT newest FROM pad_cursors WHERE door=?", [&ws], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap(),
        cursor
    );
    assert_eq!(
        call(&daemon, "route.list", Json::Null).await[0]["delivery"],
        "drop"
    );
}

#[tokio::test]
async fn u5740c_current_project_drops_only_retired_tables() {
    let (dir, mut db, _) = saved_prefix_before_reactions_retire();
    db.execute_batch(r#"
        INSERT INTO nodes(id,kind,name,ord) VALUES(5900,'agent','Retained Agent',10);
        INSERT INTO todos(id,title,body,created_at) VALUES(5900,'Keep Todo','exact body',42);
        INSERT INTO pads(key,name,text,updated_at) VALUES('kept-pad','Keep Pad','exact text',43);
        INSERT INTO messages(id,from_actor,to_id,kind,body,status,at) VALUES
            (5901,'{"kind":"user","id":"you","parent":null}','you','note','ordinary message','delivered',45);
        INSERT INTO continuation_decisions(id,agent,request,payload,message,evidence)
            VALUES('decision-kept','5900','request-kept','payload-kept',5901,'evidence-kept');
        INSERT INTO continuation_actions(action,decision) VALUES('action-kept','decision-kept');
    "#).unwrap();
    db.execute("INSERT INTO messages(id,from_actor,to_id,kind,body,status,at) VALUES(5900,?1,'5900','note','accepted firing','pending',44)", [serde_json::to_string(&contracts::Actor::daemon()).unwrap()]).unwrap();
    let record = json_definition(&db);
    db.execute("INSERT INTO reactions(id,actor_key,operation,request,record) VALUES('retired','user:you','saved','request',?1)", [&record]).unwrap();
    db.execute(
        "INSERT INTO reaction_watch(reaction,state) VALUES('retired',?1)",
        [r#"{"seen":1,"finished":["5900"],"unfinished":[],"armed":false,"before_rearm":[],"round":1,"health":"matched","health_code":"matched","cause_code":"unknown","gap_code":"unknown","recovery_code":"unknown","cause":null,"gap":null,"recovery":null,"evidence":"accepted"}"#],
    )
    .unwrap();
    db.execute("INSERT INTO reaction_firings(id,reaction,operation,ordinal,message,matched,definition,evidence) VALUES('firing-kept','retired','auto-1',1,5900,1,?1,'accepted evidence')", [&record]).unwrap();
    // Kept replay must cross a full page of retired Events, keep original numbers,
    // and tolerate a retired final row without changing the persisted log.
    db.execute_batch(
        r#"
        INSERT INTO events(id,event) VALUES
            (1,'{"actor":{"kind":"user","id":"you"},"name":"rail.changed"}');
        WITH RECURSIVE numbers(id) AS (
            SELECT 2 UNION ALL SELECT id+1 FROM numbers WHERE id<1026
        ) INSERT INTO events(id,event)
            SELECT id,'{"actor":{"kind":"user","id":"you"},"name":"reaction.changed"}' FROM numbers;
        INSERT INTO events(id,event) VALUES
            (1027,'{"actor":{"kind":"user","id":"you"},"name":"rail.changed"}'),
            (1028,'{"actor":{"kind":"user","id":"you"},"name":"reaction.changed"}');
    "#,
    )
    .unwrap();
    let retained = |db: &Connection| {
        dump_except(
            db,
            &[
                "reaction_watch",
                "reaction_firings",
                "reactions",
                "reaction_project",
                "door_told",
                "push_intents",
                "push_slots",
            ],
        )
    };
    // 0046 runs here with the later migrations, so the open leaves the retained tables as they stand.
    Migrations::new(storage::migrations())
        .to_latest(&mut db)
        .unwrap();
    let before = retained(&db);
    drop(db);
    for _ in 0..2 {
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let db = Connection::open(dir.path().join("project.db")).unwrap();
        assert_eq!(retained(&db), before);
        for table in [
            "reaction_watch",
            "reaction_firings",
            "reactions",
            "reaction_project",
        ] {
            assert_eq!(
                db.query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE name=?1",
                    [table],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
                0
            );
        }
        let (events, _replay) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = crate::Conn {
            actor: contracts::Actor::user(),
            peer: None,
            events,
            output: None,
        };
        let answer = daemon
            .dispatch(
                &mut conn,
                r#"{"jsonrpc":"2.0","id":1,"method":"events.subscribe","params":{"kept":true}}"#,
                None,
            )
            .await
            .unwrap()
            .into_value()
            .unwrap();
        assert!(answer.get("error").is_none(), "{answer}");
        assert_eq!(answer["result"]["head"], 1028);
        let (saved, head) = daemon.bus.saved_after(0).unwrap();
        assert_eq!(head, 1028);
        assert_eq!(
            saved.iter().map(|event| event.seq).collect::<Vec<_>>(),
            [Some(1), Some(1027)]
        );
        assert!(
            saved
                .iter()
                .all(|event| matches!(event.data, contracts::EventData::RailChanged))
        );
        // Opening a persisted Agent never starts a Terminal/program or adds a Message.
        assert_eq!(daemon.terminals.list().await.len(), 0);
        assert_eq!(
            db.query_row("SELECT count(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
}

fn json_definition(db: &Connection) -> String {
    let project: String = db
        .query_row("SELECT id FROM reaction_project", [], |r| r.get(0))
        .unwrap();
    serde_json::json!({"project":project,"id":"retired","name":"Saved instruction","actor":{"kind":"user","id":"you","parent":null},"reason":"Wait for work","home":null,"target":"5900","instruction":"accepted firing","condition":{"kind":"agents","ids":["5900"],"any":false},"max_firings":1,"remaining":0,"rearm":false,"expires_at":"2099-01-01T00:00:00Z","created_at":"2026-11-01T00:00:00Z","state":"active","observation":{"health":"matched","health_code":"matched","cause_code":"unknown","gap_code":"unknown","recovery_code":"unknown","cursor":1,"cause":null,"gap":null,"recovery":null,"evidence":"accepted evidence","pinned_head":null},"firings":[]}).to_string()
}

#[test]
fn u5740c_other_representations_are_unchanged_on_refusal() {
    let dir = tempfile::tempdir().unwrap();
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    let prefix = 0;
    db.execute_batch("CREATE TABLE nodes(id INTEGER PRIMARY KEY, kind TEXT, name TEXT, ord INTEGER); INSERT INTO nodes VALUES(5900,'workstream','keep sentinel',3)")
    .unwrap();
    let before = dump(&db);
    drop(db);
    for _ in 0..2 {
        assert!(crate::test_daemon(dir.path()).is_err());
        let db = Connection::open(dir.path().join("project.db")).unwrap();
        assert_eq!(dump(&db), before);
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            prefix as i64
        );
    }
}

/// R3696c: these stores (Touches opens through `connect`, which reads the schema once) have no startup recovery and `storage::connect` already initialized WAL.
/// Holding SQLite's read lock closed detects an eager schema read without a timing threshold.
#[test]
fn r3696c_idle_project_stores_do_not_read_the_schema_on_open() {
    let dir = tempfile::tempdir().unwrap();
    storage::connect(dir.path()).unwrap();
    // N22: Pads, Todos and Touches all open through `storage::connect`, which checks the schema, so none stays idle under the lock.
    let bus = rpc::Bus::new();
    drop(pads::Pads::open(dir.path(), bus.clone()).unwrap());
    drop(todos::Todos::open(dir.path(), bus).unwrap());
    drop(provenance::Touches::open(dir.path()).unwrap());
}

/// The Todos migrations as the pre-N22 standalone store ran them.
fn todos_schema(db: &mut Connection, _: &Path) -> rusqlite::Result<()> {
    for sql in [
        include_str!("../../todos/migrations/001/up.sql"),
        include_str!("../../todos/migrations/002/up.sql"),
        include_str!("../../todos/migrations/003/up.sql"),
        include_str!("../../todos/migrations/004/up.sql"),
        include_str!("../../todos/migrations/005/up.sql"),
        include_str!("../../todos/migrations/006/up.sql"),
        include_str!("../../todos/migrations/007/up.sql"),
        include_str!("../../todos/migrations/009/up.sql"),
        include_str!("../../todos/migrations/010/up.sql"),
        include_str!("../../todos/migrations/011/up.sql"),
    ] {
        db.execute_batch(sql)?;
    }
    Ok(())
}
