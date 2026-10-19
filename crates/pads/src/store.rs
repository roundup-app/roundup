//! App-stored Pads in the Project database, with standalone stores for current callers.

use std::path::Path;

use contracts::{Actor, pad::Pad};
use rpc::{OpenError, RpcError};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use unicode_normalization::UnicodeNormalization;

/// One creation of a Pad in this Project, read with its exact current text and Revision.
/// Incarnations are scoped to this Project database; callers must retain the Project too.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PadSource {
    pub incarnation: i64,
    pub pad: Pad,
}

/// Why a source row was removed. Workstream cleanup is not explicit source revocation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PadDeletion {
    User,
    Owner,
    Cleanup,
}

/// Authoritative lifecycle fact, independent of any later reuse of the Pad's name.
/// Unknown is never permission to substitute a name or grant access.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PadSourceState {
    Live(PadSource),
    Deleted(PadDeletion),
    Unknown,
}

/// Capture a live source through the existing storage owner. The connection must be to
/// this Project's initialized database. A publication writer uses its own transaction
/// here so the capture and publication commit share one SQLite snapshot.
/// One SELECT reads identity, text and Revision coherently; no file mirror is read.
pub fn source(db: &Connection, name: &str) -> rusqlite::Result<Option<PadSource>> {
    db.query_row(
        "SELECT p.name, p.owner, p.text, p.updated_at, p.home, p.revision, s.incarnation
         FROM pads p JOIN pad_sources s ON s.pad_key = p.key WHERE p.key = ?1",
        [key(name)],
        |row| {
            Ok(PadSource {
                incarnation: row.get(6)?,
                pad: row_to_pad(row)?,
            })
        },
    )
    .optional()
}

/// Look up the recorded incarnation, never a reusable name. Uses the caller's Project
/// transaction, so a publication resolver can read its retained record and this fact
/// without racing source deletion. This supplies facts, not an access grant.
pub fn source_state(db: &Connection, incarnation: i64) -> rusqlite::Result<PadSourceState> {
    db.query_row(
        "SELECT p.name, p.owner, p.text, p.updated_at, p.home, p.revision, s.incarnation, s.deletion
         FROM pad_sources s LEFT JOIN pads p ON p.key = s.pad_key WHERE s.incarnation = ?1",
        [incarnation],
        |row| {
            let deletion: Option<String> = row.get(7)?;
            match deletion.as_deref() {
                None => Ok(PadSourceState::Live(PadSource { incarnation: row.get(6)?, pad: row_to_pad(row)? })),
                Some("user") => Ok(PadSourceState::Deleted(PadDeletion::User)),
                Some("owner") => Ok(PadSourceState::Deleted(PadDeletion::Owner)),
                Some("cleanup") => Ok(PadSourceState::Deleted(PadDeletion::Cleanup)),
                Some(_) => Err(rusqlite::Error::InvalidQuery),
            }
        },
    ).optional().map(|state| state.unwrap_or(PadSourceState::Unknown))
}

const FILES_SETTING: &str = "files";

pub struct Store {
    db: Connection,
    settings: &'static str,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, OpenError> {
        let mut db = Connection::open(path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        crate::schema::open(&mut db, path)?;
        Ok(Self {
            db,
            settings: if path.file_name().is_some_and(|name| name == "project.db") {
                "pad_settings"
            } else {
                "settings"
            },
        })
    }

    /// Runs `work` in one write transaction: its Store calls commit together or not at all, and no other connection writes meanwhile.
    pub fn atomically<T>(&self, work: impl FnOnce() -> Result<T, RpcError>) -> Result<T, RpcError> {
        let tx = Transaction::new_unchecked(&self.db, TransactionBehavior::Immediate)
            .map_err(RpcError::internal)?;
        let out = work()?;
        tx.commit().map_err(RpcError::internal)?;
        Ok(out)
    }

    /// False when a Pad with this name already exists.
    pub fn insert(&self, pad: &Pad) -> rusqlite::Result<bool> {
        let changed = self.db.execute(
            "INSERT OR IGNORE INTO pads (key, name, owner, text, updated_at, home, revision) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
            params![
                key(&pad.name),
                pad.name,
                owner_json(&pad.owner),
                pad.text,
                pad.updated_at,
                pad.home
            ],
        )?;
        Ok(changed == 1)
    }

    pub fn get(&self, name: &str) -> rusqlite::Result<Option<Pad>> {
        self.db
            .query_row(
                "SELECT name, owner, text, updated_at, home, revision FROM pads WHERE key = ?1",
                [key(name)],
                row_to_pad,
            )
            .optional()
    }

