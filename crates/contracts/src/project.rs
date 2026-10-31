//! Per-Project settings (G1, `scenarios/worktrees.md`): today, only the `worktrees` toggle.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Worktrees {
    pub on: bool,
    /// The command Landing runs in a Worktree before it fast-forwards the Base. `None` is
    /// allowed: isolation needs no check, though Landing then refuses (`check_missing`).
    pub check: Option<String>,
}

/// G2542a, G2542c: the Project's prepared-directory mode, set only by explicit local user
/// configuration. A non-empty `enrolled` turns the mode on (with `worktrees` on); each path is
/// an existing Worktree of this repository that the Project already prepared.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Prepared {
    pub enrolled: Vec<String>,
    /// Run in the directory, with `sh -c`, on every assignment; exit 0 before the Agent starts.
    pub readiness: Option<String>,
    /// Positive: how long the readiness command may run, in milliseconds.
    #[specta(type = Option<specta_typescript::BigInt>)]
    pub timeout_ms: Option<u64>,
    /// Run only by `project.prepareDirectory`, before the readiness command; never at launch.
    pub setup: Option<String>,
}

/// G2542a: `project.prepareDirectory`, the explicit preparation of one unavailable directory.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct PrepareParams {
    pub path: String,
}

/// M2219: whether Agents launch with the roundup MCP server; a Project that never set it reads `on: true`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Mcp {
    pub on: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ProjectSettings {
    pub worktrees: Worktrees,
    /// A36: the Model and Effort the user set per Role, and the Models a Door may start a child on.
    pub models: ProjectModels,
    pub mcp: Mcp,
    /// A3195: the most Workstreams that run at once; `None` is no cap.
    #[serde(rename = "workstreamCap")]
    #[specta(type = Option<specta_typescript::Number>)]
    pub workstream_cap: Option<u32>,
}

/// A36: one Model or Effort the Adapter offers. Outside the Adapter `id` is opaque (P4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Choice {
    pub id: String,
    pub label: String,
}

/// A36: `models.list`, the Models and Efforts the Adapter offers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ModelList {
    pub engines: Vec<Choice>,
    pub models: Vec<Choice>,
    pub efforts: Vec<Choice>,
}

/// A36: the Model and Effort of one Role; `None` passes nothing, so the user's own default applies.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RoleModels {
    pub role: String,
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// A36: what `project.setModels` takes and `project.get` returns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ProjectModels {
    pub roles: Vec<RoleModels>,
}

/// M8: ask the App to open the Project at `path`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct OpenParams {
    /// An absolute path to an existing folder.
    pub path: String,
}

/// M8: ask the App to give this Project another name (S10's rule, but never empty).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RenameParams {
    pub name: String,
}

/// M8: what the Daemon asks of the App, which no Daemon can reach but by an Event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Requested {
    Open { path: String },
    Rename { path: String, name: String },
}

/// D8: one Agent's Resource use, sampled by `project.resources`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct AgentResources {
    pub id: String,
    /// Resident memory of the Agent's program and every program it started.
    #[specta(type = specta_typescript::Number)]
    pub memory_bytes: u64,
    /// Share of one core since the previous sample, summed over the same tree (100 is one core).
    #[specta(type = specta_typescript::Number)]
    pub cpu_percent: f64,
    /// The size of the Agent's Worktree; `None` for an Agent with none.
    #[specta(type = Option<specta_typescript::Number>)]
    pub disk_bytes: Option<u64>,
}

/// D8: the Project's Resource use in total.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ResourceTotal {
    #[specta(type = specta_typescript::Number)]
    pub memory_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub cpu_percent: f64,
    /// The sum of the Agents' non-null disk sizes; `None` when every one is `None`.
    #[specta(type = Option<specta_typescript::Number>)]
    pub disk_bytes: Option<u64>,
}

/// D8: what `project.resources` returns.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Resources {
    pub agents: Vec<AgentResources>,
    pub total: ResourceTotal,
}

/// U2875a: how far back `project.importDiscover` looks, counted from the call.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ImportPeriod {
    Day,
    Week,
    Month,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportDiscoverParams {
    /// Read the last list published by this Agent in this Project; absent uses direct discovery.
    #[serde(default)]
    #[specta(optional, type = String)]
    pub agent: Option<String>,
    pub period: ImportPeriod,
}

