use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Whether the remote's main has commits the repository has not fetched (U7693a).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RemoteMain {
    /// No `origin`, or no `origin/HEAD`: the comparison reads the local default branch.
    None,
    Current,
    Moved,
}

/// What `agent.fetchRemoteMain` brought onto the remote's main (U7693b).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct FetchedMain {
    pub commits: u32,
}
