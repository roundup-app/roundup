//! What the App keeps between runs, in its data folder (S10): the open Projects in order and the
//! names the user gave. Reached from Rust only; incompatible reads refuse startup; failed writes retain recoverable memory.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use rpc::RpcError;
use serde::{Deserialize, Serialize};

const FILE: &str = "projects.json";

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    open: Vec<String>,
    recent: Vec<String>,
    names: BTreeMap<String, String>,
}

pub struct Store {
    dir: OnceLock<PathBuf>,
    /// Read from the file on first use; without a folder it only lives as long as the App.
    saved: Mutex<Option<Result<Saved, RpcError>>>,
}

impl Store {
    pub fn new(dir: Option<PathBuf>) -> Self {
        let store = Self {
            dir: OnceLock::new(),
            saved: Mutex::new(None),
        };
        if let Some(dir) = dir {
            store.use_dir(dir);
        }
        store
    }

    /// Sets the folder unless one is already set, so a test's folder is never replaced by the user's.
    /// The folder the App keeps its data in, once it is known (N1 hands it to each Daemon).
    pub fn dir(&self) -> Option<&Path> {
        self.dir.get().map(PathBuf::as_path)
    }

    pub fn use_dir(&self, dir: PathBuf) {
        let dir = std::path::absolute(&dir).unwrap_or(dir);
        let _ = self.dir.set(dir);
    }

    pub fn open_paths(&self) -> Result<Vec<String>, RpcError> {
        self.with(false, |saved| saved.open.clone())
    }

    pub fn recent_projects(&self) -> Result<Vec<String>, RpcError> {
        self.with(false, |saved| {
            saved
                .recent
                .iter()
                .filter(|path| Path::new(path).is_dir())
                .take(5)
                .cloned()
                .collect()
        })
    }

    pub fn record_recent(&self, path: &str) -> Result<(), RpcError> {
        self.with(true, |saved| {
            saved.recent.retain(|entry| entry != path);
            saved.recent.insert(0, path.to_owned());
            saved.recent.truncate(5);
        })
    }

    pub fn name(&self, path: &str) -> Result<Option<String>, RpcError> {
        self.with(false, |saved| saved.names.get(path).cloned())
    }

    pub fn set_open(&self, paths: Vec<String>) -> Result<(), RpcError> {
        self.with(true, |saved| saved.open = paths)
    }

    /// `None` removes the stored name. A captured base is compared under the same lock as the
    /// write, so a stale editor cannot replace a name accepted after its last read.
    pub fn set_name(
        &self,
        path: &str,
        name: Option<String>,
        base: Option<&str>,
        fallback: &str,
    ) -> Result<String, RpcError> {
        self.with(true, |saved| {
            let current = saved
                .names
                .get(path)
                .map(String::as_str)
                .unwrap_or(fallback);
            if base.is_some_and(|base| base != current) {
                return Err(RpcError::conflict("Project name changed"));
            }
            let result = name.clone().unwrap_or_else(|| fallback.to_owned());
            match name {
                Some(name) => {
                    saved.names.insert(path.to_owned(), name);
                }
                None => {
                    saved.names.remove(path);
                }
            }
            Ok(result)
        })?
    }

    pub fn load(&self) -> Result<(), RpcError> {
        self.with(false, |_| ())
    }

    fn with<T>(&self, persist: bool, change: impl FnOnce(&mut Saved) -> T) -> Result<T, RpcError> {
        let mut guard = self
            .saved
            .lock()
            .expect("the store lock is never kept across a panic");
        let saved = guard
            .get_or_insert_with(|| self.read())
            .as_mut()
            .map_err(|error| error.clone())?;
        let result = change(saved);
        if persist && let Some(dir) = self.dir.get() {
            write(dir, saved);
        }
        Ok(result)
    }

    fn read(&self) -> Result<Saved, RpcError> {
        let Some(dir) = self.dir.get() else {
            return Ok(Saved::default());
        };
        let refuse = |cause| {
            RpcError::internal(format!(
                "Local Project preferences are incompatible with this build or unreadable ({cause}). Close roundup and delete only projects.json in {} to start fresh. Preserve all other files, Projects and Worktrees.",
                dir.display()
            ))
        };
        match std::fs::read(dir.join(FILE)) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| {
                log::warn!(target: "roundup::shell", "restore Project store: JSON {:?} at {}:{}; original file retained", error.classify(), error.line(), error.column());
                refuse(error.to_string())
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Saved::default()),
            Err(error) => Err(refuse(error.to_string())),
        }
    }
}

