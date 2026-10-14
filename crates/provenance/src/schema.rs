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
    if exists(tx, "touches")? && !column(tx, "touches", "todo_revision")? {
        tx.execute_batch(include_str!(
            "../migrations/001/touches-add-todo_revision.sql"
        ))?;
    }
    if exists(tx, "touches")? {
        tx.prepare("SELECT seq, actor_kind, actor_id, actor_parent, verb, item, at, todo_revision FROM touches LIMIT 0")?;
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
    const STORE: &str = "provenance";
    const INVALID_SQL: &str = "ALTER TABLE touches RENAME COLUMN item TO missing";
    const FAILURE_SQL: &str = "INSERT INTO touches(actor_kind,actor_id,verb,item,at) VALUES('user','you','wrote','rollback',120); THIS IS INVALID SQL;";
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
        db.execute_batch(r#"ALTER TABLE touches DROP COLUMN todo_revision;"#)
            .unwrap();
        open(&mut db, &path).unwrap();
        assert_eq!(db.query_row(r#"SELECT COUNT(*) FROM touches WHERE todo_revision IS NULL AND item IN ('todo:5', 'todo:8')"#, [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        assert_eq!(
            version(&db),
            SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
        );
    }
}
