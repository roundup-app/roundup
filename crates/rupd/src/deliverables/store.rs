//! Every SQL statement over `deliverables` and `deliverable_files`, as `*_in(tx, …)` on the
//! caller's transaction. No file IO and no other table's SQL lives here.
use super::DeliverableError;
use contracts::deliverable::{Deliverable, DeliverableId};
use rusqlite::{Connection, OptionalExtension, params};

type Result<T> = std::result::Result<T, DeliverableError>;

pub(super) fn project_in(db: &Connection) -> Result<String> {
    Ok(db.query_row("SELECT id FROM deliverable_project", [], |r| r.get(0))?)
}

pub(super) fn new_id_in(db: &Connection) -> Result<String> {
    Ok(db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?)
}

/// The stored request, record and removed flag of this maker's publication under `key`.
pub(super) fn previous_in(
    db: &Connection,
    maker: &str,
    key: &str,
) -> Result<Option<(String, String, bool)>> {
    Ok(db
        .query_row(
            "SELECT request, record, removed FROM deliverables WHERE maker=?1 AND publication_key=?2",
            params![maker, key],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?)
}

pub(super) struct NewRow<'a> {
    pub maker: &'a str,
    pub key: &'a str,
    pub request: &'a str,
    pub file_source: Option<&'a str>,
}

pub(super) fn insert_in(db: &Connection, record: &Deliverable, row: &NewRow) -> Result<()> {
    db.execute(
        "INSERT INTO deliverables(id,maker,publication_key,request,record,home,file_source) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            record.id,
            row.maker,
            row.key,
            row.request,
            serde_json::to_string(record)?,
            record.home,
            row.file_source
        ],
    )?;
    Ok(())
}

pub(super) fn insert_file_in(db: &Connection, id: &str, length: usize) -> Result<()> {
    db.execute(
        "INSERT INTO deliverable_files VALUES (?1,?2)",
        params![id, length as i64],
    )?;
    Ok(())
}

pub(super) fn retained_bytes_in(db: &Connection) -> Result<i64> {
    Ok(db.query_row(
        "SELECT coalesce(sum(length),0) FROM deliverable_files",
        [],
        |r| r.get(0),
    )?)
}

pub(super) fn file_retained_in(db: &Connection, id: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM deliverable_files WHERE id=?1)",
        [id],
        |r| r.get(0),
    )?)
}

pub(super) fn drop_file_in(db: &Connection, id: &str) -> Result<()> {
    db.execute("DELETE FROM deliverable_files WHERE id=?1", [id])?;
    Ok(())
}

/// Removed publications whose retained file row is still present.
pub(super) fn removed_with_files_in(db: &Connection) -> Result<Vec<String>> {
    let mut stmt = db.prepare(
        "SELECT id FROM deliverables WHERE removed=1 AND id IN (SELECT id FROM deliverable_files)",
    )?;
    Ok(stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn decode(record: &str) -> Result<Deliverable> {
    Ok(serde_json::from_str(record)?)
}

pub(super) fn live_in(db: &Connection) -> Result<Vec<Deliverable>> {
    let mut stmt = db.prepare("SELECT record FROM deliverables WHERE removed=0")?;
    stmt.query_map([], |r| r.get::<_, String>(0))?
        .map(|r| decode(&r?))
        .collect()
}

pub(super) fn list_in(db: &Connection, home: Option<&str>) -> Result<Vec<Deliverable>> {
    let mut stmt = db.prepare("SELECT record FROM deliverables WHERE removed=0 AND (?1 IS NULL OR home=?1) ORDER BY rowid")?;
    stmt.query_map([home], |r| r.get::<_, String>(0))?
        .map(|r| decode(&r?))
        .collect()
}

pub(super) fn get_in(db: &Connection, project: &str, p: &DeliverableId) -> Result<Deliverable> {
    if p.project != project {
        return Err(DeliverableError::OtherProject);
    }
    let record: Option<String> = db
        .query_row(
            "SELECT record FROM deliverables WHERE id=?1 AND removed=0",
            [&p.id],
            |r| r.get(0),
        )
        .optional()?;
    decode(&record.ok_or(DeliverableError::Gone)?)
}

pub(super) fn user_placed_in(db: &Connection, id: &str) -> Result<bool> {
    Ok(db.query_row(
        "SELECT user_placed FROM deliverables WHERE id=?1",
        [id],
        |r| r.get(0),
    )?)
}

pub(super) fn place_in(db: &Connection, record: &Deliverable, user_placed: bool) -> Result<()> {
    db.execute(
        "UPDATE deliverables SET record=?1,home=?2,user_placed=?3 WHERE id=?4",
        params![
            serde_json::to_string(record)?,
            record.home,
            user_placed,
            record.id
        ],
    )?;
    Ok(())
}

pub(super) fn remove_in(db: &Connection, id: &str) -> Result<()> {
    db.execute("UPDATE deliverables SET removed=1 WHERE id=?1", [id])?;
    Ok(())
}

/// The captured file source and whether access was revoked.
pub(super) fn file_source_in(db: &Connection, id: &str) -> Result<(String, bool)> {
    Ok(db.query_row(
        "SELECT file_source,access_revoked FROM deliverables WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

pub(super) fn revoke_in(db: &Connection, id: &str) -> Result<()> {
    db.execute("UPDATE deliverables SET access_revoked=1 WHERE id=?1", [id])?;
    Ok(())
}

pub(super) fn revoked_in(db: &Connection, id: &str) -> rusqlite::Result<bool> {
    Ok(db
        .query_row(
            "SELECT access_revoked FROM deliverables WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

/// Rail removal: a removed Home leaves its publications homeless.
pub(crate) fn clear_home_in(db: &Connection, home: &str) -> rusqlite::Result<usize> {
    db.execute(
        "UPDATE deliverables SET home=NULL,record=json_set(record,'$.home',NULL) WHERE home=? AND removed=0",
        [home],
    )
}

/// Undo of a Rail removal: the publications its retained rows name leave their Home again.
pub(crate) fn clear_retained_homes_in(db: &Connection, operation: &str) -> rusqlite::Result<usize> {
    db.execute(
        "UPDATE deliverables SET home=NULL,record=json_set(record,'$.home',NULL) WHERE id IN (SELECT id FROM rail_removal_items WHERE operation=? AND kind='deliverable-home')",
        [operation],
    )
}
