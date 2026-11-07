//! Pads: markdown notes, app-stored or as files. Owner: pads Builder.

#![cfg_attr(
    not(test),
    deny(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

mod contract_handlers;
mod deletion;
mod error;
pub use error::Error;
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
use rpc::{Ctx, Module, RpcError, params};
use serde_json::Value;

use operations::{found, get, wrote};
use store::Store;
pub use store::{PadDeletion, PadSource, PadSourceState, source, source_state};

pub struct Pads {
    store: Mutex<Store>,
    files_dir: PathBuf,
}

impl Pads {
    /// Every Pad, as `pad.list` replies. It logs no Touch.
    pub fn list_all(&self) -> Result<Vec<contracts::pad::Pad>, RpcError> {
        Ok(self.list()?)
    }

    /// `pad.move`: the Daemon has checked `home` against the Rail (P12).
    pub fn set_home(
        &self,
        ctx: &Ctx,
        name: &str,
        home: Option<String>,
    ) -> Result<contracts::pad::Pad, RpcError> {
        let name = name.to_owned();
        Ok(self.move_to(ctx, contracts::pad::MoveParams { name, home })?)
    }
}

#[async_trait]
impl Module for Pads {
    fn namespaces(&self) -> &'static [&'static str] {
        &["pad"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        contracts::pads_methods!(rpc::dispatch_values, self, ctx, method, value)
    }
}

/// Files temporarily renamed beside their originals, so rollback does not reconstruct text
/// from SQLite or lose external edits, permissions or symlinks.
#[derive(Default)]
pub struct RemovalFiles {
    files: Vec<(PathBuf, tempfile::TempPath)>,
    committed: bool,
}

fn reply<T: serde::Serialize>(value: &T) -> Result<Value, Error> {
    Ok(rpc::reply(value)?)
}
