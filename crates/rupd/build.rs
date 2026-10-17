//! N21: every `migrations/project/<NNNN>-<name>.sql` is a Project migration after the frozen head.
use std::{env, fs, path::PathBuf};

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