/// Written beside its final name and renamed, so a crash never leaves half a file.
fn write(dir: &Path, saved: &Saved) {
    let result = std::fs::create_dir_all(dir).and_then(|()| {
        let temporary = dir.join(format!("{FILE}.tmp"));
        std::fs::write(&temporary, serde_json::to_vec_pretty(saved)?)?;
        std::fs::rename(temporary, dir.join(FILE))
    });
    if let Err(err) = result {
        log::warn!(target: "roundup::shell", "save Project store: IO {:?}; changes remain in memory", err.kind());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn n5467b_incompatible_preferences_are_refused_without_rewriting() {
        for bytes in [
            br#"{}"#.as_slice(),
            br#"{"open":[],"names":{}}"#,
            br#"{"recent":[],"names":{}}"#,
            br#"{"open":[],"recent":[]}"#,
            br#"{"open":[],"recent":[],"names":[],"extra":true}"#,
            b"{broken",
        ] {
            let dir = tempfile::tempdir().unwrap();
            let file = dir.path().join(FILE);
            std::fs::write(&file, bytes).unwrap();
            for _ in 0..2 {
                let store = Store::new(Some(dir.path().to_owned()));
                let error = store
                    .set_name("/sentinel", Some("changed".into()), None, "sentinel")
                    .unwrap_err();
                assert!(error.message.contains("incompatible"));
                assert!(error.message.contains(&dir.path().display().to_string()));
                assert!(error.message.contains("Close roundup"));
                assert!(error.message.contains("projects.json"));
                assert_eq!(std::fs::read(&file).unwrap(), bytes);
            }
        }
    }

    #[test]
    fn n5467c_fresh_preferences_reopen_with_current_names_and_order() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let store = Store::new(Some(data.clone()));
        store.load().unwrap();
        assert!(!data.exists());
        let first = dir.path().join("first");
        let second = dir.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        let first = first.display().to_string();
        let second = second.display().to_string();
        store.set_open(vec![second.clone(), first.clone()]).unwrap();
        store
            .set_name(&first, Some("雪".into()), None, "first")
            .unwrap();
        store.record_recent(&first).unwrap();
        store.record_recent(&second).unwrap();
        let bytes = std::fs::read(data.join(FILE)).unwrap();
        let reopened = Store::new(Some(data.clone()));
        assert_eq!(
            reopened.open_paths().unwrap(),
            [second.clone(), first.clone()]
        );
        assert_eq!(reopened.name(&first).unwrap().as_deref(), Some("雪"));
        assert_eq!(reopened.recent_projects().unwrap(), [second, first]);
        assert_eq!(std::fs::read(data.join(FILE)).unwrap(), bytes);
    }

    #[test]
    fn n5467b_unreadable_preferences_are_not_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(FILE);
        std::fs::create_dir(&file).unwrap();
        for _ in 0..2 {
            let store = Store::new(Some(dir.path().to_owned()));
            assert!(
                store
                    .set_open(vec![])
                    .unwrap_err()
                    .message
                    .contains("unreadable")
            );
            assert!(file.is_dir());
            assert!(!dir.path().join("projects.json.tmp").exists());
        }
    }

    #[test]
    fn s6_recent_paths_are_distinct_bounded_ordered_and_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(Some(dir.path().join("data")));
        let paths: Vec<_> = (0..7)
            .map(|n| {
                let path = dir.path().join(n.to_string());
                std::fs::create_dir(&path).unwrap();
                path.display().to_string()
            })
            .collect();
        for path in &paths {
            store.record_recent(path).unwrap();
        }
        store.record_recent(&paths[3]).unwrap();
        let restored = Store::new(Some(dir.path().join("data")));
        assert_eq!(
            restored.recent_projects().unwrap(),
            vec![
                paths[3].clone(),
                paths[6].clone(),
                paths[5].clone(),
                paths[4].clone(),
                paths[2].clone()
            ]
        );
    }

    #[test]
    fn s6_recent_paths_omit_folders_that_no_longer_exist() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("project");
        std::fs::create_dir(&folder).unwrap();
        let store = Store::new(Some(dir.path().join("data")));
        store.record_recent(&folder.display().to_string()).unwrap();
        std::fs::remove_dir(folder).unwrap();
        assert!(store.recent_projects().unwrap().is_empty());
    }
}
