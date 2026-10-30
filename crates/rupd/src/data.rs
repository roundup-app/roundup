//! N1, N3: where a Project's application data lives, and the move of an older Project's files
//! out of its folder.

use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// The App's identifier; its data folder is named by it.
const IDENTIFIER: &str = "dev.roundup.app";

/// Names a copy in progress; a restart deletes any it finds.
const TEMPORARY: &str = ".roundup-moving-";

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

/// Move what an older Project kept in `<project>/.roundup/` into `data`: databases with their
/// `-wal` and `-shm`, and the `agents` and `pads` folders. `worktrees/` and any file roundup did
/// not write stay. Copies, checks the size, renames, then removes the old file; so a failure or a
/// kill leaves the old files whole, and a second call finishes the move.
pub fn migrate(project: &Path, data: &Path) -> Result<(), String> {
    let old = project.join(".roundup");
    if !old.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(data).map_err(|err| format!("{}: {err}", data.display()))?;
    clear_temporaries(data).map_err(|err| format!("{}: {err}", data.display()))?;
    let entries = fs::read_dir(&old).map_err(|err| format!("{}: {err}", old.display()))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("{}: {err}", old.display()))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();
        if is_database_file(&name) && !path.is_dir() {
            move_file(&path, &data.join(&*name))?;
        } else if matches!(&*name, "agents" | "pads") && path.is_dir() {
            move_tree(&path, &data.join(&*name))?;
        }
    }
    // Only an emptied folder goes: a file roundup did not write keeps `.roundup/` in place.
    let _ = fs::remove_dir(&old);
    Ok(())
}

fn is_database_file(name: &str) -> bool {
    [".db", ".db-wal", ".db-shm"]
        .iter()
        .any(|suffix| name.ends_with(suffix))
}

fn clear_temporaries(dir: &Path) -> io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with(TEMPORARY) {
            fs::remove_file(&path)?;
        } else if entry.file_type()?.is_dir() {
            clear_temporaries(&path)?;
        }
    }
    Ok(())
}

fn move_tree(old: &Path, new: &Path) -> Result<(), String> {
    fs::create_dir_all(new).map_err(|err| format!("{}: {err}", new.display()))?;
    let entries = fs::read_dir(old).map_err(|err| format!("{}: {err}", old.display()))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("{}: {err}", old.display()))?;
        let (from, to) = (entry.path(), new.join(entry.file_name()));
        let kind = entry
            .file_type()
            .map_err(|err| format!("{}: {err}", from.display()))?;
        if kind.is_dir() {
            move_tree(&from, &to)?;
        } else {
            move_file(&from, &to)?;
        }
    }
    let _ = fs::remove_dir(old);
    Ok(())
}

fn move_file(old: &Path, new: &Path) -> Result<(), String> {
    let failed = |path: &Path, err: io::Error| format!("{}: {err}", path.display());
    let link = fs::symlink_metadata(old).map_err(|err| failed(old, err))?;
    if new.symlink_metadata().is_ok() {
        // A finished copy whose old file a kill left behind is finished; any other is a conflict.
        let same = if link.is_symlink() {
            fs::read_link(old).ok() == fs::read_link(new).ok()
        } else {
            fs::read(old).map_err(|err| failed(old, err))?
                == fs::read(new).map_err(|err| failed(new, err))?
        };
        if !same {
            return Err(format!(
                "{} and {} differ; neither was changed",
                old.display(),
                new.display()
            ));
        }
        return fs::remove_file(old).map_err(|err| failed(old, err));
    }
    if link.is_symlink() {
        let target = fs::read_link(old).map_err(|err| failed(old, err))?;
        std::os::unix::fs::symlink(target, new).map_err(|err| failed(new, err))?;
        return fs::remove_file(old).map_err(|err| failed(old, err));
    }
    let name = new.file_name().unwrap_or_default().to_string_lossy();
    let temporary = new.with_file_name(format!("{TEMPORARY}{name}"));
    fs::copy(old, &temporary).map_err(|err| failed(old, err))?;
    let copied = fs::metadata(&temporary)
        .map_err(|err| failed(&temporary, err))?
        .len();
    if copied != link.len() {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "{}: copy is {copied} bytes, not {}",
            old.display(),
            link.len()
        ));
    }
    fs::rename(&temporary, new).map_err(|err| failed(new, err))?;
    fs::remove_file(old).map_err(|err| failed(old, err))
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

    fn seeded() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("p");
        let old = project.join(".roundup");
        fs::create_dir_all(old.join("agents/.bin")).unwrap();
        fs::create_dir_all(old.join("worktrees/agent-1")).unwrap();
        for (name, bytes) in [
            ("agents.db", "a"),
            ("agents.db-wal", "bb"),
            ("agents.db-shm", "c"),
        ] {
            fs::write(old.join(name), bytes).unwrap();
        }
        fs::write(old.join("agents/1.brief.md"), "brief").unwrap();
        fs::write(old.join("agents/.bin/rup"), "x").unwrap();
        fs::write(old.join("worktrees/agent-1/f"), "w").unwrap();
        let data = tmp.path().join("data");
        (tmp, data, project, old)
    }

    #[test]
    fn n3_files_move_and_worktrees_stay() {
        let (_tmp, data, project, old) = seeded();
        migrate(&project, &data).unwrap();
        assert_eq!(
            fs::read_to_string(data.join("agents.db-wal")).unwrap(),
            "bb"
        );
        assert_eq!(
            fs::read_to_string(data.join("agents/.bin/rup")).unwrap(),
            "x"
        );
        let mut left: Vec<_> = fs::read_dir(&old)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        left.sort();
        assert_eq!(left, ["worktrees"]);
        assert!(old.join("worktrees/agent-1/f").is_file());
        migrate(&project, &data).unwrap();
    }

    #[test]
    fn n3_an_emptied_folder_goes_and_a_foreign_file_stays() {
        let (_tmp, data, project, old) = seeded();
        fs::remove_dir_all(old.join("worktrees")).unwrap();
        fs::write(old.join("notes.txt"), "mine").unwrap();
        migrate(&project, &data).unwrap();
        assert!(old.join("notes.txt").is_file());
        fs::remove_file(old.join("notes.txt")).unwrap();
        let (_tmp, data, project, old) = seeded();
        fs::remove_dir_all(old.join("worktrees")).unwrap();
        migrate(&project, &data).unwrap();
        assert!(!old.exists());
    }

    #[test]
    fn n3_a_finished_copy_is_finished_and_a_differing_one_is_a_conflict() {
        let (_tmp, data, project, old) = seeded();
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("agents.db"), "a").unwrap();
        fs::write(data.join(format!("{TEMPORARY}agents.db-wal")), "par").unwrap();
        migrate(&project, &data).unwrap();
        assert!(!old.join("agents.db").exists());
        assert!(!data.join(format!("{TEMPORARY}agents.db-wal")).exists());

        let (_tmp, data, project, old) = seeded();
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("agents.db"), "different").unwrap();
        let err = migrate(&project, &data).unwrap_err();
        assert!(err.contains("agents.db") && err.contains(data.to_str().unwrap()));
        assert_eq!(fs::read_to_string(old.join("agents.db")).unwrap(), "a");
    }
}
