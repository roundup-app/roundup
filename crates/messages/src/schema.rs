//! Current schema creation for standalone stores; the Daemon initializes `project.db`.
use rusqlite::Connection;
use rusqlite_migration::M;
use std::path::Path;

pub fn open(db: &mut Connection, path: &Path) -> rusqlite::Result<()> {
    if path.file_name().is_some_and(|name| name == "project.db") {
        return Ok(());
    }
    provenance::migration::migrate(db, path, migrations())
}

fn migrations() -> Vec<M<'static>> {
    vec![
        M::up(include_str!("../migrations/001/up.sql")),
        M::up(include_str!("../migrations/002/up.sql")),
        M::up(include_str!("../migrations/003/up.sql")),
        M::up(
            "CREATE TABLE message_sender_names (agent TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);",
        ),
        M::up(include_str!("../migrations/004/up.sql")),
        M::up(include_str!("../migrations/005/up.sql")),
        M::up(crate::evidence::SCHEMA),
        M::up(crate::continuation::SCHEMA),
        M::up(include_str!("../migrations/006/up.sql")),
        M::up(include_str!("../migrations/007/up.sql")),
        M::up(include_str!("../migrations/008/up.sql")),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite_migration::Migrations;

    #[test]
    fn n5088a_messages_refuses_a_newer_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.db");
        let known = i64::try_from(migrations().len()).unwrap();
        let stored = known + 1;
        let db = Connection::open(&path).unwrap();
        db.pragma_update(None, "user_version", stored).unwrap();
        drop(db);

        let mut db = Connection::open(&path).unwrap();
        let message = open(&mut db, &path).unwrap_err().to_string();
        assert!(message.contains(&path.display().to_string()), "{message}");
        assert!(
            message.contains(&format!("database version {stored}")),
            "{message}"
        );
        assert!(
            message.contains(&format!("supports through {known}")),
            "{message}"
        );
        assert!(message.contains("newer or branch build"), "{message}");
        assert!(message.contains("closing roundup"), "{message}");
        drop(db);

        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            stored
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn n5420a_messages_refuses_a_divergent_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.db");
        let mut swapped = migrations();
        let known = swapped.len();
        *swapped.last_mut().unwrap() = M::up("CREATE TABLE n5420a_swapped (c);");
        let mut db = Connection::open(&path).unwrap();
        Migrations::new(swapped).to_latest(&mut db).unwrap();
        let schema = |db: &Connection| -> Vec<(String, String)> {
            db.prepare("SELECT name, coalesce(sql, '') FROM sqlite_schema ORDER BY name")
                .unwrap()
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        let before = schema(&db);
        drop(db);

        let mut db = Connection::open(&path).unwrap();
        let message = open(&mut db, &path).unwrap_err().to_string();
        assert!(message.contains(&path.display().to_string()), "{message}");
        assert!(message.contains("schema differs"), "{message}");
        assert!(
            message.contains(&format!("database version {known}")),
            "{message}"
        );
        assert!(
            message.contains(&format!("supports through {known}")),
            "{message}"
        );
        assert!(message.contains("newer or branch build"), "{message}");
        drop(db);

        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            i64::try_from(known).unwrap()
        );
        assert_eq!(schema(&db), before);
    }
}

#[cfg(test)]
mod retirement_tests {
    use super::*;
    use rusqlite_migration::Migrations;

    #[test]
    fn n5467a_older_store_is_refused_without_changes() {
        for prefix in 0..migrations().len() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("messages.db");
            let mut db = Connection::open(&path).unwrap();
            if prefix > 0 {
                Migrations::new(migrations()[..prefix].to_vec()).to_latest(&mut db).unwrap();
            }
            db.execute_batch("CREATE TABLE retirement_sentinel(value TEXT); INSERT INTO retirement_sentinel VALUES ('keep me');").unwrap();
            let schema = |db: &Connection| -> Vec<(String, String)> {
                db.prepare("SELECT name, coalesce(sql, '') FROM sqlite_schema ORDER BY name").unwrap()
                    .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
            };
            let before = schema(&db);
            drop(db);
            for _ in 0..2 {
                let mut db = Connection::open(&path).unwrap();
                let message = open(&mut db, &path).unwrap_err().to_string();
                assert!(message.contains("incompatible with this build"), "{message}");
                assert!(message.contains(&dir.path().display().to_string()), "{message}");
                assert!(message.contains("close roundup") && message.contains("delete"), "{message}");
                assert_eq!(schema(&db), before);
                assert_eq!(db.pragma_query_value(None, "user_version", |r| r.get::<_, usize>(0)).unwrap(), prefix);
                assert_eq!(db.query_row("SELECT value FROM retirement_sentinel", [], |r| r.get::<_, String>(0)).unwrap(), "keep me");
            }
        }
    }
}
