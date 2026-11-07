use super::*;
use rusqlite::params;

mod dump {
    include!("tests/dump.rs");
}
use dump::dump;

#[test]
fn r3696c_a_fresh_project_db_equals_the_migrated_one_with_its_own_identity() {
    let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    connect(a.path()).unwrap();
    connect(b.path()).unwrap();
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
    let own = id(a.path(), "deliverable_project");
    assert_ne!(own, id(b.path(), "deliverable_project"));
    assert!(own.len() == 32 && own.bytes().all(|c| c.is_ascii_hexdigit()));
    let image = std::fs::read(a.path().join("project.db")).unwrap();
    for placeholder in IDENTITIES {
        assert!(!image.windows(32).any(|window| window == placeholder));
    }
}

// Real production prefixes; no owner data or copied migration inventory.
fn saved_prefix() -> (tempfile::TempDir, Connection, usize) {
    saved_prefix_behind(1)
}

fn saved_prefix_behind(behind: usize) -> (tempfile::TempDir, Connection, usize) {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Connection::open(dir.path().join("project.db")).unwrap();
    let prefix = migrations().len() - behind;
    Migrations::new(migrations()[..prefix].to_vec())
        .to_latest(&mut db)
        .unwrap();
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,ord) VALUES(5809,'workstream','saved work',7);
         INSERT INTO nodes(id,kind,name,ord) VALUES(5810,'workstream','more work',9);",
    )
    .unwrap();
    (dir, db, prefix)
}

fn saved_rows(db: &Connection) -> Vec<(i64, String, String, i64)> {
    db.prepare("SELECT id,kind,name,ord FROM nodes WHERE id IN (5809,5810) ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn n5809a_matching_project_upgrades_and_keeps_rows() {
    for behind in [1, 7] {
        matching_prefix_upgrades(behind);
    }
}

fn matching_prefix_upgrades(behind: usize) {
    let (dir, db, _) = saved_prefix_behind(behind);
    let rows = saved_rows(&db);
    drop(db);
    for _ in 0..2 {
        let db = connect(dir.path()).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            migrations().len() as i64
        );
        assert_eq!(
            provenance::migration::difference(&db, &reference().unwrap()).unwrap(),
            None
        );
        assert_eq!(saved_rows(&db), rows);
    }
}

#[test]
fn n5809b_divergent_project_names_column_without_changes() {
    for behind in [1, 7] {
        divergent_prefix_refuses(behind);
    }
}

fn divergent_prefix_refuses(behind: usize) {
    let (dir, db, prefix) = saved_prefix_behind(behind);
    db.execute_batch("ALTER TABLE nodes ADD COLUMN n5809_extra TEXT")
        .unwrap();
    let before = dump(&db);
    let rows = saved_rows(&db);
    drop(db);
    for _ in 0..2 {
        let message = match connect(dir.path()) {
            Ok(_) => panic!("divergent predecessor returned a Daemon"),
            Err(error) => error.to_string(),
        };
        for detail in [
            dir.path().join("project.db").display().to_string(),
            format!("database version {prefix}"),
            format!("supports through {}", migrations().len()),
            "table `nodes` has column `n5809_extra`".into(),
            "newer or branch build".into(),
            "close roundup and delete".into(),
        ] {
            assert!(message.contains(&detail), "{message}");
        }
        let db = Connection::open(dir.path().join("project.db")).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                .unwrap(),
            prefix as i64
        );
        assert_eq!(dump(&db), before);
        assert_eq!(saved_rows(&db), rows);
    }
}

#[test]
fn n5809c_failed_suffix_rolls_back_and_names_migration() {
    let (dir, mut db, prefix) = saved_prefix();
    let before = dump(&db);
    let rows = saved_rows(&db);
    let mut failing = migrations()[..prefix].to_vec();
    failing.push(M::up("CREATE TABLE n5809_partial(value TEXT); INSERT INTO nodes(id,kind,name,ord) VALUES(5811,'workstream','must roll back',11);"));
    failing.push(M::up("N5809_INVALID_SQL;"));
    let message = apply(&mut db, failing).unwrap_err().to_string();
    assert!(
        message.contains(&format!("migration {}:", prefix + 2)),
        "{message}"
    );
    assert!(message.contains("N5809_INVALID_SQL"), "{message}");
    drop(db);
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        prefix as i64
    );
    assert_eq!(dump(&db), before);
    assert_eq!(saved_rows(&db), rows);
}

#[test]
fn n2705a_sender_names_reject_nulls_and_duplicate_identities() {
    let dir = tempfile::tempdir().unwrap();
    connect(dir.path()).unwrap();
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
    connect(dir.path()).unwrap();
    let path = dir.path().join("project.db");
    let db = Connection::open(&path).unwrap();
    db.execute_batch(
        "INSERT INTO message_sender_names(agent, name) VALUES ('7013', 'sad');
         UPDATE message_sender_names SET name = 'glad' WHERE agent = '7013';
         INSERT INTO message_sender_names(agent, name) VALUES ('7014', 'glad');",
    )
    .unwrap();
    drop(db);
    connect(dir.path()).unwrap();
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

#[path = "tests/migration_files.rs"]
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
    connect(dir.path()).unwrap();
    let db = Connection::open(dir.path().join("project.db")).unwrap();
    let nodes: i64 = db
        .query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))
        .unwrap();
    assert_eq!(nodes, 0);
    assert_eq!(std::fs::read(&old).unwrap(), before);
}
