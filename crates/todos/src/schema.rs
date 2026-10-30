//! Current schema creation for standalone stores; the Daemon initializes `project.db`.
use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};
use std::path::Path;

pub fn open(db: &mut Connection, path: &Path) -> rusqlite::Result<()> {
    if path.file_name().is_some_and(|name| name == "project.db") {
        return Ok(());
    }
    let migrations = migrations();
    let count = migrations.len();
    let stored: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    Migrations::new(migrations).to_latest(db).map_err(|error| {
        let message = if matches!(
            error,
            rusqlite_migration::Error::MigrationDefinition(
                rusqlite_migration::MigrationDefinitionError::DatabaseTooFarAhead
            )
        ) {
            format!("database version {stored}; this build supports through {count}. This database came from a newer or branch build. Use the build that wrote it, or reset this disposable pre-release database after closing roundup.")
        } else {
            format!("migration through {count}: {error}")
        };
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!(
            "{}: {message}",
            path.display()
        ))))
    })
}

fn migrations() -> Vec<M<'static>> {
    vec![
        M::up(include_str!("../migrations/001/up.sql")),
        M::up(include_str!("../migrations/002/up.sql")),
        M::up(include_str!("../migrations/003/up.sql")),
        M::up(include_str!("../migrations/004/up.sql")),
        M::up(include_str!("../migrations/005/up.sql")),
        M::up(include_str!("../migrations/006/up.sql")),
        M::up(include_str!("../migrations/007/up.sql")),
        M::up("-- T4902: retired T29; retain the migration slot."),
        M::up(include_str!("../migrations/009/up.sql")),
        M::up(include_str!("../migrations/010/up.sql")),
        M::up(include_str!("../migrations/011/up.sql")),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn n5088a_todos_refuses_a_newer_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("todos.db");
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
}
