use std::path::Path;

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

use crate::added;
use crate::image::{reference, seed_fresh};

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

/// The frozen head (1 to 10), then every `migrations/project/*.sql` that `build.rs` found.
pub fn migrations() -> Vec<M<'static>> {
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

/// A store's own connection to the Project database in `dir`, created and migrated as needed.
pub fn connect(dir: &Path) -> rusqlite::Result<Connection> {
    let path = dir.join("project.db");
    // A failed seed only costs the replay: the migrations below build the same database.
    let _ = seed_fresh(&path);
    let run = || -> rusqlite::Result<Connection> {
        let mut db = Connection::open(&path)?;
        refuse_divergent(&db)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        let stored: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if stored <= migrations().len() as i64 {
            apply(&mut db, migrations())?;
            convert_saved_modes(&db)?;
        }
        Ok(db)
    };
    run().map_err(|e| {
        error(format!(
            "{}: {e} To start fresh, close roundup and delete {}.",
            path.display(),
            std::path::absolute(dir)
                .unwrap_or_else(|_| dir.to_path_buf())
                .display()
        ))
    })
}

/// A saved Mode written before Modes became root Agents is a root Workstream holding an opening
/// prompt: make it a root Agent in place, keeping its id, prompt bytes and nested Agents. Kept out
/// of a migration, which MG1 holds additive; it changes no row that is already an Agent.
fn convert_saved_modes(db: &Connection) -> rusqlite::Result<()> {
    db.execute(
        "UPDATE nodes SET kind = 'agent' \
         WHERE kind = 'workstream' AND parent IS NULL AND opening_prompt IS NOT NULL",
        [],
    )
    .map(drop)
}

/// N22: an empty directory holding the real Project schema, for a store's tests; open it with `connect`.
pub fn fixture() -> rusqlite::Result<tempfile::TempDir> {
    let dir = tempfile::tempdir().map_err(|e| error(e.to_string()))?;
    connect(dir.path())?;
    Ok(dir)
}

#[cfg(test)]
pub(crate) fn added_at(sql: &str) -> usize {
    10 + added::ADDED.iter().position(|added| *added == sql).unwrap()
}

fn refuse_divergent(db: &Connection) -> rusqlite::Result<()> {
    let known = migrations().len();
    let stored: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let empty: bool = db.query_row(
        "SELECT NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\')",
        [], |r| r.get(0),
    )?;
    if stored <= 0 && !(stored == 0 && empty) {
        return Err(error("Local data is incompatible with this build."));
    }
    if stored > known as i64 {
        // MG3: a database ahead by additive migrations still holds everything this build knows.
        return match crate::migration::missing(db, &reference()?)? {
            None => Ok(()),
            Some(difference) => Err(error(format!(
                "database version {stored}; this build supports through {known}. This database lacks what this build needs ({difference}); it came from a newer or branch build. Use the build that wrote it, or reset this disposable pre-release database after closing roundup."
            ))),
        };
    }
    if stored == 0 {
        return Ok(());
    }
    let reference = if stored == known as i64 {
        reference()?
    } else {
        let mut reference = Connection::open_in_memory()?;
        let known_migrations = migrations();
        let Some(applied) = known_migrations.get(..stored as usize) else {
            return Err(error("Local data is incompatible with this build."));
        };
        apply(&mut reference, applied.to_vec())?;
        reference
    };
    if let Some(difference) = crate::migration::difference(db, &reference)? {
        return Err(error(crate::migration::divergence(
            &difference,
            stored,
            known,
        )));
    }
    Ok(())
}

pub(crate) fn apply(db: &mut Connection, migrations: Vec<M<'_>>) -> rusqlite::Result<()> {
    let count = migrations.len();
    let stored: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    Migrations::from_slice(&migrations).to_latest(db).map_err(|error| {
        let message = match &error {
            rusqlite_migration::Error::MigrationDefinition(
                rusqlite_migration::MigrationDefinitionError::DatabaseTooFarAhead,
            ) => format!("database version {stored}; this build supports through {count}. This database came from a newer or branch build. Use the build that wrote it, or reset this disposable pre-release database after closing roundup."),
            rusqlite_migration::Error::RusqliteError { query, .. } => {
                // The library returns the full failed entry's SQL, not only its failed statement.
                let position = migrations.iter().enumerate().find(|(index, migration)| {
                    *index as i64 >= stored && **migration == M::up(query)
                });
                match position {
                    Some((index, _)) => format!("migration {}: {error}", index + 1),
                    None => format!("migration through {count}: {error}"),
                }
            }
            _ => format!("migration through {count}: {error}"),
        };
        self::error(message)
    })
}

pub(crate) fn error(message: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(message.into())))
}
