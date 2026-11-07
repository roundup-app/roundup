//! Retained deletion lives in the same Project transaction as the rows it removes.
use crate::error::Error;
use contracts::todo::{DeleteParams, Deletion, DeletionParams, DeletionState, RedoParams, TodoId};
use contracts::{Actor, EventData, Verb};
use rpc::Ctx;
use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::{Todos, item};

// Column lists pin the retained representation without trusting a webview snapshot.
const TABLES: &[(&str, &str, &str)] = &[
    (
        "todos",
        "deleted_todos",
        "id,title,body,done,created_at,updated_at,creator,home,pos,owner,priority",
    ),
    (
        "changes",
        "deleted_changes",
        "seq,todo,before_values,after_values,after_touch,actor,changed_at,handed",
    ),
    (
        "comments",
        "deleted_comments",
        "id,todo,author,body,created_at,read",
    ),
    ("todo_refs", "deleted_refs", "id,todo,target,url"),
    ("blockers", "deleted_blockers", "todo,blocker"),
];

impl Todos {
    /// Rail coordination can include this exact chosen set in its Project transaction.
    /// The caller commits all participants before publishing returned events or Touches.
    pub fn delete_in(
        tx: &Connection,
        actor: &Actor,
        p: &DeleteParams,
        after_touch: i64,
    ) -> Result<(Deletion, Vec<EventData>), Error> {
        retain(tx, actor, p, after_touch, true)
    }

    pub(super) async fn delete(&self, ctx: &Ctx, p: DeleteParams) -> Result<Deletion, Error> {
        let store = self.store()?;
        let tx = store.db.unchecked_transaction()?;
        let (result, events) = Self::delete_in(&tx, &ctx.actor, &p, ctx.touches.sequence()?)?;
        tx.commit()?;
        publish(ctx, events)?;
        Ok(result)
    }

