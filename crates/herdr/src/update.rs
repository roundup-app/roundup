//! MC72, MC75: `herdr-core machine update <name>` is the CLI's, which `connect` has no method for.

use std::ffi::OsStr;
use std::process::Stdio;

use tokio::process::Command;

use crate::error::{Error, Result};

/// Runs `<program> machine update <name>` on this Mac; the CLI reaches the machine through the
/// user's own ssh. A failure carries the `kind` of the JSON line the CLI printed, never the line.
pub async fn update_machine(program: impl AsRef<OsStr>, name: &str) -> Result<()> {
    let out = Command::new(program)
        .args(["machine", "update", name])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => Error::Missing,
            _ => Error::Io(e),
        })?;
    if out.status.success() {
        return Ok(());
    }
    Err(Error::Update(
        kind_of(&out.stderr)
            .or_else(|| kind_of(&out.stdout))
            .unwrap_or_else(|| "update_failed".to_owned()),
    ))
}

/// MC72: the `kind` of the CLI's `{"error":{"kind":…}}` line, the last one that parses.
fn kind_of(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .rev()
        .find_map(|line| {
            let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
            let kind = value.get("error")?.get("kind")?.as_str()?;
            (!kind.is_empty()).then(|| kind.to_owned())
        })
}

/// MC75: whether `found` is an older herdr-core than `than`; a version neither reads is not older.
pub fn older(found: &str, than: &str) -> bool {
    match (semver::Version::parse(found), semver::Version::parse(than)) {
        (Ok(found), Ok(than)) => {
            (found.major, found.minor, found.patch) < (than.major, than.minor, than.patch)
        }
        _ => false,
    }
}
