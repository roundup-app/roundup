//! Todo creation, edits and blocker transitions.
use std::collections::BTreeSet;

use contracts::todo::{CreateParams, SetBlockersParams, TodoId, UpdateParams};
use contracts::{EventData, Verb};
use rpc::{Ctx, RpcError, reply};
use serde_json::Value;

use super::{Todos, cycle, item};

impl Todos {
    /// The creator is the calling Actor; a `creator` field sent in the params is ignored.
    pub(super) fn create(&self, ctx: &Ctx, p: CreateParams) -> Result<Value, RpcError> {
        let owner = p
            .owner
            .map(contracts::common::Owner::into_actor)
            .transpose()
            .map_err(|e| RpcError::new(rpc::code::INVALID_PARAMS, e))?;
        let todo = self.store()?.insert(
            &p.title,
            &p.body.unwrap_or_default(),
            &p.blockers.unwrap_or_default(),
            &ctx.actor,
            owner.as_ref(),
            valid_estimate(p.estimate_minutes)?,
            p.priority,
            ctx.touches.sequence().map_err(RpcError::internal)?,
        )?;
        ctx.touch(Verb::Wrote, &item(todo.id))?;
        ctx.emit(EventData::TodoCreated(todo.clone().into()));
        reply(&todo)
    }

    pub(super) fn update(&self, ctx: &Ctx, p: UpdateParams) -> Result<Value, RpcError> {
        if p.title.is_none()
            && p.body.is_none()
            && p.estimate_minutes.is_none()
            && p.priority.is_none()
        {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "update needs a title, a body, an estimate or a priority",
            ));
        }
        valid_estimate(p.estimate_minutes.flatten())?;
        let store = self.store()?;
        if p.title.is_none() && p.body.is_none() {
            let todo = store.get(p.id)?;
            if p.estimate_minutes
                .is_none_or(|value| value == todo.estimate_minutes)
                && p.priority.is_none_or(|value| value == todo.priority)
            {
                store.require_change(p.id, p.expected_change)?;
                return reply(&todo);
            }
        }
        let todo = store.update(
            p.id,
            p.title.as_deref(),
            p.body.as_deref(),
            p.estimate_minutes,
            p.priority,
            p.expected_change,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    pub(super) fn complete(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let was_blocked = store.blocked_ids()?;
        let todo = store.set_done(
            p.id,
            true,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        emit_unblocked(ctx, &was_blocked, &store.blocked_ids()?);
        reply(&todo)
    }

    pub(super) fn reopen(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if !todo.done {
            return reply(&todo);
        }
        let todo = store.set_done(
            p.id,
            false,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    pub(super) fn set_blockers(&self, ctx: &Ctx, p: SetBlockersParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let was_blocked = store.blocked_ids()?;
        store.get(p.id)?;
        store.require_all(&p.blockers)?;
        if cycle::creates_cycle(&store.edges()?, p.id, &p.blockers) {
            return Err(RpcError::conflict(format!(
                "blockers {:?} would make todo {} block itself",
                p.blockers, p.id
            )));
        }
        let todo = store.set_blockers(
            p.id,
            &p.blockers,
            p.expected_change,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        emit_unblocked(ctx, &was_blocked, &store.blocked_ids()?);
        reply(&todo)
    }
}

/// Emit `todo.unblocked` for every Todo that was blocked before and is not now.
fn emit_unblocked(ctx: &Ctx, before: &BTreeSet<u32>, after: &BTreeSet<u32>) {
    for id in before.difference(after) {
        ctx.emit(EventData::TodoUnblocked(TodoId { id: *id }));
    }
}

/// T29: an estimate is 1 to 1440 whole minutes.
fn valid_estimate(minutes: Option<u32>) -> Result<Option<u32>, RpcError> {
    match minutes {
        Some(0 | 1441..) => Err(RpcError::new(
            rpc::code::INVALID_PARAMS,
            "estimate_minutes is 1 to 1440",
        )),
        _ => Ok(minutes),
    }
}