    pub(super) async fn redo(&self, ctx: &Ctx, p: RedoParams) -> Result<Deletion, Error> {
        let store = self.store()?;
        let tx = store.db.unchecked_transaction()?;
        let source = receipt(&tx, &ctx.actor, &p.source)?
            .ok_or_else(|| Error::NotFound("deletion".into()))?;
        if source.restoration.as_deref() != Some(&p.restoration) {
            return Err(Error::Conflict(
                "redo belongs to another restored deletion".into(),
            ));
        }
        // Bind replay to its source before inspecting current targets: an unknown reply
        // stays reconcilable even after restore or later edits.
        if let Some(result) = receipt(&tx, &ctx.actor, &p.operation)? {
            let previous: Option<String> = tx.query_row(
                "SELECT json_extract(result,'$.source') FROM todo_deletions WHERE operation=?",
                [&p.operation],
                |r| r.get(0),
            )?;
            if previous.as_deref() != Some(&p.source) {
                return Err(Error::Conflict(
                    "redo key already names another operation".into(),
                ));
            }
            return Ok(result);
        }
        let (targets, successor): (Option<String>, Option<String>) = tx.query_row(
            "SELECT json_extract(result,'$.restoredTargets'),json_extract(result,'$.redo') FROM todo_deletions WHERE operation=?",
            [&p.source], |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if source.state != DeletionState::Restored || successor.is_some() {
            return Err(Error::Conflict(
                "redo needs an unconsumed restored deletion".into(),
            ));
        }
        let chosen = serde_json::to_string(&source.deleted)?;
        if targets.as_deref() != Some(&restored_targets(&tx, &chosen)?) {
            return Err(Error::Conflict("Can't redo: a restored Todo was changed, moved or replaced. Keep the newer work, or restore its previous placement and values before retrying Redo; the deletion is retained.".into()));
        }
        let remove = !source.deleted.is_empty();
        let (result, events) = retain(
            &tx,
            &ctx.actor,
            &DeleteParams {
                operation: p.operation.clone(),
                ids: source.deleted,
            },
            ctx.touches.sequence()?,
            remove,
        )?;
        tx.execute(
            "UPDATE todo_deletions SET result=json_set(result,'$.source',?2) WHERE operation=?1",
            params![p.operation, p.source],
        )?;
        tx.execute(
            "UPDATE todo_deletions SET result=json_set(result,'$.redo',?2) WHERE operation=?1",
            params![p.source, p.operation],
        )?;
        tx.commit()?;
        publish(ctx, events)?;
        Ok(result)
    }

    pub(super) async fn deletion(
        &self,
        ctx: &Ctx,
        p: DeletionParams,
    ) -> Result<Option<Deletion>, Error> {
        Ok(receipt(&self.store()?.db, &ctx.actor, &p.operation)?)
    }

    pub(super) async fn restore(&self, ctx: &Ctx, p: DeletionParams) -> Result<Deletion, Error> {
        let (result, events) = self.restore_with(
            &ctx.actor,
            &p.operation,
            ctx.touches.sequence()?,
            |_| Ok(()),
            |_| Ok(()),
        )?;
        publish(ctx, events)?;
        Ok(result)
    }

    /// Restore data and a coordinator's graph changes in the same Project transaction.
    /// The coordinator uses only the supplied transaction, never a nested Todo call.
    /// Equal replay skips coordination. On conflict/error all participants roll back;
    /// only a committed result returns events for the caller to publish and Touch.
    pub fn restore_with(
        &self,
        actor: &Actor,
        operation: &str,
        after_touch: i64,
        coordinate: impl FnOnce(&Transaction<'_>) -> Result<(), Error>,
        finish: impl FnOnce(&Transaction<'_>) -> Result<(), Error>,
    ) -> Result<(Deletion, Vec<EventData>), Error> {
        let store = self.store()?;
        let tx = store.db.unchecked_transaction()?;
        let mut result =
            receipt(&tx, actor, operation)?.ok_or_else(|| Error::NotFound("deletion".into()))?;
        if result.state == DeletionState::Restored {
            return Ok((result, Vec::new()));
        }
        coordinate(&tx)?;
        let has_nodes: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='nodes')",
            [],
            |r| r.get(0),
        )?;
        if has_nodes {
            Self::validate_rail_targets_in(&tx, operation)?;
        }
        let before = store.list()?;
        let occupied: Option<(String,String)> = tx.query_row("SELECT CAST(t.id AS TEXT),t.title FROM todos t JOIN deleted_todos d ON d.id=t.id WHERE d.operation=? LIMIT 1", [operation], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((id, title)) = occupied {
            return Err(Error::UndoIdentity {
                id,
                name: title,
                removable: true,
            });
        }
        // Plain INSERT refuses collisions; the transaction rolls every insertion back.
        for (live, retained, columns) in TABLES {
            tx.execute(&format!("INSERT INTO {live} ({columns}) SELECT {columns} FROM {retained} WHERE operation = ?"), [operation])
                .map_err(|_| Error::Conflict("Can't undo these Todos because retained relationships are unavailable. Undo the later deletion first; this deletion is retained.".into()))?;
        }
        let edges = store.edges()?;
        for (id, blockers) in &edges {
            if crate::cycle::creates_cycle(&edges, *id, blockers) {
                return Err(Error::Conflict(format!(
                    "Can't undo: dependencies for \"{}\" would form a cycle. Remove the later dependency, then try Undo again.",
                    store.get(*id)?.title
                )));
            }
        }
        let mut restored = result
            .deleted
            .iter()
            .map(|id| store.get(*id))
            .collect::<Result<Vec<_>, _>>()?;
        for todo in before {
            let after = store.get(todo.id)?;
            if todo.blockers != after.blockers {
                store.record_change(
                    todo.id,
                    Some(crate::store::values(&todo)),
                    after_touch,
                    actor,
                )?;
                restored.push(after);
            }
        }
        result.state = DeletionState::Restored;
        let chosen = serde_json::to_string(&result.deleted)?;
        let targets = restored_targets(&tx, &chosen)?;
        let restoration: String =
            tx.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        result.restoration = Some(restoration.clone());
        tx.execute(
            "UPDATE todo_deletions SET result = json_set(result,'$.state','restored','$.restoredTargets',json(?2),'$.restoration',?3) WHERE operation = ?1",
            params![operation, targets, restoration],
        )?;
        for (_, retained, _) in TABLES {
            tx.execute(
                &format!("DELETE FROM {retained} WHERE operation = ?"),
                [operation],
            )?;
        }
        finish(&tx)?;
        tx.commit()?;
        let events = restored
            .into_iter()
            .map(|todo| EventData::TodoRestored(todo.into()))
            .collect();
        Ok((result, events))
    }
}

// The creation Change sequence distinguishes reincarnations even if numeric id,
// content and millisecond creation time match. Placement and values may be repaired;
// last-change timestamps are deliberately not identity.
fn restored_targets(db: &Connection, chosen: &str) -> Result<String, Error> {
    db.query_row(
        "SELECT json_group_array(json_array(id,title,body,done,created_at,creator,home,pos,owner,json((SELECT json_group_array(blocker) FROM (SELECT blocker FROM blockers WHERE todo=t.id ORDER BY blocker))),(SELECT MIN(seq) FROM changes WHERE todo=t.id),priority)) FROM (SELECT * FROM todos WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id) t",
        [chosen], |r| r.get(0),
    ).map_err(Error::from)
}

fn receipt(db: &Connection, actor: &Actor, operation: &str) -> Result<Option<Deletion>, Error> {
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT actor, result FROM todo_deletions WHERE operation = ?",
            [operation],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    row.map(|(author, result)| {
        let author: Actor = serde_json::from_str(&author)?;
        if author != *actor {
            return Err(Error::Forbidden("deletion belongs to another Actor".into()));
        }
        serde_json::from_str(&result).map_err(Error::from)
    })
    .transpose()
}

fn retain(
    db: &Connection,
    actor: &Actor,
    p: &DeleteParams,
    after_touch: i64,
    remove: bool,
) -> Result<(Deletion, Vec<EventData>), Error> {
    if db.is_autocommit() {
        return Err(Error::internal("Todo retention requires a transaction"));
    }
    if p.operation.is_empty()
        || p.operation.len() > 128
        || (remove && p.ids.is_empty())
        || p.ids.len() > 10000
    {
        return Err(Error::InvalidParams(
            "deletion needs a key (1–128 bytes) and 1–10000 chosen ids".into(),
        ));
    }
    let mut chosen = p.ids.clone();
    chosen.sort_unstable();
    chosen.dedup();
    let chosen_json = serde_json::to_string(&chosen)?;
    if let Some(result) = receipt(db, actor, &p.operation)? {
        let previous: String = db.query_row(
            "SELECT chosen FROM todo_deletions WHERE operation = ?",
            [&p.operation],
            |r| r.get(0),
        )?;
        if previous != chosen_json {
            return Err(Error::Conflict(
                "deletion key already names another chosen set".into(),
            ));
        }
        return Ok((result, Vec::new()));
    }
    let actor_json = serde_json::to_string(actor)?;
    let mut result = Deletion {
        operation: p.operation.clone(),
        deleted: Vec::new(),
        missing: Vec::new(),
        state: DeletionState::Deleted,
        restoration: None,
    };
    for id in chosen {
        let exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM todos WHERE id = ?)",
            [id],
            |r| r.get(0),
        )?;
        if exists {
            result.deleted.push(id);
        } else {
            result.missing.push(id);
        }
    }
    let selected = serde_json::to_string(&result.deleted)?;
    for (live, retained, columns) in TABLES {
        let condition = match *live {
            "todos" => "id IN (SELECT value FROM json_each(?2))",
            "blockers" => {
                "todo IN (SELECT value FROM json_each(?2)) OR blocker IN (SELECT value FROM json_each(?2))"
            }
            _ => "todo IN (SELECT value FROM json_each(?2))",
        };
        db.execute(&format!("INSERT INTO {retained} (operation,{columns}) SELECT ?1,{columns} FROM {live} WHERE {condition}"), params![p.operation, selected])?;
    }
    let mut unblocked = Vec::<u32>::new();
    if remove {
        // Preserve T6's surviving dependent Changes. Values come from the authoritative
        // last Change, whose blocker list is updated in the same deletion transaction.
        let now = provenance::now_ms().max(0);
        db.execute("INSERT INTO changes(todo,before_values,after_values,after_touch,actor,changed_at)
        SELECT t.id,
        json_object('title',t.title,'body',t.body,'done',json(CASE t.done WHEN 0 THEN 'false' ELSE 'true' END),'owner',json(t.owner),'priority',json(t.priority),'blockers',json((SELECT json_group_array(blocker) FROM (SELECT blocker FROM blockers WHERE todo=t.id ORDER BY blocker)))),
        json_object('title',t.title,'body',t.body,'done',json(CASE t.done WHEN 0 THEN 'false' ELSE 'true' END),'owner',json(t.owner),'priority',json(t.priority),'blockers',json((SELECT json_group_array(blocker) FROM (SELECT blocker FROM blockers WHERE todo=t.id AND blocker NOT IN (SELECT value FROM json_each(?1)) ORDER BY blocker)))),
        ?2, ?3, ?4 FROM todos t
        WHERE t.id NOT IN (SELECT value FROM json_each(?1)) AND EXISTS(SELECT 1 FROM blockers b WHERE b.todo=t.id AND b.blocker IN (SELECT value FROM json_each(?1)))", params![selected,after_touch,actor_json,now])?;
        db.execute("UPDATE todos SET updated_at=?2 WHERE id NOT IN (SELECT value FROM json_each(?1)) AND EXISTS(SELECT 1 FROM blockers b WHERE b.todo=todos.id AND b.blocker IN (SELECT value FROM json_each(?1)))", params![selected,now])?;
        unblocked = db.prepare("SELECT DISTINCT b.todo FROM blockers b JOIN todos t ON t.id=b.blocker WHERE t.done=0 AND b.blocker IN (SELECT value FROM json_each(?1)) AND b.todo NOT IN (SELECT value FROM json_each(?1)) AND NOT EXISTS(SELECT 1 FROM blockers x JOIN todos y ON y.id=x.blocker WHERE x.todo=b.todo AND y.done=0 AND x.blocker NOT IN (SELECT value FROM json_each(?1))) ORDER BY b.todo")
        .and_then(|mut q| q.query_map([&selected], |r| r.get(0))?.collect())?;
        db.execute(
            "DELETE FROM todos WHERE id IN (SELECT value FROM json_each(?))",
            [&selected],
        )?;
    }
    let mut record = serde_json::to_value(&result)?;
    let has_nodes: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='nodes')",
        [],
        |r| r.get(0),
    )?;
    if has_nodes {
        let names: String = db
            .query_row(
                "SELECT json_group_object(CAST(id AS TEXT),name) FROM nodes WHERE CAST(id AS TEXT) IN (SELECT home FROM deleted_todos WHERE operation=?1 UNION SELECT json_extract(owner,'$.id') FROM deleted_todos WHERE operation=?1)",
                [&p.operation],
                |r| r.get(0),
            )
            ?;
        record
            .as_object_mut()
            .ok_or_else(|| Error::internal("a deletion record is not an object"))?
            .insert("targetNames".into(), serde_json::from_str(&names)?);
    }
    db.execute(
        "INSERT INTO todo_deletions(operation,actor,chosen,result) VALUES (?,?,?,?)",
        params![
            p.operation,
            actor_json,
            chosen_json,
            serde_json::to_string(&record)?
        ],
    )?;
    let events = result
        .deleted
        .iter()
        .map(|id| EventData::TodoDeleted(TodoId { id: *id }))
        .chain(
            unblocked
                .into_iter()
                .map(|id| EventData::TodoUnblocked(TodoId { id })),
        )
        .collect();
    Ok((result, events))
}

