//! Pads: markdown notes, app-stored or as files. Owner: pads Builder.

mod contract_handlers;
mod deletion;
mod files;
pub use deletion::{restore, retain};
mod name;
mod operations;
pub mod reference;
mod rename;
#[doc(hidden)]
pub mod schema;
pub mod section;
mod store;

use std::path::PathBuf;
use std::sync::Mutex;

use async_trait::async_trait;
use contracts::pad::PadName;
use contracts::{Actor, EventData};
use rpc::{Ctx, Module, RpcError, params, reply};
use serde_json::Value;

use operations::{found, get, wrote};
use store::Store;
pub use store::{PadDeletion, PadSource, PadSourceState, source, source_state};

pub struct Pads {
    store: Mutex<Store>,
    files_dir: PathBuf,
}

#[async_trait]
impl Module for Pads {
    fn namespaces(&self) -> &'static [&'static str] {
        &["pad"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        contracts::pads_methods!(rpc::dispatch_methods, self, ctx, method, value)
    }
}

/// Files temporarily renamed beside their originals, so rollback does not reconstruct text
/// from SQLite or lose external edits, permissions or symlinks.
#[derive(Default)]
pub struct RemovalFiles {
    files: Vec<(PathBuf, tempfile::TempPath)>,
    committed: bool,
}
