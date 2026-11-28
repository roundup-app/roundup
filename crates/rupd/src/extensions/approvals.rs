//! EP5: what the owner approved, kept per Extension folder beside the folder, never inside it.

use std::collections::BTreeMap;
use std::path::PathBuf;

use contracts::extension::Capability;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Approved {
    name: String,
    uses: Vec<Capability>,
}

pub(super) struct Approvals {
    path: Option<PathBuf>,
    held: BTreeMap<String, Approved>,
}

impl Approvals {
    /// The approvals saved at `path`; none when it is absent or unreadable, which grants nothing.
    pub(super) fn load(path: Option<PathBuf>) -> Self {
        let held = path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, held }
    }

    /// EP5: an approval holds while folder, name and the set asked all match.
    pub(super) fn holds(&self, folder: &str, name: &str, uses: &[Capability]) -> bool {
        self.held
            .get(folder)
            .is_some_and(|held| held.name == name && held.uses == uses)
    }

    /// `uses` is sorted and without repeats, as the manifest reader gives it.
    pub(super) fn record(
        &mut self,
        folder: &str,
        name: &str,
        uses: &[Capability],
    ) -> std::io::Result<()> {
        self.held.insert(
            folder.to_owned(),
            Approved {
                name: name.to_owned(),
                uses: uses.to_vec(),
            },
        );
        let Some(path) = &self.path else {
            return Ok(());
        };
        let temp = path.with_extension("tmp");
        std::fs::write(&temp, serde_json::to_vec(&self.held)?)?;
        std::fs::rename(&temp, path)
    }
}
