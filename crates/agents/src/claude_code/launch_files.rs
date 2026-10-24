//! Atomic launch-file writes and the vendor config lock.

use serde_json::Value;
use std::io::{ErrorKind, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// A config lock this old was left by a holder that died: Claude Code keeps `proper-lockfile`'s
/// 10 s default, and a live holder refreshes the lock's mtime every 5 s.
const STALE: Duration = Duration::from_secs(10);

/// The directory lock Claude Code 2.1.286 holds while it saves its config (`<config>.lock`, as
/// npm's `proper-lockfile` makes it); Claude re-reads the config under it. Released on drop.
pub(super) struct ConfigLock {
    path: PathBuf,
}

impl ConfigLock {
    /// Wait for the lock, breaking it once stale. An error once it has been parked past `STALE`
    /// and then some, which no live holder does.
    pub(super) fn take(config: &Path) -> std::io::Result<Self> {
        let mut path = config.as_os_str().to_owned();
        path.push(".lock");
        let path = PathBuf::from(path);
        let located = |err: std::io::Error| {
            std::io::Error::new(err.kind(), format!("{}: {err}", path.display()))
        };
        if let Some(folder) = path.parent() {
            std::fs::create_dir_all(folder).map_err(located)?;
        }
        let deadline = Instant::now() + STALE + Duration::from_secs(1);
        let mut pause = Duration::from_millis(5);
        loop {
            match std::fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(err) if err.kind() != ErrorKind::AlreadyExists => return Err(located(err)),
                Err(_) if is_stale(&path) => match std::fs::remove_dir(&path) {
                    Err(err) if err.kind() != ErrorKind::NotFound => return Err(located(err)),
                    _ => continue,
                },
                Err(_) if Instant::now() >= deadline => {
                    return Err(std::io::Error::other(format!(
                        "{} is still parked after {} s",
                        path.display(),
                        STALE.as_secs() + 1
                    )));
                }
                Err(_) => {}
            }
            std::thread::sleep(pause);
            pause = (pause * 2).min(Duration::from_millis(200));
        }
    }
}

impl Drop for ConfigLock {
    fn drop(&mut self) {
        if let Err(err) = std::fs::remove_dir(&self.path) {
            eprintln!(
                "agents: could not release {}: {err}; it goes stale in {} s",
                self.path.display(),
                STALE.as_secs()
            );
        }
    }
}

/// A lock whose mtime is in the future (as `proper-lockfile` sets it) is not stale.
fn is_stale(lock: &Path) -> bool {
    std::fs::metadata(lock)
        .and_then(|meta| meta.modified())
        .is_ok_and(|modified| modified.elapsed().is_ok_and(|age| age > STALE))
}

/// Write to a fresh file beside `path`, then rename it over `path` itself, so a reader never sees
/// half a file and two writers never share a temp file. A symlink at `path` is replaced, never
/// written through: the files in the Project are not ours to trust. The old permissions are kept
/// (the config holds credentials).
pub(super) fn replace_file(path: &Path, value: &Value) -> std::io::Result<()> {
    replace_bytes(path, &serde_json::to_vec_pretty(value)?)
}

/// [`replace_file`] for text.
pub(super) fn replace_text(path: &Path, text: &str) -> std::io::Result<()> {
    replace_bytes(path, text.as_bytes())
}

fn replace_bytes(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    staged.write_all(bytes)?;
    staged.as_file().sync_all()?;
    if let Ok(existing) = std::fs::symlink_metadata(path)
        && existing.is_file()
    {
        staged.as_file().set_permissions(existing.permissions())?;
    }
    staged.persist(path).map_err(|err| err.error)?;
    Ok(())
}

/// The file Claude's config at `path` really is: through any symlinks (a dotfiles manager's), to
/// a target that may not exist yet, so a dangling link stays a link.
pub(super) fn landing(path: &Path) -> std::io::Result<PathBuf> {
    match path.canonicalize() {
        Err(err) if err.kind() == ErrorKind::NotFound => match std::fs::read_link(path) {
            // A relative target is relative to the link's own folder.
            Ok(next) => landing(&path.parent().unwrap_or(Path::new("")).join(next)),
            // Not a link, or nothing there at all: the write creates `path` itself.
            Err(err) if matches!(err.kind(), ErrorKind::NotFound | ErrorKind::InvalidInput) => {
                Ok(path.to_owned())
            }
            Err(err) => Err(err),
        },
        found => found,
    }
}

/// Claude Code refuses a messaging socket in a folder anyone else can reach.
pub(super) fn socket_folder() -> std::io::Result<tempfile::TempDir> {
    let folder = tempfile::Builder::new().prefix("rup-").tempdir()?;
    std::fs::set_permissions(folder.path(), std::fs::Permissions::from_mode(0o700))?;
    Ok(folder)
}

pub(super) fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
}

/// Vendor settings precedence: objects extend, lists concatenate once, scalars override.
/// Unlike JSON Merge Patch, null is a value and arrays are not replaced.
pub(super) fn merge_settings(base: &mut Value, next: Value) {
    match (base, next) {
        (Value::Object(base), Value::Object(next)) => {
            for (key, value) in next {
                merge_settings(base.entry(key).or_insert(Value::Null), value);
            }
        }
        (Value::Array(base), Value::Array(next)) => {
            for value in next {
                if !base.contains(&value) {
                    base.push(value);
                }
            }
        }
        (base, next) => *base = next,
    }
}

/// A3507b/c: carry all settings, including unknown keys, from the user's config and Project.
pub(super) fn user_settings(config: &Path, project: &Path) -> std::io::Result<Value> {
    let mut settings = serde_json::json!({});
    for file in [
        config.join("settings.json"),
        project.join(".claude/settings.json"),
        project.join(".claude/settings.local.json"),
    ] {
        let bytes = match std::fs::read(&file) {
            Ok(bytes) => bytes,
            Err(err) if err.kind() == ErrorKind::NotFound => continue,
            Err(err) => return Err(err),
        };
        let next: Value = serde_json::from_slice(&bytes)
            .map_err(|err| std::io::Error::other(format!("{}: {err}", file.display())))?;
        if !next.is_object() {
            return Err(std::io::Error::other(format!(
                "{}: settings must be an object",
                file.display()
            )));
        }
        merge_settings(&mut settings, next);
    }
    Ok(settings)
}
