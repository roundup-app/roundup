//! Checkpoints (M10): the cards of facts a Door writes, in SQLite. A Checkpoint is not a Message.
//! The Daemon decides who is a Door; the Checkpoint is written to the Workstream of the calling Actor.

mod check;
mod contract_handlers;
mod marks;
mod objects;
#[doc(hidden)]
pub mod schema;
mod store;
pub use marks::{File, FileContent, Mark, Marks, RecordMarks};

use std::sync::Mutex;

use async_trait::async_trait;
use rpc::{Ctx, Module, RpcError, params};
use rusqlite::Connection;
use serde_json::Value;

pub struct Checkpoints {
    db: Mutex<Connection>,
    objects: objects::Objects,
    recorder: Option<std::sync::Arc<dyn RecordMarks>>,
}

#[async_trait]
impl Module for Checkpoints {
    fn namespaces(&self) -> &'static [&'static str] {
        &["checkpoint"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        contracts::checkpoints_methods!(rpc::dispatch_methods, self, ctx, method, value)
    }
}
