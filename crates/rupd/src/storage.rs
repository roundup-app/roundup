//! N16–N17: one Project migration sequence, with verified legacy snapshots before recovery.
use std::path::Path;
use std::sync::Arc;

use rusqlite::{Connection, OpenFlags, params, params_from_iter, types::Value};
use rusqlite_migration::{HookError, M, Migrations};

const STORES: [&str; 7] = [
    "agents",
    "todos",
    "pads",
    "provenance",
    "messages",
    "digest",
    "checkpoints",
];
type Observer = Arc<dyn Fn(&str, &Connection) -> rusqlite::Result<()> + Send + Sync>;

pub(crate) fn open(dir: &Path) -> rusqlite::Result<()> {
    open_with(dir, Arc::new(|_, _| Ok(())))
}

fn open_with(dir: &Path, observe: Observer) -> rusqlite::Result<()> {
    let path = dir.join("project.db");
    let run = || -> rusqlite::Result<()> {
        let mut db = Connection::open(&path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        // Refuse an unrelated or partially constructed unmarked destination. Our first migration
        // and its copied marker commit together, so a killed import never needs this exception.
        let tables: i64 = db.query_row(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        )?;
        let marked = db
            .prepare("SELECT 1 FROM sqlite_schema WHERE name = 'project_import'")?
            .exists([])?;
        if tables != 0 && !marked {
            return Err(error("conflicting unmarked destination"));
        }
        let source_dir = dir.to_owned();
        let before = Arc::clone(&observe);
        apply(
            &mut db,
            vec![M::up_with_hook(
                SCHEMA,
                move |tx: &rusqlite::Transaction<'_>| {
                    tx.pragma_update(None, "defer_foreign_keys", true)?;
                    before("before_copy", tx)?;
                    for name in STORES {
                        let source = source_dir.join(format!("{name}.db"));
                        if !source.try_exists().map_err(|e| {
                            HookError::Hook(format!("source {}: {e}", source.display()))
                        })? {
                            continue;
                        }
                        let snapshot = snapshot(&source, name)?;
                        copy(&snapshot, tx, name)
                            .map_err(|e| error(format!("source {}: {e}", source.display())))?;
                        verify(&snapshot, tx, name)?;
                        tx.execute("INSERT INTO project_import_sources VALUES (?)", [name])?;
                    }
                    integrity(tx)?;
                    before("before_commit", tx)?;
                    Ok(())
                },
            )],
        )?;
        let verified: bool =
            db.query_row("SELECT verified FROM project_import WHERE id=0", [], |r| {
                r.get(0)
            })?;
        if !verified {
            observe("after_commit", &db)?;
            let names = db
                .prepare("SELECT name FROM project_import_sources ORDER BY name")?
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            for name in names {
                let source = dir.join(format!("{name}.db"));
                let snapshot = snapshot(&source, &name)?;
                verify(&snapshot, &db, &name)?;
            }
            integrity(&db)?;
            db.execute("UPDATE project_import SET verified=1 WHERE id=0", [])?;
            observe("after_verification", &db)?;
        }
        Ok(())
    };
    run().map_err(|e| error(format!("{}: {e}", path.display())))
}

const SCHEMA: &str = include_str!("../migrations/001/up.sql");

fn apply(db: &mut Connection, migrations: Vec<M<'_>>) -> rusqlite::Result<()> {
    let count = migrations.len();
    Migrations::new(migrations)
        .to_latest(db)
        .map_err(|e| error(format!("migration through {count}: {e}")))
}

fn error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(message.into())))
}

fn snapshot(path: &Path, name: &str) -> rusqlite::Result<Connection> {
    let read = || -> rusqlite::Result<Connection> {
        let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let mut snapshot = Connection::open_in_memory()?;
        // SQLite's backup reads committed WAL frames as well as the main database. The legacy
        // migration runs on the snapshot, never on the retained source or its WAL companions.
        rusqlite::backup::Backup::new(&source, &mut snapshot)?.run_to_completion(
            128,
            std::time::Duration::ZERO,
            None,
        )?;
        integrity(&snapshot)?;
        let migrate = match name {
            "agents" => agents::schema::open,
            "todos" => todos::schema::open,
            "pads" => pads::schema::open,
            "provenance" => provenance::schema::open,
            "messages" => messages::schema::open,
            "digest" => messages::digest_schema::open,
            "checkpoints" => checkpoints::schema::open,
            _ => return Err(error(format!("unknown import source {name}"))),
        };
        migrate(&mut snapshot, path)?;
        Ok(snapshot)
    };
    read().map_err(|e| error(format!("source {}: {e}", path.display())))
}

fn integrity(db: &Connection) -> rusqlite::Result<()> {
    let check: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(error(check));
    }
    if db.prepare("PRAGMA foreign_key_check")?.exists([])? {
        return Err(error("foreign key verification failed"));
    }
    Ok(())
}

