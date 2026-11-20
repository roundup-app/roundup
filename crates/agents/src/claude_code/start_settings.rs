//! ST1, ST2, ST5: the Claude Code settings a starter sends with `agent.spawn`. They are checked
//! once, kept with the Agent beside its lean record and merged into the `--settings` file at every
//! launch.

use std::io::ErrorKind;
use std::path::Path;

use rpc::{RpcError, code};
use serde_json::Value;

use super::launch::start_settings_path;
use super::launch_files::replace_file;
use crate::id::AgentId;

/// ST1: the most a starter sends.
const MAX_BYTES: usize = 64 * 1024;

/// ST5: the values of `permissions.defaultMode` Claude Code takes.
const MODES: [&str; 5] = [
    "default",
    "acceptEdits",
    "plan",
    "auto",
    "bypassPermissions",
];

/// ST1: `settings` is a JSON object of at most 64 KiB whose `permissions.defaultMode`, when it
/// names one, is a mode Claude Code takes. The message never quotes a value, since an `env` entry
/// may be a secret.
pub fn check(settings: &Value) -> Result<(), RpcError> {
    let invalid = |message: &str| RpcError::new(code::INVALID_PARAMS, message.to_owned());
    if !settings.is_object() {
        return Err(invalid("settings is a JSON object"));
    }
    if serde_json::to_vec(settings)
        .map_err(RpcError::internal)?
        .len()
        > MAX_BYTES
    {
        return Err(invalid("settings is at most 64 KiB"));
    }
    match mode_of(settings) {
        Some(mode) if !MODES.contains(&mode) => Err(invalid(
            "settings.permissions.defaultMode is default, acceptEdits, plan, auto or bypassPermissions",
        )),
        None if settings.pointer("/permissions/defaultMode").is_some() => {
            Err(invalid("settings.permissions.defaultMode is a string"))
        }
        _ => Ok(()),
    }
}

/// ST5: the mode `settings` names.
pub(super) fn mode_of(settings: &Value) -> Option<&str> {
    settings.pointer("/permissions/defaultMode")?.as_str()
}

/// ST1: Claude Code's own joining of settings sources, with `own` first: an array joins and an
/// entry already there is not repeated, an object merges key by key, and any other pair keeps
/// `own`. A key only `theirs` holds is its own.
pub(super) fn merge(own: &mut Value, theirs: &Value) {
    match (own, theirs) {
        (Value::Array(own), Value::Array(theirs)) => {
            for entry in theirs {
                if !own.contains(entry) {
                    own.push(entry.clone());
                }
            }
        }
        (Value::Object(own), Value::Object(theirs)) => {
            for (key, value) in theirs {
                match own.get_mut(key) {
                    Some(ours) => merge(ours, value),
                    None => {
                        own.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        _ => {}
    }
}

impl super::Launcher {
    /// ST2: keep `settings` with Agent `id` for every launch after.
    pub fn save_start_settings(dir: &Path, id: &str, settings: &Value) -> Result<(), RpcError> {
        let id = AgentId::parse(id).ok_or_else(|| RpcError::internal("not a node id"))?;
        replace_file(&start_settings_path(dir, id), settings).map_err(RpcError::internal)
    }

    /// What `save_start_settings` kept: `None` for an Agent started without any.
    pub fn load_start_settings(dir: &Path, id: &str) -> Result<Option<Value>, RpcError> {
        let Some(id) = AgentId::parse(id) else {
            return Ok(None);
        };
        let path = start_settings_path(dir, id);
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(RpcError::internal(format!("{}: {err}", path.display()))),
        };
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| RpcError::internal(format!("{} is not JSON", path.display())))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn st1_merge_joins_arrays_and_roundup_wins_a_shared_scalar() {
        let mut own = json!({"permissions": {"allow": ["a"]}, "env": {"PATH": "/r"}, "k": 1});
        let theirs = json!({"permissions": {"allow": ["a", "b"], "deny": ["x"]},
            "env": {"PATH": "/t", "X": "1"}, "k": {"o": 1}, "z": true});
        merge(&mut own, &theirs);
        assert_eq!(
            own,
            json!({"permissions": {"allow": ["a", "b"], "deny": ["x"]},
                "env": {"PATH": "/r", "X": "1"}, "k": 1, "z": true})
        );
    }

    #[test]
    fn st1_check_refuses_a_non_object_and_a_bad_mode() {
        assert!(check(&json!([])).is_err());
        assert!(check(&json!({"permissions": {"defaultMode": "nope"}})).is_err());
        assert!(check(&json!({"permissions": {"defaultMode": 3}})).is_err());
        assert!(check(&json!({"permissions": {"defaultMode": "plan"}})).is_ok());
        let big = json!({"env": {"A": "x".repeat(MAX_BYTES)}});
        assert!(check(&big).is_err());
    }
}
