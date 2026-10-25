//! Todo reads and per-Actor history acknowledgements.
use contracts::todo::{History, ReadHistoryParams, TodoId};
use rpc::{Ctx, RpcError, reply};
use serde_json::Value;

use super::{Todos, item};

impl Todos {
    pub(super) fn get(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        let through = store
            .history(p.id)?
            .last()
            .map_or(0, |(change, _)| change.seq);
        ctx.touches
            .record_todo_read(&ctx.actor, &item(p.id), through)
            .map_err(RpcError::internal)?;
        reply(&todo)
    }

    pub(super) fn get_history(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let rows = store.history(p.id)?;
        let read = ctx
            .touches
            .todo_read(&ctx.actor, &item(p.id))
            .map_err(RpcError::internal)?;
        let unread = rows
            .iter()
            .find(|(change, touch)| match read {
                None => true,
                Some((_, Some(through))) => change.seq > through,
                Some((seq, None)) => *touch >= seq,
            })
            .map(|(change, _)| change.seq);
        reply(&History {
            changes: rows.into_iter().map(|(change, _)| change).collect(),
            unread,
        })
    }

    pub(super) fn read_history(&self, ctx: &Ctx, p: ReadHistoryParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let history = store.history(p.id)?;
        if !history.iter().any(|(change, _)| change.seq == p.through) {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "read must acknowledge a fetched change",
            ));
        }
        // A delayed acknowledgement cannot move an Actor's read backwards.
        let prior = ctx
            .touches
            .todo_read(&ctx.actor, &item(p.id))
            .map_err(RpcError::internal)?;
        let through = prior
            .and_then(|(_, revision)| revision)
            .unwrap_or(0)
            .max(p.through);
        ctx.touches
            .record_todo_read(&ctx.actor, &item(p.id), through)
            .map_err(RpcError::internal)?;
        Ok(Value::Null)
    }
}