/// One recent conversation the user may import. `revision` binds a confirmation to what was shown.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportCandidate {
    pub source: String,
    pub title: String,
    /// The conversation's working directory, relative to the Project ("" is the Project folder).
    pub cwd: String,
    #[specta(type = specta_typescript::BigInt)]
    pub last_activity_ms: i64,
    pub revision: String,
}

/// Why a saved conversation cannot be selected. Diagnostics never determine this cause.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ImportExclusionCause {
    AlreadyImported,
    AmbiguousProject,
    MissingDirectory,
    NoDirectory,
    TooManyDirectories,
    InsideWorktree,
    DuplicateSource,
    UnknownActivity,
    NoCompleteRecords,
    UnsupportedSource,
    PreviewLimit,
    RecordLimit,
    SnapshotLimit,
    MalformedRecord,
    SubagentRecord,
    ForeignIdentity,
    MetadataLimit,
    IncompleteMetadata,
    SdkUnreadable,
    RecordsMissing,
    InsideRoundup,
    LiveWithoutRecords,
    #[serde(other)]
    Unknown,
}

/// A conversation that is not selectable, with diagnostic details.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportExclusion {
    pub source: String,
    pub cause: ImportExclusionCause,
    pub reason: String,
    /// The conversation's title, when it is known.
    pub title: Option<String>,
    /// Its last activity, or the source file's modified time when none is recorded.
    #[specta(type = Option<specta_typescript::BigInt>)]
    pub last_activity_ms: Option<i64>,
}

/// Newest first; equal times by source identity.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportDiscovery {
    pub candidates: Vec<ImportCandidate>,
    pub excluded: Vec<ImportExclusion>,
}

/// U3523a: what `import.list` reads. `period` is as in `project.importDiscover`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportListParams {
    pub period: ImportPeriod,
}

/// U3523a: a live Claude Code session as `claude agents --json` reported it; each field only
/// when the program supplied it. roundup never signals or writes `pid`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportLive {
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    pub name: Option<String>,
    pub busy: Option<bool>,
    #[specta(type = Option<specta_typescript::BigInt>)]
    pub started_at_ms: Option<i64>,
}

/// U3523a: one session `import.list` offers, once. `revision` binds an approval to what was listed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportListed {
    pub source: String,
    pub title: String,
    /// The first recorded directory inside the Project, relative to it ("" is the Project folder).
    pub cwd: String,
    #[specta(type = specta_typescript::BigInt)]
    pub last_activity_ms: i64,
    pub revision: String,
    pub live: Option<ImportLive>,
}

/// U3523a, U3523f: read-only; newest first, equal times by source identity. `notices` are what the
/// SDK sidecar printed; `sdk` is its pinned version.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportList {
    pub candidates: Vec<ImportListed>,
    pub excluded: Vec<ImportExclusion>,
    pub notices: Vec<String>,
    pub sdk: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportSelection {
    pub source: String,
    pub revision: String,
}

/// U2875b: import the user's selection into this Project. At most 50 selections per call.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportCommitParams {
    /// When confirming an Agent list, bind every pick to its retained preview. User-only.
    #[serde(default)]
    #[specta(optional, type = String)]
    pub agent: Option<String>,
    pub selections: Vec<ImportSelection>,
}

/// Whether a per-source import failure proves refusal or leaves completion unconfirmed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ImportDisposition {
    Failed,
    Unknown,
}

/// The original RPC identity and diagnostic, plus its per-source certainty.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportFailure {
    #[specta(type = specta_typescript::Number)]
    pub code: i64,
    pub message: String,
    pub outcome: ImportDisposition,
}

/// One source's result: the created (or earlier created) nodes, or the cause it was refused.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportOutcome {
    pub source: String,
    pub workstream: Option<String>,
    pub agent: Option<String>,
    pub error: Option<ImportFailure>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ImportResult {
    pub outcomes: Vec<ImportOutcome>,
}

/// Global naming preferences shared by every Project Daemon.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NamingSettings {
    pub automatic_renaming: bool,
    pub naming_guide: String,
}

impl Default for NamingSettings {
    fn default() -> Self {
        Self {
            automatic_renaming: true,
            naming_guide: "Use three hyphen-separated words in role-verb-object order, for example reviewer-checks-tests; at most 32 characters.".into(),
        }
    }
}