    /// Ordered by name.
    pub fn list(&self) -> rusqlite::Result<Vec<Pad>> {
        let mut stmt = self.db.prepare(
            "SELECT name, owner, text, updated_at, home, revision FROM pads ORDER BY name",
        )?;
        stmt.query_map([], row_to_pad)?.collect()
    }

    pub fn set_text(&self, name: &str, text: &str, at: i64) -> rusqlite::Result<bool> {
        let changed = self.db.execute(
            "UPDATE pads SET revision = revision + (text <> ?2),
                 updated_at = CASE WHEN text = ?2 THEN updated_at ELSE ?3 END,
                 text = ?2 WHERE key = ?1",
            params![key(name), text, at],
        )?;
        Ok(changed == 1)
    }

    /// Leaves `updated_at` alone: a Home is not an edit of the text.
    pub fn set_home(&self, name: &str, home: Option<&str>) -> rusqlite::Result<bool> {
        let changed = self.db.execute(
            "UPDATE pads SET home = ?2 WHERE key = ?1",
            params![key(name), home],
        )?;
        Ok(changed == 1)
    }

    /// Called only in the same transaction as `delete`, after authorization.
    pub fn record_deletion(&self, name: &str, cause: PadDeletion) -> rusqlite::Result<()> {
        self.db.execute(
            "UPDATE pad_sources SET pad_key = NULL, deletion = ?2 WHERE pad_key = ?1",
            params![
                key(name),
                match cause {
                    PadDeletion::User => "user",
                    PadDeletion::Owner => "owner",
                    PadDeletion::Cleanup => "cleanup",
                }
            ],
        )?;
        Ok(())
    }

    pub fn delete(&self, name: &str) -> rusqlite::Result<bool> {
        let changed = self
            .db
            .execute("DELETE FROM pads WHERE key = ?1", [key(name)])?;
        Ok(changed == 1)
    }

    pub fn set_owner(&self, name: &str, owner: &Actor, at: i64) -> rusqlite::Result<bool> {
        let changed = self.db.execute(
            "UPDATE pads SET owner = ?2, updated_at = ?3 WHERE key = ?1",
            params![key(name), owner_json(owner), at],
        )?;
        Ok(changed == 1)
    }

    pub fn files(&self) -> rusqlite::Result<bool> {
        let value: Option<String> = self
            .db
            .query_row(
                &format!("SELECT value FROM {} WHERE key = ?1", self.settings),
                [FILES_SETTING],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value.as_deref() == Some("true"))
    }

    pub fn set_files(&self, files: bool) -> rusqlite::Result<()> {
        self.db.execute(
            &format!(
                "INSERT INTO {} (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                self.settings
            ),
            params![FILES_SETTING, files.to_string()],
        )?;
        Ok(())
    }
}

/// Names are unique ignoring case and Unicode normalization: APFS treats both kinds of pair as one file.
/// Case folding NFD text leaves it in NFD, so the result needs no second normalization.
pub(crate) fn key(name: &str) -> String {
    let decomposed: String = name.nfd().collect();
    caseless::default_case_fold_str(&decomposed)
}

fn owner_json(owner: &Actor) -> String {
    serde_json::to_string(owner).expect("an Actor is always serializable")
}

fn row_to_pad(row: &rusqlite::Row<'_>) -> rusqlite::Result<Pad> {
    let owner: String = row.get(1)?;
    Ok(Pad {
        name: row.get(0)?,
        owner: serde_json::from_str(&owner).map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(err))
        })?,
        text: row.get(2)?,
        updated_at: row.get(3)?,
        home: row.get(4)?,
        revision: u64::try_from(row.get::<_, i64>(5)?).unwrap_or(1),
    })
}

#[cfg(test)]
mod tests {
    use contracts::Actor;

    use super::*;

    #[test]
    fn updates_to_a_pad_deleted_through_another_connection_report_no_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pads.db");
        let (one, other) = (Store::open(&path).unwrap(), Store::open(&path).unwrap());
        let pad = Pad {
            name: "notes".into(),
            owner: Actor::user(),
            text: String::new(),
            updated_at: 0,
            revision: 1,
            home: None,
        };
        one.insert(&pad).unwrap();
        other.delete("notes").unwrap();

        assert!(!one.set_text("notes", "x", 1).unwrap());
        assert!(!one.set_owner("notes", &Actor::user(), 1).unwrap());
        assert!(!one.delete("notes").unwrap());
    }
}
