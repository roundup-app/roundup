//! Migration 1 adopts main's schema; later changes append numbered SQL migrations.
use rusqlite::{Connection, Transaction};
use rusqlite_migration::{HookResult, M, Migrations};
use std::path::Path;

fn migrations() -> Vec<M<'static>> {
    vec![M::up_with_hook(
        include_str!("../migrations/001-digest/up.sql"),
        bootstrap,
    )]
}

pub(crate) fn open(db: &mut Connection, path: &Path) -> rusqlite::Result<()> {
    apply(db, path, migrations())
}

fn apply(db: &mut Connection, path: &Path, migrations: Vec<M<'_>>) -> rusqlite::Result<()> {
    let count = migrations.len();
    Migrations::new(migrations).to_latest(db).map_err(|error| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!(
            "{}: migration through {count}: {error}",
            path.display()
        ))))
    })
}

fn bootstrap(tx: &Transaction<'_>) -> HookResult {
    if exists(tx, "pad_cursors")? {
        tx.prepare("SELECT door, child, newest FROM pad_cursors LIMIT 0")?;
    }
    Ok(())
}

fn exists(db: &Connection, table: &str) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")?
        .exists([table])
}

#[cfg(test)]
mod tests {
    const STORE: &str = "digest";
    const INVALID_SQL: &str = "ALTER TABLE pad_cursors RENAME COLUMN newest TO missing";
    const FAILURE_SQL: &str =
        "INSERT INTO pad_cursors VALUES('rollback','child',120); THIS IS INVALID SQL;";
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rupd/tests/support/schema_tests.rs"
    ));
}
