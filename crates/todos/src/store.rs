//! SQLite persistence for Todos. `blocked` is computed on read, never stored.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::Mutex;

use contracts::todo::{Change, Comment, Handed, Todo, UnreadComment, Values};
use contracts::{Actor, ActorKind};
use rpc::{OpenError, RpcError};
use rusqlite::{Connection, OptionalExtension, params};

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
    ) -> Result<Vec<contracts::EventData>, RpcError> {
        use contracts::EventData;
        use contracts::agent::{KeptItem, KeptReason, RemovalKind, RemovedItem};
        use contracts::todo::TodoId;
        let before = self.list()?;
        let mut events = Vec::new();
        for todo in before.iter().filter(|t| t.home.as_deref() == Some(home)) {
            if todo.done || scope == contracts::agent::RemoveScope::All {
                db.execute("DELETE FROM todos WHERE id = ?", [todo.id])
                    .map_err(RpcError::internal)?;
                removal.removed.push(RemovedItem {
                    id: todo.id.to_string(),
                    kind: RemovalKind::Todo,
                    name: todo.title.clone(),
                });
                events.push(EventData::TodoDeleted(TodoId { id: todo.id }));
            } else {
                db.execute("UPDATE todos SET home = NULL WHERE id = ?", [todo.id])
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
            if todo.home.as_deref() == Some(home)
                && (todo.done || scope == contracts::agent::RemoveScope::All)
            {
                continue;
            }
            todo.blockers = db
                .prepare("SELECT blocker FROM blockers WHERE todo = ? ORDER BY blocker")
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
                let at = now_ms();
                todo.updated_at = at;
                db.execute(
                    "UPDATE todos SET updated_at = ?2 WHERE id = ?1",
                    params![todo.id, at],
                )
                .map_err(RpcError::internal)?;
                let after_touch: i64 = db
                    .query_row("SELECT COALESCE(MAX(seq), 0) FROM touches", [], |row| {
                        row.get(0)
                    })
                    .map_err(RpcError::internal)?;
                db.execute(
                    "INSERT INTO changes(todo, before_values, after_values, after_touch, actor, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![todo.id, serde_json::to_string(previous).map_err(RpcError::internal)?, serde_json::to_string(&after).map_err(RpcError::internal)?, after_touch, creator_json(actor), at],
                ).map_err(RpcError::internal)?;
            }
            let was_blocked = todo.blocked;
            todo.blocked = db.query_row("SELECT EXISTS(SELECT 1 FROM blockers b JOIN todos t ON t.id = b.blocker WHERE b.todo = ? AND t.done = 0)", [todo.id], |r| r.get(0)).map_err(RpcError::internal)?;
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
        owner: Option<&Actor>,
        after_touch: i64,
    ) -> Result<Todo, RpcError> {
        self.require_all(blockers)?;
        let created_at = now_ms();
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        tx.execute(
            "INSERT INTO todos (title, body, created_at, updated_at, creator, owner, pos)
             VALUES (?1, ?2, ?3, ?3, ?4, ?5, (SELECT COALESCE(MAX(pos), 0) + 1 FROM todos))",
            params![
                title,
                body,
                created_at,
                creator_json(creator),
                owner.map(creator_json),
            ],
        )
        .map_err(RpcError::internal)?;
        let id = u32::try_from(tx.last_insert_rowid()).map_err(RpcError::internal)?;
        self.insert_blockers(id, blockers)?;
        self.record_change(id, None, after_touch, creator)?;
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    pub(crate) fn get(&self, id: u32) -> Result<Todo, RpcError> {
        let row = self
            .db
            .query_row(
                "SELECT title, body, done, created_at, updated_at, creator, home, owner, EXISTS(
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
                        r.get(4)?,
                        r.get::<_, String>(5)?,
                        r.get(6)?,
                        r.get::<_, Option<String>>(7)?,
                        r.get(8)?,
                    ))
                },
            )
            .optional()
            .map_err(RpcError::internal)?;
        let (title, body, done, created_at, updated_at, creator, home, owner, blocked) =
            row.ok_or_else(|| RpcError::not_found(format!("todo {id}")))?;
        Ok(Todo {
            id,
            title,
            body,
            done,
            blockers: self.blockers_of(id)?,
            blocked,
            created_at,
            updated_at,
            creator: parse_creator(&creator).map_err(RpcError::internal)?,
            home,
            owner: owner
                .map(|text| parse_creator(&text))
                .transpose()
                .map_err(RpcError::internal)?,
            refs: self.refs(id)?,
        })
    }

    /// Bounded to one fact per current Todo. Values stay in SQLite, never in History replies.
    pub(crate) fn list_handed(&self) -> Result<Vec<Handed>, RpcError> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT c.todo, c.seq, c.handed, t.owner
             FROM todos t JOIN changes c ON c.seq = (
                SELECT last.seq FROM changes last WHERE last.todo = t.id AND (
                    last.handed IS NOT NULL OR json_extract(last.before_values, '$.owner')
                        IS NOT json_extract(last.after_values, '$.owner'))
                ORDER BY last.seq DESC LIMIT 1
             ) WHERE c.handed IS NOT NULL AND t.owner IS NOT NULL ORDER BY c.seq",
            )
            .map_err(RpcError::internal)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, u32>(0)?,
                    r.get::<_, u32>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(RpcError::internal)?;
        let mut handed = Vec::new();
        for row in rows {
            let (todo, seq, to, owner) = row.map_err(RpcError::internal)?;
            let to = parse_creator(&to).map_err(RpcError::internal)?;
            let owner = parse_creator(&owner).map_err(RpcError::internal)?;
            if owner.kind == ActorKind::Agent && to == owner {
                handed.push(Handed { todo, seq, owner });
            }
        }
        Ok(handed)
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
        expected_change: Option<u32>,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Todo, RpcError> {
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        let current = self.get(id)?;
        let before = values(&current);
        self.require_change(id, expected_change)?;
        self.db
            .execute(
                "UPDATE todos SET title = COALESCE(?2, title), body = COALESCE(?3, body) WHERE id = ?1",
                params![id, title, body],
            )
            .map_err(RpcError::internal)?;
        self.record_change(id, Some(before), after_touch, actor)?;
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    pub(crate) fn set_done(
        &self,
        id: u32,
        done: bool,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Todo, RpcError> {
        let before = values(&self.get(id)?);
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        tx.execute(
            "UPDATE todos SET done = ?2 WHERE id = ?1",
            params![id, done],
        )
        .map_err(RpcError::internal)?;
        self.record_change(id, Some(before), after_touch, actor)?;
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
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        self.get(id)?;
        self.db
            .execute(
                "UPDATE todos SET home = ?2 WHERE id = ?1",
                params![id, home],
            )
            .map_err(RpcError::internal)?;
        let retained: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='rail_removal_items')",
                [],
                |r| r.get(0),
            )
            .map_err(RpcError::internal)?;
        if retained {
            tx.execute(
                "DELETE FROM rail_removal_items WHERE kind='todo-home' AND id=? AND operation IN (SELECT operation FROM rail_deletions WHERE restored=0)",
                [id.to_string()],
            )
            .map_err(RpcError::internal)?;
        }
        tx.commit().map_err(RpcError::internal)?;
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
    ) -> Result<Todo, RpcError> {
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        let before = values(&self.get(id)?);
        self.require_change(id, expected_change)?;
        self.db
            .execute(
                "UPDATE todos SET owner = ?2 WHERE id = ?1",
                params![id, owner.map(creator_json)],
            )
            .map_err(RpcError::internal)?;
        self.record_change(id, Some(before), after_touch, actor)?;
        let retained: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='rail_removal_items')",
                [],
                |r| r.get(0),
            )
            .map_err(RpcError::internal)?;
        if retained {
            tx.execute(
                "DELETE FROM rail_removal_items WHERE kind='todo-owner' AND id=? AND operation IN (SELECT operation FROM rail_deletions WHERE restored=0)",
                [id.to_string()],
            )
            .map_err(RpcError::internal)?;
        }
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    /// T25, T26: records a hand-off Change for the first open, unblocked Todo `agent` owns that no
    /// hand-off Change for its current owner follows the last owner Change of. `None` when no Todo is due.
    pub(crate) fn hand(
        &self,
        agent: &str,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Option<Todo>, RpcError> {
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        for todo in self.list()? {
            let owner = match &todo.owner {
                Some(owner) if owner.kind == ActorKind::Agent && owner.id == agent => owner,
                _ => continue,
            };
            if todo.done || todo.blocked || self.handed_to(todo.id, owner)? {
                continue;
            }
            let at = values(&todo);
            self.db.execute(
                "INSERT INTO changes(todo, before_values, after_values, after_touch, actor, changed_at, handed) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6)",
                params![todo.id, serde_json::to_string(&at).map_err(RpcError::internal)?, after_touch, creator_json(actor), now_ms(), creator_json(owner)],
            ).map_err(RpcError::internal)?;
            tx.commit().map_err(RpcError::internal)?;
            return Ok(Some(todo));
        }
        Ok(None)
    }

    /// Whether a hand-off to `owner` follows the last Change of the Todo's owner.
    fn handed_to(&self, id: u32, owner: &Actor) -> Result<bool, RpcError> {
        let mut handed = false;
        for (change, _) in self.history(id)? {
            match &change.handed {
                Some(to) => handed = to == owner,
                None => {
                    let before = change.before.as_ref().and_then(|v| v.owner.as_ref());
                    if before != change.after.owner.as_ref() {
                        handed = false;
                    }
                }
            }
        }
        Ok(handed)
    }

    /// Replaces the whole blocker list. The caller has checked ids and cycles.
    pub(crate) fn set_blockers(
        &self,
        id: u32,
        blockers: &[u32],
        expected_change: Option<u32>,
        after_touch: i64,
        actor: &Actor,
    ) -> Result<Todo, RpcError> {
        let tx = self
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        let before = values(&self.get(id)?);
        self.require_change(id, expected_change)?;
        tx.execute("DELETE FROM blockers WHERE todo = ?1", [id])
            .map_err(RpcError::internal)?;
        self.insert_blockers(id, blockers)?;
        self.record_change(id, Some(before), after_touch, actor)?;
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
    }

    /// T20: appends a line to the thread. It is no Change: no field of the Todo moves.
    pub(crate) fn add_comment(&self, id: u32, author: &Actor, body: &str) -> Result<(), RpcError> {
        self.get(id)?;
        // An Agent's comment waits for the user to read it (T23); the user's own is born read.
        let read = author.kind == contracts::ActorKind::User;
        self.db
            .execute(
                "INSERT INTO comments (todo, author, body, created_at, read) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, creator_json(author), body, now_ms(), read],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    /// T27: the links in the order added. An unknown Todo has none; callers check it first.
    pub(crate) fn refs(&self, id: u32) -> Result<Vec<String>, RpcError> {
        let mut stmt = self
            .db
            .prepare("SELECT url FROM todo_refs WHERE todo = ?1 ORDER BY id")
            .map_err(RpcError::internal)?;
        stmt.query_map([id], |r| r.get(0))
            .and_then(|rows| rows.collect())
            .map_err(RpcError::internal)
    }

    /// T27: whether `target` was new to the Todo. A ref is no Change: no field of the Todo's history moves.
    pub(crate) fn add_ref(&self, id: u32, target: &str, url: &str) -> Result<bool, RpcError> {
        self.get(id)?;
        let added = self
            .db
            .execute(
                "INSERT OR IGNORE INTO todo_refs (todo, target, url) VALUES (?1, ?2, ?3)",
                params![id, target, url],
            )
            .map_err(RpcError::internal)?;
        Ok(added > 0)
    }

    /// T27: whether the Todo parked `target`.
    pub(crate) fn remove_ref(&self, id: u32, target: &str) -> Result<bool, RpcError> {
        self.get(id)?;
        let removed = self
            .db
            .execute(
                "DELETE FROM todo_refs WHERE todo = ?1 AND target = ?2",
                params![id, target],
            )
            .map_err(RpcError::internal)?;
        Ok(removed > 0)
    }

    /// Oldest first.
    pub(crate) fn comments(&self, id: u32) -> Result<Vec<Comment>, RpcError> {
        self.get(id)?;
        self.comment_rows("WHERE todo = ?1 ORDER BY id", params![id])
    }

    /// Every unread comment with its Todo, oldest first.
    pub(crate) fn unread(&self) -> Result<Vec<UnreadComment>, RpcError> {
        let mut stmt = self
            .db
            .prepare(
                "SELECT c.todo, t.title, c.id, c.author, c.body, c.created_at, c.read
                 FROM comments c JOIN todos t ON t.id = c.todo WHERE c.read = 0 ORDER BY c.id",
            )
            .map_err(RpcError::internal)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, comment_row(r, 2)?)))
            .map_err(RpcError::internal)?;
        rows.map(|row| {
            let (todo, title, raw) = row.map_err(RpcError::internal)?;
            Ok(UnreadComment {
                todo,
                title,
                comment: comment_of(raw)?,
            })
        })
        .collect()
    }

    /// Whether any comment of the Todo was unread and now is read.
    pub(crate) fn mark_comments_read(&self, id: u32) -> Result<bool, RpcError> {
        self.get(id)?;
        let changed = self
            .db
            .execute(
                "UPDATE comments SET read = 1 WHERE todo = ?1 AND read = 0",
                [id],
            )
            .map_err(RpcError::internal)?;
        Ok(changed > 0)
    }

    fn comment_rows(
        &self,
        clause: &str,
        args: impl rusqlite::Params,
    ) -> Result<Vec<Comment>, RpcError> {
        let sql = format!("SELECT id, author, body, created_at, read FROM comments {clause}");
        let mut stmt = self.db.prepare(&sql).map_err(RpcError::internal)?;
        let rows = stmt
            .query_map(args, |r| comment_row(r, 0))
            .map_err(RpcError::internal)?;
        rows.map(|row| comment_of(row.map_err(RpcError::internal)?))
            .collect()
    }

    /// Called inside the mutation transaction, before any write or History Change.
    pub(crate) fn require_change(&self, id: u32, expected: Option<u32>) -> Result<(), RpcError> {
        if let Some(expected) = expected {
            let current: u32 = self
                .db
                .query_row(
                    "SELECT COALESCE(MAX(seq), 0) FROM changes WHERE todo = ?1",
                    [id],
                    |row| row.get(0),
                )
                .map_err(RpcError::internal)?;
            if current != expected {
                return Err(RpcError::conflict(format!(
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
    ) -> Result<(), RpcError> {
        let after = values(&self.get(id)?);
        if before.as_ref() == Some(&after) {
            return Ok(());
        }
        let at = now_ms();
        let created = before.is_none();
        self.db.execute(
            "INSERT INTO changes(todo, before_values, after_values, after_touch, actor, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, before.map(|value| serde_json::to_string(&value)).transpose().map_err(RpcError::internal)?, serde_json::to_string(&after).map_err(RpcError::internal)?, after_touch, creator_json(actor), at],
        ).map_err(RpcError::internal)?;
        // T30: creation keeps `updated_at` equal to `created_at`; every later Change moves it.
        if !created {
            self.db
                .execute(
                    "UPDATE todos SET updated_at = ?2 WHERE id = ?1",
                    params![id, at],
                )
                .map_err(RpcError::internal)?;
        }
        Ok(())
    }

    pub(crate) fn history(&self, id: u32) -> Result<Vec<(Change, i64)>, RpcError> {
        self.get(id)?;
        let mut stmt = self.db.prepare("SELECT seq, before_values, after_values, after_touch, actor, changed_at, handed FROM changes WHERE todo = ?1 ORDER BY seq").map_err(RpcError::internal)?;
        let rows = stmt
            .query_map([id], |r| {
                Ok((
                    r.get::<_, u32>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(RpcError::internal)?;
        rows.map(|row| {
            let (seq, before, after, touch, actor, changed_at, handed) =
                row.map_err(RpcError::internal)?;
            Ok((
                Change {
                    actor: actor
                        .map(|text| parse_creator(&text))
                        .transpose()
                        .map_err(RpcError::internal)?,
                    seq,
                    changed_at,
                    handed: handed
                        .map(|text| parse_creator(&text))
                        .transpose()
                        .map_err(RpcError::internal)?,
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

fn comment_of((id, author, body, created_at, read): CommentRow) -> Result<Comment, RpcError> {
    Ok(Comment {
        id,
        author: parse_creator(&author).map_err(RpcError::internal)?,
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
    }
}

fn creator_json(creator: &Actor) -> String {
    serde_json::to_string(creator).expect("an Actor is always serializable")
}

fn parse_creator(text: &str) -> serde_json::Result<Actor> {
    serde_json::from_str(text)
}

pub(super) fn now_ms() -> i64 {
    let millis = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    i64::try_from(millis.max(0)).unwrap_or(i64::MAX)
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

    pub(super) fn store(&self) -> Result<std::sync::MutexGuard<'_, Store>, RpcError> {
        self.store
            .lock()
            .map_err(|_| RpcError::internal("todo store poisoned"))
    }
}

pub(super) fn item(id: u32) -> String {
    format!("todo:{id}")
}
