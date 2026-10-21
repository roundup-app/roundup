//! SQLite persistence for Todos. `blocked` is computed on read, never stored.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use contracts::Actor;
use contracts::todo::{Change, Todo, Values};
use rpc::RpcError;
use rusqlite::{Connection, OptionalExtension, params};

pub(crate) struct Store {
    db: Connection,
}

impl Store {
    pub(crate) fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut db = Connection::open(path)?;
        db.set_transaction_behavior(rusqlite::TransactionBehavior::Immediate);
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.pragma_update(None, "foreign_keys", true)?;
        crate::schema::open(&mut db, path)?;
        Ok(Self { db })
    }

    /// A34: apply deletion and Home changes through the Project database.
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
            if todo.home.as_deref() == Some(home) && todo.done {
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
                let after_touch: i64 = db
                    .query_row("SELECT COALESCE(MAX(seq), 0) FROM touches", [], |row| {
                        row.get(0)
                    })
                    .map_err(RpcError::internal)?;
                db.execute(
                    "INSERT INTO changes(todo, before_values, after_values, after_touch, actor) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![todo.id, serde_json::to_string(previous).map_err(RpcError::internal)?, serde_json::to_string(&after).map_err(RpcError::internal)?, after_touch, creator_json(&Actor::daemon())],
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
            "INSERT INTO todos (title, body, created_at, creator, owner, pos)
             VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(pos), 0) + 1 FROM todos))",
            params![
                title,
                body,
                created_at,
                creator_json(creator),
                owner.map(creator_json)
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
                "SELECT title, body, done, created_at, creator, home, owner, EXISTS(
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
                        r.get::<_, Option<String>>(6)?,
                        r.get(7)?,
                    ))
                },
            )
            .optional()
            .map_err(RpcError::internal)?;
        let (title, body, done, created_at, creator, home, owner, blocked) =
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
            owner: owner
                .map(|text| parse_creator(&text))
                .transpose()
                .map_err(RpcError::internal)?,
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
        self.get(id)?;
        self.db
            .execute(
                "UPDATE todos SET home = ?2 WHERE id = ?1",
                params![id, home],
            )
            .map_err(RpcError::internal)?;
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
        tx.commit().map_err(RpcError::internal)?;
        self.get(id)
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

    /// Blockers pointing at `id` go with it (foreign keys cascade).
    pub(crate) fn delete(&self, id: u32, after_touch: i64, actor: &Actor) -> Result<(), RpcError> {
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
            self.record_change(todo.id, Some(values(&todo)), after_touch, actor)?;
        }
        tx.commit().map_err(RpcError::internal)?;
        Ok(())
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

    fn record_change(
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
        self.db.execute(
            "INSERT INTO changes(todo, before_values, after_values, after_touch, actor) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, before.map(|value| serde_json::to_string(&value)).transpose().map_err(RpcError::internal)?, serde_json::to_string(&after).map_err(RpcError::internal)?, after_touch, creator_json(actor)],
        ).map_err(RpcError::internal)?;
        Ok(())
    }

    pub(crate) fn history(&self, id: u32) -> Result<Vec<(Change, i64)>, RpcError> {
        self.get(id)?;
        let mut stmt = self.db.prepare("SELECT seq, before_values, after_values, after_touch, actor FROM changes WHERE todo = ?1 ORDER BY seq").map_err(RpcError::internal)?;
        let rows = stmt
            .query_map([id], |r| {
                Ok((
                    r.get::<_, u32>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(RpcError::internal)?;
        rows.map(|row| {
            let (seq, before, after, touch, actor) = row.map_err(RpcError::internal)?;
            Ok((
                Change {
                    actor: actor
                        .map(|text| parse_creator(&text))
                        .transpose()
                        .map_err(RpcError::internal)?,
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
        owner: todo.owner.clone(),
    }
}

fn creator_json(creator: &Actor) -> String {
    serde_json::to_string(creator).expect("an Actor is always serializable")
}

fn parse_creator(text: &str) -> serde_json::Result<Actor> {
    serde_json::from_str(text)
}
