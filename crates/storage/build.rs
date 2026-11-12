#![allow(clippy::disallowed_methods)] // a build script reads cargo's variables, not the Daemon's
//! N21: every `migrations/project/<NNNN>-<name>.sql` is a Project migration after the frozen head.
use std::{env, error::Error, fs, path::Path, path::PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let dir = root.join("migrations/project");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries {
            let path = entry?.path();
            let name = path
                .file_name()
                .ok_or_else(|| format!("{}: a migration has a file name", path.display()))?
                .to_string_lossy()
                .into_owned();
            let b = name.as_bytes();
            let fits = b.len() > 9
                && b.get(..4).is_some_and(|d| d.iter().all(u8::is_ascii_digit))
                && b.get(4) == Some(&b'-')
                && name.ends_with(".sql")
                && path.is_file();
            if !fits {
                return Err(
                    format!("{}: a migration is named <NNNN>-<name>.sql", path.display()).into(),
                );
            }
            names.push(name);
        }
    }
    names.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
    fresh_image(&root, &dir, &names)?; // IMAGE-CALL
    let mut out = String::from("pub(crate) const ADDED: &[&str] = &[\n");
    for name in names {
        out += &format!("    include_str!({:?}),\n", dir.join(name));
    }
    out += "];\n";
    fs::write(
        PathBuf::from(env::var("OUT_DIR")?).join("added_migrations.rs"),
        out,
    )?;
    Ok(())
}

// IMAGE-BEGIN: the N21 tests compile this file with bare `rustc` and cut from here on.
use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

/// The frozen head of `storage.rs`, in order.
const HEAD: [&str; 10] = [
    "migrations/001/up.sql",
    "../agents/migrations/003/up.sql",
    "migrations/003/up.sql",
    "../agents/migrations/004/up.sql",
    "migrations/005/up.sql",
    "../pads/migrations/002/up.sql",
    "migrations/006/up.sql",
    "../agents/migrations/005/up.sql",
    "../messages/migrations/002/up.sql",
    "../messages/migrations/003/up.sql",
];

/// The ids the image holds in place of a Project's own, one per table; `storage.rs` has the same ids.
const IDENTITIES: [&str; 1] = ["00000000000000000000000000000001"];

/// R3696c: a fresh `project.db` is copied from this migrated image, not replayed through every migration.
fn fresh_image(root: &Path, dir: &Path, added: &[String]) -> Result<(), Box<dyn Error>> {
    let mut sources = Vec::new();
    for path in HEAD
        .iter()
        .map(|h| root.join(h))
        .chain(added.iter().map(|n| dir.join(n)))
    {
        println!("cargo:rerun-if-changed={}", path.display());
        sources.push(fs::read_to_string(path)?);
    }
    let out = PathBuf::from(env::var("OUT_DIR")?);
    let (work, image) = (out.join("fresh-work.db"), out.join("fresh.db"));
    for f in [&work, &image] {
        let _ = fs::remove_file(f);
    }
    let mut db = Connection::open(&work)?;
    // DV2: 8 KiB pages halve publication write calls; build them here to avoid runtime VACUUM.
    db.pragma_update(None, "page_size", 8192)?;
    let migrations: Vec<M> = sources.iter().map(|s| M::up(s)).collect();
    Migrations::new(migrations).to_latest(&mut db)?;
    // Placeholders `storage.rs` replaces with each Project's own ids, in the bytes of the copy.
    let [identity] = IDENTITIES;
    db.execute("UPDATE deliverable_project SET id=?1", [identity])?;
    let image_path = image
        .to_str()
        .ok_or_else(|| format!("{}: the image path is not UTF-8", image.display()))?;
    db.execute("VACUUM INTO ?1", [image_path])?;
    // The WAL mode is kept in the file, so `storage::open` finds it set and writes nothing.
    let image_db = Connection::open(&image)?;
    image_db.pragma_update(None, "journal_mode", "WAL")?;
    drop(image_db);
    // R3696c: scanning the larger image on every fresh open costs more than its SQLite open.
    // These byte regions bound the existing literal search, without interpreting SQLite's format.
    let bytes = fs::read(&image)?;
    let mut regions = Vec::new();
    for id in IDENTITIES {
        for (at, window) in bytes.windows(id.len()).enumerate() {
            if window == id.as_bytes() {
                let start = at / 4096 * 4096;
                regions.push((start, (start + 4096 + id.len() - 1).min(bytes.len())));
            }
        }
    }
    regions.sort_unstable();
    regions.dedup();
    fs::write(
        out.join("fresh_regions.rs"),
        format!("pub(crate) const ID_REGIONS: &[(usize, usize)] = &{regions:?};\n"),
    )?;
    Ok(())
}
