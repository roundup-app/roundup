//! Todos: items with blockers, in SQLite. Owner: todos Builder.
#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

mod comments;
mod cycle;
mod deletion;
mod dispatch;
mod error;
mod handoff;
mod history;
mod placement;
mod references;
#[doc(hidden)]
pub mod schema;
mod store;
mod values;

use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;
use contracts::EventData;
pub use error::Error;
use rpc::{Bus, Ctx, Module, OpenError, RpcError};
use serde_json::Value;
use store::{Store, item};

pub struct Todos {
    store: Mutex<Store>,
}

impl Todos {
    /// `dir` is the Project's data folder (N1). `bus` is for events no call caused.
    pub fn open(dir: &Path, _bus: Bus) -> Result<Self, OpenError> {
        Self::open_store(dir)
    }

    /// A34: apply this Workstream's Todos through the coordinator's Project transaction.
    /// Events are returned for publication only after every store and the Rail commit.
    pub fn remove_workstream(
        &self,
        db: &rusqlite::Connection,
        id: &str,
        actor: &contracts::Actor,
        removal: &mut contracts::agent::Removal,
        scope: contracts::agent::RemoveScope,
    ) -> Result<Vec<EventData>, Error> {
        self.store()?
            .remove_workstream(db, id, actor, removal, scope)
    }

    /// Every Todo in id order, as `todo.list` replies. It logs no Touch.
    pub fn list_all(&self) -> Result<Vec<contracts::todo::Todo>, RpcError> {
        Ok(self.store()?.list()?)
    }

    /// `todo.get`: the Todo, and `ctx.actor` has read its History to here.
    pub fn read(&self, ctx: &Ctx, id: u32) -> Result<contracts::todo::Todo, RpcError> {
        Ok(self.get(ctx, contracts::todo::TodoId { id })?)
    }

    /// `todo.move`: the Daemon has checked `home` against the Rail (T13).
    pub fn set_home(
        &self,
        ctx: &Ctx,
        id: u32,
        home: Option<String>,
    ) -> Result<contracts::todo::Todo, RpcError> {
        Ok(self.move_to(ctx, contracts::todo::MoveParams { id, home })?)
    }

    /// `todo.assign`, unconditionally: the Daemon has checked the owner against the Rail (T17).
    pub fn set_owner(
        &self,
        ctx: &Ctx,
        id: u32,
        owner: Option<contracts::Actor>,
    ) -> Result<contracts::todo::Todo, RpcError> {
        let assign = contracts::todo::AssignParams {
            id,
            owner: owner.map(contracts::common::Owner::Actor),
            expected_change: None,
        };
        Ok(self.assign(ctx, assign)?)
    }

    /// T27: the links of a Todo as added, for the Daemon to read their state. It logs no Touch.
    pub fn refs(&self, id: u32) -> Result<Vec<String>, Error> {
        self.read_refs(id)
    }
}

#[async_trait]
impl Module for Todos {
    fn namespaces(&self) -> &'static [&'static str] {
        &["todo"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        self.dispatch(ctx, method, value).await
    }
}

#[cfg(test)]
mod tests;
