//! N5088a, N5420a, N5467a, P9b: what a Project database refuses or converts on open.
use crate::project::{added_at, connect, migrations};
use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

#[cfg(test)]
mod newer_tests {
    use super::*;

    #[test]
    fn n5088a_project_refuses_a_newer_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        let known = i64::try_from(migrations().len()).unwrap();
        let stored = known + 1;
        let db = Connection::open(&path).unwrap();
        db.pragma_update(None, "user_version", stored).unwrap();
        drop(db);

        let message = connect(dir.path()).unwrap_err().to_string();
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
    fn n5420a_project_refuses_a_divergent_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        let mut swapped = migrations();
        let known = swapped.len();
        let priority = added_at(include_str!("../migrations/project/0037-todo-priority.sql"));
        swapped[priority] = M::up("ALTER TABLE todos ADD COLUMN n5420a_swapped INTEGER;");
        let mut db = Connection::open(&path).unwrap();
        Migrations::new(swapped).to_latest(&mut db).unwrap();
        drop(db);
        let schema = || -> Vec<(String, String)> {
            Connection::open(&path)
                .unwrap()
                .prepare("SELECT name, coalesce(sql, '') FROM sqlite_schema ORDER BY name")
                .unwrap()
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        let before = schema();

        let message = connect(dir.path()).unwrap_err().to_string();
        assert!(message.contains(&path.display().to_string()), "{message}");
        assert!(message.contains("lacks column `priority`"), "{message}");
        assert!(
            message.contains(&format!("database version {known}")),
            "{message}"
        );
        assert!(
            message.contains(&format!("supports through {known}")),
            "{message}"
        );
        assert!(message.contains("newer or branch build"), "{message}");

        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            i64::try_from(known).unwrap()
        );
        assert_eq!(schema(), before);
    }
}

#[cfg(test)]
mod retirement_tests {
    use super::*;

    #[test]
    fn n5467a_older_store_is_refused_without_changes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE retirement_sentinel(value TEXT); INSERT INTO retirement_sentinel VALUES ('keep me');").unwrap();
        let read = "SELECT value FROM retirement_sentinel";
        let schema = |db: &Connection| -> Vec<(String, String)> {
            db.prepare("SELECT name, coalesce(sql, '') FROM sqlite_schema ORDER BY name")
                .unwrap()
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        let before = schema(&db);
        drop(db);
        for _ in 0..2 {
            let db = Connection::open(&path).unwrap();
            let message = connect(dir.path()).unwrap_err().to_string();
            assert!(
                message.contains("incompatible with this build"),
                "{message}"
            );
            assert!(
                message.contains(&dir.path().display().to_string()),
                "{message}"
            );
            assert!(
                message.contains("close roundup") && message.contains("delete"),
                "{message}"
            );
            assert_eq!(schema(&db), before);
            assert_eq!(
                db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
                    .unwrap(),
                0
            );
            assert_eq!(
                db.query_row(read, [], |r| r.get::<_, String>(0)).unwrap(),
                "keep me"
            );
        }
    }
}

#[cfg(test)]
mod client_deletion_key_tests {
    use rusqlite::Connection;

    /// P9b: a receipt stored under a bare client key moves to `client:`; Daemon-named keys stay.
    #[test]
    fn p9b_stored_client_receipts_move_under_the_client_prefix() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE pad_deletions (operation TEXT PRIMARY KEY NOT NULL);
             CREATE TABLE rail_removal_items (operation TEXT, participant TEXT);
             INSERT INTO rail_removal_items VALUES ('rail-op', 'participant-key');
             INSERT INTO pad_deletions VALUES ('undo-1'), ('participant-key'),
               ('0123456789abcdef0123456789abcdef'), ('client:done');",
        )
        .unwrap();
        db.execute_batch(include_str!(
            "../migrations/project/0054-client-deletion-keys.sql"
        ))
        .unwrap();
        let keys: Vec<String> = db
            .prepare("SELECT operation FROM pad_deletions ORDER BY operation")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            keys,
            [
                "0123456789abcdef0123456789abcdef",
                "client:done",
                "client:undo-1",
                "participant-key"
            ]
        );
    }
}
