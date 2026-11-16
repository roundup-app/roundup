//! MC72, MC75: `herdr-core machine update <name>` is the CLI's, which `connect` has no method for.

use std::ffi::OsStr;
use std::process::Stdio;

use tokio::process::Command;

use crate::error::{Error, Result};

/// Runs `<program> machine update <name>` on this Mac; the CLI reaches the machine through the
/// user's own ssh. A failure carries the last line the CLI printed.
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
    let text = |bytes: &[u8]| {
        String::from_utf8_lossy(bytes)
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_owned())
    };
    Err(Error::Update(
        text(&out.stderr)
            .or_else(|| text(&out.stdout))
            .unwrap_or_else(|| format!("herdr-core machine update exited with {}", out.status)),
    ))
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