fn publish(ctx: &Ctx, events: Vec<EventData>) -> Result<(), Error> {
    for event in events {
        match &event {
            EventData::TodoDeleted(id) => ctx.touch(Verb::Wrote, &item(id.id))?,
            EventData::TodoRestored(todo) => ctx.touch(Verb::Wrote, &item(todo.id))?,
            _ => {}
        }
        ctx.emit(event);
    }
    Ok(())
}

impl Todos {
    /// One selection shares the existing Todo participant receipt across its Workstream Homes.
    pub fn retain_workstream_in(
        db: &Connection,
        actor: &Actor,
        operation: &str,
        homes: &[String],
    ) -> Result<(), Error> {
        let homes = serde_json::to_string(homes)?;
        let mut query = db
            .prepare("SELECT id,done,home,owner FROM todos WHERE home IN (SELECT value FROM json_each(?)) ORDER BY id")
            ?;
        let rows = query
            .query_map([homes], |r| {
                Ok((
                    r.get::<_, u32>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut ids = Vec::new();
        for (id, done, home, owner) in rows {
            if done {
                ids.push(id);
            } else {
                db.execute("INSERT INTO rail_removal_items(operation,kind,id,home,owner) VALUES(?,'todo-home',?,?,?)",params![operation,id.to_string(),home,owner])?;
            }
        }
        let after_touch =
            db.query_row("SELECT COALESCE(MAX(seq),0) FROM touches", [], |r| r.get(0))?;
        let participant: String =
            db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        db.execute(
            "INSERT INTO rail_removal_items(operation,kind,id) VALUES(?,'todo-operation',?)",
            params![operation, participant],
        )?;
        retain(
            db,
            actor,
            &DeleteParams {
                operation: participant,
                ids,
            },
            after_touch,
            false,
        )?;
        Ok(())
    }

    /// Reconnect retained Homes only when the surviving Todo still has the placement
    /// produced by this removal. Explicit later moves keep their newer placement.
    pub fn restore_workstream_homes_in(
        db: &Connection,
        operation: &str,
    ) -> Result<Vec<u32>, Error> {
        let mut query=db.prepare("SELECT id,home FROM rail_removal_items WHERE operation=? AND kind='todo-home' ORDER BY CAST(id AS INTEGER)")?;
        let rows = query
            .query_map([operation], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut ids = Vec::new();
        for (id, home) in rows {
            if db.execute(
                "UPDATE todos SET home=? WHERE id=? AND home IS NULL",
                params![home, id],
            )? != 1
            {
                let exists: bool = db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM todos WHERE id=?)",
                    [&id],
                    |r| r.get(0),
                )?;
                if exists {
                    continue;
                }
                let title: String = db
                    .query_row(
                        "SELECT title FROM deleted_todos WHERE CAST(id AS TEXT)=? LIMIT 1",
                        [id.to_string()],
                        |r| r.get(0),
                    )
                    .optional()?
                    .unwrap_or_else(|| "Retained Todo".into());
                return Err(Error::UndoParent {
                    id: id.to_string(),
                    name: title,
                });
            }
            ids.push(id.parse().map_err(Error::internal)?);
        }
        Ok(ids)
    }
}

impl Todos {
    /// T17's authorized unassignment is part of the same graph removal, including Todos
    /// in other Homes. Retain only these ownership edges, never their replacement data.
    pub fn remove_owners_in(
        db: &Connection,
        actor: &Actor,
        operation: &str,
        agents: &[String],
    ) -> Result<Vec<u32>, Error> {
        let selected = serde_json::to_string(agents)?;
        let mut q=db.prepare("SELECT id,owner FROM todos WHERE json_extract(owner,'$.kind')='agent' AND json_extract(owner,'$.id') IN (SELECT value FROM json_each(?)) ORDER BY id")?;
        let rows = q
            .query_map([selected], |r| {
                Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut ids = Vec::new();
        for (id, owner) in rows {
            db.execute("INSERT INTO rail_removal_items(operation,kind,id,owner) VALUES(?,'todo-owner',?,?)",params![operation,id.to_string(),owner])?;
            change_owner_in(db, actor, id, None)?;
            ids.push(id);
        }
        Ok(ids)
    }

    pub fn restore_owners_in(
        db: &Connection,
        actor: &Actor,
        operation: &str,
    ) -> Result<Vec<u32>, Error> {
        let mut q=db.prepare("SELECT CAST(id AS INTEGER),owner FROM rail_removal_items WHERE operation=? AND kind='todo-owner' ORDER BY CAST(id AS INTEGER)")?;
        let rows = q
            .query_map([operation], |r| {
                Ok((r.get::<_, u32>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut ids = Vec::new();
        for (id, owner) in rows {
            let vacant: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM todos WHERE id=? AND owner IS NULL)",
                [id],
                |r| r.get(0),
            )?;
            if !vacant {
                let exists: bool =
                    db.query_row("SELECT EXISTS(SELECT 1 FROM todos WHERE id=?)", [id], |r| {
                        r.get(0)
                    })?;
                if exists {
                    continue;
                }
                let title: String = db
                    .query_row(
                        "SELECT title FROM deleted_todos WHERE CAST(id AS TEXT)=? LIMIT 1",
                        [id.to_string()],
                        |r| r.get(0),
                    )
                    .optional()?
                    .unwrap_or_else(|| "Retained Todo".into());
                return Err(Error::UndoParent {
                    id: id.to_string(),
                    name: title,
                });
            }
            change_owner_in(db, actor, id, Some(&owner))?;
            ids.push(id);
        }
        Ok(ids)
    }
}

fn change_owner_in(
    db: &Connection,
    actor: &Actor,
    id: u32,
    owner: Option<&str>,
) -> Result<(), Error> {
    // Values' latest Change is the existing authoritative owner/blocker history (T17).
    db.execute("INSERT INTO changes(todo,before_values,after_values,after_touch,actor,changed_at)
        SELECT todo,after_values,json_set(after_values,'$.owner',json(?2)),(SELECT COALESCE(MAX(seq),0) FROM touches),?3,?4
        FROM changes WHERE seq=(SELECT MAX(seq) FROM changes WHERE todo=?1)",params![id,owner,serde_json::to_string(actor)?,provenance::now_ms().max(0)])?;
    db.execute(
        "UPDATE todos SET owner=?, updated_at=? WHERE id=?",
        params![owner, provenance::now_ms().max(0), id],
    )?;
    Ok(())
}

impl Todos {
    /// Resolve the server-generated participant key only for the original Actor.
    pub fn rail_operation(&self, actor: &Actor, operation: &str) -> Result<String, Error> {
        let store = self.store()?;
        let participant: String = store.db.query_row(
            "SELECT id FROM rail_removal_items WHERE operation=? AND kind='todo-operation'",
            [operation],
            |r| r.get(0),
        )?;
        receipt(&store.db, actor, &participant)?
            .ok_or_else(|| Error::NotFound("Todo removal".into()))?;
        Ok(participant)
    }

    /// Rail insertion precedes this check in the same transaction. An unrelated missing
    /// original Home/owner is a retryable conflict, never permission to substitute one.
    pub fn validate_rail_targets_in(db: &Connection, operation: &str) -> Result<(), Error> {
        let missing: Option<(String, String)> = db.query_row("SELECT target,COALESCE((SELECT value FROM todo_deletions d,json_each(json_extract(d.result,'$.targetNames')) WHERE d.operation=?1 AND key=target),title) FROM (SELECT home AS target,title,'workstream' AS target_kind FROM deleted_todos WHERE operation=?1 AND home IS NOT NULL UNION ALL SELECT json_extract(owner,'$.id'),title,'agent' FROM deleted_todos WHERE operation=?1 AND json_extract(owner,'$.kind')='agent') WHERE NOT EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=target AND (target_kind='agent' OR nodes.kind='workstream')) LIMIT 1", [operation], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((id, name)) = missing {
            return Err(Error::UndoParent { id, name });
        }
        Ok(())
    }
}

impl Todos {
    /// Fill committed Rail participant events without adding synthetic read Touches.
    pub fn rail_events(&self, ids: Vec<u32>) -> Result<Vec<EventData>, Error> {
        let store = self.store()?;
        ids.into_iter()
            .map(|id| {
                store
                    .get(id)
                    .map(|todo| EventData::TodoUpdated(todo.into()))
            })
            .collect()
    }
}

impl Todos {
    /// Retain and remove the prior successful set and its restored Home/owner edges.
    /// The coordinator's transaction has already checked the acknowledged boundary.
    pub fn redo_workstream_in(
        db: &Connection,
        actor: &Actor,
        source: &str,
        operation: &str,
        removed: &[String],
    ) -> Result<Vec<EventData>, Error> {
        let prior: String = db.query_row(
            "SELECT id FROM rail_removal_items WHERE operation=? AND kind='todo-operation'",
            [source],
            |r| r.get(0),
        )?;
        let previous =
            receipt(db, actor, &prior)?.ok_or_else(|| Error::NotFound("Todo removal".into()))?;
        let expected: Option<String> = db.query_row(
            "SELECT json_extract(result,'$.restoredTargets') FROM todo_deletions WHERE operation=?",
            [&prior],
            |r| r.get(0),
        )?;
        let chosen = serde_json::to_string(&previous.deleted)?;
        if expected.as_deref() != Some(restored_targets(db, &chosen)?.as_str()) {
            return Err(Error::Conflict(
                "Restored Todo graph changed; repair it before retrying Redo".into(),
            ));
        }
        let participant: String =
            db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        db.execute(
            "INSERT INTO rail_removal_items(operation,kind,id) VALUES(?,'todo-operation',?)",
            params![operation, participant],
        )?;
        let after_touch =
            db.query_row("SELECT COALESCE(MAX(seq),0) FROM touches", [], |r| r.get(0))?;
        let (_, events) = retain(
            db,
            actor,
            &DeleteParams {
                operation: participant,
                ids: previous.deleted.clone(),
            },
            after_touch,
            !previous.deleted.is_empty(),
        )?;
        db.execute("INSERT INTO rail_removal_items(operation,kind,id,home,owner) SELECT ?2,kind,id,home,owner FROM rail_removal_items r WHERE operation=?1 AND ((kind='todo-home' AND EXISTS(SELECT 1 FROM todos t WHERE CAST(t.id AS TEXT)=r.id AND t.home=r.home)) OR (kind='todo-owner' AND EXISTS(SELECT 1 FROM todos t WHERE CAST(t.id AS TEXT)=r.id AND t.owner=r.owner)))",params![source,operation])?;
        db.execute("INSERT OR IGNORE INTO rail_removal_items(operation,kind,id,home) SELECT ?2,'todo-home',CAST(id AS TEXT),home FROM todos WHERE home IN (SELECT value FROM json_each(?1))",params![serde_json::to_string(removed)?,operation])?;
        db.execute("UPDATE todos SET home=NULL WHERE CAST(id AS TEXT) IN (SELECT id FROM rail_removal_items WHERE operation=? AND kind='todo-home')",[operation])?;
        let mut q=db.prepare("SELECT CAST(id AS INTEGER) FROM rail_removal_items WHERE operation=? AND kind='todo-owner'")?;
        let ids = q
            .query_map([operation], |r| r.get::<_, u32>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for id in ids {
            change_owner_in(db, &Actor::daemon(), id, None)?;
        }
        Ok(events)
    }
}
