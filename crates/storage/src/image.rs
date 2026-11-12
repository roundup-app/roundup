//! R3696c: the migrated fresh image a first start copies, and the in-memory databases built from it.
use std::path::Path;

use rusqlite::Connection;

use crate::added;

/// R3696c: every migration applied to an empty database, built by `build.rs`.
pub(crate) const FRESH: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/fresh.db"));

/// The ids the image holds in place of a Project's own (`build.rs` writes the same ids); each is
/// replaced in a copy's bytes, so a fresh start opens no connection to give them values.
pub(crate) const IDENTITIES: [&[u8; 32]; 1] = [b"00000000000000000000000000000001"];

/// Where each of `IDENTITIES` stands in the image, with the new random id to put there, in file
/// order. The image is written around these, so a start never copies its 1 MiB to patch the ids.
fn reidentified() -> std::io::Result<Vec<(usize, [u8; 32])>> {
    let mut random = [0u8; 16 * IDENTITIES.len()];
    getrandom::fill(&mut random).map_err(|e| std::io::Error::other(e.to_string()))?;
    let mut patches = Vec::new();
    for (placeholder, bytes) in IDENTITIES.iter().zip(random.chunks(16)) {
        let mut id = [0u8; 32];
        for (pair, byte) in id.chunks_mut(2).zip(bytes) {
            let hex = format!("{byte:02x}");
            for (slot, digit) in pair.iter_mut().zip(hex.bytes()) {
                *slot = digit;
            }
        }
        let before = patches.len();
        for &(start, end) in added::ID_REGIONS {
            let region = FRESH
                .get(start..end)
                .ok_or_else(|| std::io::Error::other("the image region is out of range"))?;
            for offset in memchr::memmem::find_iter(region, &placeholder[..]) {
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

/// The image with each id in `patches` written over its placeholder.
fn write_image(file: &mut std::fs::File, patches: &[(usize, [u8; 32])]) -> std::io::Result<()> {
    use std::io::Write;
    let mut done = 0;
    for (at, id) in patches {
        file.write_all(patch_gap(done, *at)?)?;
        file.write_all(id)?;
        done = at + id.len();
    }
    file.write_all(patch_gap(done, FRESH.len())?)
}

fn patch_gap(from: usize, to: usize) -> std::io::Result<&'static [u8]> {
    FRESH
        .get(from..to)
        .ok_or_else(|| std::io::Error::other("the image patch is out of range"))
}

/// A Project without `project.db` starts from the migrated image: a first start skips replaying every migration.
pub(crate) fn seed_fresh(path: &Path) -> std::io::Result<()> {
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
    // A racing opener or an existing file wins; the normal path checks its current schema.
    let linked = std::fs::hard_link(&staging, path);
    std::fs::remove_file(&staging)?;
    match linked {
        Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => Err(e),
        _ => Ok(()),
    }
}

/// N22: a private in-memory database holding the real Project schema, for a store with no directory.
pub fn memory() -> rusqlite::Result<Connection> {
    image(false)
}

/// N5420a: current-version input compares against the unchanged fresh image.
pub(crate) fn reference() -> rusqlite::Result<Connection> {
    image(true)
}

fn image(read_only: bool) -> rusqlite::Result<Connection> {
    let mut db = Connection::open_in_memory()?;
    let (Some(head), Some(tail)) = (FRESH.get(..18), FRESH.get(20..)) else {
        return Err(rusqlite::Error::ToSqlConversionFailure(
            "the image is shorter than its header".into(),
        ));
    };
    let image = std::io::Read::chain(std::io::Read::chain(head, &[1u8, 1][..]), tail);
    db.deserialize_read_exact(rusqlite::MAIN_DB, image, FRESH.len(), read_only)?;
    Ok(db)
}
