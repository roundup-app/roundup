//! Scenario IP7168c (`scenarios/idle-power.md`): the idle window of `just perf`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::time::Duration;

use perf::measure::idle_window;
use rusqlite::Connection;

#[tokio::test]
async fn ip7168c_the_idle_window_sees_a_write_and_the_cpu() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("project.db");
    let writer = Connection::open(&db).unwrap();
    writer
        .execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE t (n INTEGER);")
        .unwrap();
    let pid = std::process::id();

    let quiet = idle_window(pid, &db, Duration::from_millis(200))
        .await
        .unwrap();
    assert!(!quiet.wrote);

    let commits = std::thread::spawn(move || {
        for n in 0..2 {
            std::thread::sleep(Duration::from_millis(150));
            writer.execute("INSERT INTO t VALUES (?1)", [n]).unwrap();
        }
    });
    let busy = idle_window(pid, &db, Duration::from_millis(500))
        .await
        .unwrap();
    commits.join().unwrap();

    assert!(busy.wrote);
    assert!(busy.cpu_percent.is_finite() && busy.cpu_percent >= 0.0);
}
