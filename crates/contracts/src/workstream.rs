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
