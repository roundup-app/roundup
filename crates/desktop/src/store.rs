//! What the App keeps between runs, in its data folder (S10): the open Projects in order and the
//! names the user gave. Reached from Rust only; a failed read or write is reported and never fails a call.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use rpc::RpcError;
use serde::{Deserialize, Serialize};

const FILE: &str = "projects.json";

#[derive(Default, Serialize, Deserialize)]
struct Saved {
    #[serde(default)]
    open: Vec<String>,
    #[serde(default)]
    names: BTreeMap<String, String>,
}

pub struct Store {
    dir: OnceLock<PathBuf>,
    /// Read from the file on first use; without a folder it only lives as long as the App.
    saved: Mutex<Option<Saved>>,
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
        let _ = self.dir.set(dir);
    }

    pub fn open_paths(&self) -> Vec<String> {
        self.with(|saved| saved.open.clone())
    }

    pub fn name(&self, path: &str) -> Option<String> {
        self.with(|saved| saved.names.get(path).cloned())
    }

    pub fn set_open(&self, paths: Vec<String>) {
        self.with(|saved| saved.open = paths);
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
        self.with(|saved| {
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
        })
    }

    fn with<T>(&self, change: impl FnOnce(&mut Saved) -> T) -> T {
        let mut guard = self
            .saved
            .lock()
            .expect("the store lock is never kept across a panic");
        let saved = guard.get_or_insert_with(|| self.read());
        let result = change(saved);
        if let Some(dir) = self.dir.get() {
            write(dir, saved);
        }
        result
    }

    fn read(&self) -> Saved {
        let Some(dir) = self.dir.get() else {
            return Saved::default();
        };
        match std::fs::read(dir.join(FILE)) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                eprintln!("desktop: ignoring an unreadable {FILE}: {err}");
                Saved::default()
            }),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Saved::default(),
            Err(err) => {
                eprintln!("desktop: could not read {FILE}: {err}");
                Saved::default()
            }
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
        eprintln!("desktop: could not save {FILE}: {err}");
    }
}
