//! Workstream settings, Queue and Rewind.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// A3308: the user's Auto choice for one Workstream.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct AutoParams {
    pub id: String,
    pub auto: bool,
}

/// A4452c: the longest opening prompt a Workstream holds, in characters.
pub const OPENING_PROMPT_MAX: usize = 4000;

/// A4452c: the user's saved opening prompt for one Workstream; `None` or blank clears it.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct OpeningPromptParams {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub prompt: Option<String>,
}

/// A4452c: a user-requested fresh Door session. Retries retain `request`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RestartParams {
    pub id: String,
    pub request: String,
}

/// A3194: when a new Workstream's Door starts (the Start choice).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StartChoice {
    Now,
    Queued,
    AfterTodo { todo: u32 },
}

/// `todo.startWorkstream`: a Workstream that owns the Todo `id`, started as `start` says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct StartWorkstreamParams {
    pub id: u32,
    pub name: String,
    pub start: StartChoice,
}

/// A3195: a Workstream in the Queue, with the failure of its last start when that failed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct QueueEntry {
    pub workstream: String,
    pub start: StartChoice,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = QueueFailure)]
    pub failure: Option<QueueFailure>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct QueueFailure {
    #[specta(type = specta_typescript::BigInt)]
    pub code: i64,
    pub message: String,
}

/// `workstream.queue`: the running count, the Project's cap and the entries in Queue order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct QueueState {
    pub running: u32,
    pub cap: Option<u32>,
    pub entries: Vec<QueueEntry>,
}

/// `workstream.dequeue` and `workstream.startNow`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct QueuedWorkstream {
    pub workstream: String,
}

/// `workstream.queueMove`: place the entry at `index` (from 0), clamped to the Queue's length.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct QueueMoveParams {
    pub workstream: String,
    pub index: u32,
}

/// `project.setWorkstreamCap`: an integer 1 or more, or `None` for no cap.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct CapParams {
    #[specta(type = Option<specta_typescript::Number>)]
    pub cap: Option<serde_json::Value>,
}

/// `workstream.rewindPlan`: what a rewind of the Door's own Workstream to `checkpoint` would do.
/// `agent` selects one child, direct or nested; without it every child is selected.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RewindPlanParams {
    pub id: String,
    pub checkpoint: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub agent: Option<String>,
}

/// One selected child.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct PlanAgent {
    pub agent: String,
    pub name: String,
    /// Started after the Checkpoint: a rewind removes it from the Rail.
    pub created_after: bool,
    /// Paths whose content differs between the Mark's snapshot and the Worktree now.
    pub files_changed: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RewindPlan {
    pub agents: Vec<PlanAgent>,
    /// True when any child's `files_changed` is not empty.
    pub files_changed: bool,
}

/// What happens to files: `keep` leaves every file, `restore` returns each selected Worktree to its Mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Files {
    Keep,
    Restore,
}

/// `workstream.rewind`. `files` is required. `agent` selects one child, as in `RewindPlanParams`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RewindParams {
    pub id: String,
    pub checkpoint: u32,
    pub files: Files,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub agent: Option<String>,
}

/// How one selected child ended up: `rewound`, `removed` from the Rail, or `dropped` with its `reason`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RewindState {
    Rewound,
    Removed,
    Dropped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RewindAgent {
    pub agent: String,
    pub name: String,
    pub state: RewindState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub reason: Option<String>,
}

/// What `workstream.rewind` returns to the Door.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Rewind {
    /// The Checkpoint's title.
    pub checkpoint: String,
    pub files: Files,
    pub agents: Vec<RewindAgent>,
}

/// `workstream.rewound {id, checkpoint}`: pushed once, after every selected child ended, rewound,
/// removed or dropped.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Rewound {
    pub id: String,
    pub checkpoint: u32,
}
