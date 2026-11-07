//! Read-only node lookups for callers that hold their own transaction on the Project database.
use rusqlite::{Connection, OptionalExtension, params};

/// A maker's display name and Worktree path; `None` when its node is gone.
pub fn maker_in(db: &Connection, id: &str) -> rusqlite::Result<Option<(String, Option<String>)>> {
    db.query_row(
        "SELECT name,worktree_path FROM nodes WHERE CAST(id AS TEXT)=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
}

/// The nearest Workstream or Group at or above node `id`.
pub fn home_in(db: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    db.query_row(
        "WITH RECURSIVE ancestry(id,kind,parent) AS (SELECT id,kind,parent FROM nodes WHERE CAST(id AS TEXT)=?1 UNION ALL SELECT n.id,n.kind,n.parent FROM nodes n JOIN ancestry a ON n.id=a.parent) SELECT CAST(id AS TEXT) FROM ancestry WHERE kind IN ('workstream','group') LIMIT 1",
        [id],
        |r| r.get(0),
    )
    .optional()
}

/// Whether `id` names a Workstream or Group, a place a publication can live.
pub fn is_home_in(db: &Connection, id: &str) -> rusqlite::Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=?1 AND kind IN ('workstream','group'))",
        [id],
        |r| r.get(0),
    )
}

/// Whether a node is `maker` or sits at Worktree `root`.
pub fn registered_in(db: &Connection, maker: &str, root: &str) -> rusqlite::Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM nodes WHERE id=?1 OR worktree_path=?2)",
        params![maker, root],
        |r| r.get(0),
    )
}
