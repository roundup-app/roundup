use super::*;
use rusqlite::params;

const STORES: [&str; 6] = [
    "agents",
    "todos",
    "pads",
    "provenance",
    "messages",
    "digest",
];

fn dump(db: &Connection) -> Vec<String> {
    let mut out = Vec::new();
    let mut q = db
        .prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name")
        .unwrap();
    let rows: Vec<(String, String, Option<String>)> = q
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    for (kind, name, sql) in rows {
        out.push(format!("{kind} {name} {sql:?}"));
        if kind == "table"
            && !name.starts_with("sqlite_")
            && name != "deliverable_project"
            && name != "reaction_project"
        {
            let mut s = db.prepare(&format!("SELECT * FROM \"{name}\"")).unwrap();
            let n = s.column_count();
            let mut rows = s.query([]).unwrap();
            while let Some(r) = rows.next().unwrap() {
                let row: Vec<String> = (0..n)
                    .map(|i| format!("{:?}", r.get_ref(i).unwrap()))
                    .collect();
                out.push(format!("{name}: {}", row.join("|")));
            }
        }
    }
    out
}

#[test]
fn r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    open(a.path()).unwrap();
    open(b.path()).unwrap();
    let migrated = tempfile::tempdir().unwrap();
    let mut db = Connection::open(migrated.path().join("project.db")).unwrap();
    let version = |d: &Connection| {
        d.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap()
    };
    apply(&mut db, migrations()).unwrap();
    let fresh = Connection::open(a.path().join("project.db")).unwrap();
    assert_eq!(version(&fresh), version(&db));
    assert_eq!(dump(&fresh), dump(&db));
    let id = |dir: &Path, table: &str| -> String {
        Connection::open(dir.join("project.db"))
            .unwrap()
            .query_row(&format!("SELECT id FROM {table}"), [], |r| r.get(0))
            .unwrap()
    };
    for table in ["deliverable_project", "reaction_project"] {
        let own = id(a.path(), table);
        assert_ne!(own, id(b.path(), table));
        assert!(own.len() == 32 && own.bytes().all(|c| c.is_ascii_hexdigit()));
    }
    let image = std::fs::read(a.path().join("project.db")).unwrap();
    for placeholder in IDENTITIES {
        assert!(!image.windows(32).any(|window| window == placeholder));
    }
}

mod standalone {
    include!("../tests/support/store_migrations.rs");
}

#[tokio::test]
async fn a3308_an_old_workstream_defaults_to_auto_off() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Connection::open(dir.path().join("project.db")).unwrap();
    let before_auto = 10
        + added::ADDED
            .iter()
            .position(|sql| *sql == include_str!("../migrations/project/0022-workstream-auto.sql"))
            .unwrap();
    Migrations::new(migrations())
        .to_version(&mut db, before_auto)
        .unwrap();
    db.execute(
        "INSERT INTO nodes(kind,name,ord) VALUES('workstream','Before Auto',0)",
        [],
    )
    .unwrap();
    // Exercise the SQL migration directly; normal opens refuse obsolete local data.
    apply(&mut db, migrations()).unwrap();
    drop(db);
    let upgraded = crate::tests::daemon_in(dir.path());
    let reply = crate::tests::ask(&upgraded, r#"{"id":1,"method":"rail.tree"}"#).await;
    assert_eq!(reply["result"][0]["auto"], false);
}

