//! N21: every `migrations/project/<NNNN>-<name>.sql` is a Project migration after the frozen head.
use std::{env, fs, path::Path, path::PathBuf};

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dir = root.join("migrations/project");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            let b = name.as_bytes();
            let fits = b.len() > 9
                && b[..4].iter().all(u8::is_ascii_digit)
                && b[4] == b'-'
                && name.ends_with(".sql")
                && path.is_file();
            if !fits {
                panic!("{}: a migration is named <NNNN>-<name>.sql", path.display());
            }
            names.push(name);
        }
    }
    names.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
    fresh_image(&root, &dir, &names); // IMAGE-CALL
    let mut out = String::from("pub(crate) const ADDED: &[&str] = &[\n");
    for name in names {
        out += &format!("    include_str!({:?}),\n", dir.join(name));
    }
    out += "];\n";
    fs::write(
        PathBuf::from(env::var("OUT_DIR").unwrap()).join("added_migrations.rs"),
        out,
    )
    .unwrap();
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

/// R3696c: a fresh `project.db` is copied from this migrated image, not replayed through every migration.
fn fresh_image(root: &Path, dir: &Path, added: &[String]) {
    let mut sources = Vec::new();
    for path in HEAD
        .iter()
        .map(|h| root.join(h))
        .chain(added.iter().map(|n| dir.join(n)))
    {
        println!("cargo:rerun-if-changed={}", path.display());
        sources.push(fs::read_to_string(path).unwrap());
    }
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let (work, image) = (out.join("fresh-work.db"), out.join("fresh.db"));
    for f in [&work, &image] {
        let _ = fs::remove_file(f);
    }
    let mut db = Connection::open(&work).unwrap();
    let migrations: Vec<M> = sources.iter().map(|s| M::up(s)).collect();
    Migrations::new(migrations).to_latest(&mut db).unwrap();
    db.execute("VACUUM INTO ?1", [image.to_str().unwrap()])
        .unwrap();
}
