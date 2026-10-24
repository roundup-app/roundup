//! N16–N17: one Project migration sequence in `project.db`; older per-store databases are never read.
use std::path::Path;

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

const ANSWERS: &str = include_str!("../../agents/migrations/003/up.sql");
const ASKS: &str = include_str!("../../agents/migrations/004/up.sql");
const RESIZES: &str = include_str!("../migrations/003/up.sql");

const PAD_REVISIONS: &str = include_str!("../../pads/migrations/002/up.sql");
const ACTIONS: &str = include_str!("../migrations/005/up.sql");
const MCP: &str = include_str!("../../agents/migrations/005/up.sql");

const EVENTS: &str = include_str!("../migrations/006/up.sql");
const FLIGHT: &str = include_str!("../../messages/migrations/002/up.sql");
const WAKES: &str = include_str!("../../messages/migrations/003/up.sql");

const SCHEMA: &str = include_str!("../migrations/001/up.sql");

mod added {
    include!(concat!(env!("OUT_DIR"), "/added_migrations.rs"));
}

/// The frozen head (1 to 10), then every `migrations/project/*.sql` that `build.rs` found.
fn migrations() -> Vec<M<'static>> {
    let head = [
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
    ];
    head.into_iter()
        .chain(added::ADDED.iter().copied())
        .map(M::up)
        .collect()
}

