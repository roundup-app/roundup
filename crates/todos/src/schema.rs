//! Connection policy and standalone schemas; the Daemon migrates `project.db`.
use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};
use std::path::Path;

pub fn open(db: &mut Connection, path: &Path) -> rusqlite::Result<()> {
    if path.file_name().is_some_and(|name| name == "project.db") {
        // PERSIST is connection-local; every Project writer must opt in (ADR 0004).
        db.pragma_update(None, "synchronous", "EXTRA")?;
        db.pragma_update(None, "journal_mode", "PERSIST")?;
        return Ok(());
    }
    db.pragma_update(None, "journal_mode", "WAL")?;
    let migrations = vec![
        M::up(include_str!("../migrations/001/up.sql")),
        M::up(include_str!("../migrations/002/up.sql")),
        M::up(include_str!("../migrations/003/up.sql")),
        M::up(include_str!("../migrations/004/up.sql")),
        M::up(include_str!("../migrations/005/up.sql")),
        M::up(include_str!("../migrations/006/up.sql")),
        M::up(include_str!("../migrations/007/up.sql")),
        M::up(include_str!("../migrations/008/up.sql")),
        M::up(include_str!("../migrations/009/up.sql")),
    ];
    let count = migrations.len();
    Migrations::new(migrations).to_latest(db).map_err(|error| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!(
            "{}: migration through {count}: {error}",
            path.display()
        ))))
    })
}
