//! N1: Project data placement; N5467b refuses obsolete in-Project application storage.

use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// The App's identifier; its data folder is named by it.
const IDENTIFIER: &str = "dev.roundup.app";

/// `ROUNDUP_DATA_DIR` when set, else the App's data folder for `dev.roundup.app`.
pub fn data_dir() -> io::Result<PathBuf> {
    resolve(
        std::env::var_os("ROUNDUP_DATA_DIR"),
        std::env::var_os("XDG_DATA_HOME"),
        std::env::var_os("HOME"),
    )
}

fn resolve(
    explicit: Option<std::ffi::OsString>,
    xdg: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> io::Result<PathBuf> {
    if let Some(dir) = explicit.filter(|dir| !dir.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let home = home
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::other("neither ROUNDUP_DATA_DIR nor HOME is set"))?;
    if cfg!(target_os = "macos") {
        return Ok(home.join("Library/Application Support").join(IDENTIFIER));
    }
    let base = xdg
        .filter(|dir| !dir.is_empty())
        .map_or_else(|| home.join(".local/share"), PathBuf::from);
    Ok(base.join(IDENTIFIER))
}

/// `<data>/projects/<key>`: the key is the folder name and the first 16 hex digits of the SHA-256
/// of the canonical path.
pub fn project_data(data: &Path, project: &Path) -> io::Result<PathBuf> {
    let canonical = project.canonicalize()?;
    let digest = Sha256::digest(canonical.as_os_str().as_encoded_bytes());
    let mut hex = String::new();
    for byte in &digest[..8] {
        let _ = write!(hex, "{byte:02x}");
    }
    let name = canonical
        .file_name()
        .map_or_else(|| "root".into(), |name| name.to_string_lossy());
    Ok(data.join("projects").join(format!("{name}-{hex}")))
}

/// N5467b: inspect only obsolete application paths, leaving Worktrees and user files untouched.
pub(crate) fn refuse_old_data(project: &Path) -> Result<(), String> {
    let old = project.join(".roundup");
    if !old.is_dir() {
        return Ok(());
    }
    let entries = fs::read_dir(&old).map_err(|e| format!("{}: {e}", old.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if matches!(&*name, "agents" | "pads")
            || [".db", ".db-wal", ".db-shm"]
                .iter()
                .any(|suffix| name.ends_with(suffix))
        {
            let folder = old.canonicalize().map_err(|e| e.to_string())?;
            return Err(format!(
                "Local data is incompatible with this build. Close roundup; preserve Worktrees and unrelated user files in {}, then delete the obsolete application data there to start fresh.",
                folder.display()
            ));
        }
    }
    Ok(())
}

/// Global preferences live beside `projects/`, never in a selected Project's database.
pub(crate) fn naming_path(project_data: &Path) -> PathBuf {
    let parent = project_data.parent();
    let root = match parent {
        Some(parent) if parent.file_name().is_some_and(|name| name == "projects") => {
            parent.parent().unwrap_or(parent)
        }
        _ => return project_data.join("preferences/preferences.db"),
    };
    root.join("preferences.db")
}

/// Handle user-owned naming preferences in the App's global data folder, without a Project.
pub fn naming_settings(
    root: &Path,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, rpc::RpcError> {
    let db = open_naming(&root.join("preferences.db")).map_err(rpc::RpcError::internal)?;
    if method == "daemon.getNaming" {
        return rpc::reply(&read_naming(&db).map_err(rpc::RpcError::internal)?);
    }
    if method != "daemon.setNaming" {
        return Err(rpc::RpcError::new(
            rpc::code::METHOD_NOT_FOUND,
            "Unknown naming action",
        ));
    }
    let settings: contracts::project::NamingSettings = rpc::params(params)?;
    if settings.naming_guide.trim().is_empty() {
        return Err(rpc::RpcError::new(
            rpc::code::INVALID_PARAMS,
            "Enter a naming guide before saving.",
        ));
    }
    write_naming(&db, &settings).map_err(rpc::RpcError::internal)?;
    rpc::reply(&())
}

/// SQLite owns atomic commits and cross-process visibility for all Project Daemons.
pub(crate) fn open_naming(path: &Path) -> rusqlite::Result<rusqlite::Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    }
    let db = rusqlite::Connection::open(path)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS naming (id INTEGER PRIMARY KEY CHECK(id = 1), automatic_renaming INTEGER NOT NULL, naming_guide TEXT NOT NULL)")?;
    Ok(db)
}

pub(crate) fn read_naming(
    db: &rusqlite::Connection,
) -> rusqlite::Result<contracts::project::NamingSettings> {
    use rusqlite::OptionalExtension;
    db.query_row(
        "SELECT automatic_renaming, naming_guide FROM naming WHERE id = 1",
        [],
        |row| {
            Ok(contracts::project::NamingSettings {
                automatic_renaming: row.get(0)?,
                naming_guide: row.get(1)?,
            })
        },
    )
    .optional()
    .map(Option::unwrap_or_default)
}

pub(crate) fn write_naming(
    db: &rusqlite::Connection,
    settings: &contracts::project::NamingSettings,
) -> rusqlite::Result<()> {
    db.execute("INSERT INTO naming VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET automatic_renaming = excluded.automatic_renaming, naming_guide = excluded.naming_guide",
        rusqlite::params![settings.automatic_renaming, settings.naming_guide])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn n1_two_paths_to_one_folder_have_one_key_and_two_folders_have_two() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, b) = (tmp.path().join("a/app"), tmp.path().join("b/app"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        std::os::unix::fs::symlink(&a, tmp.path().join("link")).unwrap();
        let data = tmp.path().join("data");
        let key = |p: &Path| project_data(&data, p).unwrap();
        assert_eq!(key(&a), key(&tmp.path().join("link")));
        assert_ne!(key(&a), key(&b));
        let name = key(&a).file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with("app-") && name.len() == "app-".len() + 16);
    }

    #[test]
    fn n1_the_default_data_folder_is_the_apps() {
        let dir = resolve(None, None, Some("/h".into())).unwrap();
        let expected = if cfg!(target_os = "macos") {
            "/h/Library/Application Support/dev.roundup.app"
        } else {
            "/h/.local/share/dev.roundup.app"
        };
        assert_eq!(dir, Path::new(expected));
        assert_eq!(
            resolve(Some("/d".into()), None, None).unwrap(),
            Path::new("/d")
        );
    }

    #[test]
    fn n5467b_old_project_data_is_refused_and_worktrees_are_preserved() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join(".roundup");
        fs::create_dir_all(old.join("worktrees/agent-1")).unwrap();
        fs::write(old.join("worktrees/agent-1/work"), "kept").unwrap();
        fs::write(old.join("notes.txt"), "mine").unwrap();
        refuse_old_data(tmp.path()).unwrap();
        fs::write(old.join("agents.db"), "obsolete bytes").unwrap();
        for _ in 0..2 {
            let error = refuse_old_data(tmp.path()).unwrap_err();
            assert!(error.contains(old.to_str().unwrap()), "{error}");
            assert!(
                error.contains("preserve Worktrees and unrelated user files"),
                "{error}"
            );
            assert!(
                error.contains("delete the obsolete application data"),
                "{error}"
            );
            assert_eq!(
                fs::read_to_string(old.join("agents.db")).unwrap(),
                "obsolete bytes"
            );
            assert_eq!(
                fs::read_to_string(old.join("worktrees/agent-1/work")).unwrap(),
                "kept"
            );
            assert_eq!(fs::read_to_string(old.join("notes.txt")).unwrap(), "mine");
        }
    }
}
