use rusqlite::Connection;
use rusqlite_migration::{M, Migrations, SchemaVersion};
use std::num::NonZeroUsize;

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
        assert_eq!(
            Migrations::new(vec![M::up("")])
                .current_version(&db)
                .unwrap(),
            SchemaVersion::Inside(NonZeroUsize::new(1).unwrap()),
            "{store}"
        );
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
        assert_eq!(support::schema(&db), support::schema(&baseline), "{store}");
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
        assert_eq!(support::schema(&db), support::schema(&baseline), "{store}");
    }
}

#[test]
fn n9_agents_approved_successor_matches_schema() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Connection::open(dir.path().join("agents.db")).unwrap();
    Migrations::new(vec![
        M::up(include_str!("../../agents/migrations/001/up.sql")),
        M::up("DROP INDEX nodes_terminal; CREATE INDEX nodes_terminal ON nodes(terminal_id, attempt) WHERE terminal_id IS NOT NULL;"),
    ]).to_latest(&mut db).unwrap();
    let baseline = Connection::open(support::fixture("agents")).unwrap();
    assert_eq!(support::schema(&db), support::schema(&baseline));
}
