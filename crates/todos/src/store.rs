//! SQLite persistence for Todos. `blocked` is computed on read, never stored.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use contracts::Actor;
use contracts::todo::{Change, Todo, Values};
use rpc::RpcError;
use rusqlite::{Connection, OptionalExtension, params};

/// What a Todo's `creator` column holds before this field existed: the user, by definition (T8).
const LEGACY_CREATOR: &str = r#"{"kind":"user","id":"you","parent":null}"#;

pub(crate) struct Store {
    db: Connection,
}

impl Store {
    pub(crate) fn open(
        path: &Path,
        before_write: impl Fn(u32) -> rusqlite::Result<i64>,
    ) -> rusqlite::Result<Self> {
        let db = Connection::open(path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.pragma_update(None, "foreign_keys", true)?;
        db.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                creator TEXT NOT NULL DEFAULT '{LEGACY_CREATOR}'
            );
            CREATE TABLE IF NOT EXISTS blockers (
                todo INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
                blocker INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
                PRIMARY KEY (todo, blocker)
            );"
        ))?;
        Self::migrate_creator_column(&db)?;
        Self::migrate_home_column(&db)?;
        Self::migrate_pos_column(&db)?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS changes (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            todo INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
            before_values TEXT,
            after_values TEXT NOT NULL,
            after_touch INTEGER NOT NULL
        ); CREATE INDEX IF NOT EXISTS changes_todo ON changes(todo, seq);",
        )?;
        let store = Self { db };
        let tx = store.db.unchecked_transaction()?;
        let baselines = store.db.prepare("SELECT id, title, body, done FROM todos WHERE NOT EXISTS (SELECT 1 FROM changes WHERE todo = todos.id)")?
            .query_map([], |r| Ok((r.get::<_, u32>(0)?, Values { title: r.get(1)?, body: r.get(2)?, done: r.get(3)?, blockers: vec![] })))?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, mut after) in baselines {
            after.blockers = store
                .blockers_of(id)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            store.db.execute("INSERT INTO changes(todo, before_values, after_values, after_touch) VALUES (?1, NULL, ?2, ?3)", params![id, serde_json::to_string(&after).map_err(|_| rusqlite::Error::InvalidQuery)?, before_write(id)?])?;
        }
        tx.commit()?;
        Ok(store)
    }

    /// A `todos.db` from before T8 has no `creator` column; such a Todo is the user's (T8).
    fn migrate_creator_column(db: &Connection) -> rusqlite::Result<()> {
        let has_creator: bool = db.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('todos') WHERE name = 'creator'",
            [],
            |row| row.get(0),
        )?;
        if !has_creator {
            db.execute_batch(&format!(
                "ALTER TABLE todos ADD COLUMN creator TEXT NOT NULL DEFAULT '{LEGACY_CREATOR}'"
            ))?;
        }
        Ok(())
    }

    /// A `todos.db` from before T12 has no `home` column; its Todos stay `NULL`, the Project root.
    fn migrate_home_column(db: &Connection) -> rusqlite::Result<()> {
        let has_home: bool = db.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('todos') WHERE name = 'home'",
            [],
            |row| row.get(0),
        )?;
        if !has_home {
            db.execute_batch("ALTER TABLE todos ADD COLUMN home TEXT")?;
        }
        Ok(())
    }

    /// A `todos.db` from before T10 has no `pos` column; its Todos take id order.
    fn migrate_pos_column(db: &Connection) -> rusqlite::Result<()> {
        let has_pos: bool = db.query_row(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('todos') WHERE name = 'pos'",
            [],
            |row| row.get(0),
        )?;
        if !has_pos {
            db.execute_batch(
                "ALTER TABLE todos ADD COLUMN pos INTEGER NOT NULL DEFAULT 0;
                 UPDATE todos SET pos = id;",
            )?;
        }
        Ok(())
    }

    /// A34: apply deletion and Home changes through the attached Todo store.
    pub(crate) fn remove_workstream(
        &self,
        db: &Connection,
        home: &str,
        removal: &mut contracts::agent::Removal,
    ) -> Result<Vec<contracts::EventData>, RpcError> {
        use contracts::EventData;
        use contracts::agent::{KeptItem, KeptReason, RemovalKind, RemovedItem};
        use contracts::todo::TodoId;
        let before = self.list()?;
        let mut events = Vec::new();
        for todo in before.iter().filter(|t| t.home.as_deref() == Some(home)) {
            if todo.done {
                db.execute("DELETE FROM removal_todos.todos WHERE id = ?", [todo.id])
                    .map_err(RpcError::internal)?;
                removal.removed.push(RemovedItem {
                    id: todo.id.to_string(),
                    kind: RemovalKind::Todo,
                    name: todo.title.clone(),
                });
                events.push(EventData::TodoDeleted(TodoId { id: todo.id }));
            } else {
                db.execute(
                    "UPDATE removal_todos.todos SET home = NULL WHERE id = ?",
                    [todo.id],
                )
                .map_err(RpcError::internal)?;
                removal.kept.push(KeptItem {
                    id: todo.id.to_string(),
                    kind: RemovalKind::Todo,
                    name: todo.title.clone(),
                    reason: KeptReason::Open,
                });
            }
        }
        let before_values: HashMap<_, _> =
            before.iter().map(|todo| (todo.id, values(todo))).collect();
        for mut todo in before {
            if todo.home.as_deref() == Some(home) && todo.done {
                continue;
            }
            todo.blockers = db
                .prepare(
                    "SELECT blocker FROM removal_todos.blockers WHERE todo = ? ORDER BY blocker",
                )
                .map_err(RpcError::internal)?
                .query_map([todo.id], |r| r.get(0))
                .map_err(RpcError::internal)?
                .collect::<rusqlite::Result<Vec<u32>>>()
                .map_err(RpcError::internal)?;
            let previous = before_values
                .get(&todo.id)
                .expect("listed Todo has initial values");
            let after = values(&todo);
            if previous != &after {
                let after_touch: i64 = db
                    .query_row(
                        "SELECT COALESCE(MAX(seq), 0) FROM removal_touches.touches",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(RpcError::internal)?;
                db.execute(
                    "INSERT INTO removal_todos.changes(todo, before_values, after_values, after_touch) VALUES (?1, ?2, ?3, ?4)",
                    params![todo.id, serde_json::to_string(previous).map_err(RpcError::internal)?, serde_json::to_string(&after).map_err(RpcError::internal)?, after_touch],
                ).map_err(RpcError::internal)?;
            }
            let was_blocked = todo.blocked;
            todo.blocked = db.query_row("SELECT EXISTS(SELECT 1 FROM removal_todos.blockers b JOIN removal_todos.todos t ON t.id = b.blocker WHERE b.todo = ? AND t.done = 0)", [todo.id], |r| r.get(0)).map_err(RpcError::internal)?;
            if todo.home.as_deref() == Some(home) {
                todo.home = None;
                events.push(EventData::TodoUpdated(todo.clone().into()));
            }
            if was_blocked && !todo.blocked {
                events.push(EventData::TodoUnblocked(TodoId { id: todo.id }));
            }
        }
        // T13 observes Todo changes in id order, including moves and deletions.
        events.sort_by_key(|e| match e {
            EventData::TodoDeleted(t) | EventData::TodoUnblocked(t) => t.id,
            EventData::TodoUpdated(t) => t.id,
            _ => unreachable!(),
        });
        Ok(events)
    }

    /// Every id in `blockers` must exist, or the call is `NOT_FOUND`.
    pub(crate) fn insert(
        &self,
        title: &str,
        body: &str,
        blockers: &[u32],
        creator: &Actor,
        after_touch: i64,
    ) -> Result<Todo, RpcError> {
        self.require_all(blockers)?;
        let created_at = i64::try_from(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
        )
        .unwrap_or(i64::MAX);
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        tx.execute(
            "INSERT INTO todos (title, body, created_at, creator, pos)
             VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(pos), 0) + 1 FROM todos))",
            params![title, body, created_at, creator_json(creator)],
        )
        .map_err(RpcError::internal)?;
        let id = u32::try_from(tx.last_insert_rowid()).map_err(RpcError::internal)?;
        self.insert_blockers(id, blockers)?;
        self.record_change(id, None, after_touch)?;
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    pub(crate) fn get(&self, id: u32) -> Result<Todo, RpcError> {
        let row = self
            .db
            .query_row(
                "SELECT title, body, done, created_at, creator, home, EXISTS(
                    SELECT 1 FROM blockers b JOIN todos o ON o.id = b.blocker
                    WHERE b.todo = todos.id AND o.done = 0
                ) FROM todos WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get::<_, String>(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                },
            )
            .optional()
            .map_err(RpcError::internal)?;
        let (title, body, done, created_at, creator, home, blocked) =
            row.ok_or_else(|| RpcError::not_found(format!("todo {id}")))?;
        Ok(Todo {
            id,
            title,
            body,
            done,
            blockers: self.blockers_of(id)?,
            blocked,
            created_at,
            creator: parse_creator(&creator).map_err(RpcError::internal)?,
            home,
        })
    }

    pub(crate) fn list(&self) -> Result<Vec<Todo>, RpcError> {
        let ids = self
            .db
            .prepare("SELECT id FROM todos ORDER BY pos, id")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| r.get::<_, u32>(0))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(RpcError::internal)?;
        ids.into_iter().map(|id| self.get(id)).collect()
    }

    pub(crate) fn update(
        &self,
        id: u32,
        title: Option<&str>,
        body: Option<&str>,
        after_touch: i64,
    ) -> Result<Todo, RpcError> {
        let before = values(&self.get(id)?);
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        self.db
            .execute(
                "UPDATE todos SET title = COALESCE(?2, title), body = COALESCE(?3, body) WHERE id = ?1",
                params![id, title, body],
            )
            .map_err(RpcError::internal)?;
        self.record_change(id, Some(before), after_touch)?;
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    pub(crate) fn complete(&self, id: u32, after_touch: i64) -> Result<Todo, RpcError> {
        let before = values(&self.get(id)?);
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        self.db
            .execute("UPDATE todos SET done = 1 WHERE id = ?1", [id])
            .map_err(RpcError::internal)?;
        self.record_change(id, Some(before), after_touch)?;
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    /// Puts `id` before `before`, or last. The caller has checked both ids and that `id != before`.
    pub(crate) fn reorder(&self, id: u32, before: Option<u32>) -> Result<Todo, RpcError> {
        let mut ids: Vec<u32> = self.list()?.into_iter().map(|t| t.id).collect();
        ids.retain(|other| *other != id);
        let at = before
            .and_then(|b| ids.iter().position(|other| *other == b))
            .unwrap_or(ids.len());
        ids.insert(at, id);
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        for (pos, todo) in (1_i64..).zip(&ids) {
            tx.execute(
                "UPDATE todos SET pos = ?2 WHERE id = ?1",
                params![todo, pos],
            )
            .map_err(RpcError::internal)?;
        }
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    /// The Todo that follows `id` in the Todo order, if any.
    pub(crate) fn successor(&self, id: u32) -> Result<Option<u32>, RpcError> {
        let ids: Vec<u32> = self.list()?.into_iter().map(|t| t.id).collect();
        Ok(ids
            .iter()
            .position(|other| *other == id)
            .and_then(|i| ids.get(i + 1).copied()))
    }

    /// Sets the Home. The caller has checked that a Workstream exists on the Rail.
    pub(crate) fn set_home(&self, id: u32, home: Option<&str>) -> Result<Todo, RpcError> {
        self.get(id)?;
        self.db
            .execute(
                "UPDATE todos SET home = ?2 WHERE id = ?1",
                params![id, home],
            )
            .map_err(RpcError::internal)?;
        self.get(id)
    }

    /// Replaces the whole blocker list. The caller has checked ids and cycles.
    pub(crate) fn set_blockers(
        &self,
        id: u32,
        blockers: &[u32],
        after_touch: i64,
    ) -> Result<Todo, RpcError> {
        let before = values(&self.get(id)?);
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        tx.execute("DELETE FROM blockers WHERE todo = ?1", [id])
            .map_err(RpcError::internal)?;
        self.insert_blockers(id, blockers)?;
        self.record_change(id, Some(before), after_touch)?;
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    /// Blockers pointing at `id` go with it (foreign keys cascade).
    pub(crate) fn delete(&self, id: u32, after_touch: i64) -> Result<(), RpcError> {
        self.get(id)?;
        let affected: Vec<_> = self
            .list()?
            .into_iter()
            .filter(|todo| todo.blockers.contains(&id))
            .collect();
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        self.db
            .execute("DELETE FROM todos WHERE id = ?1", [id])
            .map_err(RpcError::internal)?;
        for todo in affected {
            self.record_change(todo.id, Some(values(&todo)), after_touch)?;
        }
        tx.commit().map_err(RpcError::internal)?;
        Ok(())
    }

    fn record_change(
        &self,
        id: u32,
        before: Option<Values>,
        after_touch: i64,
    ) -> Result<(), RpcError> {
        let after = values(&self.get(id)?);
        if before.as_ref() == Some(&after) {
            return Ok(());
        }
        self.db.execute(
            "INSERT INTO changes(todo, before_values, after_values, after_touch) VALUES (?1, ?2, ?3, ?4)",
            params![id, before.map(|value| serde_json::to_string(&value)).transpose().map_err(RpcError::internal)?, serde_json::to_string(&after).map_err(RpcError::internal)?, after_touch],
        ).map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn history(&self, id: u32) -> Result<Vec<(Change, i64)>, RpcError> {
        self.get(id)?;
        let mut stmt = self.db.prepare("SELECT seq, before_values, after_values, after_touch FROM changes WHERE todo = ?1 ORDER BY seq").map_err(RpcError::internal)?;
        let rows = stmt
            .query_map([id], |r| {
                Ok((
                    r.get::<_, u32>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(RpcError::internal)?;
        rows.map(|row| {
            let (seq, before, after, touch) = row.map_err(RpcError::internal)?;
            Ok((
                Change {
                    seq,
                    before: before
                        .map(|text| serde_json::from_str(&text))
                        .transpose()
                        .map_err(RpcError::internal)?,
                    after: serde_json::from_str(&after).map_err(RpcError::internal)?,
                },
                touch,
            ))
        })
        .collect()
    }

    pub(crate) fn blocked_ids(&self) -> Result<BTreeSet<u32>, RpcError> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|t| t.blocked)
            .map(|t| t.id)
            .collect())
    }

    pub(crate) fn edges(&self) -> Result<HashMap<u32, Vec<u32>>, RpcError> {
        Ok(self
            .list()?
            .into_iter()
            .map(|t| (t.id, t.blockers))
            .collect())
    }

    fn blockers_of(&self, id: u32) -> Result<Vec<u32>, RpcError> {
        self.db
            .prepare("SELECT blocker FROM blockers WHERE todo = ?1 ORDER BY blocker")
            .and_then(|mut stmt| stmt.query_map([id], |r| r.get(0))?.collect())
            .map_err(RpcError::internal)
    }

    fn insert_blockers(&self, id: u32, blockers: &[u32]) -> Result<(), RpcError> {
        for blocker in blockers {
            self.db
                .execute(
                    "INSERT OR IGNORE INTO blockers (todo, blocker) VALUES (?1, ?2)",
                    [id, *blocker],
                )
                .map_err(RpcError::internal)?;
        }
        Ok(())
    }

    pub(crate) fn require_all(&self, ids: &[u32]) -> Result<(), RpcError> {
        ids.iter().try_for_each(|id| self.get(*id).map(drop))
    }
}

fn values(todo: &Todo) -> Values {
    Values {
        title: todo.title.clone(),
        body: todo.body.clone(),
        done: todo.done,
        blockers: todo.blockers.clone(),
    }
}

fn creator_json(creator: &Actor) -> String {
    serde_json::to_string(creator).expect("an Actor is always serializable")
}

fn parse_creator(text: &str) -> serde_json::Result<Actor> {
    serde_json::from_str(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_creator_matches_actor_user() {
        assert_eq!(parse_creator(LEGACY_CREATOR).unwrap(), Actor::user());
    }
}
