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
    support::assert_current_schema(STORE, &db);
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(migrations().len()).unwrap())
    );
}

#[test]
fn n9_in_memory_uses_the_same_schema() {
    let mut db = Connection::open_in_memory().unwrap();
    open(&mut db, Path::new(STORE)).unwrap();
    support::assert_current_schema(STORE, &db);
}

#[test]
fn n10_adopts_each_main_database_without_data_change() {
    let baseline = Connection::open(support::fixture(STORE)).unwrap();
    let (_dir, db) = adopted();
    assert_eq!(support::rows(&db), support::rows(&baseline));
    support::assert_current_schema(STORE, &db);
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(migrations().len()).unwrap())
    );
}

#[test]
fn n10_reopen_is_idempotent() {
    let (dir, db) = adopted();
    let rows = support::rows(&db);
    let schema = support::schema(&db);
    support::assert_current_schema(STORE, &db);
    drop(db);
    let path = dir.path().join(format!("{STORE}.db"));
    let mut db = Connection::open(&path).unwrap();
    open(&mut db, &path).unwrap();
    // A poisoned migration 1 must be skipped on a versioned reopen.
    apply(
        &mut db,
        &path,
        (0..migrations().len())
            .map(|_| M::up("THIS IS INVALID SQL;"))
            .collect(),
    )
    .unwrap();
    assert_eq!(support::rows(&db), rows);
    assert_eq!(support::schema(&db), schema);
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(migrations().len()).unwrap())
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
        error.contains(&format!("{STORE}.db"))
            && error.contains(&format!("migration through {}", migrations().len() + 1)),
        "{error}"
    );
    assert_eq!(support::rows(&db), rows);
    assert_eq!(support::schema(&db), schema);
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(migrations().len()).unwrap())
    );
    drop(db);
    let mut reopened = Connection::open(&path).unwrap();
    open(&mut reopened, &path).unwrap();
    assert_eq!(support::rows(&reopened), rows);
    assert_eq!(
        version(&reopened),
        SchemaVersion::Inside(NonZeroUsize::new(migrations().len()).unwrap())
    );
    assert_eq!(support::schema(&reopened), schema);
}

#[test]
fn n10_migration_one_adopts_retained_baseline() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(format!("{STORE}.db"));
    std::fs::copy(support::fixture(STORE), &path).unwrap();
    let baseline = Connection::open(support::fixture(STORE)).unwrap();
    let mut db = Connection::open(&path).unwrap();
    apply(&mut db, &path, migrations().into_iter().take(1).collect()).unwrap();
    assert_eq!(support::rows(&db), support::rows(&baseline));
    assert_eq!(support::schema(&db), support::schema(&baseline));
    assert_eq!(
        version(&db),
        SchemaVersion::Inside(NonZeroUsize::new(1).unwrap())
    );
}

#[test]
fn n11_agents_successor_failure_rolls_back_migration_three() {
    if STORE != "agents" {
        return;
    }
    let (dir, mut db) = adopted();
    let path = dir.path().join(format!("{STORE}.db"));
    let successor = || {
        let mut definition: Vec<_> = migrations().into_iter().take(1).collect();
        definition.push(M::up("DROP INDEX nodes_terminal; CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL;"));
        definition
    };
    apply(&mut db, &path, successor()).unwrap();
    assert_eq!(support::assert_current_schema(STORE, &db), 2);
    let rows = support::rows(&db);
    let schema = support::schema(&db);
    let mut next = successor();
    next.push(M::up(FAILURE_SQL));
    let error = apply(&mut db, &path, next).unwrap_err().to_string();
    assert!(
        error.contains(&format!("{STORE}.db"))
            && error.contains("migration through 3")
            && error.contains("near \"THIS\": syntax error"),
        "{error}"
    );
    assert_eq!(support::assert_current_schema(STORE, &db), 2);
    assert_eq!(support::rows(&db), rows);
    assert_eq!(support::schema(&db), schema);
    drop(db);
    let mut reopened = Connection::open(path).unwrap();
    apply(&mut reopened, Path::new(STORE), successor()).unwrap();
    assert_eq!(support::assert_current_schema(STORE, &reopened), 2);
    assert_eq!(support::rows(&reopened), rows);
    assert_eq!(support::schema(&reopened), schema);
}
