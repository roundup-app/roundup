//! Todo creation, edits and blocker transitions.
use std::collections::BTreeSet;

use contracts::todo::{CreateParams, SetBlockersParams, Todo, TodoId, UpdateParams};
use contracts::{EventData, Verb};
use rpc::Ctx;

use super::{Todos, cycle, item};
use crate::error::Error;

impl Todos {
    /// The creator is the calling Actor; a `creator` field sent in the params is ignored.
    pub(super) async fn create(&self, ctx: &Ctx, p: CreateParams) -> Result<Todo, Error> {
        let owner = p
            .owner
            .map(contracts::common::Owner::into_actor)
            .transpose()
            .map_err(Error::InvalidParams)?;
        let todo = self.store()?.insert(
            &p.title,
            &p.body.unwrap_or_default(),
            &p.blockers.unwrap_or_default(),
            &ctx.actor,
            owner.as_ref(),
            p.priority,
            ctx.touches.sequence()?,
        )?;
        ctx.touch(Verb::Wrote, &item(todo.id))?;
        ctx.emit(EventData::TodoCreated(todo.clone().into()));
        Ok(todo)
    }

    pub(super) async fn update(&self, ctx: &Ctx, p: UpdateParams) -> Result<Todo, Error> {
        if p.title.is_none() && p.body.is_none() && p.priority.is_none() {
            return Err(Error::InvalidParams(
                "update needs a title, a body or a priority".into(),
            ));
        }
        let store = self.store()?;
        if p.title.is_none() && p.body.is_none() {
            let todo = store.get(p.id)?;
            if p.priority.is_none_or(|value| value == todo.priority) {
                store.require_change(p.id, p.expected_change)?;
                return Ok(todo);
            }
        }
        let todo = store.update(
            p.id,
            p.title.as_deref(),
            p.body.as_deref(),
            p.priority,
            p.expected_change,
            ctx.touches.sequence()?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        Ok(todo)
    }

    pub(super) async fn complete(&self, ctx: &Ctx, p: TodoId) -> Result<Todo, Error> {
        let store = self.store()?;
        let was_blocked = store.blocked_ids()?;
        let todo = store.set_done(p.id, true, ctx.touches.sequence()?, &ctx.actor)?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        emit_unblocked(ctx, &was_blocked, &store.blocked_ids()?);
        Ok(todo)
    }

    pub(super) async fn reopen(&self, ctx: &Ctx, p: TodoId) -> Result<Todo, Error> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if !todo.done {
            return Ok(todo);
        }
        let todo = store.set_done(p.id, false, ctx.touches.sequence()?, &ctx.actor)?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        Ok(todo)
    }

    pub(super) async fn set_blockers(
        &self,
        ctx: &Ctx,
        p: SetBlockersParams,
    ) -> Result<Todo, Error> {
        let store = self.store()?;
        let was_blocked = store.blocked_ids()?;
        store.get(p.id)?;
        store.require_all(&p.blockers)?;
        if cycle::creates_cycle(&store.edges()?, p.id, &p.blockers) {
            return Err(Error::Conflict(format!(
                "blockers {:?} would make todo {} block itself",
                p.blockers, p.id
            )));
        }
        let todo = store.set_blockers(
            p.id,
            &p.blockers,
            p.expected_change,
            ctx.touches.sequence()?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        emit_unblocked(ctx, &was_blocked, &store.blocked_ids()?);
        Ok(todo)
    }
}

/// Emit `todo.unblocked` for every Todo that was blocked before and is not now.
fn emit_unblocked(ctx: &Ctx, before: &BTreeSet<u32>, after: &BTreeSet<u32>) {
    for id in before.difference(after) {
        ctx.emit(EventData::TodoUnblocked(TodoId { id: *id }));
    }
}
