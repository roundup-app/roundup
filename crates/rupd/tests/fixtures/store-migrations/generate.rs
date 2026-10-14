// Run only in the recorded main checkout; that Daemon owns the fixture schemas.
use std::path::PathBuf;
fn main() {
    let output = PathBuf::from(std::env::args_os().nth(1).unwrap());
    let seeds = PathBuf::from(std::env::args_os().nth(2).unwrap());
    std::fs::create_dir_all(&output).unwrap();
    drop(rupd::Daemon::open(&output).unwrap());
    for name in [
        "agents",
        "todos",
        "checkpoints",
        "messages",
        "digest",
        "pads",
        "provenance",
    ] {
        let db = rusqlite::Connection::open(output.join(format!("{name}.db"))).unwrap();
        db.execute_batch(&std::fs::read_to_string(seeds.join(format!("{name}.seed.sql"))).unwrap())
            .unwrap();
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    }
}
