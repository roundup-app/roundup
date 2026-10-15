use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

const STORES: [&str; 7] = [
    "todos",
    "agents",
    "checkpoints",
    "messages",
    "digest",
    "pads",
    "provenance",
];

#[test]
fn n9_each_store_creates_current_schema() {
    let dir = tempfile::tempdir().unwrap();
    drop(rupd::Daemon::open(dir.path()).unwrap());
    for store in STORES {
        let db = Connection::open(dir.path().join(format!("{store}.db"))).unwrap();
        support::assert_current_schema(store, &db);
    }
}

mod support {
    include!("support/store_migrations.rs");
}

fn fixtures() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for store in STORES {
        std::fs::copy(
            support::fixture(store),
            dir.path().join(format!("{store}.db")),
        )
        .unwrap();
    }
    dir
}

#[test]
fn n10_adopts_each_main_database_without_data_change() {
    let dir = fixtures();
    drop(rupd::Daemon::open(dir.path()).unwrap());
    for store in STORES {
        let baseline = Connection::open(support::fixture(store)).unwrap();
        let db = Connection::open(dir.path().join(format!("{store}.db"))).unwrap();
        let rows = support::rows(&baseline);
        assert!(
            rows.values().all(|rows| !rows.is_empty()),
            "empty fixture table in {store}"
        );
        assert_eq!(support::rows(&db), rows, "{store}");
        support::assert_current_schema(store, &db);
    }
}

#[test]
fn n10_reopen_is_idempotent() {
    let dir = fixtures();
    drop(rupd::Daemon::open(dir.path()).unwrap());
    drop(rupd::Daemon::open(dir.path()).unwrap());
    for store in STORES {
        let baseline = Connection::open(support::fixture(store)).unwrap();
        let db = Connection::open(dir.path().join(format!("{store}.db"))).unwrap();
        assert_eq!(support::rows(&db), support::rows(&baseline), "{store}");
        support::assert_current_schema(store, &db);
    }
}

#[test]
fn n9_agents_approved_successor_matches_schema() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Connection::open(dir.path().join("agents.db")).unwrap();
    Migrations::new(agents_successor())
        .to_latest(&mut db)
        .unwrap();
    assert_eq!(support::assert_current_schema("agents", &db), 2);
}

fn agents_successor() -> Vec<M<'static>> {
    vec![
        M::up(include_str!("../../agents/migrations/001/up.sql")),
        M::up(
            "DROP INDEX nodes_terminal; CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL;",
        ),
    ]
}

#[test]
fn n10_agents_successor_preserves_adopted_rows_on_reopen() {
    let dir = fixtures();
    let path = dir.path().join("agents.db");
    let baseline = Connection::open(support::fixture("agents")).unwrap();
    let mut db = Connection::open(&path).unwrap();
    Migrations::new(agents_successor())
        .to_latest(&mut db)
        .unwrap();
    assert_eq!(support::assert_current_schema("agents", &db), 2);
    assert_eq!(support::rows(&db), support::rows(&baseline));
    drop(db);
    let mut db = Connection::open(&path).unwrap();
    Migrations::new(agents_successor())
        .to_latest(&mut db)
        .unwrap();
    assert_eq!(support::assert_current_schema("agents", &db), 2);
    assert_eq!(support::rows(&db), support::rows(&baseline));
}

#[test]
fn n9_unexpected_schema_version_combinations_fail() {
    // Establish versions through the library, including mismatched version/index
    // pairs and alterations outside the one approved index replacement.
    for (store, version, sql) in [
        ("agents", 0, ""),
        (
            "agents",
            1,
            "DROP INDEX nodes_terminal; CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL;",
        ),
        ("agents", 2, ""),
        (
            "agents",
            2,
            "DROP INDEX nodes_terminal; CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt);",
        ),
        (
            "agents",
            2,
            "DROP INDEX nodes_terminal; CREATE INDEX nodes_terminal ON nodes(attempt, terminal_id) WHERE terminal_id IS NOT NULL;",
        ),
        (
            "agents",
            2,
            "DROP INDEX nodes_terminal; CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL; ALTER TABLE nodes ADD COLUMN unexpected TEXT;",
        ),
        (
            "agents",
            2,
            "DROP INDEX nodes_terminal; CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL; CREATE INDEX unexpected ON nodes(name);",
        ),
        ("agents", 3, ""),
        ("todos", 2, ""),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{store}.db"));
        std::fs::copy(support::fixture(store), &path).unwrap();
        let mut db = Connection::open(path).unwrap();
        if version > 0 {
            Migrations::new((0..version).map(|_| M::up("")).collect())
                .to_latest(&mut db)
                .unwrap();
        }
        db.execute_batch(sql).unwrap();
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                support::assert_current_schema(store, &db)
            }))
            .is_err(),
            "accepted {store} version {version}: {sql}"
        );
    }
}

#[test]
fn n16_all_stores_share_one_project_database() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = rupd::Daemon::open(dir.path()).unwrap();
    let mut databases: Vec<_> = std::fs::read_dir(dir.path()).unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "db"))
        .collect();
    databases.sort();
    assert_eq!(databases, [dir.path().join("project.db")]);
    let db = Connection::open(&databases[0]).unwrap();
    for table in ["nodes", "settings", "todos", "blockers", "changes", "pads", "pad_settings", "touches", "messages", "routes", "message_restarts", "message_retirements", "pad_cursors", "checkpoints", "marks"] {
        assert!(db.prepare(&format!("SELECT * FROM {table}")).is_ok(), "missing {table}");
    }
    drop(daemon);
    drop(rupd::Daemon::open(dir.path()).unwrap());
}