pub(crate) fn open(dir: &Path) -> rusqlite::Result<()> {
    let path = dir.join("project.db");
    let run = || -> rusqlite::Result<()> {
        let mut db = Connection::open(&path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        apply(&mut db, migrations())
    };
    run().map_err(|e| error(format!("{}: {e}", path.display())))
}

fn apply(db: &mut Connection, migrations: Vec<M<'_>>) -> rusqlite::Result<()> {
    let count = migrations.len();
    Migrations::new(migrations)
        .to_latest(db)
        .map_err(|e| error(format!("migration through {count}: {e}")))
}

fn error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(message.into())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    const STORES: [&str; 7] = [
        "agents",
        "todos",
        "pads",
        "provenance",
        "messages",
        "digest",
        "checkpoints",
    ];

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
                .position(|sql| {
                    *sql == include_str!("../migrations/project/0022-workstream-auto.sql")
                })
                .unwrap();
        Migrations::new(migrations())
            .to_version(&mut db, before_auto)
            .unwrap();
        db.execute(
            "INSERT INTO nodes(kind,name,ord) VALUES('workstream','Before Auto',0)",
            [],
        )
        .unwrap();
        drop(db);
        let upgraded = crate::tests::daemon_in(dir.path());
        let reply = crate::tests::ask(&upgraded, r#"{"id":1,"method":"rail.list"}"#).await;
        assert_eq!(reply["result"][0]["auto"], false);
    }

    #[tokio::test]
    async fn u3016m_measurement_store_has_no_token_or_money_and_reopens_with_the_same_time() {
        use serde_json::json;
        let dir = tempfile::tempdir().unwrap();
        let mut db = Connection::open(dir.path().join("project.db")).unwrap();
        let before = 10
            + added::ADDED
                .iter()
                .position(|sql| {
                    *sql == include_str!(
                        "../migrations/project/0023-measurement-no-tokens-or-money.sql"
                    )
                })
                .unwrap();
        Migrations::new(migrations())
            .to_version(&mut db, before)
            .unwrap();
        let attempt = r#"{"kind":"observed","activity":{"kind":"attempt"},"clock_lifetime":"c","start":{"unix_ms":1000,"monotonic_ns":"0"},"segments":[{"start":{"unix_ms":1000,"monotonic_ns":"0"},"end":{"unix_ms":3000,"monotonic_ns":"2000000000"}}],"state":{"kind":"ended","at":{"unix_ms":3000,"monotonic_ns":"2000000000"}}}"#;
        for (identity, value) in [
            ("roundup:attempt:1:1", attempt.to_string()),
            (
                "request:r",
                format!(
                    r#"{{"kind":"request","usage":{{"input":1,"output":2,"{}_read":3,"{}_write":4}},"cost":null}}"#,
                    "cache", "cache"
                ),
            ),
            (
                "money:s",
                format!(
                    r#"{{"kind":"money","reported":{{"scope":"conversation","amount":"1","{}":"USD","source":"s","basis":"b"}}}}"#,
                    ["curr", "ency"].concat()
                ),
            ),
        ] {
            db.execute(
                "INSERT INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES(?1,'1','roundup:1','1','1','2','maker',1000,?2,'[]')",
                params![identity, value],
            )
            .unwrap();
        }
        drop(db);
        let reopened = crate::tests::daemon_in(dir.path());
        let reply =
            crate::tests::ask(&reopened, r#"{"id":1,"method":"project.measurements"}"#).await;
        let facts = reply["result"]["time_evidence"].as_array().unwrap();
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0]["identity"], "roundup:attempt:1:1");
        assert_eq!(reply["result"]["contributions"], json!([]));
        let db = Connection::open(dir.path().join("project.db")).unwrap();
        let tables: Vec<String> = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'measurement%'",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(tables.iter().all(|t| !t.contains("request")), "{tables:?}");
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

    #[test]
    fn n2705a_an_added_migration_preserves_messages_and_routes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        let mut db = Connection::open(&path).unwrap();
        let mut preceding = migrations();
        preceding.truncate(preceding.len() - 1);
        apply(&mut db, preceding).unwrap();
        db.execute_batch(
            r#"INSERT INTO messages
                (id, from_actor, to_id, kind, body, reply_to, status, reason, at,
                 rank, receiver_attempt, receiver_revision, passed_from)
               VALUES (31, '{"kind":"agent","id":"7013","parent":null}', '7014',
                       'note', 'preserved Message', 29, 'queued', 'preserved reason',
                       12345, 2, 3, 4, 28);
               INSERT INTO routes(from_id, to_id, delivery, set_by)
               VALUES ('7013', '7014', 'ask-first', '7013');"#,
        )
        .unwrap();
        let rows = |db: &Connection, table: &str| -> Vec<Vec<rusqlite::types::Value>> {
            db.prepare(&format!("SELECT * FROM {table}"))
                .unwrap()
                .query_map([], |r| {
                    (0..r.as_ref().column_count()).map(|i| r.get(i)).collect()
                })
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        let message = rows(&db, "messages");
        let route = rows(&db, "routes");
        drop(db);
        open(dir.path()).unwrap();
        let db = Connection::open(&path).unwrap();
        let count: i64 = db
            .query_row("SELECT count(*) FROM message_sender_names", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(rows(&db, "messages"), message);
        assert_eq!(rows(&db, "routes"), route);
        db.execute(
            "INSERT INTO message_sender_names(agent, name) VALUES ('7013', 'sad')",
            [],
        )
        .unwrap();
        drop(db);
        open(dir.path()).unwrap();
        let db = Connection::open(path).unwrap();
        let names: Vec<(String, String)> = db
            .prepare("SELECT agent, name FROM message_sender_names")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(names, [("7013".to_owned(), "sad".to_owned())]);
        assert_eq!(rows(&db, "messages"), message);
        assert_eq!(rows(&db, "routes"), route);
    }

    /// U3078a/b: an existing version-24 Project must gain evidence storage on upgrade.
    #[tokio::test]
    async fn u3078a_main_database_upgrade_keeps_progress_readable() {
        use contracts::Actor;
        use serde_json::json;

        let dir = tempfile::tempdir().unwrap();
        let mut db = Connection::open(dir.path().join("project.db")).unwrap();
        // Pin main's released sequence, independently of the candidate's added-file order.
        let released = [
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
            include_str!("../migrations/project/0014-reaction-firing-identities.sql"),
        ];
        apply(
            &mut db,
            migrations()
                .into_iter()
                .take(10)
                .chain(released.into_iter().map(M::up))
                .collect(),
        )
        .unwrap();
        drop(db);

        let daemon = crate::test_daemon(dir.path()).unwrap();
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = crate::Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        let home = daemon
            .route(
                &mut conn,
                "rail.createWorkstream",
                json!({"name":"Kept work"}),
            )
            .await
            .unwrap();
        let instructions = daemon
            .route(&mut conn, "agent.instructions", json!({"id":home["id"]}))
            .await
            .unwrap();
        let progress = daemon
            .route(
                &mut conn,
                "message.progress",
                json!({"project":daemon.project,"id":home["id"]}),
            )
            .await
            .unwrap();
        assert_eq!(progress["instructions"], instructions);
        assert_eq!(progress["results"], json!([]));
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
            let initialize = match name {
                "agents" => agents::schema::open,
                "todos" => todos::schema::open,
                "pads" => pads::schema::open,
                "provenance" => provenance::schema::open,
                "messages" => messages::schema::open,
                "digest" => messages::digest_schema::open,
                "checkpoints" => checkpoints::schema::open,
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
            "CREATETABLEmessage_sender_names(agentTEXTPRIMARYKEYNOTNULL,nameTEXTNOTNULL)"
                .to_owned(),
        );
        // Publications extend the Project owner, rather than a second standalone store.
        resize_schema
            .execute_batch(include_str!("../migrations/project/0004-deliverables.sql"))
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
                "../migrations/project/0013-instruction-messages.sql"
            ))
            .unwrap();
        expected.extend(standalone::schema(&resize_schema));
        let actual: std::collections::BTreeMap<_, _> =
            standalone::schema(&db).into_iter().collect();
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
            json!({"from":"you","to":ws,"delivery":"ask-first"}),
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
        daemon.modules["checkpoint"]
            .call(
                &ctx,
                "checkpoint.write",
                json!({"title":"kept Checkpoint","blocks":[{"kind":"text","text":"facts"}]}),
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
        db.execute(
            "UPDATE pads SET owner=?,home=?",
            params![
                serde_json::to_string(&Actor {
                    kind: contracts::ActorKind::Agent,
                    id: child,
                    parent: Some(ws.clone())
                })
                .unwrap(),
                ws
            ],
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
        assert_eq!(
            call(&daemon, "checkpoint.list", json!({"workstream":ws})).await[0]["title"],
            "kept Checkpoint"
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
            "ask-first"
        );
    }

    /// Compiles `build.rs` and runs it over the crate copy in `root`; returns the added list.
    fn generated(root: &Path) -> Vec<String> {
        use std::process::Command;
        let out = root.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let bin = out.join("build_rs");
        let built = Command::new("rustc")
            .args(["--edition", "2024", "-o"])
            .arg(&bin)
            .arg(root.join("crate/build.rs"))
            .status()
            .unwrap();
        assert!(built.success());
        let ran = Command::new(&bin)
            .env("CARGO_MANIFEST_DIR", root.join("crate"))
            .env("OUT_DIR", &out)
            .output()
            .unwrap();
        assert!(
            ran.status.success(),
            "{}",
            String::from_utf8_lossy(&ran.stderr)
        );
        std::fs::read_to_string(out.join("added_migrations.rs"))
            .unwrap()
            .lines()
            .filter_map(|l| l.trim().strip_prefix("include_str!(\""))
            .map(|l| {
                l.trim_end_matches("\"),")
                    .rsplit('/')
                    .next()
                    .unwrap()
                    .to_owned()
            })
            .collect()
    }

    fn crate_copy(root: &Path) {
        let src = Path::new(env!("CARGO_MANIFEST_DIR"));
        std::fs::create_dir_all(root.join("crate")).unwrap();
        std::fs::copy(src.join("build.rs"), root.join("crate/build.rs")).unwrap();
    }

    fn git(root: &Path, args: &[&str]) -> std::process::Output {
        std::process::Command::new("git")
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(root)
            .output()
            .unwrap()
    }

    fn add(root: &Path, name: &str) {
        let dir = root.join("crate/migrations/project");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(name),
            format!("CREATE TABLE t_{}(x);", &name[5..name.len() - 4]),
        )
        .unwrap();
        git(root, &["add", "."]);
        assert!(git(root, &["commit", "-m", name]).status.success());
    }

    /// N21: two branches each add one migration file; the merge is clean and both run, `a` first.
    #[test]
    fn n21_two_migrations_added_on_two_branches_merge_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        crate_copy(root);
        git(root, &["init", "-b", "main"]);
        git(root, &["add", "."]);
        assert!(git(root, &["commit", "-m", "base"]).status.success());
        git(root, &["checkout", "-b", "b"]);
        add(root, "0011-b.sql");
        git(root, &["checkout", "main"]);
        git(root, &["checkout", "-b", "a"]);
        add(root, "0011-a.sql");
        let merged = git(root, &["merge", "b", "-m", "merge"]);
        assert!(
            merged.status.success(),
            "{}",
            String::from_utf8_lossy(&merged.stdout)
        );
        assert!(
            git(root, &["diff", "--name-only", "--diff-filter=U"])
                .stdout
                .is_empty()
        );
        assert_eq!(generated(root), ["0011-a.sql", "0011-b.sql"]);
    }

    /// N21: files added out of order run after the head in name order, and a bad name fails the build.
    #[test]
    fn n21_a_migration_file_runs_after_the_head_in_name_order() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        crate_copy(root);
        git(root, &["init", "-b", "main"]);
        add(root, "0012-second.sql");
        add(root, "0011-first.sql");
        let names = generated(root);
        assert_eq!(names, ["0011-first.sql", "0012-second.sql"]);
        let base = migrations().len();
        let sql: Vec<String> = names
            .iter()
            .map(|n| {
                std::fs::read_to_string(root.join("crate/migrations/project").join(n)).unwrap()
            })
            .collect();
        let mut db = Connection::open_in_memory().unwrap();
        let all: Vec<M> = migrations()
            .into_iter()
            .chain(sql.iter().map(|s| M::up(s)))
            .collect();
        apply(&mut db, all).unwrap();
        let applied: i64 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied, i64::try_from(base).unwrap() + 2);
        let tables: i64 = db
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name IN ('t_first','t_second')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 2);
        std::fs::write(root.join("crate/migrations/project/notes.txt"), "").unwrap();
        let bad = std::process::Command::new(root.join("out/build_rs"))
            .env("CARGO_MANIFEST_DIR", root.join("crate"))
            .env("OUT_DIR", root.join("out"))
            .output()
            .unwrap();
        assert!(!bad.status.success());
        assert!(String::from_utf8_lossy(&bad.stderr).contains("notes.txt"));
    }

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
}
