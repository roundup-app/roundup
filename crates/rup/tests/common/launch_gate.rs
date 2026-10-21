//! A launch gate over real Claude that holds Agent starts.
use crate::daemon::aimock;

use serde_json::Value;

/// A launch gate over real Claude: starts pass while `hold` exists; a start without it waits and creates `held`.
pub struct Gate {
    pub dir: tempfile::TempDir,
    pub hold: std::path::PathBuf,
    pub held: std::path::PathBuf,
    pub launches: std::path::PathBuf,
}

impl Gate {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let hold = dir.path().join("hold-start");
        std::fs::write(&hold, "").unwrap();
        Self {
            hold,
            held: dir.path().join("held-start"),
            launches: dir.path().join("launches.jsonl"),
            dir,
        }
    }

    pub fn wrapper(&self) -> String {
        aimock::launch_wrapper(self.dir.path(), &self.hold, &self.held, &self.launches)
            .to_str()
            .unwrap()
            .to_owned()
    }

    /// The Agent starts; the Daemon's own `claude plugin test` runs pass through the gate too.
    pub fn rows(&self) -> Vec<Value> {
        std::fs::read_to_string(&self.launches)
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str::<Value>(line).unwrap())
            .filter(|row| row["argv"][0] == "--settings")
            .collect()
    }
}
