//! RB2 to RB5: what `agent.readbackStart` and `agent.readback` return, the state of one Readback
//! of an Agent's diff.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Where a flow came from: `code` (found by the language server, CP4) or `readback` (added by
/// the model).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum FlowSource {
    Code,
    Readback,
}

/// One step of a flow, in call order: what happens and the ids of the hunks that hold it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ReadFlowStep {
    pub note: String,
    pub hunks: Vec<String>,
}

/// A flow or path the change touches (RB3).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ReadFlow {
    pub id: String,
    pub name: String,
    pub source: FlowSource,
    pub steps: Vec<ReadFlowStep>,
}

/// A short account of one module.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ModuleNote {
    pub module: String,
    pub account: String,
}

/// RB4: where the diff disagrees with the Agent's last message. `said` is the Agent's words,
/// `quote` a fragment of a line the diff holds at `path`, `line` that line on the new side.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Gap {
    pub path: String,
    pub said: String,
    pub quote: String,
    pub line: u32,
}

/// The gaps, or why the comparison with the Agent's last message failed (RB4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(untagged)]
pub enum Gaps {
    Found(Vec<Gap>),
    Failed { failed: String },
}

/// A read Readback (RB3). `unplaced` is computed by the Daemon: the hunk ids no flow holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Account {
    pub overview: String,
    pub diagram: String,
    pub flows: Vec<ReadFlow>,
    pub modules: Vec<ModuleNote>,
    pub unplaced: Vec<String>,
    pub gaps: Gaps,
}

/// The state of the Readback of one `(Agent, to)` (RB5): `stale` is a read result whose diff has
/// changed since; `failed` says why in `cause`, and `kind` is `tooLarge`, `badAnswer` or `call`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Readback {
    NotRead,
    Reading,
    Read(Account),
    Stale(Account),
    Failed { kind: String, cause: String },
}
