use std::path::Path;
use std::sync::Mutex;

use contracts::{Actor, ActorKind, Touch, Verb};
use rusqlite::{Connection, OptionalExtension, params};

use crate::Touches;

impl Touches {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        Self::from_connection(Connection::open(path)?, path)
    }

    pub fn in_memory() -> rusqlite::Result<Self> {
        Self::from_connection(
            Connection::open_in_memory()?,
            Path::new("provenance.db (memory)"),
        )
    }

    fn from_connection(mut db: Connection, path: &Path) -> rusqlite::Result<Self> {
        // The Daemon initializes Project WAL; repeating the pragma eagerly loads its whole schema.
        if path.file_name().is_none_or(|name| name != "project.db") {
            db.pragma_update(None, "journal_mode", "WAL")?;
        }
        crate::schema::open(&mut db, path)?;
        Ok(Self { db: Mutex::new(db) })
    }

    pub fn record(&self, actor: &Actor, verb: Verb, item: &str) -> rusqlite::Result<()> {
        self.record_revision(actor, verb, item, None)
    }

    /// The history sequence belongs to this read Touch, not to a separate read flag.
    pub fn record_todo_read(
        &self,
        actor: &Actor,
        item: &str,
        through: u32,
    ) -> rusqlite::Result<()> {
        self.record_revision(actor, Verb::Read, item, Some(through))
    }

    /// Orders Todo changes against reads even when the wall clock does not advance.
    pub fn sequence(&self) -> rusqlite::Result<i64> {
        self.db()?
            .query_row("SELECT COALESCE(MAX(seq), 0) FROM touches", [], |row| {
                row.get(0)
            })
    }

    /// Last read by this Actor: Touch order and, when known, the history it actually fetched.
    pub fn todo_read(
        &self,
        actor: &Actor,
        item: &str,
    ) -> rusqlite::Result<Option<(i64, Option<u32>)>> {
        self.db()?.query_row(
            "SELECT seq, todo_revision FROM touches WHERE item = ?1 AND actor_kind = ?2 AND actor_id = ?3 AND verb = 'read' ORDER BY seq DESC LIMIT 1",
            params![item, kind_str(actor.kind), actor.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()
    }

    fn record_revision(
        &self,
        actor: &Actor,
        verb: Verb,
        item: &str,
        revision: Option<u32>,
    ) -> rusqlite::Result<()> {
        let at = crate::now_ms();
        self.db()?.execute(
            "INSERT INTO touches (actor_kind, actor_id, actor_parent, verb, item, at, todo_revision) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![kind_str(actor.kind), actor.id, actor.parent, verb_str(verb), item, at, revision],
        )?;
        Ok(())
    }

    /// Oldest first.
    pub fn history(&self, item: &str) -> rusqlite::Result<Vec<Touch>> {
        self.query("WHERE item = ?1", item)
    }

    /// Oldest first.
    pub fn touched(&self, actor_id: &str) -> rusqlite::Result<Vec<Touch>> {
        self.query("WHERE actor_id = ?1", actor_id)
    }

    fn db(&self) -> rusqlite::Result<std::sync::MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|_| rusqlite::Error::InvalidQuery)
    }

    fn query(&self, filter: &str, arg: &str) -> rusqlite::Result<Vec<Touch>> {
        let db = self.db()?;
        let mut stmt = db.prepare(&format!(
            "SELECT actor_kind, actor_id, actor_parent, verb, item, at FROM touches {filter} ORDER BY seq"
        ))?;
        stmt.query_map([arg], |row| {
            Ok(Touch {
                actor: Actor {
                    kind: parse_kind(&row.get::<_, String>(0)?),
                    id: row.get(1)?,
                    parent: row.get(2)?,
                },
                verb: parse_verb(&row.get::<_, String>(3)?),
                item: row.get(4)?,
                at: row.get(5)?,
            })
        })?
        .collect()
    }
}

fn kind_str(kind: ActorKind) -> &'static str {
    match kind {
        ActorKind::User => "user",
        ActorKind::Agent => "agent",
        ActorKind::Ext => "ext",
    }
}

fn parse_kind(text: &str) -> ActorKind {
    match text {
        "agent" => ActorKind::Agent,
        "ext" => ActorKind::Ext,
        _ => ActorKind::User,
    }
}

fn verb_str(verb: Verb) -> &'static str {
    match verb {
        Verb::Read => "read",
        Verb::Wrote => "wrote",
    }
}

fn parse_verb(text: &str) -> Verb {
    if text == "read" {
        Verb::Read
    } else {
        Verb::Wrote
    }
}
