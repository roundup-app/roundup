//! SQLite persistence for Todos. `blocked` is computed on read, never stored.

use provenance::now_ms;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::Mutex;

use crate::error::Error;
use contracts::todo::{Change, Comment, Handed, Priority, Todo, UnreadComment, Values};
use contracts::{Actor, ActorKind};
use rpc::OpenError;
use rusqlite::{Connection, OptionalExtension, params};

// Compare Actor fields, not serialized objects: whitespace/key order and absent/null parents
// decode equally. Missing/null owners both have no kind/id/parent. Handed takes precedence
// over owner changes on the same row, matching the typed History fold (T26).
const LAST_OWNER_CHANGE: &str = "SELECT last.seq FROM changes last
    WHERE last.todo = t.id AND (last.handed IS NOT NULL
        OR json_extract(last.before_values, '$.owner.kind') IS NOT json_extract(last.after_values, '$.owner.kind')
        OR json_extract(last.before_values, '$.owner.id') IS NOT json_extract(last.after_values, '$.owner.id')
        OR json_extract(last.before_values, '$.owner.parent') IS NOT json_extract(last.after_values, '$.owner.parent'))
    ORDER BY last.seq DESC LIMIT 1";

pub(crate) struct Store {
    pub(super) db: Connection,
}

impl Store {
    pub(crate) fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut db = Connection::open(path)?;
        db.set_transaction_behavior(rusqlite::TransactionBehavior::Immediate);
        // The Daemon initializes Project WAL; repeating the pragma eagerly loads its whole schema.
        if path.file_name().is_none_or(|name| name != "project.db") {
            db.pragma_update(None, "journal_mode", "WAL")?;
        }
        db.pragma_update(None, "foreign_keys", true)?;
        crate::schema::open(&mut db, path)?;
        Ok(Self { db })
    }

    /// A34: apply deletion and Home changes through the Project database.
    pub(crate) fn remove_workstream(
        &self,
        db: &Connection,
        home: &str,
        actor: &Actor,
        removal: &mut contracts::agent::Removal,
        scope: contracts::agent::RemoveScope,
    ) -> Result<Vec<contracts::EventData>, Error> {
        use contracts::EventData;
        use contracts::agent::{KeptItem, KeptReason, RemovalKind, RemovedItem};
        use contracts::todo::TodoId;
        let before = self.list()?;
        let mut events = Vec::new();
        for todo in before.iter().filter(|t| t.home.as_deref() == Some(home)) {
            if todo.done || scope == contracts::agent::RemoveScope::All {
                db.execute("DELETE FROM todos WHERE id = ?", [todo.id])?;
                removal.removed.push(RemovedItem {
                    id: todo.id.to_string(),
                    kind: RemovalKind::Todo,
                    name: todo.title.clone(),
                });
                events.push((todo.id, EventData::TodoDeleted(TodoId { id: todo.id })));
            } else {
                db.execute("UPDATE todos SET home = NULL WHERE id = ?", [todo.id])?;
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
            if todo.home.as_deref() == Some(home)
                && (todo.done || scope == contracts::agent::RemoveScope::All)
            {
                continue;
            }
            todo.blockers = db
                .prepare("SELECT blocker FROM blockers WHERE todo = ? ORDER BY blocker")?
                .query_map([todo.id], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<u32>>>()?;
            let previous = before_values
                .get(&todo.id)
                .ok_or_else(|| Error::internal("listed Todo has no initial values"))?;
            let after = values(&todo);
            if previous != &after {
                let at = now_ms().max(0);
                todo.updated_at = at;
                db.execute(
                    "UPDATE todos SET updated_at = ?2 WHERE id = ?1",
                    params![todo.id, at],
                )?;
                let after_touch: i64 =
                    db.query_row("SELECT COALESCE(MAX(seq), 0) FROM touches", [], |row| {
                        row.get(0)
                    })?;
                db.execute(
                    "INSERT INTO changes(todo, before_values, after_values, after_touch, actor, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![todo.id, serde_json::to_string(previous)?, serde_json::to_string(&after)?, after_touch, creator_json(actor)?, at],
                )?;
            }
            let was_blocked = todo.blocked;
            todo.blocked = db.query_row("SELECT EXISTS(SELECT 1 FROM blockers b JOIN todos t ON t.id = b.blocker WHERE b.todo = ? AND t.done = 0)", [todo.id], |r| r.get(0))?;
            if todo.home.as_deref() == Some(home) {
                todo.home = None;
                events.push((todo.id, EventData::TodoUpdated(todo.clone().into())));
            }
            if was_blocked && !todo.blocked {
                events.push((todo.id, EventData::TodoUnblocked(TodoId { id: todo.id })));
            }
        }
        // T13 observes Todo changes in id order, including moves and deletions.
        events.sort_by_key(|(id, _)| *id);
        Ok(events.into_iter().map(|(_, event)| event).collect())
    }

    /// Every id in `blockers` must exist, or the call is `NOT_FOUND`.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn insert(
        &self,
        title: &str,
        body: &str,
        blockers: &[u32],
        creator: &Actor,
        owner: Option<&Actor>,
        priority: Option<Priority>,
        after_touch: i64,
    ) -> Result<Todo, Error> {
        self.require_all(blockers)?;
        let created_at = now_ms().max(0);
        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO todos (title, body, created_at, updated_at, creator, owner, priority, pos)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX(pos), 0) + 1 FROM todos))",
            params![
                title,
                body,
                created_at,
                creator_json(creator)?,
                owner.map(creator_json).transpose()?,
                priority
                    .map(|value| serde_json::to_string(&value))
                    .transpose()?
            ],
        )?;
        let id = u32::try_from(tx.last_insert_rowid()).map_err(Error::internal)?;
        self.insert_blockers(id, blockers)?;
        self.record_change(id, None, after_touch, creator)?;
        tx.commit()?;
        self.get(id)
    }

    pub(crate) fn get(&self, id: u32) -> Result<Todo, Error> {
        let mut todo = self.db.query_row(
            "SELECT id, title, body, done, created_at, updated_at, creator, home, owner, priority,
             EXISTS(SELECT 1 FROM blockers b JOIN todos o ON o.id = b.blocker
                    WHERE b.todo = todos.id AND o.done = 0)
             FROM todos WHERE id = ?1", [id], |r| Ok(todo_row(r)),
        ).optional()?
            .ok_or_else(|| Error::NotFound(format!("todo {id}")))??;
        todo.blockers = self.blockers_of(id)?;
        todo.refs = self.refs(id)?;
        Ok(todo)
    }

    /// Bounded to one fact per current Todo. Values stay in SQLite, never in History replies.
    pub(crate) fn list_handed(&self) -> Result<Vec<Handed>, Error> {
        let mut stmt = self.db.prepare(&format!(
            "SELECT c.todo, c.seq, c.handed, t.owner
                 FROM todos t JOIN changes c ON c.seq = ({LAST_OWNER_CHANGE})
                 WHERE c.handed IS NOT NULL AND t.owner IS NOT NULL ORDER BY c.seq"
        ))?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, u32>(0)?,
                r.get::<_, u32>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        let mut handed = Vec::new();
        for row in rows {
            let (todo, seq, to, owner) = row?;
            let to = parse_creator(&to)?;
            let owner = parse_creator(&owner)?;
            if owner.kind == ActorKind::Agent && to == owner {
                handed.push(Handed { todo, seq, owner });
            }
        }
        Ok(handed)
    }

    pub(crate) fn list(&self) -> Result<Vec<Todo>, Error> {
        // T5642a: three executions replace 1 + 3N reads; only ids/indices accompany final Todos.
        let mut stmt = self.db.prepare(
            "SELECT id, title, body, done, created_at, updated_at, creator, home, owner, priority,
             EXISTS(SELECT 1 FROM blockers b JOIN todos o ON o.id = b.blocker
                    WHERE b.todo = todos.id AND o.done = 0)
             FROM todos ORDER BY pos, id",
        )?;
        let rows = stmt.query_map([], |r| Ok(todo_row(r)))?;
        let mut todos = Vec::new();
        let mut indices = HashMap::new();
        for row in rows {
            let todo = row??;
            indices.insert(todo.id, todos.len());
            todos.push(todo);
        }
        let mut stmt = self
            .db
            .prepare("SELECT todo, blocker FROM blockers ORDER BY todo, blocker")?;
        let edges = stmt.query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, u32>(1)?)))?;
        for edge in edges {
            let (id, blocker) = edge?;
            if let Some(todo) = indices.get(&id).and_then(|&index| todos.get_mut(index)) {
                todo.blockers.push(blocker);
            }
        }
        let mut stmt = self
            .db
            .prepare("SELECT todo, url FROM todo_refs ORDER BY todo, id")?;
        let refs = stmt.query_map([], |r| Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?)))?;
        for reference in refs {
            let (id, url) = reference?;
            if let Some(todo) = indices.get(&id).and_then(|&index| todos.get_mut(index)) {
                todo.refs.push(url);
            }
        }
        Ok(todos)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update(
        &self,
        id: u32,
        title: Option<&str>,
        body: Option<&str>,
        priority: Option<Option<Priority>>,
        expected_change: Option<u32>,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Todo, Error> {
        let tx = self.db.unchecked_transaction()?;
        let current = self.get(id)?;
        let before = values(&current);
        self.require_change(id, expected_change)?;
        self.db
            .execute(
                "UPDATE todos SET title = COALESCE(?2, title), body = COALESCE(?3, body), priority = ?4 WHERE id = ?1",
                params![id, title, body, priority.unwrap_or(current.priority).map(|value| serde_json::to_string(&value)).transpose()?],
            )
            ?;
        self.record_change(id, Some(before), after_touch, actor)?;
        tx.commit()?;
        self.get(id)
    }

    pub(crate) fn set_done(
        &self,
        id: u32,
        done: bool,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Todo, Error> {
        let before = values(&self.get(id)?);
        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "UPDATE todos SET done = ?2 WHERE id = ?1",
            params![id, done],
        )?;
        self.record_change(id, Some(before), after_touch, actor)?;
        tx.commit()?;
        self.get(id)
    }

    /// Puts `id` before `before`, or last. The caller has checked both ids and that `id != before`.
    pub(crate) fn reorder(&self, id: u32, before: Option<u32>) -> Result<Todo, Error> {
        let mut ids: Vec<u32> = self.list()?.into_iter().map(|t| t.id).collect();
        ids.retain(|other| *other != id);
        let at = before
            .and_then(|b| ids.iter().position(|other| *other == b))
            .unwrap_or(ids.len());
        ids.insert(at, id);
        let tx = self.db.unchecked_transaction()?;
        for (pos, todo) in (1_i64..).zip(&ids) {
            tx.execute(
                "UPDATE todos SET pos = ?2 WHERE id = ?1",
                params![todo, pos],
            )?;
        }
        tx.commit()?;
        self.get(id)
    }

    /// The Todo that follows `id` in the Todo order, if any.
    pub(crate) fn successor(&self, id: u32) -> Result<Option<u32>, Error> {
        let ids: Vec<u32> = self.list()?.into_iter().map(|t| t.id).collect();
        Ok(ids
            .iter()
            .position(|other| *other == id)
            .and_then(|i| ids.get(i + 1).copied()))
    }

    /// Sets the Home. The caller has checked that a Workstream exists on the Rail.
    pub(crate) fn set_home(&self, id: u32, home: Option<&str>) -> Result<Todo, Error> {
        let tx = self.db.unchecked_transaction()?;
        self.get(id)?;
        self.db.execute(
            "UPDATE todos SET home = ?2 WHERE id = ?1",
            params![id, home],
        )?;
        let retained: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='rail_removal_items')",
            [],
            |r| r.get(0),
        )?;
        if retained {
            tx.execute(
                "DELETE FROM rail_removal_items WHERE kind='todo-home' AND id=? AND operation IN (SELECT operation FROM rail_deletions WHERE restored=0)",
                [id.to_string()],
            )
            ?;
        }
        tx.commit()?;
        self.get(id)
    }

    /// Sets the owner and records one History Change. The caller has checked the Agent (T17).
    pub(crate) fn set_owner(
        &self,
        id: u32,
        owner: Option<&Actor>,
        expected_change: Option<u32>,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Todo, Error> {
        let tx = self.db.unchecked_transaction()?;
        let before = values(&self.get(id)?);
        self.require_change(id, expected_change)?;
        self.db.execute(
            "UPDATE todos SET owner = ?2 WHERE id = ?1",
            params![id, owner.map(creator_json).transpose()?],
        )?;
        self.record_change(id, Some(before), after_touch, actor)?;
        let retained: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='rail_removal_items')",
            [],
            |r| r.get(0),
        )?;
        if retained {
            tx.execute(
                "DELETE FROM rail_removal_items WHERE kind='todo-owner' AND id=? AND operation IN (SELECT operation FROM rail_deletions WHERE restored=0)",
                [id.to_string()],
            )
            ?;
        }
        tx.commit()?;
        self.get(id)
    }

    /// T25, T26: records a hand-off Change for the first open, unblocked Todo `agent` owns that no
    /// hand-off Change for its current owner follows the last owner Change of. `None` when no Todo is due.
    pub(crate) fn hand(
        &self,
        agent: &str,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Option<Todo>, Error> {
        let tx = self.db.unchecked_transaction()?;
        let id = {
            let mut stmt = tx.prepare(&format!(
                "SELECT t.id, t.owner, c.handed, t.creator, c.actor FROM todos t
                 LEFT JOIN changes c ON c.seq = ({LAST_OWNER_CHANGE})
                 WHERE t.done = 0 AND json_extract(t.owner, '$.kind') = 'agent'
                    AND json_extract(t.owner, '$.id') = ?1
                    AND NOT EXISTS(SELECT 1 FROM blockers b JOIN todos o ON o.id = b.blocker
                                   WHERE b.todo = t.id AND o.done = 0)
                 ORDER BY t.pos, t.id"
            ))?;
            let mut rows = stmt.query([agent])?;
            let mut selected = None;
            while let Some(row) = rows.next()? {
                let owner: String = row.get(1)?;
                let owner = parse_creator(&owner)?;
                let handed: Option<String> = row.get(2)?;
                let handed = handed.map(|text| parse_creator(&text)).transpose()?;
                // DTC1: a Todo the agent created for itself, its owner unchanged by anyone else since, is no hand-off.
                let creator: String = row.get(3)?;
                let by: Option<String> = row.get(4)?;
                let own = parse_creator(&creator)? == owner
                    && by
                        .map(|text| parse_creator(&text))
                        .transpose()?
                        .is_none_or(|actor| actor == owner);
                if own {
                    continue;
                }
                if handed.as_ref() != Some(&owner) {
                    selected = Some(row.get::<_, u32>(0)?);
                    break;
                }
            }
            selected
        };
        let Some(id) = id else {
            return Ok(None);
        };
        let todo = self.get(id)?;
        let at = values(&todo);
        tx.execute(
            "INSERT INTO changes(todo, before_values, after_values, after_touch, actor, changed_at, handed) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6)",
            params![todo.id, serde_json::to_string(&at)?, after_touch, creator_json(actor)?, now_ms().max(0), todo.owner.as_ref().map(creator_json).transpose()?],
        )?;
        tx.commit()?;
        Ok(Some(todo))
    }

    /// Replaces the whole blocker list. The caller has checked ids and cycles.
    pub(crate) fn set_blockers(
        &self,
        id: u32,
        blockers: &[u32],
        expected_change: Option<u32>,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Todo, Error> {
        let tx = self.db.unchecked_transaction()?;
        let before = values(&self.get(id)?);
        self.require_change(id, expected_change)?;
        tx.execute("DELETE FROM blockers WHERE todo = ?1", [id])?;
        self.insert_blockers(id, blockers)?;
        self.record_change(id, Some(before), after_touch, actor)?;
        tx.commit()?;
        self.get(id)
    }

    /// T20: appends a line to the thread. It is no Change: no field of the Todo moves.
    pub(crate) fn add_comment(&self, id: u32, author: &Actor, body: &str) -> Result<(), Error> {
        self.get(id)?;
        // An Agent's comment waits for the user to read it (T23); the user's own is born read.
        let read = author.kind == contracts::ActorKind::User;
        self.db
            .execute(
                "INSERT INTO comments (todo, author, body, created_at, read) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, creator_json(author)?, body, now_ms().max(0), read],
            )
            ?;
        Ok(())
    }

    /// T27: the links in the order added. An unknown Todo has none; callers check it first.
    pub(crate) fn refs(&self, id: u32) -> Result<Vec<String>, Error> {
        let mut stmt = self
            .db
            .prepare("SELECT url FROM todo_refs WHERE todo = ?1 ORDER BY id")?;
        stmt.query_map([id], |r| r.get(0))
            .and_then(|rows| rows.collect())
            .map_err(Error::from)
    }

    /// T27: whether `target` was new to the Todo. A ref is no Change: no field of the Todo's history moves.
    pub(crate) fn add_ref(&self, id: u32, target: &str, url: &str) -> Result<bool, Error> {
        self.get(id)?;
        let added = self.db.execute(
            "INSERT OR IGNORE INTO todo_refs (todo, target, url) VALUES (?1, ?2, ?3)",
            params![id, target, url],
        )?;
        Ok(added > 0)
    }

    /// T27: whether the Todo parked `target`.
    pub(crate) fn remove_ref(&self, id: u32, target: &str) -> Result<bool, Error> {
        self.get(id)?;
        let removed = self.db.execute(
            "DELETE FROM todo_refs WHERE todo = ?1 AND target = ?2",
            params![id, target],
        )?;
        Ok(removed > 0)
    }

    /// Oldest first.
    pub(crate) fn comments(&self, id: u32) -> Result<Vec<Comment>, Error> {
        self.get(id)?;
        self.comment_rows("WHERE todo = ?1 ORDER BY id", params![id])
    }

    /// Every unread comment with its Todo, oldest first.
    pub(crate) fn unread(&self) -> Result<Vec<UnreadComment>, Error> {
        let mut stmt = self.db.prepare(
            "SELECT c.todo, t.title, c.id, c.author, c.body, c.created_at, c.read
                 FROM comments c JOIN todos t ON t.id = c.todo WHERE c.read = 0 ORDER BY c.id",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, comment_row(r, 2)?)))?;
        rows.map(|row| {
            let (todo, title, raw) = row?;
            Ok(UnreadComment {
                todo,
                title,
                comment: comment_of(raw)?,
            })
        })
        .collect()
    }

    /// Whether any comment of the Todo was unread and now is read.
    pub(crate) fn mark_comments_read(&self, id: u32) -> Result<bool, Error> {
        self.get(id)?;
        let changed = self.db.execute(
            "UPDATE comments SET read = 1 WHERE todo = ?1 AND read = 0",
            [id],
        )?;
        Ok(changed > 0)
    }

    fn comment_rows(
        &self,
        clause: &str,
        args: impl rusqlite::Params,
    ) -> Result<Vec<Comment>, Error> {
        let sql = format!("SELECT id, author, body, created_at, read FROM comments {clause}");
        let mut stmt = self.db.prepare(&sql)?;
        let rows = stmt.query_map(args, |r| comment_row(r, 0))?;
        rows.map(|row| comment_of(row?)).collect()
    }

    /// Called inside the mutation transaction, before any write or History Change.
    pub(crate) fn require_change(&self, id: u32, expected: Option<u32>) -> Result<(), Error> {
        if let Some(expected) = expected {
            let current: u32 = self.db.query_row(
                "SELECT COALESCE(MAX(seq), 0) FROM changes WHERE todo = ?1",
                [id],
                |row| row.get(0),
            )?;
            if current != expected {
                return Err(Error::Conflict(format!(
                    "todo {id} changed since the captured base"
                )));
            }
        }
        Ok(())
    }

    pub(super) fn record_change(
        &self,
        id: u32,
        before: Option<Values>,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<(), Error> {
        let after = values(&self.get(id)?);
        if before.as_ref() == Some(&after) {
            return Ok(());
        }
        let at = now_ms().max(0);
        let created = before.is_none();
        self.db.execute(
            "INSERT INTO changes(todo, before_values, after_values, after_touch, actor, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, before.map(|value| serde_json::to_string(&value)).transpose()?, serde_json::to_string(&after)?, after_touch, creator_json(actor)?, at],
        )?;
        // T30: creation keeps `updated_at` equal to `created_at`; every later Change moves it.
        if !created {
            self.db.execute(
                "UPDATE todos SET updated_at = ?2 WHERE id = ?1",
                params![id, at],
            )?;
        }
        Ok(())
    }

    pub(crate) fn history(&self, id: u32) -> Result<Vec<(Change, i64)>, Error> {
        self.get(id)?;
        let mut stmt = self.db.prepare("SELECT seq, before_values, after_values, after_touch, actor, changed_at, handed FROM changes WHERE todo = ?1 ORDER BY seq")?;
        let rows = stmt.query_map([id], |r| {
            Ok((
                r.get::<_, u32>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })?;
        rows.map(|row| {
            let (seq, before, after, touch, actor, changed_at, handed) = row?;
            Ok((
                Change {
                    actor: actor.map(|text| parse_creator(&text)).transpose()?,
                    seq,
                    changed_at,
                    handed: handed.map(|text| parse_creator(&text)).transpose()?,
                    before: before.map(|text| serde_json::from_str(&text)).transpose()?,
                    after: serde_json::from_str(&after)?,
                },
                touch,
            ))
        })
        .collect()
    }

    pub(crate) fn blocked_ids(&self) -> Result<BTreeSet<u32>, Error> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|t| t.blocked)
            .map(|t| t.id)
            .collect())
    }

    pub(crate) fn edges(&self) -> Result<HashMap<u32, Vec<u32>>, Error> {
        Ok(self
            .list()?
            .into_iter()
            .map(|t| (t.id, t.blockers))
            .collect())
    }

    fn blockers_of(&self, id: u32) -> Result<Vec<u32>, Error> {
        self.db
            .prepare("SELECT blocker FROM blockers WHERE todo = ?1 ORDER BY blocker")
            .and_then(|mut stmt| stmt.query_map([id], |r| r.get(0))?.collect())
            .map_err(Error::from)
    }

    fn insert_blockers(&self, id: u32, blockers: &[u32]) -> Result<(), Error> {
        for blocker in blockers {
            self.db.execute(
                "INSERT OR IGNORE INTO blockers (todo, blocker) VALUES (?1, ?2)",
                [id, *blocker],
            )?;
        }
        Ok(())
    }

    pub(crate) fn require_all(&self, ids: &[u32]) -> Result<(), Error> {
        ids.iter().try_for_each(|id| self.get(*id).map(drop))
    }
}

/// Relations are filled by the caller, so base payloads move directly into the returned array.
fn todo_row(r: &rusqlite::Row<'_>) -> Result<Todo, Error> {
    let row = (|| -> rusqlite::Result<_> {
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
            r.get::<_, String>(6)?,
            r.get(7)?,
            r.get::<_, Option<String>>(8)?,
            r.get::<_, Option<String>>(9)?,
            r.get(10)?,
        ))
    })()?;
    let (id, title, body, done, created_at, updated_at, creator, home, owner, priority, blocked) =
        row;
    Ok(Todo {
        id,
        title,
        body,
        done,
        created_at,
        updated_at,
        home,
        blocked,
        creator: parse_creator(&creator)?,
        owner: owner.map(|text| parse_creator(&text)).transpose()?,
        priority: priority
            .map(|text| serde_json::from_str(&text))
            .transpose()?,
        blockers: Vec::new(),
        refs: Vec::new(),
    })
}

