//! What an Agent's lean launch is remembered as (LC4, LC7).

use std::io::ErrorKind;
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

    /// What `save_lean` kept: `None` for an Agent that launches with the user's full setup, an
    /// error naming the file when it cannot be read or parsed.
    pub fn load_lean(dir: &Path, id: &str) -> Result<Option<Lean>, RpcError> {
        let Some(id) = parse_id(id) else {
            return Ok(None);
        };
        let path = lean_path(dir, id);
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(RpcError::internal(format!("{}: {err}", path.display()))),
        };
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|err| RpcError::internal(format!("{}: {err}", path.display())))
    }
}
