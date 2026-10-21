//! Per-Project settings (G1, `scenarios/worktrees.md`): today, only the `worktrees` toggle.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct Worktrees {
    pub on: bool,
    /// The command Landing runs in a Worktree before it fast-forwards the Base. `None` is
    /// allowed: isolation needs no check, though Landing then refuses (`check_missing`).
    pub check: Option<String>,
}

/// G2542a, G2542c: the Project's prepared-directory mode, set only by explicit local user
/// configuration. A non-empty `enrolled` turns the mode on (with `worktrees` on); each path is
/// an existing Worktree of this repository that the Project already prepared.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct Prepared {
    pub enrolled: Vec<String>,
    /// Run in the directory, with `sh -c`, on every assignment; exit 0 before the Agent starts.
    pub readiness: Option<String>,
    /// Positive: how long the readiness command may run, in milliseconds.
    pub timeout_ms: Option<u64>,
    /// Run only by `project.prepareDirectory`, before the readiness command; never at launch.
    pub setup: Option<String>,
}

/// G2542a: `project.prepareDirectory`, the explicit preparation of one unavailable directory.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct PrepareParams {
    pub path: String,
}

/// M2219: whether Agents launch with the roundup MCP server; a Project that never set it reads `on: true`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct Mcp {
    pub on: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ProjectSettings {
    pub worktrees: Worktrees,
    /// A36: the Model and Effort the user set per Role, and the Models a Door may start a child on.
    pub models: ProjectModels,
    pub mcp: Mcp,
}

/// A36: one Model or Effort the Adapter offers. Outside the Adapter `id` is opaque (P4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct Choice {
    pub id: String,
    pub label: String,
}

/// A36: `models.list`, the Models and Efforts the Adapter offers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ModelList {
    pub models: Vec<Choice>,
    pub efforts: Vec<Choice>,
}

/// A36: the Model and Effort of one Role; `None` passes nothing, so the user's own default applies.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct RoleModels {
    pub role: String,
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// A36: what `project.setModels` takes and `project.get` returns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct ProjectModels {
    pub roles: Vec<RoleModels>,
}

/// M8: ask the App to open the Project at `path`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct OpenParams {
    /// An absolute path to an existing folder.
    pub path: String,
}

/// M8: ask the App to give this Project another name (S10's rule, but never empty).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct RenameParams {
    pub name: String,
}

/// M8: what the Daemon asks of the App, which no Daemon can reach but by an Event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "project/")]
pub enum Requested {
    Open { path: String },
    Rename { path: String, name: String },
}

/// D8: one Agent's Resource use, sampled by `project.resources`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct AgentResources {
    pub id: String,
    /// Resident memory of the Agent's program and every program it started.
    #[ts(type = "number")]
    pub memory_bytes: u64,
    /// Share of one core since the previous sample, summed over the same tree (100 is one core).
    pub cpu_percent: f64,
    /// The size of the Agent's Worktree; `None` for an Agent with none.
    #[ts(type = "number | null")]
    pub disk_bytes: Option<u64>,
}

/// D8: the Project's Resource use in total.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ResourceTotal {
    #[ts(type = "number")]
    pub memory_bytes: u64,
    pub cpu_percent: f64,
    /// The sum of the Agents' non-null disk sizes; `None` when every one is `None`.
    #[ts(type = "number | null")]
    pub disk_bytes: Option<u64>,
}

/// D8: what `project.resources` returns.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct Resources {
    pub agents: Vec<AgentResources>,
    pub total: ResourceTotal,
}

/// U2875a: how far back `project.importDiscover` looks, counted from the call.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "project/")]
pub enum ImportPeriod {
    Day,
    Week,
    Month,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct ImportDiscoverParams {
    pub period: ImportPeriod,
}

/// One recent conversation the user may import. `revision` binds a confirmation to what was shown.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ImportCandidate {
    pub source: String,
    pub title: String,
    /// The conversation's working directory, relative to the Project ("" is the Project folder).
    pub cwd: String,
    pub last_activity_ms: i64,
    pub revision: String,
}

/// A conversation that is not selectable, with the reason the user reads.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ImportExclusion {
    pub source: String,
    pub reason: String,
}

/// Newest first; equal times by source identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ImportDiscovery {
    pub candidates: Vec<ImportCandidate>,
    pub excluded: Vec<ImportExclusion>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct ImportSelection {
    pub source: String,
    pub revision: String,
}

/// U2875b: import the user's selection into this Project. At most 50 selections per call.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct ImportCommitParams {
    pub selections: Vec<ImportSelection>,
}

/// One source's result: the created (or earlier created) nodes, or the cause it was refused.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ImportOutcome {
    pub source: String,
    pub workstream: Option<String>,
    pub agent: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ImportResult {
    pub outcomes: Vec<ImportOutcome>,
}

/// Retained source contributions; latest revisions replace the same identity, never add to it.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct Measurements {
    pub project: String,
    pub cause: Option<String>,
    pub revision: String,
    pub contributions: Vec<Measurement>,
    pub time_evidence: Vec<Measurement>,
    pub sources: Vec<MeasurementSource>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct Measurement {
    pub identity: String,
    pub source: String,
    pub source_revision: String,
    pub agent: String,
    pub attempt: Option<String>,
    pub home: Option<String>,
    pub maker: String,
    #[ts(type = "number")]
    pub observed: i64,
    pub value: MeasurementValue,
    pub coverage: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "project/")]
