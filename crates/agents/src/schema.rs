//! Current schema creation for standalone stores; the Daemon initializes `project.db`.
use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};
use std::path::Path;

pub fn open(db: &mut Connection, path: &Path) -> rusqlite::Result<()> {
    if path.file_name().is_some_and(|name| name == "project.db") {
        return Ok(());
    }
    let migrations = vec![
        M::up(include_str!("../migrations/001/up.sql")),
        M::up(include_str!("../migrations/002/up.sql")),
        M::up(include_str!("../migrations/003/up.sql")),
        M::up(include_str!("../migrations/004/up.sql")),
        M::up(include_str!("../migrations/005/up.sql")),
        M::up(include_str!("../migrations/006/up.sql")),
        M::up(include_str!("../migrations/007/up.sql")),
        M::up(include_str!("../migrations/008/up.sql")),
        M::up(include_str!("../migrations/009/up.sql")),
        M::up(include_str!("../migrations/010/up.sql")),
        M::up(include_str!("../migrations/011/up.sql")),
        M::up(include_str!("../migrations/012/up.sql")),
        M::up(include_str!("../migrations/013/up.sql")),
        M::up(include_str!("../migrations/014/up.sql")),
        M::up(include_str!("../migrations/015/up.sql")),
        M::up(include_str!("../migrations/016/up.sql")),
    ];
    let count = migrations.len();
    Migrations::new(migrations).to_latest(db).map_err(|error| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(format!(
            "{}: migration through {count}: {error}",
            path.display()
        ))))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a4452c_existing_standalone_stores_gain_opening_prompts() {
        let mut db = Connection::open_in_memory().unwrap();
        // Main's fifteen migrations model a store opened before Opening prompts existed.
        for version in 1..=15 {
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(format!("migrations/{version:03}/up.sql"));
            db.execute_batch(&std::fs::read_to_string(path).unwrap())
                .unwrap();
        }
        db.pragma_update(None, "user_version", 15).unwrap();
        open(&mut db, Path::new("agents.db")).unwrap();
        db.execute("INSERT INTO nodes (kind, name, ord, opening_prompt) VALUES ('workstream', 'team', 0, 'Read the plan')", []).unwrap();
        let prompt: String = db
            .query_row(
                "SELECT opening_prompt FROM nodes WHERE name='team'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(prompt, "Read the plan");
    }
}