fn tables(db: &Connection) -> rusqlite::Result<Vec<String>> {
    db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?
        .query_map([], |r| r.get(0))?.collect()
}

fn target<'a>(name: &str, table: &'a str) -> &'a str {
    if name == "pads" && table == "settings" {
        "pad_settings"
    } else {
        table
    }
}

fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn rows(db: &Connection, table: &str) -> rusqlite::Result<Vec<Vec<Value>>> {
    let mut query = db.prepare(&format!("SELECT * FROM {}", quote(table)))?;
    let count = query.column_count();
    // Order by every stored value; primary keys are included, so row order never hides a
    // mismatched reference or payload. Values stay typed (including blobs and NULLs).
    let order = (1..=count)
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    query = db.prepare(&format!("SELECT * FROM {} ORDER BY {order}", quote(table)))?;
    query
        .query_map([], |r| (0..count).map(|i| r.get(i)).collect())?
        .collect()
}

fn copy(source: &Connection, db: &Connection, name: &str) -> rusqlite::Result<()> {
    for table in tables(source)? {
        let destination = target(name, &table);
        // Old Pad bindings are consumed by normal runtime recovery, after import verification.
        if name == "pads" && table == "scribes" {
            db.execute_batch(include_str!("../migrations/001/scribes.sql"))?;
        }
        let source_columns = source.prepare(&format!("SELECT * FROM {} LIMIT 0", quote(&table)))?;
        let destination_columns =
            db.prepare(&format!("SELECT * FROM {} LIMIT 0", quote(destination)))?;
        if source_columns.column_names() != destination_columns.column_names() {
            return Err(error(format!("{name}.{table}: column verification failed")));
        }
        let columns = source_columns
            .column_names()
            .iter()
            .map(|c| quote(c))
            .collect::<Vec<_>>()
            .join(",");
        let placeholders = vec!["?"; source_columns.column_count()].join(",");
        let mut insert = db.prepare(&format!(
            "INSERT INTO {} ({columns}) VALUES ({placeholders})",
            quote(destination)
        ))?;
        for row in rows(source, &table)? {
            insert.execute(params_from_iter(row))?;
        }
    }
    if source
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'")?
        .exists([])?
    {
        let sequences = source
            .prepare("SELECT name, seq FROM sqlite_sequence")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (table, seq) in sequences {
            let destination = target(name, &table);
            db.execute("DELETE FROM sqlite_sequence WHERE name=?", [destination])?;
            db.execute(
                "INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)",
                params![destination, seq],
            )?;
        }
    }
    Ok(())
}

