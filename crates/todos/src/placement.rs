//! Todo Home, owner and ordering changes.
use contracts::todo::{AssignParams, MoveParams, ReorderParams};
use contracts::{EventData, Verb};
use rpc::{Ctx, RpcError, reply};
use serde_json::Value;

use super::{Todos, item};

impl Todos {
    /// The Daemon has checked `home` against the Rail (T13). A move to the Home it has changes nothing.
    pub(super) fn move_to(&self, ctx: &Ctx, p: MoveParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if todo.home == p.home {
            return reply(&todo);
        }
        let todo = store.set_home(p.id, p.home.as_deref())?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    /// T17: the Daemon has checked the Agent against the Rail. The owner it has changes nothing.
    pub(super) fn assign(&self, ctx: &Ctx, p: AssignParams) -> Result<Value, RpcError> {
        let owner = p
            .owner
            .map(contracts::common::Owner::into_actor)
            .transpose()
            .map_err(|e| RpcError::new(rpc::code::INVALID_PARAMS, e))?;
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if todo.owner == owner {
            store.require_change(p.id, p.expected_change)?;
            return reply(&todo);
        }
        let todo = store.set_owner(
            p.id,
            owner.as_ref(),
            p.expected_change,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    /// T11: the Todo goes before `before`, or last. A move to the place it holds changes nothing.
    pub(super) fn reorder(&self, ctx: &Ctx, p: ReorderParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if let Some(before) = p.before {
            store.get(before)?;
            if before == p.id {
                return Err(RpcError::conflict(format!(
                    "todo {} cannot go before itself",
                    p.id
                )));
            }
        }
        if store.successor(p.id)? == p.before {
            return reply(&todo);
        }
        let todo = store.reorder(p.id, p.before)?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }
}
