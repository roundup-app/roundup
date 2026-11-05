use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// DCL2: a Workstream's state, most urgent first.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Type, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum WorkstreamState {
    NeedsYou,
    Error,
    Stalled,
    Working,
    Waiting,
    Idle,
    Settled,
}

/// U5483c: completed-turn evidence, never the assistant's text. Missing evidence protects.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct FinalText {
    pub attempt: String,
    /// Opaque completed-turn identity, scoped to the Attempt.
    pub turn: String,
    pub finished: String,
    pub kind: FinalTextKind,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum FinalTextKind {
    #[default]
    Unknown,
    Empty,
    Present,
}
