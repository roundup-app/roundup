//! N16–N17: one Project migration sequence in `project.db`; older per-store databases are never read.
use std::path::Path;

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

const ANSWERS: &str = include_str!("../../agents/migrations/003/up.sql");
const ASKS: &str = include_str!("../../agents/migrations/004/up.sql");
const RESIZES: &str = include_str!("../migrations/003/up.sql");

const PAD_REVISIONS: &str = include_str!("../../pads/migrations/002/up.sql");
const ACTIONS: &str = include_str!("../migrations/005/up.sql");
const MCP: &str = include_str!("../../agents/migrations/005/up.sql");

const EVENTS: &str = include_str!("../migrations/006/up.sql");
const FLIGHT: &str = include_str!("../../messages/migrations/002/up.sql");
const WAKES: &str = include_str!("../../messages/migrations/003/up.sql");

const SCHEMA: &str = include_str!("../migrations/001/up.sql");

mod added {
    include!(concat!(env!("OUT_DIR"), "/added_migrations.rs"));
    include!(concat!(env!("OUT_DIR"), "/fresh_regions.rs"));
}

/// The frozen head (1 to 10), then every `migrations/project/*.sql` that `build.rs` found.
fn migrations() -> Vec<M<'static>> {
    let head = [
        SCHEMA,
        ANSWERS,
        RESIZES,
        ASKS,
        ACTIONS,
        PAD_REVISIONS,
        EVENTS,
        MCP,
        FLIGHT,
        WAKES,
    ];
    head.into_iter()
        .chain(added::ADDED.iter().copied())
        .map(M::up)
        .collect()
}

/// R3696c: every migration applied to an empty database, built by `build.rs`.
const FRESH: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/fresh.db"));

/// The ids the image holds in place of a Project's own (`build.rs` writes the same pair); each is
/// replaced in a copy's bytes, so a fresh start opens no connection to give them values.
const IDENTITIES: [&[u8; 32]; 2] = [
    b"00000000000000000000000000000001",
    b"00000000000000000000000000000002",
];

/// Where each of `IDENTITIES` stands in the image, with the new random id to put there, in file
/// order. The image is written around these, so a start never copies its 1 MiB to patch 64 bytes.
fn reidentified() -> std::io::Result<Vec<(usize, [u8; 32])>> {
    let mut random = [0u8; 16 * IDENTITIES.len()];
    getrandom::fill(&mut random).map_err(|e| std::io::Error::other(e.to_string()))?;
    let mut patches = Vec::new();
    for (placeholder, bytes) in IDENTITIES.iter().zip(random.chunks(16)) {
        let mut id = [0u8; 32];
        for (pair, byte) in id.chunks_mut(2).zip(bytes) {
            pair.copy_from_slice(&[HEX[(byte >> 4) as usize], HEX[(byte & 15) as usize]]);
        }
        let before = patches.len();
        for &(start, end) in added::ID_REGIONS {
            for offset in memchr::memmem::find_iter(&FRESH[start..end], &placeholder[..]) {
                patches.push((start + offset, id));
            }
        }
        if patches.len() == before {
            return Err(std::io::Error::other("the image holds no placeholder id"));
        }
    }
    patches.sort_unstable_by_key(|&(at, _)| at);
    Ok(patches)
}

const HEX: &[u8; 16] = b"0123456789abcdef";

/// The image with each id in `patches` written over its placeholder.
fn write_image(file: &mut std::fs::File, patches: &[(usize, [u8; 32])]) -> std::io::Result<()> {
    use std::io::Write;
    let mut done = 0;
    for (at, id) in patches {
        file.write_all(&FRESH[done..*at])?;
        file.write_all(id)?;
        done = at + id.len();
    }
    file.write_all(&FRESH[done..])
}

/// A Project without `project.db` starts from the migrated image: a first start skips replaying every migration.
fn seed_fresh(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        return Ok(());
    }
    let staging = path.with_extension("db.new");
    // A crashed earlier start may have left a log that would replay onto this image.
    for leftover in ["db.new-wal", "db.new-shm"] {
        let _ = std::fs::remove_file(path.with_extension(leftover));
    }
    write_image(&mut std::fs::File::create(&staging)?, &reidentified()?)?;
    // One sync makes the image durable before it is linked. Plain `fsync`, as SQLite issues:
    // `File::sync_all` is `F_FULLFSYNC` on macOS, several ms of the Daemon's cold start.
    rustix::fs::fsync(std::fs::File::open(&staging)?)?;
    // A racing opener or an existing file wins; the normal path then migrates it.
    let linked = std::fs::hard_link(&staging, path);
    std::fs::remove_file(&staging)?;
    match linked {
        Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => Err(e),
        _ => Ok(()),
    }
}

pub(crate) fn open(dir: &Path) -> rusqlite::Result<Connection> {
    let path = dir.join("project.db");
    // A failed seed only costs the replay: the migrations below build the same database.
    let _ = seed_fresh(&path);
    let run = || -> rusqlite::Result<Connection> {
        let mut db = Connection::open(&path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        apply(&mut db, migrations())?;
        Ok(db)
    };
    run().map_err(|e| error(format!("{}: {e}", path.display())))
}

fn apply(db: &mut Connection, migrations: Vec<M<'_>>) -> rusqlite::Result<()> {
    let count = migrations.len();
    Migrations::new(migrations)
        .to_latest(db)
        .map_err(|e| error(format!("migration through {count}: {e}")))
}

fn error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(message.into())))
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;

#[cfg(test)]
mod newer_tests {
    use super::*;

    #[test]
    fn n5088a_project_refuses_a_newer_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("project.db");
        let known = i64::try_from(migrations().len()).unwrap();
        let stored = known + 1;
        let db = Connection::open(&path).unwrap();
        db.pragma_update(None, "user_version", stored).unwrap();
        drop(db);

        let message = open(dir.path()).unwrap_err().to_string();
        assert!(message.contains(&path.display().to_string()), "{message}");
        assert!(
            message.contains(&format!("database version {stored}")),
            "{message}"
        );
        assert!(
            message.contains(&format!("supports through {known}")),
            "{message}"
        );
        assert!(message.contains("newer or branch build"), "{message}");
        assert!(message.contains("closing roundup"), "{message}");

        let db = Connection::open(&path).unwrap();
        assert_eq!(
            db.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            stored
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
    }
}
