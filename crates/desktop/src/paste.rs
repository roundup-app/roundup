//! `save_pasted_image`: saves the image a `⌘V` found on the clipboard as a file whose path the Terminal pastes (`scenarios/ui-terminal-paste.md` U418).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rpc::RpcError;

/// Policy: about five 4K screenshots, above any screenshot and below a clipboard holding a video frame buffer.
pub const LIMIT: usize = 20 * 1024 * 1024;

/// Policy: far past any Agent turn that reads the path.
const KEEP: Duration = Duration::from_secs(7 * 24 * 60 * 60);

const FOLDER: &str = "roundup-pasted";

fn extension(media_type: &str) -> Option<&'static str> {
    match media_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

/// Deletes the files of `folder` last modified over seven days before `now`, and nothing else.
fn prune(folder: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .ok()
            .filter(|meta| meta.is_file())
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > KEEP);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Writes `bytes` to a new file in `<cache>/roundup-pasted` and returns its absolute path.
pub fn save(
    cache: &Path,
    media_type: &str,
    bytes: &[u8],
    now: SystemTime,
) -> Result<PathBuf, RpcError> {
    let extension = extension(media_type).ok_or_else(|| {
        RpcError::forbidden(format!(
            "{media_type} is not an image type a paste can save"
        ))
    })?;
    if bytes.len() > LIMIT {
        return Err(RpcError::forbidden(format!(
            "the image is {} MiB, over the {} MiB a paste can save",
            bytes.len() / (1024 * 1024),
            LIMIT / (1024 * 1024)
        )));
    }
    let io = |err: std::io::Error| {
        RpcError::new(
            rpc::code::INTERNAL,
            format!("could not save the image: {err}"),
        )
    };
    let folder = cache.join(FOLDER);
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&folder)
        .map_err(io)?;
    prune(&folder, now);

    let mut random = [0u8; 4];
    getrandom::fill(&mut random)
        .map_err(|err| RpcError::new(rpc::code::INTERNAL, format!("no random bytes: {err}")))?;
    let seconds = now
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    let name = format!(
        "pasted-{seconds}-{}.{extension}",
        random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let path = folder.join(name);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .and_then(|mut file| file.write_all(bytes))
        .map_err(io)?;

    Ok(path)
}

/// `save` in the OS cache directory, as the clock stands.
pub fn save_in_cache(media_type: &str, bytes: &[u8]) -> Result<PathBuf, RpcError> {
    let cache = dirs::cache_dir()
        .ok_or_else(|| RpcError::new(rpc::code::INTERNAL, "this Mac has no cache folder"))?;

    save(&cache, media_type, bytes, SystemTime::now())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    #[test]
    fn u418_saves_the_bytes_under_a_unique_name() {
        let cache = tempfile::tempdir().unwrap();
        let now = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let types = [
            ("image/png", "png"),
            ("image/jpeg", "jpg"),
            ("image/gif", "gif"),
            ("image/webp", "webp"),
        ];

        for (media_type, extension) in types {
            let first = save(cache.path(), media_type, b"\x89abc", now).unwrap();
            let second = save(cache.path(), media_type, b"\x89abc", now).unwrap();
            let name = first.file_name().unwrap().to_str().unwrap();
            let stem = name.strip_suffix(&format!(".{extension}")).unwrap();
            let hex = stem.strip_prefix("pasted-1700000000-").unwrap();

            assert!(first.is_absolute());
            assert_eq!(first.parent().unwrap(), cache.path().join("roundup-pasted"));
            assert_eq!(hex.len(), 8);
            assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
            assert_ne!(first, second);
            assert_eq!(fs::read(&first).unwrap(), b"\x89abc");
            assert_eq!(
                fs::metadata(&first).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let folder = cache.path().join("roundup-pasted");
        assert_eq!(
            fs::metadata(folder).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn u418_refuses_a_type_it_does_not_name() {
        let cache = tempfile::tempdir().unwrap();

        for refused in ["image/svg+xml", "text/html", "image/png; x", ""] {
            let err = save(cache.path(), refused, b"x", SystemTime::now()).unwrap_err();

            assert_eq!(err.code, rpc::code::FORBIDDEN, "{refused}");
        }
        assert!(!cache.path().join("roundup-pasted").exists());
    }

    #[test]
    fn u418_refuses_bytes_over_the_limit() {
        let cache = tempfile::tempdir().unwrap();
        let big = vec![0u8; LIMIT + 1];

        let err = save(cache.path(), "image/png", &big, SystemTime::now()).unwrap_err();

        assert_eq!(err.code, rpc::code::FORBIDDEN);
        assert!(!cache.path().join("roundup-pasted").exists());
        assert!(save(cache.path(), "image/png", &big[..LIMIT], SystemTime::now()).is_ok());
    }

    #[test]
    fn u418_a_save_prunes_files_older_than_seven_days_and_only_those() {
        let cache = tempfile::tempdir().unwrap();
        let folder = cache.path().join("roundup-pasted");
        fs::create_dir_all(&folder).unwrap();
        let now = SystemTime::now();
        let aged = |name: &str, days: u64| {
            let path = folder.join(name);
            fs::write(&path, "x").unwrap();
            fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(now - Duration::from_secs(days * 24 * 60 * 60 + 60))
                .unwrap();
            path
        };
        let old = aged("old.png", 8);
        let fresh = aged("fresh.png", 6);
        let other = aged("notes.txt", 30);
        let outside = cache.path().join("outside.png");
        fs::write(&outside, "x").unwrap();
        fs::File::options()
            .write(true)
            .open(&outside)
            .unwrap()
            .set_modified(now - Duration::from_secs(30 * 24 * 60 * 60))
            .unwrap();

        save(cache.path(), "image/png", b"x", now).unwrap();

        assert!(!old.exists());
        assert!(fresh.exists());
        assert!(
            !other.exists(),
            "an old file in the folder is pruned whatever its name"
        );
        assert!(outside.exists());
    }
}
