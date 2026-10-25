//! Todos: items with blockers, in SQLite. Owner: todos Builder.

mod comments;
mod cycle;
mod deletion;
mod dispatch;
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
    ) -> Result<Vec<EventData>, RpcError> {
        self.store()?.remove_workstream(db, id, actor, removal)
    }

    /// T27: the links of a Todo as added, for the Daemon to read their state. It logs no Touch.
    pub fn refs(&self, id: u32) -> Result<Vec<String>, RpcError> {
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
