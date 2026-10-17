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
        let actual: std::collections::BTreeMap<_, _> =
            standalone::schema(&db).into_iter().collect();
        assert_eq!(actual, expected);
        assert_eq!(
            Migrations::new(migrations()).current_version(&db).unwrap(),
            rusqlite_migration::SchemaVersion::Inside(std::num::NonZeroUsize::new(10).unwrap())
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
        assert_eq!(base, 10);
        let applied: i64 = db
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied, 12);
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