fn verify(source: &Connection, db: &Connection, name: &str) -> rusqlite::Result<()> {
    for table in tables(source)? {
        if rows(source, &table)? != rows(db, target(name, &table))? {
            return Err(error(format!(
                "source {name}.db table {table}: row verification failed"
            )));
        }
    }
    if source
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'")?
        .exists([])?
    {
        let mut query = source.prepare("SELECT name,seq FROM sqlite_sequence")?;
        for sequence in
            query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        {
            let (table, seq) = sequence?;
            let actual: i64 = db.query_row(
                "SELECT seq FROM sqlite_sequence WHERE name=?",
                [target(name, &table)],
                |r| r.get(0),
            )?;
            if seq != actual {
                return Err(error(format!(
                    "source {name}.db table {table}: sequence verification failed"
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Write};
    use std::process::{Command, Stdio};
    use std::time::Duration;

    fn fixtures() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for name in STORES {
            std::fs::copy(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join(format!("tests/fixtures/project-store/{name}.db")),
                dir.path().join(format!("{name}.db")),
            )
            .unwrap();
        }
        dir
    }

    mod baseline {
        include!("../tests/support/store_migrations.rs");
    }

    fn assert_import(dir: &Path) {
        let destination = Connection::open(dir.join("project.db")).unwrap();
        // Compare every typed field and primary key independently of the import verifier.
        for name in STORES {
            let source = Connection::open(dir.join(format!("{name}.db"))).unwrap();
            for (table, expected) in baseline::rows(&source) {
                if table == "sqlite_sequence" {
                    for row in expected {
                        let Value::Text(table) = &row[0] else {
                            panic!("sequence name")
                        };
                        let seq: Value = destination
                            .query_row(
                                "SELECT seq FROM sqlite_sequence WHERE name=?",
                                [target(name, table)],
                                |r| r.get(0),
                            )
                            .unwrap();
                        assert_eq!(seq, row[1], "{name}.{table}");
                    }
                } else {
                    let mut actual = rows(&destination, target(name, &table)).unwrap();
                    let mut expected = expected;
                    actual.sort_by_key(|r| format!("{r:?}"));
                    expected.sort_by_key(|r| format!("{r:?}"));
                    assert!(!expected.is_empty(), "empty fixture {name}.{table}");
                    assert_eq!(actual, expected, "{name}.{table}");
                }
            }
        }
        assert!(
            destination
                .query_row("SELECT verified FROM project_import", [], |r| r
                    .get::<_, bool>(0))
                .unwrap()
        );
    }

    #[test]
    fn n17_import_preserves_every_store() {
        let dir = fixtures();
        for name in STORES {
            baseline::assert_current_schema(
                name,
                &Connection::open(dir.path().join(format!("{name}.db"))).unwrap(),
            );
        }
        for name in STORES {
            let source = Connection::open(dir.path().join(format!("{name}.db"))).unwrap();
            if source
                .prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'")
                .unwrap()
                .exists([])
                .unwrap()
            {
                source
                    .execute("UPDATE sqlite_sequence SET seq=seq+100", [])
                    .unwrap();
            }
        }
        Connection::open(dir.path().join("pads.db")).unwrap().execute_batch("CREATE TABLE scribes(key TEXT PRIMARY KEY,agent TEXT NOT NULL); INSERT INTO scribes VALUES('kept pad','9');").unwrap();
        open(dir.path()).unwrap();
        assert_import(dir.path());
        let _daemon = crate::test_daemon(dir.path()).unwrap();
        let source_companions = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| {
                !n.starts_with("project.db") && (n.ends_with(".db-wal") || n.ends_with(".db-shm"))
            })
            .count();
        println!(
            "imported: active mains=1, active companions=2, retained source mains=7, retained source companions={source_companions}"
        );
        assert_eq!(
            std::fs::read_dir(dir.path())
                .unwrap()
                .filter(|e| e
                    .as_ref()
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|x| x == "db"))
                .count(),
            8,
            "one active main plus seven retained sources"
        );
    }

    #[test]
    fn n17_import_reads_committed_wal() {
        let dir = fixtures();
        let source = Connection::open(dir.path().join("pads.db")).unwrap();
        source.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE pads SET text='committed WAL payload';").unwrap();
        assert!(
            std::fs::metadata(dir.path().join("pads.db-wal"))
                .unwrap()
                .len()
                > 32
        );
        open(dir.path()).unwrap();
        assert_import(dir.path());
        assert_eq!(
            Connection::open(dir.path().join("project.db"))
                .unwrap()
                .query_row("SELECT text FROM pads", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "committed WAL payload"
        );
    }

    #[test]
    fn n17_reopen_does_not_reimport_old_rows() {
        let dir = fixtures();
        open(dir.path()).unwrap();
        let db = Connection::open(dir.path().join("project.db")).unwrap();
        db.execute_batch(
            "DELETE FROM pads; INSERT INTO pads VALUES('new','New','{}','new write',999,NULL);",
        )
        .unwrap();
        open(dir.path()).unwrap();
        assert_eq!(
            rows(&db, "pads").unwrap(),
            vec![vec![
                Value::Text("new".into()),
                Value::Text("New".into()),
                Value::Text("{}".into()),
                Value::Text("new write".into()),
                Value::Integer(999),
                Value::Null
            ]]
        );
    }

    #[test]
    fn n17_failed_import_keeps_sources() {
        for failure in ["copy", "mismatch", "invalid", "conflict", "metadata"] {
            let dir = fixtures();
            let pads = dir.path().join("pads.db");
            if failure == "invalid" {
                std::fs::write(&pads, "not SQLite").unwrap();
            }
            if failure == "conflict" {
                Connection::open(dir.path().join("project.db"))
                    .unwrap()
                    .execute_batch(
                        "CREATE TABLE unrelated(value); INSERT INTO unrelated VALUES('keep');",
                    )
                    .unwrap();
            }
            let sources: Vec<_> = STORES
                .iter()
                .map(|name| {
                    (
                        name,
                        std::fs::read(dir.path().join(format!("{name}.db"))).unwrap(),
                    )
                })
                .collect();
            if failure == "metadata" {
                std::fs::rename(&pads, dir.path().join("retained-pads")).unwrap();
                std::os::unix::fs::symlink("pads.db", &pads).unwrap();
            }
            let err = open_with(dir.path(), Arc::new(move |phase, db| {
                if failure == "copy" && phase == "before_copy" { db.execute_batch("CREATE TRIGGER fail_copy BEFORE INSERT ON pads BEGIN SELECT RAISE(FAIL,'copy refused'); END;")?; }
                if failure == "mismatch" && phase == "after_commit" { db.execute("UPDATE pads SET text='wrong'", [])?; }
                Ok(())
            })).unwrap_err().to_string();
            assert!(err.contains("project.db"), "{failure}: {err}");
            assert!(
                match failure {
                    "copy" => err.contains("copy refused"),
                    "mismatch" => err.contains("pads.db") && err.contains("verification failed"),
                    "invalid" | "metadata" => err.contains("pads.db"),
                    _ => err.contains("conflicting unmarked"),
                },
                "{failure}: {err}"
            );
            for (name, bytes) in sources {
                let source = if failure == "metadata" && *name == "pads" {
                    assert_eq!(std::fs::read_link(&pads).unwrap(), Path::new("pads.db"));
                    dir.path().join("retained-pads")
                } else {
                    dir.path().join(format!("{name}.db"))
                };
                assert_eq!(std::fs::read(source).unwrap(), bytes, "{failure}: {name}");
            }
            if failure == "copy" {
                open(dir.path()).unwrap();
                assert_import(dir.path());
            } else {
                assert!(
                    crate::test_daemon(dir.path()).is_err(),
                    "failed import accepts no calls: {failure}"
                );
            }
        }
    }

    #[test]
    fn n17_interrupted_import_retries_safely() {
        const CHILD: &str = "ROUNDUP_IMPORT_CHILD";
        if let Some(dir) = std::env::var_os(CHILD) {
            let stage = std::env::var("ROUNDUP_IMPORT_STAGE").unwrap();
            open_with(
                Path::new(&dir),
                Arc::new(move |phase, db| {
                    if phase == stage {
                        if phase == "after_verification" {
                            db.execute("UPDATE pads SET text='destination write before kill'", [])?;
                        }
                        println!("IMPORT_GATE");
                        std::io::stdout().flush().unwrap();
                        let mut release = String::new();
                        std::io::stdin().read_line(&mut release).unwrap();
                    }
                    Ok(())
                }),
            )
            .unwrap();
            panic!("the parent must kill at the acknowledged gate");
        }
        for stage in ["before_commit", "after_commit", "after_verification"] {
            let dir = fixtures();
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "storage::tests::n17_interrupted_import_retries_safely",
                    "--nocapture",
                ])
                .env(CHILD, dir.path())
                .env("ROUNDUP_IMPORT_STAGE", stage)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let output = child.stdout.take().unwrap();
            let (send, receive) = std::sync::mpsc::channel();
            let reader = std::thread::spawn(move || {
                for line in std::io::BufReader::new(output).lines() {
                    if line.unwrap() == "IMPORT_GATE" {
                        send.send(()).unwrap();
                        break;
                    }
                }
            });
            let entered = receive.recv_timeout(Duration::from_secs(10));
            child.kill().unwrap();
            child.wait().unwrap();
            reader.join().unwrap();
            entered.expect("import acknowledges the exact stage before kill");
            open(dir.path()).unwrap();
            let db = Connection::open(dir.path().join("project.db")).unwrap();
            if stage == "after_verification" {
                assert_eq!(
                    db.query_row("SELECT text FROM pads", [], |r| r.get::<_, String>(0))
                        .unwrap(),
                    "destination write before kill"
                );
            } else {
                assert_import(dir.path());
            }
            db.execute("UPDATE pads SET text='after restart'", [])
                .unwrap();
            open(dir.path()).unwrap();
            assert_eq!(
                db.query_row("SELECT text FROM pads", [], |r| r.get::<_, String>(0))
                    .unwrap(),
                "after restart"
            );
        }
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
            for (table, sql) in
                baseline::expected_schema(name, if name == "agents" { 2 } else { 1 })
            {
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
        let actual: std::collections::BTreeMap<_, _> = baseline::schema(&db)
            .into_iter()
            .filter(|(n, _)| !n.starts_with("project_import"))
            .collect();
        assert_eq!(actual, expected);
        assert_eq!(
            Migrations::new(vec![M::up(SCHEMA)])
                .current_version(&db)
                .unwrap(),
            rusqlite_migration::SchemaVersion::Inside(std::num::NonZeroUsize::new(1).unwrap())
        );
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

    #[test]
    fn n11_failed_project_migration_preserves_imported_data() {
        let dir = fixtures();
        open(dir.path()).unwrap();
        let mut db = Connection::open(dir.path().join("project.db")).unwrap();
        let before = baseline::rows(&db);
        let definition = SCHEMA;
        let err = apply(
            &mut db,
            vec![
                M::up(definition),
                M::up("DELETE FROM pads; THIS IS INVALID SQL;"),
            ],
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("syntax error")
                && err.to_string().contains("migration through 2")
        );
        assert_eq!(baseline::rows(&db), before);
        assert_eq!(
            Migrations::new(vec![M::up(SCHEMA)])
                .current_version(&db)
                .unwrap(),
            rusqlite_migration::SchemaVersion::Inside(std::num::NonZeroUsize::new(1).unwrap())
        );
        drop(db);
        open(dir.path()).unwrap();
        assert_import(dir.path());
    }
}
