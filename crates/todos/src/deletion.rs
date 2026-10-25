//! Retained deletion lives in the same Project transaction as the rows it removes.
use contracts::todo::{DeleteParams, Deletion, DeletionParams, DeletionState, TodoId};
use contracts::{Actor, EventData, Verb};
use rpc::{Ctx, RpcError, reply};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::Value;

use crate::{Todos, item};

// Column lists pin the retained representation without trusting a webview snapshot.
const TABLES: &[(&str, &str, &str)] = &[
    (
        "todos",
        "deleted_todos",
        "id,title,body,done,created_at,creator,home,pos,owner,estimate_minutes",
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
        tx: &Transaction<'_>,
        actor: &Actor,
        p: &DeleteParams,
        after_touch: i64,
    ) -> Result<(Deletion, Vec<EventData>), RpcError> {
        retain(tx, actor, p, after_touch)
    }

    /// Retained Home/owner identities for Daemon validation; no replacement data is accepted.
    pub fn restore_targets(
        &self,
        actor: &Actor,
        operation: &str,
    ) -> Result<Vec<contracts::todo::AssignParams>, RpcError> {
        let store = self.store()?;
        receipt(&store.db, actor, operation)?.ok_or_else(|| RpcError::not_found("deletion"))?;
        store
            .db
            .prepare("SELECT id, owner FROM deleted_todos WHERE operation = ?")
            .map_err(RpcError::internal)?
            .query_map([operation], |r| {
                Ok((r.get::<_, u32>(0)?, r.get::<_, Option<String>>(1)?))
            })
            .map_err(RpcError::internal)?
            .map(|row| {
                let (id, owner) = row.map_err(RpcError::internal)?;
                Ok(contracts::todo::AssignParams {
                    id,
                    owner: owner
                        .map(|v| serde_json::from_str(&v))
                        .transpose()
                        .map_err(RpcError::internal)?,
                    expected_change: None,
                })
            })
            .collect()
    }

    /// Retained Homes for the same authorized operation, validated before restoring.
    pub fn restore_homes(
        &self,
        actor: &Actor,
        operation: &str,
    ) -> Result<Vec<contracts::todo::MoveParams>, RpcError> {
        let store = self.store()?;
        receipt(&store.db, actor, operation)?.ok_or_else(|| RpcError::not_found("deletion"))?;
        store
            .db
            .prepare("SELECT id, home FROM deleted_todos WHERE operation = ?")
            .and_then(|mut q| {
                q.query_map([operation], |r| {
                    Ok(contracts::todo::MoveParams {
                        id: r.get(0)?,
                        home: r.get(1)?,
                    })
                })?
                .collect()
            })
            .map_err(RpcError::internal)
    }

    pub(super) fn delete(&self, ctx: &Ctx, p: DeleteParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let tx = store
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        let (result, events) = Self::delete_in(
            &tx,
            &ctx.actor,
            &p,
            ctx.touches.sequence().map_err(RpcError::internal)?,
        )?;
        tx.commit().map_err(RpcError::internal)?;
        publish(ctx, events)?;
        reply(&result)
    }

    pub(super) fn deletion(&self, ctx: &Ctx, p: DeletionParams) -> Result<Value, RpcError> {
        reply(&receipt(&self.store()?.db, &ctx.actor, &p.operation)?)
    }

    pub(super) fn restore(&self, ctx: &Ctx, p: DeletionParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let tx = store
            .db
            .unchecked_transaction()
            .map_err(RpcError::internal)?;
        let mut result = receipt(&tx, &ctx.actor, &p.operation)?
            .ok_or_else(|| RpcError::not_found("deletion"))?;
        if result.state == DeletionState::Restored {
            return reply(&result);
        }
        let before = store.list()?;
        // Plain INSERT refuses collisions; the transaction rolls every insertion back.
        for (live, retained, columns) in TABLES {
            tx.execute(&format!("INSERT INTO {live} ({columns}) SELECT {columns} FROM {retained} WHERE operation = ?"), [&p.operation])
                .map_err(|e| RpcError::conflict(format!("cannot restore {live}: {e}")))?;
        }
        let edges = store.edges()?;
        for (id, blockers) in &edges {
            if crate::cycle::creates_cycle(&edges, *id, blockers) {
                return Err(RpcError::conflict("restored blockers would make a cycle"));
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
                    ctx.touches.sequence().map_err(RpcError::internal)?,
                    &ctx.actor,
                )?;
                restored.push(after);
            }
        }
        result.state = DeletionState::Restored;
        tx.execute(
            "UPDATE todo_deletions SET result = ? WHERE operation = ?",
            params![
                serde_json::to_string(&result).map_err(RpcError::internal)?,
                p.operation
            ],
        )
        .map_err(RpcError::internal)?;
        for (_, retained, _) in TABLES {
            tx.execute(
                &format!("DELETE FROM {retained} WHERE operation = ?"),
                [&p.operation],
            )
            .map_err(RpcError::internal)?;
        }
        tx.commit().map_err(RpcError::internal)?;
        // Restoration refreshes readers without replaying external effects.
        for todo in restored {
            ctx.touch(Verb::Wrote, &item(todo.id))?;
            ctx.emit(EventData::TodoRestored(todo.into()));
        }
        reply(&result)
    }
}

