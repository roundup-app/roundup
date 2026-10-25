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
        Self::open_at(data, time::OffsetDateTime::now_utc().into())
    }

    fn open_at(data: &Path, now: SystemTime) -> Self {
        let dir = data.join(FOLDER);
        let mut highest = 0;
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let age = entry
                    .metadata()
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|at| now.duration_since(at).ok());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn z3799c_pruning_keeps_future_and_boundary_files() {
        let data = tempfile::tempdir().unwrap();
        let dir = data.path().join(FOLDER);
        fs::create_dir(&dir).unwrap();
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let cases = [
            ("9-future.png", now + Duration::from_secs(1), true),
            ("8-boundary.png", now - Duration::from_secs(604_800), true),
            ("10-expired.png", now - Duration::from_secs(604_801), false),
        ];
        for (name, modified, _) in cases {
            let file = fs::File::create(dir.join(name)).unwrap();
            file.set_modified(modified).unwrap();
            assert_eq!(file.metadata().unwrap().modified().unwrap(), modified);
        }

        let attachments = Attachments::open_at(data.path(), now);

        for (name, _, retained) in cases {
            assert_eq!(dir.join(name).exists(), retained, "{name}");
        }
        let saved = attachments
            .save(serde_json::json!({"name": "new.png", "data": "eA=="}))
            .unwrap();
        assert_eq!(
            Path::new(saved["path"].as_str().unwrap())
                .file_name()
                .unwrap(),
            "10-new.png"
        );
    }
}
