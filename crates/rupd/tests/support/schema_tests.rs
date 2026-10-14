use super::*;
use rusqlite_migration::SchemaVersion;
use std::num::NonZeroUsize;
mod support {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../rupd/tests/support/store_migrations.rs"
    ));
}

fn adopted() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(format!("{STORE}.db"));
    std::fs::copy(support::fixture(STORE), &path).unwrap();
    let mut db = Connection::open(&path).unwrap();
    open(&mut db, &path).unwrap();
    (dir, db)
}

fn version(db: &Connection) -> SchemaVersion {
    Migrations::new(migrations()).current_version(db).unwrap()
}

#[test]
fn n9_each_store_creates_current_schema() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(format!("{STORE}.db"));
    let mut db = Connection::open(&path).unwrap();
    open(&mut db, &path).unwrap();
    let baseline = Connection::open(support::fixture(STORE)).unwrap();
    assert_eq!(support::schema(&db), support::schema(&baseline));
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
    );
}

#[test]
fn n9_in_memory_uses_the_same_schema() {
    let mut db = Connection::open_in_memory().unwrap();
    open(&mut db, Path::new(STORE)).unwrap();
    let baseline = Connection::open(support::fixture(STORE)).unwrap();
    assert_eq!(support::schema(&db), support::schema(&baseline));
}

#[test]
fn n10_adopts_each_main_database_without_data_change() {
    let baseline = Connection::open(support::fixture(STORE)).unwrap();
    let (_dir, db) = adopted();
    assert_eq!(support::rows(&db), support::rows(&baseline));
    assert_eq!(support::schema(&db), support::schema(&baseline));
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
    );
}

#[test]
fn n10_reopen_is_idempotent() {
    let (dir, db) = adopted();
    let rows = support::rows(&db);
    let schema = support::schema(&db);
    drop(db);
    let path = dir.path().join(format!("{STORE}.db"));
    let mut db = Connection::open(&path).unwrap();
    open(&mut db, &path).unwrap();
    // A poisoned migration 1 must be skipped on a versioned reopen.
    apply(&mut db, &path, vec![M::up("THIS IS INVALID SQL;")]).unwrap();
    assert_eq!(support::rows(&db), rows);
    assert_eq!(support::schema(&db), schema);
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
    );
}

#[test]
fn n10_invalid_schema_preserves_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(format!("{STORE}.db"));
    std::fs::copy(support::fixture(STORE), &path).unwrap();
    let mut db = Connection::open(&path).unwrap();
    db.execute_batch(INVALID_SQL).unwrap();
    let rows = support::rows(&db);
    let schema = support::schema(&db);
    let error = open(&mut db, &path).unwrap_err().to_string();
    assert!(error.contains(&format!("{STORE}.db")), "{error}");
    assert_eq!(support::rows(&db), rows);
    assert_eq!(support::schema(&db), schema);
    assert_eq!(version(&db), SchemaVersion::NoneSet);
}

#[test]
fn n11_failed_migration_rolls_back() {
    let (dir, mut db) = adopted();
    let path = dir.path().join(format!("{STORE}.db"));
    let rows = support::rows(&db);
    let schema = support::schema(&db);
    let mut next = migrations();
    next.push(M::up(FAILURE_SQL));
    let error = apply(&mut db, &path, next).unwrap_err().to_string();
    assert!(error.contains("near \"THIS\": syntax error"), "{error}");
    assert!(
        error.contains(&format!("{STORE}.db")) && error.contains("migration through 2"),
        "{error}"
    );
    assert_eq!(support::rows(&db), rows);
    assert_eq!(support::schema(&db), schema);
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
    );
    drop(db);
    let mut reopened = Connection::open(&path).unwrap();
    open(&mut reopened, &path).unwrap();
    assert_eq!(support::rows(&reopened), rows);
    assert_eq!(
        version(&reopened),
        SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
    );
}