fn receipt(db: &Connection, actor: &Actor, operation: &str) -> Result<Option<Deletion>, RpcError> {
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT actor, result FROM todo_deletions WHERE operation = ?",
            [operation],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(RpcError::internal)?;
    row.map(|(author, result)| {
        let author: Actor = serde_json::from_str(&author).map_err(RpcError::internal)?;
        if author != *actor {
            return Err(RpcError::forbidden("deletion belongs to another Actor"));
        }
        serde_json::from_str(&result).map_err(RpcError::internal)
    })
    .transpose()
}

fn retain(
    db: &Connection,
    actor: &Actor,
    p: &DeleteParams,
    after_touch: i64,
) -> Result<(Deletion, Vec<EventData>), RpcError> {
    if p.operation.is_empty() || p.operation.len() > 128 || p.ids.is_empty() || p.ids.len() > 10000
    {
        return Err(RpcError::new(
            rpc::code::INVALID_PARAMS,
            "deletion needs a key (1–128 bytes) and 1–10000 chosen ids",
        ));
    }
    let mut chosen = p.ids.clone();
    chosen.sort_unstable();
    chosen.dedup();
    let chosen_json = serde_json::to_string(&chosen).map_err(RpcError::internal)?;
    if let Some(result) = receipt(db, actor, &p.operation)? {
        let previous: String = db
            .query_row(
                "SELECT chosen FROM todo_deletions WHERE operation = ?",
                [&p.operation],
                |r| r.get(0),
            )
            .map_err(RpcError::internal)?;
        if previous != chosen_json {
            return Err(RpcError::conflict(
                "deletion key already names another chosen set",
            ));
        }
        return Ok((result, Vec::new()));
    }
    let actor_json = serde_json::to_string(actor).map_err(RpcError::internal)?;
    let mut result = Deletion {
        operation: p.operation.clone(),
        deleted: Vec::new(),
        missing: Vec::new(),
        state: DeletionState::Deleted,
    };
    for id in chosen {
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM todos WHERE id = ?)",
                [id],
                |r| r.get(0),
            )
            .map_err(RpcError::internal)?;
        if exists {
            result.deleted.push(id);
        } else {
            result.missing.push(id);
        }
    }
    let selected = serde_json::to_string(&result.deleted).map_err(RpcError::internal)?;
    for (live, retained, columns) in TABLES {
        let condition = match *live {
            "todos" => "id IN (SELECT value FROM json_each(?2))",
            "blockers" => {
                "todo IN (SELECT value FROM json_each(?2)) OR blocker IN (SELECT value FROM json_each(?2))"
            }
            _ => "todo IN (SELECT value FROM json_each(?2))",
        };
        db.execute(&format!("INSERT INTO {retained} (operation,{columns}) SELECT ?1,{columns} FROM {live} WHERE {condition}"), params![p.operation, selected]).map_err(RpcError::internal)?;
    }
    // Preserve T6's surviving dependent Changes. Values come from the authoritative
    // last Change, whose blocker list is updated in the same deletion transaction.
    db.execute("INSERT INTO changes(todo,before_values,after_values,after_touch,actor,changed_at)
        SELECT t.id,
        json_object('title',t.title,'body',t.body,'done',json(CASE t.done WHEN 0 THEN 'false' ELSE 'true' END),'owner',json(t.owner),'estimate_minutes',t.estimate_minutes,'blockers',json((SELECT json_group_array(blocker) FROM (SELECT blocker FROM blockers WHERE todo=t.id ORDER BY blocker)))),
        json_object('title',t.title,'body',t.body,'done',json(CASE t.done WHEN 0 THEN 'false' ELSE 'true' END),'owner',json(t.owner),'estimate_minutes',t.estimate_minutes,'blockers',json((SELECT json_group_array(blocker) FROM (SELECT blocker FROM blockers WHERE todo=t.id AND blocker NOT IN (SELECT value FROM json_each(?1)) ORDER BY blocker)))),
        ?2, ?3, ?4 FROM todos t
        WHERE t.id NOT IN (SELECT value FROM json_each(?1)) AND EXISTS(SELECT 1 FROM blockers b WHERE b.todo=t.id AND b.blocker IN (SELECT value FROM json_each(?1)))", params![selected,after_touch,actor_json,crate::store::now_ms()]).map_err(RpcError::internal)?;
    let unblocked: Vec<u32> = db.prepare("SELECT DISTINCT b.todo FROM blockers b JOIN todos t ON t.id=b.blocker WHERE t.done=0 AND b.blocker IN (SELECT value FROM json_each(?1)) AND b.todo NOT IN (SELECT value FROM json_each(?1)) AND NOT EXISTS(SELECT 1 FROM blockers x JOIN todos y ON y.id=x.blocker WHERE x.todo=b.todo AND y.done=0 AND x.blocker NOT IN (SELECT value FROM json_each(?1)))")
        .and_then(|mut q| q.query_map([&selected], |r| r.get(0))?.collect()).map_err(RpcError::internal)?;
    db.execute(
        "DELETE FROM todos WHERE id IN (SELECT value FROM json_each(?))",
        [&selected],
    )
    .map_err(RpcError::internal)?;
    db.execute(
        "INSERT INTO todo_deletions(operation,actor,chosen,result) VALUES (?,?,?,?)",
        params![
            p.operation,
            actor_json,
            chosen_json,
            serde_json::to_string(&result).map_err(RpcError::internal)?
        ],
    )
    .map_err(RpcError::internal)?;
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

fn publish(ctx: &Ctx, events: Vec<EventData>) -> Result<(), RpcError> {
    for event in events {
        if let EventData::TodoDeleted(id) = &event {
            ctx.touch(Verb::Wrote, &item(id.id))?;
        }
        ctx.emit(event);
    }
    Ok(())
}
