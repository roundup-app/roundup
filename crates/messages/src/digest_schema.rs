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
    vec![M::up(include_str!("../migrations/001-digest/up.sql"))]
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite_migration::Migrations;

    #[test]
    fn n5088a_digest_refuses_a_newer_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("digest.db");
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
    fn n5420a_digest_refuses_a_divergent_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("digest.db");
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
