use super::*;

/// Compiles `build.rs` and runs it over the crate copy in `root`; returns the added list.
fn generated(root: &Path) -> Vec<String> {
    use std::process::Command;
    let out = root.join("out");
    std::fs::create_dir_all(&out).unwrap();
    let bin = out.join("build_rs");
    let built = Command::new("rustc")
        .args(["--edition", "2024", "-o"])
        .arg(&bin)
        .arg(root.join("crate/build.rs"))
        .status()
        .unwrap();
    assert!(built.success());
    let ran = Command::new(&bin)
        .env("CARGO_MANIFEST_DIR", root.join("crate"))
        .env("OUT_DIR", &out)
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    std::fs::read_to_string(out.join("added_migrations.rs"))
        .unwrap()
        .lines()
        .filter_map(|l| l.trim().strip_prefix("include_str!(\""))
        .map(|l| {
            l.trim_end_matches("\"),")
                .rsplit('/')
                .next()
                .unwrap()
                .to_owned()
        })
        .collect()
}

fn crate_copy(root: &Path) {
    let src = Path::new(env!("CARGO_MANIFEST_DIR"));
    std::fs::create_dir_all(root.join("crate")).unwrap();
    // The probe has no dependencies: cut the fresh image, which needs rusqlite.
    let build = std::fs::read_to_string(src.join("build.rs")).unwrap();
    let listing: String = build
        .split("// IMAGE-BEGIN")
        .next()
        .unwrap()
        .lines()
        .filter(|l| !l.contains("// IMAGE-CALL"))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(root.join("crate/build.rs"), listing).unwrap();
}

fn git(root: &Path, args: &[&str]) -> std::process::Output {
    std::process::Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(root)
        .output()
        .unwrap()
}

fn add(root: &Path, name: &str) {
    let dir = root.join("crate/migrations/project");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(name),
        format!("CREATE TABLE t_{}(x);", &name[5..name.len() - 4]),
    )
    .unwrap();
    git(root, &["add", "."]);
    assert!(git(root, &["commit", "-m", name]).status.success());
}

/// N21: two branches each add one migration file; the merge is clean and both run, `a` first.
#[test]
fn n21_two_migrations_added_on_two_branches_merge_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    crate_copy(root);
    git(root, &["init", "-b", "main"]);
    git(root, &["add", "."]);
    assert!(git(root, &["commit", "-m", "base"]).status.success());
    git(root, &["checkout", "-b", "b"]);
    add(root, "0011-b.sql");
    git(root, &["checkout", "main"]);
    git(root, &["checkout", "-b", "a"]);
    add(root, "0011-a.sql");
    let merged = git(root, &["merge", "b", "-m", "merge"]);
    assert!(
        merged.status.success(),
        "{}",
        String::from_utf8_lossy(&merged.stdout)
    );
    assert!(
        git(root, &["diff", "--name-only", "--diff-filter=U"])
            .stdout
            .is_empty()
    );
    assert_eq!(generated(root), ["0011-a.sql", "0011-b.sql"]);
}

/// N21: files added out of order run after the head in name order, and a bad name fails the build.
#[test]
fn n21_a_migration_file_runs_after_the_head_in_name_order() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    crate_copy(root);
    git(root, &["init", "-b", "main"]);
    add(root, "0012-second.sql");
    add(root, "0011-first.sql");
    let names = generated(root);
    assert_eq!(names, ["0011-first.sql", "0012-second.sql"]);
    let base = migrations().len();
    let sql: Vec<String> = names
        .iter()
        .map(|n| std::fs::read_to_string(root.join("crate/migrations/project").join(n)).unwrap())
        .collect();
    let mut db = Connection::open_in_memory().unwrap();
    let all: Vec<M> = migrations()
        .into_iter()
        .chain(sql.iter().map(|s| M::up(s)))
        .collect();
    apply(&mut db, all).unwrap();
    let applied: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(applied, i64::try_from(base).unwrap() + 2);
    let tables: i64 = db
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name IN ('t_first','t_second')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(tables, 2);
    std::fs::write(root.join("crate/migrations/project/notes.txt"), "").unwrap();
    let bad = std::process::Command::new(root.join("out/build_rs"))
        .env("CARGO_MANIFEST_DIR", root.join("crate"))
        .env("OUT_DIR", root.join("out"))
        .output()
        .unwrap();
    assert!(!bad.status.success());
    assert!(String::from_utf8_lossy(&bad.stderr).contains("notes.txt"));
}
