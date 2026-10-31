//! Workstream settings and Queue.

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
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct QueueEntry {
    pub workstream: String,
    pub start: StartChoice,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = QueueFailure)]
    pub failure: Option<QueueFailure>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct QueueFailure {
    #[specta(type = specta_typescript::BigInt)]
    pub code: i64,
    pub message: String,
}

/// `workstream.queue`: the running count, the Project's cap and the entries in Queue order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
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

/// One Agent to rewind and the turn to return it to.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RewindTurn {
    /// A child of the Door's Workstream, direct or nested; never the Door itself.
    pub agent: String,
    /// The provider's own id of the turn to return to: for Claude Code, the UUID of a user message
    /// in that Agent's conversation.
    pub turn: String,
}

/// `workstream.rewind` (M5159b): ask each named Agent's provider to rewind through its own feature.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RewindParams {
    pub id: String,
    /// One entry per Agent; name every child to rewind them all.
    pub turns: Vec<RewindTurn>,
}

/// How one named Agent ended up.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum RewindState {
    Rewound,
    Unavailable,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct RewindAgent {
    pub agent: String,
    pub name: String,
    pub state: RewindState,
    /// Why it was `unavailable` or `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub reason: Option<String>,
}

/// What `workstream.rewind` returns to the Door: one outcome per named Agent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Rewind {
    pub agents: Vec<RewindAgent>,
}
