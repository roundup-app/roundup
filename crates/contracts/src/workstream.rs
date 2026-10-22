//! Clearing a Workstream (A32): a Handoff, then the Door's next Iteration.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The longest `reason` a clear takes, in characters.
pub const REASON_MAX: usize = 2000;

/// A3194: when a new Workstream's Door starts (the Start choice).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "workstream/")]
pub enum StartChoice {
    Now,
    Queued,
    AfterTodo { todo: u32 },
}

/// `todo.startWorkstream`: a Workstream that owns the Todo `id`, started as `start` says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct StartWorkstreamParams {
    pub id: u32,
    pub name: String,
    pub start: StartChoice,
}

/// A3195: a Workstream in the Queue, with the failure of its last start when that failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct QueueEntry {
    pub workstream: String,
    pub start: StartChoice,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub failure: Option<QueueFailure>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct QueueFailure {
    pub code: i64,
    pub message: String,
}

/// `workstream.queue`: the running count, the Project's cap and the entries in Queue order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct QueueState {
    pub running: u32,
    pub cap: Option<u32>,
    pub entries: Vec<QueueEntry>,
}

/// `workstream.dequeue` and `workstream.startNow`.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct QueuedWorkstream {
    pub workstream: String,
}

/// `workstream.queueMove`: place the entry at `index` (from 0), clamped to the Queue's length.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct QueueMoveParams {
    pub workstream: String,
    pub index: u32,
}

/// `project.setWorkstreamCap`: an integer 1 or more, or `None` for no cap.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct CapParams {
    #[ts(type = "number | null")]
    pub cap: Option<serde_json::Value>,
}

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

/// `workstream.rewindPlan`: what a rewind of the Door's own Workstream to `checkpoint` would do.
/// `agent` selects one child, direct or nested; without it every child is selected.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct RewindPlanParams {
    pub id: String,
    pub checkpoint: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent: Option<String>,
}

/// One selected child.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct PlanAgent {
    pub agent: String,
    pub name: String,
    /// Under Takeover (B6): the rewind of this child waits until the user gives it back.
    pub takeover: bool,
    /// Started after the Checkpoint: a rewind removes it from the Rail.
    pub created_after: bool,
    /// Paths whose content differs between the Mark's snapshot and the Worktree now.
    pub files_changed: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct RewindPlan {
    pub agents: Vec<PlanAgent>,
    /// True when any child's `files_changed` is not empty.
    pub files_changed: bool,
}

/// What happens to files: `keep` leaves every file, `restore` returns each selected Worktree to its Mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "workstream/")]
pub enum Files {
    Keep,
    Restore,
}

/// `workstream.rewind`. `files` is required. A held rewind (`HeldCall::Rewind`) carries the
/// child it waits for in `agent`.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "workstream/")]
pub struct RewindParams {
    pub id: String,
    pub checkpoint: u32,
    pub files: Files,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub agent: Option<String>,
}

/// How one selected child ended up: `waiting` for a Takeover (with the held action `action`),
/// `rewound`, `removed` from the Rail, or `dropped` with its `reason`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "workstream/")]
pub enum RewindState {
    Waiting,
    Rewound,
    Removed,
    Dropped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct RewindAgent {
    pub agent: String,
    pub name: String,
    pub state: RewindState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub action: Option<String>,
}

/// What `workstream.rewind` returns to the Door.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct Rewind {
    /// The Checkpoint's title.
    pub checkpoint: String,
    pub files: Files,
    pub agents: Vec<RewindAgent>,
}

/// `workstream.rewound {id, checkpoint}`: pushed once, after every selected child ended, rewound,
/// removed or dropped.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "workstream/")]
pub struct Rewound {
    pub id: String,
    pub checkpoint: u32,
}
