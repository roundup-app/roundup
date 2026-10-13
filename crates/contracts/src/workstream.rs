//! Clearing a Workstream (A32): a Handoff, then the Door's next Iteration.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The longest `reason` a clear takes, in characters.
pub const REASON_MAX: usize = 2000;

/// `workstream.clear`. `without_handoff` makes the Daemon write the Handoff itself.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct ClearParams {
    pub id: String,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub without_handoff: Option<bool>,
}

/// What `workstream.clear` returns at once: `pending` is always `true`. The clear ends with
/// `workstream.cleared` or `workstream.clearFailed`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct ClearResult {
    pub pending: bool,
}

/// `workstream.handoff`, called by the Door while its Workstream's clear is pending.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct HandoffParams {
    pub id: String,
    pub summary: String,
    pub keep_todos: Vec<u32>,
    pub keep_pads: Vec<String>,
}

/// `workstream.cleared`: pushed once, after the Door's new Attempt has started.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct WorkstreamClearedEvent {
    pub id: String,
    pub iteration: u32,
}

/// `workstream.clearFailed`: pushed once when a pending clear ends without clearing. `code` is the
/// RPC error code the clear would have returned and `message` its text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct WorkstreamClearFailedEvent {
    pub id: String,
    pub code: i32,
    pub message: String,
}

/// `workstream.rewindPlan`: what a rewind to `checkpoint` of Workstream `id` would do.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct RewindPlanParams {
    pub id: String,
    pub checkpoint: u32,
}

/// One Agent of the Workstream, the Door included.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct PlanAgent {
    pub agent: String,
    pub name: String,
    /// Under Takeover (B6): rewound only when the user names it.
    pub takeover: bool,
    /// Started after the Checkpoint: removed from the Rail by a rewind.
    pub created_after: bool,
    /// Paths whose content differs between the Mark's snapshot and the Worktree now.
    pub files_changed: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct RewindPlan {
    pub agents: Vec<PlanAgent>,
    /// True when any Agent's `files_changed` is not empty.
    pub files_changed: bool,
}

/// What happens to files: `keep` leaves them, `restore` returns each Worktree to its Mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "workstream/")]
pub enum Files {
    Keep,
    Restore,
}

/// `workstream.rewind`. `takeover` names the Takeover Agents the user chose to rewind, which
/// needs the App's `proof` (H4).
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct RewindParams {
    pub id: String,
    pub checkpoint: u32,
    pub files: Files,
    #[serde(default)]
    #[ts(optional = nullable, type = "Array<string>")]
    pub takeover: Vec<String>,
    #[serde(default)]
    #[ts(optional)]
    pub proof: Option<String>,
}

/// What `workstream.rewind` returns: the Agents taken back, removed from the Rail and skipped.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct Rewind {
    pub rewound: Vec<String>,
    pub removed: Vec<String>,
    pub skipped: Vec<String>,
}

/// `workstream.rewound {id, checkpoint}`: pushed once, after the last restarted Agent's `SessionStart`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct Rewound {
    pub id: String,
    pub checkpoint: u32,
}
