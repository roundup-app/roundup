//! What an Agent's lean launch is remembered as (LC4, LC7).

use std::path::Path;

use rpc::RpcError;

use super::launch::{Launcher, lean_path, parse_id};
use super::launch_files::replace_file;
use super::models::Lean;

impl Launcher {
    /// LC4, LC7: remember that Agent `id` launches lean as `lean` says, for every launch after.
    pub fn save_lean(dir: &Path, id: &str, lean: &Lean) -> Result<(), RpcError> {
        let id = parse_id(id).ok_or_else(|| RpcError::internal("not a node id"))?;
        let value = serde_json::to_value(lean).map_err(RpcError::internal)?;
        replace_file(&lean_path(dir, id), &value).map_err(RpcError::internal)
    }

    /// What `save_lean` kept; `None` for an Agent that launches with the user's full setup.
    pub fn load_lean(dir: &Path, id: &str) -> Option<Lean> {
        let bytes = std::fs::read(lean_path(dir, parse_id(id)?)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }
}
