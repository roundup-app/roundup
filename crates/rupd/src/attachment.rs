//! U419: `attachment.save` keeps a pasted image's bytes in a file, so a Message can name its path.

use std::fs;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use contracts::attachment::{SaveParams, Saved};
use rpc::{RpcError, code, params, reply};
use serde_json::Value;

const FOLDER: &str = "attachments";
const MAX_BYTES: usize = 20 * 1024 * 1024;
const KEEP: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// The Project's Attachment files and the counter that makes their names unique.
pub(crate) struct Attachments {
    dir: PathBuf,
    next: AtomicU64,
}

impl Attachments {
    /// Removes the files older than 7 days, and counts on from the highest `<n>` left.
    pub(crate) fn open(data: &Path) -> Self {
        let dir = data.join(FOLDER);
        let mut highest = 0;
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let age = entry
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|at| SystemTime::now().duration_since(at).ok());
                if age.is_some_and(|age| age > KEEP) {
                    let _ = fs::remove_file(entry.path());
                    continue;
                }
                let name = entry.file_name();
                let number = name.to_string_lossy();
                if let Some(n) = number.split('-').next().and_then(|n| n.parse::<u64>().ok()) {
                    highest = highest.max(n);
                }
            }
        }
        Self {
            dir,
            next: AtomicU64::new(highest + 1),
        }
    }

    pub(crate) fn save(&self, args: Value) -> Result<Value, RpcError> {
        let SaveParams { name, data } = params(args)?;
        // Base64 is 4 characters per 3 bytes; refuse before allocating the decoded bytes.
        if data.len() > MAX_BYTES / 3 * 4 + 4 {
            return Err(too_large());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.trim())
            .map_err(|err| {
                RpcError::new(code::INVALID_PARAMS, format!("data is not base64: {err}"))
            })?;
        if bytes.len() > MAX_BYTES {
            return Err(too_large());
        }
        fs::create_dir_all(&self.dir).map_err(RpcError::internal)?;
        let name: String = name
            .chars()
            .map(|c| {
                if matches!(c, '/' | '\\') || c.is_control() {
                    '_'
                } else {
                    c
                }
            })
            .collect();
        loop {
            let n = self.next.fetch_add(1, Ordering::Relaxed);
            let path = self.dir.join(format!("{n}-{name}"));
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut file) => {
                    if let Err(err) = file.write_all(&bytes) {
                        let _ = fs::remove_file(&path);
                        return Err(RpcError::internal(err));
                    }
                    let path = path.canonicalize().unwrap_or(path);
                    return reply(&Saved {
                        path: path.to_string_lossy().into_owned(),
                    });
                }
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(RpcError::internal(err)),
            }
        }
    }
}

fn too_large() -> RpcError {
    RpcError::new(
        code::INVALID_PARAMS,
        "the image is over 20 MB, so it was not saved",
    )
}