#[tokio::test]
async fn t19_main_project_upgrades_without_losing_todo_history() {
    use contracts::Actor;
    use rpc::Ctx;
    use serde_json::{Value, json};

    let dir = tempfile::tempdir().unwrap();
    let mut db = Connection::open(dir.path().join("project.db")).unwrap();
    // Freeze main 25e81a6d5's sequence: deriving it from migrations() would
    // hide an insertion that shifts an already-shipped SQLite version.
    let shipped = [
        SCHEMA,
        ANSWERS,
        RESIZES,
        ASKS,
        ACTIONS,
        PAD_REVISIONS,
        EVENTS,
        MCP,
        FLIGHT,
        WAKES,
        include_str!("../migrations/project/0001-prepared.sql"),
        include_str!("../migrations/project/0002-message-sender-names.sql"),
        include_str!("../migrations/project/0003-pad-sources.sql"),
        include_str!("../migrations/project/0004-deliverables.sql"),
        include_str!("../migrations/project/0005-ask-submissions.sql"),
        include_str!("../migrations/project/0006-closed-sources.sql"),
        include_str!("../migrations/project/0007-todo-owner.sql"),
        include_str!("../migrations/project/0008-reactions.sql"),
        include_str!("../migrations/project/0009-reaction-firings.sql"),
        include_str!("../migrations/project/0010-reaction-watch.sql"),
        include_str!("../migrations/project/0011-measurements.sql"),
        include_str!("../migrations/project/0012-instruction-revisions.sql"),
        include_str!("../migrations/project/0013-instruction-messages.sql"),
    ];
    apply(&mut db, shipped.into_iter().map(M::up).collect()).unwrap();
    db.execute_batch(
        r#"INSERT INTO todos(id,title,body,done,created_at)
           VALUES(1,'shipped Todo','kept body',1,42);
           INSERT INTO changes(todo,after_values,after_touch)
           VALUES(1,'{"title":"shipped Todo","body":"kept body","done":true,"blockers":[]}',0);"#,
    )
    .unwrap();
    // Exercise the SQL migration directly; normal opens refuse obsolete local data.
    apply(&mut db, migrations()).unwrap();
    drop(db);

    let daemon = crate::test_daemon(dir.path()).unwrap();
    let ctx = Ctx {
        actor: Actor::user(),
        bus: daemon.bus.clone(),
        touches: daemon.touches.clone(),
    };
    let todos = &daemon.modules["todo"];
    let history = todos
        .call(&ctx, "todo.getHistory", json!({"id":1}))
        .await
        .unwrap();
    assert_eq!(history["changes"].as_array().unwrap().len(), 1);
    assert_eq!(history["changes"][0]["actor"], Value::Null);
    assert_eq!(history["changes"][0]["after"]["done"], true);
    let reopened = todos
        .call(&ctx, "todo.reopen", json!({"id":1}))
        .await
        .unwrap();
    assert_eq!(reopened["id"], 1);
    assert_eq!(reopened["title"], "shipped Todo");
    assert_eq!(reopened["body"], "kept body");
    assert_eq!(reopened["done"], false);
    let history = todos
        .call(&ctx, "todo.getHistory", json!({"id":1}))
        .await
        .unwrap();
    assert_eq!(history["changes"].as_array().unwrap().len(), 2);
    assert_eq!(history["changes"][1]["actor"], json!(Actor::user()));
    assert_eq!(history["changes"][1]["before"]["done"], true);
    assert_eq!(history["changes"][1]["after"]["done"], false);
}

#[test]
fn n2705a_sender_names_reject_nulls_and_duplicate_identities() {
    let dir = tempfile::tempdir().unwrap();
    open(dir.path()).unwrap();
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    db.execute(
        "INSERT INTO message_sender_names(agent, name) VALUES ('7013', 'sad')",
        [],
    )
    .unwrap();
    for (agent, name) in [
        (None, Some("sad")),
        (Some("7014"), None),
        (Some("7013"), Some("glad")),
    ] {
        let error = db
            .execute(
                "INSERT INTO message_sender_names(agent, name) VALUES (?1, ?2)",
                params![agent, name],
            )
            .unwrap_err();
        assert_eq!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::ConstraintViolation)
        );
    }
}

#[test]
fn n2705a_updated_names_survive_project_reopen() {
    let dir = tempfile::tempdir().unwrap();
    open(dir.path()).unwrap();
    let path = dir.path().join("project.db");
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "INSERT INTO message_sender_names(agent, name) VALUES ('7013', 'sad');
         UPDATE message_sender_names SET name = 'glad' WHERE agent = '7013';
         INSERT INTO message_sender_names(agent, name) VALUES ('7014', 'glad');",
    )
    .unwrap();
    drop(db);
    open(dir.path()).unwrap();
    let db = Connection::open(path).unwrap();
    let rows: Vec<(String, String)> = db
        .prepare("SELECT agent, name FROM message_sender_names ORDER BY agent")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(
        rows,
        [
            ("7013".to_owned(), "glad".to_owned()),
            ("7014".to_owned(), "glad".to_owned())
        ]
    );
}