type CommentRow = (u32, String, String, i64, bool);

fn comment_row(r: &rusqlite::Row<'_>, at: usize) -> rusqlite::Result<CommentRow> {
    Ok((
        r.get(at)?,
        r.get(at + 1)?,
        r.get(at + 2)?,
        r.get(at + 3)?,
        r.get(at + 4)?,
    ))
}

fn comment_of((id, author, body, created_at, read): CommentRow) -> Result<Comment, Error> {
    Ok(Comment {
        id,
        author: parse_creator(&author)?,
        body,
        created_at,
        read,
    })
}

pub(super) fn values(todo: &Todo) -> Values {
    Values {
        title: todo.title.clone(),
        body: todo.body.clone(),
        done: todo.done,
        blockers: todo.blockers.clone(),
        owner: todo.owner.clone(),
        priority: todo.priority,
    }
}

fn creator_json(creator: &Actor) -> serde_json::Result<String> {
    serde_json::to_string(creator)
}

fn parse_creator(text: &str) -> serde_json::Result<Actor> {
    serde_json::from_str(text)
}

impl super::Todos {
    /// `dir` is the Project's data folder (N1).
    pub(super) fn open_store(dir: &Path) -> Result<Self, OpenError> {
        Ok(Self {
            store: Mutex::new(Store::open(&dir.join(
                if dir.join("project.db").exists() {
                    "project.db"
                } else {
                    "todos.db"
                },
            ))?),
        })
    }

    pub(super) fn store(&self) -> Result<std::sync::MutexGuard<'_, Store>, Error> {
        self.store
            .lock()
            .map_err(|_| Error::internal("todo store poisoned"))
    }
}

pub(super) fn item(id: u32) -> String {
    format!("todo:{id}")
}
