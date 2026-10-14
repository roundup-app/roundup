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
    if exists(tx, "pads")? && !column(tx, "pads", "home")? {
        tx.execute_batch(include_str!("../migrations/001/pads-add-home.sql"))?;
    }
    if exists(tx, "pads")? {
        tx.prepare("SELECT key, name, owner, text, updated_at, home FROM pads LIMIT 0")?;
    }
    if exists(tx, "settings")? {
        tx.prepare("SELECT key, value FROM settings LIMIT 0")?;
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
    const STORE: &str = "pads";
    const INVALID_SQL: &str = "ALTER TABLE pads RENAME COLUMN name TO missing";
    const FAILURE_SQL: &str =
        "INSERT INTO pads VALUES('rollback','Rollback','{}','row',120,NULL); THIS IS INVALID SQL;";
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
        db.execute_batch(r#"ALTER TABLE pads DROP COLUMN home;"#)
            .unwrap();
        open(&mut db, &path).unwrap();
        assert_eq!(
            db.query_row(
                r#"SELECT COUNT(*) FROM pads WHERE home IS NULL AND name = 'Kept Pad'"#,
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            version(&db),
            SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
        );
    }
}
