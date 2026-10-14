use rusqlite::Connection;
use rusqlite_migration::{M, Migrations, SchemaVersion};
use std::num::NonZeroUsize;

const STORES: [&str; 7] = ["todos", "agents", "checkpoints", "messages", "digest", "pads", "provenance"];

#[test]
fn n9_each_store_creates_current_schema() {
    let dir = tempfile::tempdir().unwrap();
    drop(rupd::Daemon::open(dir.path()).unwrap());
    for store in STORES {
        let db = Connection::open(dir.path().join(format!("{store}.db"))).unwrap();
        assert_eq!(Migrations::new(vec![M::up("")]).current_version(&db).unwrap(),
            SchemaVersion::Inside(NonZeroUsize::new(1).unwrap()), "{store}");
    }
}
