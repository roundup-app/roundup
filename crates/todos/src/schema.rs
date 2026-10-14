//! Migration 1 adopts main's schema; later changes append numbered SQL migrations.
use rusqlite::{Connection, Transaction};
use rusqlite_migration::{HookResult, M, Migrations};
use std::path::Path;

fn migrations() -> Vec<M<'static>> {
    vec![M::up_with_hook(
        include_str!("../migrations/001/up.sql"),
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
    // These probes select only pre-versioned upgrades, inside the library's migration-1 transaction.
    for (table, name, sql) in [
        (
            "todos",
            "creator",
            include_str!("../migrations/001/todos-add-creator.sql"),
        ),
        (
            "todos",
            "home",
            include_str!("../migrations/001/todos-add-home.sql"),
        ),
        (
            "todos",
            "pos",
            include_str!("../migrations/001/todos-add-pos.sql"),
        ),
    ] {
        if exists(tx, table)? && !column(tx, table, name)? {
            tx.execute_batch(sql)?;
        }
    }
    if exists(tx, "todos")? {
        tx.prepare(
            "SELECT id, title, body, done, created_at, creator, home, pos FROM todos LIMIT 0",
        )?;
    }
    if exists(tx, "blockers")? {
        tx.prepare("SELECT todo, blocker FROM blockers LIMIT 0")?;
    }
    if exists(tx, "changes")? {
        tx.prepare(
            "SELECT seq, todo, before_values, after_values, after_touch FROM changes LIMIT 0",
        )?;
    }
    Ok(())
}

fn exists(db: &Connection, table: &str) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")?
        .exists([table])
}

fn column(db: &Connection, table: &str, name: &str) -> rusqlite::Result<bool> {
    db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?")?
        .exists([table, name])
}

#[cfg(test)]
mod tests {
    const STORE: &str = "todos";
    const INVALID_SQL: &str = "ALTER TABLE todos RENAME COLUMN title TO missing";
    const FAILURE_SQL: &str = "INSERT INTO todos(title,body,created_at) VALUES('rollback','row',120); THIS IS INVALID SQL;";
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rupd/tests/support/schema_tests.rs"
    ));

    #[test]
    fn n10_supported_older_schemas_still_upgrade() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{STORE}.db"));
        std::fs::copy(support::fixture(STORE), &path).unwrap();
        let mut db = Connection::open(&path).unwrap();
        db.execute_batch(r#"ALTER TABLE todos DROP COLUMN creator; ALTER TABLE todos DROP COLUMN home; ALTER TABLE todos DROP COLUMN pos;"#).unwrap();
        open(&mut db, &path).unwrap();
        assert_eq!(db.query_row(r#"SELECT COUNT(*) FROM todos WHERE pos = id AND home IS NULL AND creator = '{"kind":"user","id":"you","parent":null}'"#, [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(
            version(&db),
            SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
        );
    }
}