/// U3078a/b: an existing version-24 Project must gain evidence storage on upgrade.
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
        let initialize = match name {
            "agents" => agents::schema::open,
            "todos" => todos::schema::open,
            "pads" => pads::schema::open,
            "provenance" => provenance::schema::open,
            "messages" => messages::schema::open,
            "digest" => messages::digest_schema::open,
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
    resize_schema.execute_batch(RESIZES).unwrap();
    expected.extend(standalone::schema(&resize_schema));
    resize_schema.execute_batch(ACTIONS).unwrap();
    expected.extend(standalone::schema(&resize_schema));
    resize_schema.execute_batch(EVENTS).unwrap();
    expected.extend(standalone::schema(&resize_schema));
    expected.insert(
        "message_sender_names".to_owned(),
        "CREATETABLEmessage_sender_names(agentTEXTPRIMARYKEYNOTNULL,nameTEXTNOTNULL)".to_owned(),
    );
    // Publications extend the Project owner, rather than a second standalone store.
    resize_schema
        .execute_batch(include_str!("../migrations/project/0004-deliverables.sql"))
        .unwrap();
    resize_schema
        .execute_batch(include_str!(
            "../migrations/project/0028-deliverable-files.sql"
        ))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    resize_schema
        .execute_batch(include_str!("../migrations/project/0008-reactions.sql"))
        .unwrap();
    resize_schema
        .execute_batch(include_str!(
            "../migrations/project/0010-reaction-watch.sql"
        ))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    // Project-only retention observes the same Message admission/receipt transaction.
    resize_schema
        .execute_batch(include_str!("../../messages/migrations/001/up.sql"))
        .unwrap();
    resize_schema.execute_batch(FLIGHT).unwrap();
    resize_schema
        .execute_batch(include_str!(
            "../migrations/project/0034-door-session-restart.sql"
        ))
        .unwrap();
    resize_schema
        .execute_batch(include_str!(
            "../migrations/project/0013-instruction-messages.sql"
        ))
        .unwrap();
    expected.extend(standalone::schema(&resize_schema));
    let rail = include_str!("../migrations/project/0027-rail-deletions.sql");
    resize_schema.execute_batch(rail).unwrap();
    expected.extend(standalone::schema(&resize_schema));
    let mut retention = Connection::open_in_memory().unwrap();
    agents::schema::open(&mut retention, Path::new("agents")).unwrap();
    retention
        .execute_batch(include_str!("../../messages/migrations/001/up.sql"))
        .unwrap();
    retention.execute_batch(FLIGHT).unwrap();
    retention
        .execute_batch(include_str!(
            "../migrations/project/0013-instruction-messages.sql"
        ))
        .unwrap();
    retention
        .execute_batch(include_str!(
            "../migrations/project/0033-coordination-instructions.sql"
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
            "../migrations/project/0039-current-publications.sql"
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
    // M5159c: no migration drops the retired Checkpoint tables; no store creates or reads them.
    actual.remove("checkpoints");
    actual.remove("marks");
    assert_eq!(actual, expected);
    assert_eq!(
        Migrations::new(migrations()).current_version(&db).unwrap(),
        rusqlite_migration::SchemaVersion::Inside(
            std::num::NonZeroUsize::new(migrations().len()).unwrap()
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

#[path = "storage_tests/migration_files.rs"]
mod migration_files;

/// N17: a data folder from before `project.db` still holds per-store databases, one of them
/// in a column order no current build writes. They are not read, so they cannot block startup.
#[test]
fn n17_old_store_files_never_block_the_open() {
    let dir = tempfile::tempdir().unwrap();
    let old = dir.path().join("agents.db");
    Connection::open(&old)
        .unwrap()
        .execute_batch(
            "CREATE TABLE nodes (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, creator TEXT, spawn_prompt TEXT);
             INSERT INTO nodes VALUES (1,'agent','a','p');",
        )
        .unwrap();
    std::fs::write(dir.path().join("todos.db"), b"not a database").unwrap();
    let before = std::fs::read(&old).unwrap();
    open(dir.path()).unwrap();
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    let nodes: i64 = db
        .query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(nodes, 0);
    assert_eq!(std::fs::read(&old).unwrap(), before);
}

/// R3696c: these stores have no startup recovery and `storage::open` already initialized WAL.
/// Holding SQLite's read lock closed detects an eager schema read without a timing threshold.
#[test]
fn r3696c_idle_project_stores_do_not_read_the_schema_on_open() {
    let dir = tempfile::tempdir().unwrap();
    let db = open(dir.path()).unwrap();
    db.pragma_update(None, "locking_mode", "EXCLUSIVE").unwrap();
    db.execute_batch("BEGIN EXCLUSIVE").unwrap();
    let path = dir.path().join("project.db");
    let bus = rpc::Bus::new();
    let _touches = provenance::Touches::open(&path).expect("Touches must not read the schema yet");
    let _todos =
        todos::Todos::open(dir.path(), bus.clone()).expect("Todos must not read the schema yet");
    let _pads = pads::Pads::open(dir.path(), bus).expect("Pads must not read the schema yet");
}
