//! RB2 to RB5, RB13 to RB15: what `agent.readbackStart` and `agent.readback` return, the state of
//! one Readback of an Agent's diff, and what `agent.explain` asks and answers.

use super::CompareTarget;
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

/// RB10: how much of the change a hunk is: `core` (the change itself), `forced` (what it forces
/// elsewhere) or `glue` (wiring), in that order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Rank {
    Core,
    Forced,
    Glue,
}

/// RB10: the rank of one hunk id of the run's input.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct HunkRank {
    pub hunk: String,
    pub rank: Rank,
}

/// RB11: how much a flow or module deserves a closer look.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    High,
    Medium,
    Low,
}

/// RB11: what a risk is about: a `ReadFlow` id or a module's name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RiskTarget {
    Flow,
    Module,
}

/// RB11: the risk of one flow or module, with its one-sentence reason.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Risk {
    pub target: RiskTarget,
    pub id: String,
    pub level: RiskLevel,
    pub reason: String,
}

/// A read Readback (RB3). `ranks` holds one rank per hunk id of the input (RB10) and `risks` one
/// risk per flow and module (RB11). `unplaced` is computed by the Daemon: the hunk ids no flow holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Account {
    pub overview: String,
    pub diagram: String,
    pub flows: Vec<ReadFlow>,
    pub modules: Vec<ModuleNote>,
    pub unplaced: Vec<String>,
    pub ranks: Vec<HunkRank>,
    pub risks: Vec<Risk>,
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

/// RS1: start a Readback of the Agent's diff, optionally briefed by one of the user's Skills.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ReadbackStartParams {
    pub id: String,
    #[serde(default)]
    #[specta(optional, type = CompareTarget)]
    pub to: CompareTarget,
    /// A Skill name `agent.skills` lists for the Agent; its body is the readback's review lens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub skill: Option<String>,
}

/// RB13: which side of the diff a selection numbers its lines on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DiffSide {
    Old,
    New,
}

/// RB13: how the reader answers: in sentences, or as a small text diagram.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExplainForm {
    Words,
    Diagram,
}

/// RB13: explain lines `start` to `end` of `side` of `path` in the Agent's diff, in `form`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExplainParams {
    pub id: String,
    #[serde(default)]
    #[specta(optional, type = CompareTarget)]
    pub to: CompareTarget,
    pub path: String,
    pub side: DiffSide,
    pub start: u32,
    pub end: u32,
    pub form: ExplainForm,
}

/// RB14, RB15: an Explanation of a selection: `text` is sentences for `words` and the parts and
/// calls, one `A -> B` per line, for `diagram`; `failed` says why in `cause`, and `kind` is
/// `outOfDiff`, `tooLarge`, `badAnswer` or `call`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Explanation {
    Explained { form: ExplainForm, text: String },
    Failed { kind: String, cause: String },
}
