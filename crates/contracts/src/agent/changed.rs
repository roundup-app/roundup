//! The files an Agent changed, per repository and branch (U2539a, U7186a, U7853a, U7952a).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// How a Changed file differs from the Agent's Base (U2539a).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChangedStatus {
    Added,
    Modified,
    Renamed,
    Deleted,
    Untracked,
}

/// The `+added -removed` line counts of one changed file, as `git diff --numstat` counts them (U7610a).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct LineCounts {
    pub added: u32,
    pub removed: u32,
}

/// One file the Agent's Worktree differs in: `line` is the 1-based first differing line in the
/// working copy (`null` for a deleted or binary file), `counts` its line counts (`null` for a
/// binary file), `blob` git's blob id of the To side (`null` for a deleted file), `from` the old
/// path of a renamed file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ChangedFile {
    pub path: String,
    pub status: ChangedStatus,
    pub line: Option<u32>,
    pub counts: Option<LineCounts>,
    pub blob: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub from: Option<String>,
}

/// What `agent.changedFiles` returns (U2539a), sorted by `path`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ChangedFiles {
    pub files: Vec<ChangedFile>,
}
