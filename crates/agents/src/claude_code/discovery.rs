//! SDK-backed import discovery and selected-source complete-record validation.

use super::{Launcher, is_uuid};
use contracts::project::ImportExclusionCause;
use rpc::RpcError;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// One conversation the user may import. `revision` binds the preview to the source file facts.
#[derive(Debug, PartialEq, Eq)]
pub struct ImportCandidate {
    pub source: String,
    pub title: String,
    /// The recorded working directory, relative to the Project.
    pub cwd: PathBuf,
    pub last_activity_ms: i64,
    pub revision: String,
}

/// A conversation that is not selectable, with the reason the user reads.
#[derive(Debug, PartialEq, Eq)]
pub struct ImportExclusion {
    pub source: String,
    pub cause: ImportExclusionCause,
    pub reason: String,
    /// The source file's modified time, which names the conversation when no title is known.
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportDiscovery {
    /// Newest first, equal times by source identity.
    pub candidates: Vec<ImportCandidate>,
    pub excluded: Vec<ImportExclusion>,
}

const MAX_RECORD: u64 = 8 * 1024 * 1024;
const MAX_SNAPSHOT: usize = 512 * 1024 * 1024;

impl Launcher {
    /// Compatibility entry point; SDK listing owns all storage discovery and membership.
    pub async fn discover_recent(
        &self,
        project: &Path,
        worktrees: &[PathBuf],
        now_ms: i64,
        period_ms: i64,
    ) -> Result<ImportDiscovery, RpcError> {
        let listing = self
            .list_current(project, worktrees, (now_ms, period_ms), false)
            .await?;
        Ok(ImportDiscovery {
            candidates: listing
                .candidates
                .into_iter()
                .map(|c| ImportCandidate {
                    source: c.source,
                    title: c.title,
                    cwd: c.cwd,
                    last_activity_ms: c.last_activity_ms,
                    revision: c.revision,
                })
                .collect(),
            excluded: listing.excluded,
        })
    }

    /// SDK membership supplies the mapped cwd; only the selected raw source is validated here.
    pub fn read_import_snapshot(
        &self,
        project: &Path,
        source: &str,
        revision: &str,
        _now_ms: i64,
        listed: Option<ImportCandidate>,
    ) -> Result<(ImportCandidate, Vec<u8>), RpcError> {
        let changed = || {
            RpcError::conflict(format!(
                "source changed since preview: {source}; Refresh to try again"
            ))
        };
        if !is_uuid(source) {
            return Err(changed());
        }
        let candidate = listed
            .filter(|c| c.source == source && c.revision == revision)
            .ok_or_else(changed)?;
        let path = self.conversation_path(project, source).map_err(|error| {
            RpcError::conflict(format!(
                "source changed since preview: {source}: {}; Refresh to try again",
                error.message
            ))
        })?;
        let bytes = read_snapshot(
            self,
            &path,
            source,
            revision,
            Instant::now() + Duration::from_secs(18),
        )?;
        if self.conversation_path(project, source)? != path {
            return Err(changed());
        }
        Ok((candidate, bytes))
    }
}

pub(super) fn io_error(path: &Path, error: impl std::fmt::Display) -> RpcError {
    RpcError::internal(format!("{}: {error}", path.display()))
}

pub(super) fn source_revision(metadata: &std::fs::Metadata) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.len(),
        metadata.mtime(),
        metadata.mtime_nsec(),
        metadata.ctime(),
        metadata.ctime_nsec(),
        metadata.mode()
    )
}

/// Freeze complete source records against the preview revision. SDK membership already decided
/// the mapped cwd; historical folders and listing metadata never veto this conversion.
fn read_snapshot(
    launcher: &Launcher,
    path: &Path,
    source: &str,
    revision: &str,
    deadline: Instant,
) -> Result<Vec<u8>, RpcError> {
    let changed = || {
        RpcError::conflict(format!(
            "source changed since preview: {source}; Refresh to try again"
        ))
    };
    #[cfg(not(any(test, feature = "test-support")))]
    let _ = launcher;
    #[cfg(any(test, feature = "test-support"))]
    if let Some(observer) = &launcher.import_observer {
        observer(path, "open", 0);
    }
    let file = std::fs::File::open(path).map_err(|err| io_error(path, err))?;
    let metadata = file.metadata().map_err(|err| io_error(path, err))?;
    if source_revision(&metadata) != revision {
        return Err(changed());
    }
    let mut reader = BufReader::new(file.take(metadata.len()));
    let mut line = Vec::new();
    let mut bytes = Vec::new();
    loop {
        if Instant::now() >= deadline {
            return Err(RpcError::not_accepted(
                "source validation took too long; Refresh to try again",
            ));
        }
        #[cfg(any(test, feature = "test-support"))]
        if let Some(observer) = &launcher.import_observer {
            observer(path, "record", 0);
        }
        line.clear();
        let size = reader
            .by_ref()
            .take(MAX_RECORD + 1)
            .read_until(b'\n', &mut line)
            .map_err(|err| io_error(path, err))?;
        if size == 0 {
            break;
        }
        let refuse = |reason| {
            RpcError::conflict(format!(
                "cannot import {source}: {reason}; Refresh to try again"
            ))
        };
        if line.len() as u64 > MAX_RECORD {
            return Err(refuse("record exceeds 8 MiB limit"));
        }
        if line.last() != Some(&b'\n') {
            break;
        }
        if bytes.len() + line.len() > MAX_SNAPSHOT {
            return Err(refuse("conversation exceeds 512 MiB import limit"));
        }
        if line != b"\n" {
            let record: Value =
                serde_json::from_slice(&line).map_err(|_| refuse("malformed record"))?;
            if !record.is_object() {
                return Err(refuse("malformed record"));
            }
            if record["isSidechain"] == true {
                return Err(refuse("subagent record"));
            }
            if record
                .get("sessionId")
                .is_some_and(|id| !id.is_null() && id.as_str() != Some(source))
            {
                return Err(refuse("identity does not match source"));
            }
        }
        bytes.extend_from_slice(&line);
    }
    if bytes.is_empty() {
        return Err(RpcError::conflict(
            "no complete records; Refresh to try again",
        ));
    }
    if source_revision(
        &reader
            .get_ref()
            .get_ref()
            .metadata()
            .map_err(|err| io_error(path, err))?,
    ) != revision
        || source_revision(&path.metadata().map_err(|err| io_error(path, err))?) != revision
    {
        return Err(changed());
    }
    Ok(bytes)
}

#[cfg(test)]
#[path = "discovery_tests.rs"]
mod tests;