pub enum MeasurementValue {
    Request {
        usage: Consumed,
        // Old retained records remain explicitly unknown until bounded source replay.
        #[serde(default)]
        cost: Option<Box<RequestCost>>,
    },
    /// Inclusive source totals never add to constituent requests or their reference estimates.
    Money { reported: ReportedMoney },
    /// Roundup-owned lifetimes and waits. Never model/tool execution.
    Observed {
        activity: TimedActivity,
        clock_lifetime: String,
        start: Option<ClockPoint>,
        segments: Vec<ObservedSegment>,
        state: TimeState,
    },
    Interval {
        category: Execution,
        clock: String,
        start_unix_ns: String,
        end_unix_ns: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "project/")]
pub enum Execution {
    Agent,
    Tool,
}

/// Disjoint consumed categories. Unknown is not measured zero.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct Consumed {
    #[ts(type = "number | null")]
    pub input: Option<u64>,
    #[ts(type = "number | null")]
    pub output: Option<u64>,
    #[ts(type = "number | null")]
    pub cache_read: Option<u64>,
    #[ts(type = "number | null")]
    pub cache_write: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct MeasurementSource {
    pub source: String,
    pub agent: String,
    #[ts(type = "number | null")]
    pub last_good: Option<i64>,
    pub cause: Option<String>,
    pub coverage: Vec<String>,
}

/// The operation whose blocking/lifetime was observed, with its original identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "project/")]
pub enum TimedActivity {
    Attempt,
    Decision { decision: String },
    Coordination { message: u32 },
}

/// Local wall time is an alignment observation, never a duration clock.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ClockPoint {
    #[ts(type = "number")]
    pub unix_ms: i64,
    pub monotonic_ns: String,
}

/// Only endpoints in the same lifetime and segment can be subtracted.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ObservedSegment {
    pub start: ClockPoint,
    pub end: ClockPoint,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export, export_to = "project/")]
pub enum TimeState {
    Active,
    Ended { at: ClockPoint },
    Interrupted,
}

/// Retained evidence, never a subscription bill. Missing fields are unknown, never zero.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct RequestCost {
    pub model: Option<String>,
    pub cache_write: CacheWrites,
    pub reference: Option<ReferenceRates>,
    pub reported: Option<ReportedMoney>,
    pub unavailable: Vec<String>,
}

/// Independently observed write classes; they partition Consumed.cache_write, never add to it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct CacheWrites {
    #[ts(type = "number | null")]
    pub five_minute: Option<u64>,
    #[ts(type = "number | null")]
    pub one_hour: Option<u64>,
}

/// Exact decimal currency units per `per_tokens`; an offline comparison, not observed money.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ReferenceRates {
    pub version: String,
    pub date: String,
    pub currency: String,
    pub source: String,
    pub basis: String,
    pub per_tokens: u32,
    pub input: String,
    pub output: String,
    pub cache_read: String,
    pub cache_write_five_minute: String,
    pub cache_write_one_hour: String,
}

/// Source money is separate from reference rates. Currency absence forbids conversion/summing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ReportedMoney {
    pub scope: MoneyScope,
    pub amount: String,
    pub currency: Option<String>,
    pub source: String,
    pub basis: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "project/")]
pub enum MoneyScope {
    Request,
    Conversation,
}

/// The disjoint consumed category used to rank a Workstream's contributors.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "project/")]
pub enum ConsumedCategory {
    Input,
    Output,
    CacheRead,
    CacheWrite,
    #[default]
    Total,
}

/// Later pages require the revision returned by the first page; a changed revision conflicts.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
#[serde(deny_unknown_fields)]
pub struct MeasurementSummaryParams {
    pub home: String,
    #[serde(default)]
    pub category: ConsumedCategory,
    #[serde(default)]
    pub offset: u32,
    pub revision: Option<String>,
}

/// Exact known subtotal and number of contributions lacking this category.
/// A contributor with no retained requests counts as one unknown contribution.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ConsumedSubtotal {
    pub known: String,
    pub missing: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ConsumedTotals {
    pub input: ConsumedSubtotal,
    pub output: ConsumedSubtotal,
    pub cache_read: ConsumedSubtotal,
    pub cache_write: ConsumedSubtotal,
    pub total: ConsumedSubtotal,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct MeasurementContributor {
    pub agent: String,
    pub maker: String,
    pub removed: bool,
    pub tokens: ConsumedTotals,
    pub coverage: Vec<String>,
}

/// One Workstream's consumed tokens, ranked in pages of at most twenty at one revision.
/// Money and time retain their separate evidence contract; they are not token totals.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct MeasurementSummary {
    pub project: String,
    pub home: String,
    pub revision: String,
    pub category: ConsumedCategory,
    pub cause: Option<String>,
    #[ts(type = "number | null")]
    pub last_observed: Option<i64>,
    pub tokens: ConsumedTotals,
    pub coverage: Vec<String>,
    pub contributors: u32,
    pub rows: Vec<MeasurementContributor>,
    pub next_offset: Option<u32>,
}
