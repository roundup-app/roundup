//! Agents and the Rail: the tree of Workstreams, Agents and Terminals.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use crate::common::Status;

mod launch;
pub use launch::{Extras, ExtrasAddParams, PermissionMode, SpawnParams, StartDoorParams};

/// Parse the wire ordinal without accepting aliases such as leading zeroes or signs.
pub fn parse_positive_ordinal(value: &str) -> Option<i64> {
    value
        .parse::<i64>()
        .ok()
        .filter(|n| *n > 0 && n.to_string() == value)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum NodeKind {
    Workstream,
    Agent,
}

/// The git worktree Provisioning made for a node's Agent (G2, `scenarios/worktrees.md`).
/// `base` is the branch that was checked out in the Project when it was made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Worktree {
    pub path: String,
    pub branch: String,
    pub base: String,
}

/// A34: what a Workstream's removal took off the Rail, the Todos and the Pads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum RemovalKind {
    Agent,
    Todo,
    Pad,
}

/// A34: why a Workstream's removal kept an item at the Project root.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum KeptReason {
    Running,
    Dirty,
    Ahead,
    Open,
}

/// A34: one item `rail.remove` of a Workstream deleted.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RemovedItem {
    pub id: String,
    pub kind: RemovalKind,
    pub name: String,
}

/// A34: one item `rail.remove` of a Workstream moved to the Project root.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct KeptItem {
    pub id: String,
    pub kind: RemovalKind,
    pub name: String,
    pub reason: KeptReason,
}

/// A34: what `rail.remove` of a Workstream returns.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Removal {
    pub removed: Vec<RemovedItem>,
    pub kept: Vec<KeptItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub deletion: Option<Deletion>,
}

/// Which contents the user chose to remove from a Workstream.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RemoveScope {
    #[default]
    This,
    All,
}

/// A client key requests data-only removal; omission keeps irreversible removal's consent path.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RemoveParams {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub scope: Option<RemoveScope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub operation: Option<String>,
}

/// Authority is retained by the Project, never supplied as a replacement graph.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct DeletionParams {
    pub project: String,
    pub operation: String,
}

/// Reapply only the retained restored boundary. Read `restoration` from the successful
/// restore/deletion receipt; retry the same request after an unknown reply. Conflicting
/// placement, identity or authority refuses atomically and leaves the source retryable.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RedoParams {
    pub project: String,
    pub source: String,
    pub restoration: String,
    pub operation: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Deletion {
    pub project: String,
    pub operation: String,
    pub id: String,
    pub restored: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub restoration: Option<String>,
}

/// What `agent.worktreeState` returns (G3): commits only the branch has, commits only the Base
/// has, and whether the Worktree has a staged, unstaged or untracked change outside `.roundup/`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct WorktreeState {
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = WorktreeCi)]
    pub ci: Option<WorktreeCi>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = WorktreePr)]
    pub pr: Option<WorktreePr>,
    // NR10: the required checks of `pr`, bound to its repository and head.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = WorktreeEvidence)]
    pub evidence: Option<WorktreeEvidence>,
}

/// NR10: only `Complete` carries a concluded required-check set; every other state keeps
/// `checks` empty so it never reads as passing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WorktreeEvidenceState {
    Complete,
    /// A required check is pending or none is required.
    Incomplete,
    /// The PR head moved while the checks were read.
    StaleHead,
    /// The forge read failed in a way that does not say why.
    Unknown,
    /// No usable `gh`, login, GitHub remote or answer in time.
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WorktreeCheckConclusion {
    Passed,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct WorktreeRequiredCheck {
    pub name: String,
    pub conclusion: WorktreeCheckConclusion,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct WorktreeEvidence {
    pub state: WorktreeEvidenceState,
    /// The read is older than the refresh interval or a later refresh failed.
    pub stale: bool,
    /// `host/owner/name`, so two repositories sharing a PR number stay distinct.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub head: Option<String>,
    pub checks: Vec<WorktreeRequiredCheck>,
    /// Seconds since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = specta_typescript::Number)]
    pub read_at: Option<u64>,
    /// Changes whenever the repository, PR, head or check set does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub revision: Option<String>,
}

/// Optional forge checks, independent of an Agent's Kind or local git state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct WorktreeCi {
    pub state: WorktreeCiState,
    pub stale: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WorktreeCiState {
    Passed,
    Failed,
    Running,
    NoCi,
    Conflicts,
    Error,
    Unknown,
}

/// A positive forge PR number, optionally retained after a failed refresh.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct WorktreePr {
    #[specta(type = specta_typescript::Number)]
    pub number: std::num::NonZeroU64,
    pub stale: bool,
}

/// How a Changed file differs from the Agent's Base (U2539a).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChangedStatus {
    Added,
    Modified,
    Renamed,
    Deleted,
    Untracked,
}

/// One file the Agent's Worktree differs in: `line` is the 1-based first differing line in the
/// working copy (`null` for a deleted or binary file), `from` the old path of a renamed file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ChangedFile {
    pub path: String,
    pub status: ChangedStatus,
    pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub from: Option<String>,
}

/// What `agent.changedFiles` returns (U2539a), sorted by `path`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ChangedFiles {
    pub files: Vec<ChangedFile>,
}

/// Select one relative path in an Agent's Worktree (U2540a).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct CompareFileParams {
    pub id: String,
    pub path: String,
}

/// Exact present bytes use SHA-256 revisions; an absent side uses `absent`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FileContent {
    Absent { revision: String },
    Text { revision: String, text: String },
    Binary { revision: String },
}

/// Merge-base versus current disk content, never the index (U2540a).
/// Each side is capped at 4 MiB; oversized or special files fail explicitly.
/// Status is null when no change remains against the merge base.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileComparison {
    pub base: String,
    pub old_path: String,
    pub new_path: String,
    pub status: Option<ChangedStatus>,
    pub old: FileContent,
    pub new: FileContent,
}

/// What `agent.land` returns (G4): the commit the Base points at after Landing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Landed {
    pub base: String,
}

/// O1: what an Agent or a Door holds before it works, exactly one of a Work order (the ask and
/// what it must not do) or a Clarification order (the open question that comes first).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Order {
    Work {
        /// O14: the short name of the order; absent from an old caller's JSON.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        ask: String,
        /// O7: how the Agent knows it is done; absent from an old caller's JSON.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        done: Option<String>,
        limits: Vec<String>,
    },
    Clarification {
        question: String,
    },
}

impl Order {
    /// O2: what an Agent spawned with only a `prompt` holds.
    pub fn work(ask: &str) -> Self {
        Self::Work {
            title: None,
            ask: ask.to_owned(),
            done: None,
            limits: Vec::new(),
        }
    }

    pub fn clarification(question: &str) -> Self {
        Self::Clarification {
            question: question.to_owned(),
        }
    }

    /// O1's shape: the ask or question, a present done condition and every limit, non-empty after
    /// trimming.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Work {
                title,
                ask,
                done,
                limits,
            } => {
                if ask.trim().is_empty() {
                    return Err("order ask must not be empty".into());
                }
                if title
                    .as_deref()
                    .is_some_and(|title| title.trim().is_empty())
                {
                    return Err("order title must not be empty".into());
                }
                if done.as_deref().is_some_and(|done| done.trim().is_empty()) {
                    return Err("order done must not be empty".into());
                }
                if limits.iter().any(|limit| limit.trim().is_empty()) {
                    return Err("order limits must not be empty".into());
                }
            }
            Self::Clarification { question } => {
                if question.trim().is_empty() {
                    return Err("order question must not be empty".into());
                }
            }
        }
        Ok(())
    }

    /// O7: `validate` for an explicit order of a spawn, a Workstream or `agent.setOrder`, which
    /// also holds the ask to `ASK_CAP` characters.
    pub fn validate_explicit(&self) -> Result<(), String> {
        self.validate()?;
        if let Self::Work { title, ask, .. } = self {
            if ask.trim().chars().count() > ASK_CAP {
                return Err(format!("order ask is over {ASK_CAP} characters"));
            }
            if title
                .as_deref()
                .is_some_and(|title| title.split_whitespace().count() > TITLE_CAP)
            {
                return Err(format!("order title is over {TITLE_CAP} words"));
            }
        }
        Ok(())
    }
}

/// O7: the longest `ask` of an explicit order, in Unicode scalar values after trimming.
pub const ASK_CAP: usize = 200;

/// O14: the most words of a Work order's `title`, split on whitespace.
pub const TITLE_CAP: usize = 6;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RailNode {
    /// A3308: the Workstream's Auto choice; absent on an Agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub auto: Option<bool>,
    /// A4452c: the Workstream's saved opening prompt; absent on an Agent and when none is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub opening_prompt: Option<String>,
    pub id: String,
    pub kind: NodeKind,
    pub name: String,
    pub parent: Option<String>,
    /// Position among siblings; lower first.
    pub order: u32,
    /// `None` for Terminals.
    pub status: Option<Status>,
    /// Last allocated program attempt; present even after stop or reopen.
    pub attempt: Option<String>,
    /// Status transition within the current Attempt; absent after reopen.
    pub status_revision: Option<String>,
    /// The Terminal behind an Agent or Terminal node.
    pub terminal_id: Option<String>,
    /// `None` for a Terminal, or when the Project's `worktrees` setting was off.
    pub worktree: Option<Worktree>,
    /// A22: true only for an exited Agent or Door with saved conversation data (A21) and no
    /// start in flight. `false` for a Terminal.
    pub can_resume: bool,
    /// Permission prompts are off for the last acknowledged Attempt; cleared on reopen.
    #[serde(default)]
    pub yolo: bool,
    /// E6: whether the Agent's `rup mcp` has reported to the Daemon. `None` for a Workstream that is
    /// no Door, a Terminal, and an Agent with no live Terminal.
    pub channel: Option<Channel>,
    /// O1: the order of an Agent or a Workstream's Door; `None` for a Terminal. Named `work` because
    /// `order` is the position among siblings.
    pub work: Option<Order>,
    /// F5: processes in a Door's Terminal tree that carry a vendor program's name and that the
    /// Daemon did not register. Empty for every other node, and for a Door with none.
    pub stray: Vec<Stray>,
    /// A36: the Model the Agent runs on; `None` passes none. `None` for a Terminal.
    pub model: Option<String>,
    /// A36: the Effort the Agent runs on; `None` passes none. `None` for a Terminal.
    pub effort: Option<String>,
    /// B51: whether the Claude inbox a `note` is written to is usable, from the Agent's latest
    /// check; absent before the first check and on a Terminal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Inbox)]
    pub inbox: Option<Inbox>,
    /// U3780a: the Agent's current or last tool call; absent until its first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = ToolCall)]
    pub tool_call: Option<ToolCall>,
    /// A2681a: available conversation parts, only after the Agent's program exits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = ConversationOverview)]
    pub overview: Option<ConversationOverview>,
}

/// A2681a: display data from a closed Agent's saved conversation, never authority.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ConversationOverview {
    pub program: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub name: Option<String>,
    /// Input tokens occupying the last reply's context window; excludes generated output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = specta_typescript::Number)]
    pub used: Option<u64>,
    /// Model context capacity in tokens; absent for an unrecognized model id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = specta_typescript::Number)]
    pub limit: Option<u64>,
    /// A2681d: what Claude Code itself measured fills `used`, in display order; absent when it
    /// wrote no usable split.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<ContextPart>)]
    pub context_parts: Option<Vec<ContextPart>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = ConversationCard)]
    pub card: Option<ConversationCard>,
}

/// A2681d: one measured part of the context.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ContextPart {
    pub kind: ContextPartKind,
    #[specta(type = specta_typescript::Number)]
    pub tokens: u64,
}

/// A2681d: `Other` is the remainder of `used` no measured part accounts for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ContextPartKind {
    System,
    Tools,
    Files,
    Conversation,
    Other,
}

/// A2681c: the available parts of the conversation's latest card.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ConversationCard {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub intent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub facts: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub outcome: Option<String>,
}

/// B51: the outcome of checking an Agent's Claude inbox: `ok`, `missing` (absent or not writable)
/// or `mismatch` (present, listing a messaging protocol the adapter does not speak).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Inbox {
    Ok,
    Missing,
    Mismatch,
}

/// F5: one process found by name under a Door, by its pid and the command line `ps` printed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Stray {
    pub pid: u32,
    pub command: String,
}

/// The `agent.stray` event: the Door `id` now holds exactly `stray`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct StrayEvent {
    pub id: String,
    pub stray: Vec<Stray>,
}

/// E6: `pending` from the start, `up` once `agent.channelUp` arrived, `missing` when it had not
/// within the Daemon's deadline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Channel {
    Pending,
    Up,
    Missing,
}

/// The `agent.channel` event: Agent `id`'s Channel changed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ChannelEvent {
    pub id: String,
    pub channel: Channel,
}

/// What `agent.brief` returns (E3): the text `rup context` prints, verbatim.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Brief {
    pub stdout: String,
}

/// A31: one Skill a Door can call, by the name the user types after `/`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Skill {
    pub name: String,
    /// One line of at most 160 characters; empty when the Skill has none.
    pub description: String,
}

/// What `agent.skills` returns (A31), sorted by `name`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Skills {
    pub skills: Vec<Skill>,
}

/// The node an Agent sits under: a Workstream with no running Door, or an Agent (a Door or the Agent that started it).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ParentNode {
    Group,
    Agent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ContextSelf {
    pub id: String,
    pub name: String,
    pub status: Status,
    /// O4: the Agent's own order; `None` for a Terminal.
    pub order: Option<Order>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ContextParent {
    pub id: String,
    pub name: String,
    pub node: ParentNode,
}

/// Who a Message for help goes to: a Door's id, or the user's Actor id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ContextAsk {
    pub to: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ContextPeer {
    pub id: String,
    pub name: String,
    pub status: Status,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ContextTodo {
    pub id: u32,
    pub title: String,
    pub blocked: bool,
}

/// B19: what a Door is told about one child. `last` is one line, `todos` counts the open Todos
/// whose Home is the child, and `pads` names the child's Pads written since the previous envelope.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct DigestEntry {
    pub name: String,
    pub kind: crate::Kind,
    pub last: String,
    pub todos: u32,
    pub pads: Vec<String>,
}

/// B20: one item of `agent.digest`'s `children`: a child's entry, or the last item `{more: n}` when
/// the Door has more children than the result holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(untagged)]
pub enum DigestItem {
    Child(DigestEntry),
    More { more: u32 },
}

/// What `agent.digest` returns (B20).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Digest {
    pub children: Vec<DigestItem>,
}

/// B41: ask to be woken when the named Agents finish.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct WakeParams {
    /// The Agents to wait on, one to twenty, none of them yourself.
    pub ids: Vec<String>,
    /// Wake when the first of them finishes; the default is when every one has.
    #[serde(default)]
    #[specta(optional, type = bool)]
    pub any: Option<bool>,
}

/// What `agent.wake` returns (B41, B48): the request's number, whether it already fired, and,
/// when it did not, why the request waits.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Woken {
    pub id: u32,
    pub fired: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub why: Option<String>,
}

/// What `agent.context` returns (E2).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Context {
    #[serde(rename = "self")]
    pub this: ContextSelf,
    pub parent: Option<ContextParent>,
    pub ask: ContextAsk,
    pub peers: Vec<ContextPeer>,
    pub todos: Vec<ContextTodo>,
}

/// A37: change the Model and Effort of one Agent, running or not.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SetModelParams {
    pub id: String,
    /// An id from `models.list`, or `None` for the Project's.
    pub model: Option<String>,
    pub effort: Option<String>,
    /// Must be `true`: the user has been told the Agent re-reads its conversation on the new Model.
    pub confirmed: bool,
}

/// X11: start `command` in a Run owned by Agent `id`; `cwd` defaults to its Worktree, else its cwd.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RunParams {
    /// U4590: initial PTY columns; absent keeps the hostless 80-column default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = u16)]
    pub cols: Option<u16>,
    /// U4590: initial PTY rows; absent keeps the hostless 24-row default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = u16)]
    pub rows: Option<u16>,

    pub id: String,
    pub command: Vec<String>,
    #[serde(default)]
    #[specta(optional, type = String)]
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct NodeId {
    pub id: String,
}

/// Permission prompt selection for the next Attempt.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ResumeMode {
    #[default]
    Normal,
    Yolo,
}

/// Exact retained content, independent of the mutable current Order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Instruction {
    Order { order: Order },
    Message { message: u32, text: String },
}

/// A never-reused revision in its Project, attributed to the original Rail identities.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct InstructionRevision {
    pub revision: String,
    pub agent: String,
    pub workstream: Option<String>,
    #[serde(flatten)]
    pub instruction: Instruction,
}

/// Delivery facts do not establish completion, acceptance or verification of work.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum InstructionState {
    Prepared,
    Uncertain,
    Submitted,
    Refused,
}

/// Exact text at delivery admission, bound to its original Attempt and revision.
/// Prepared has not entered the writer; uncertain never authorizes blind replay.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct InstructionDelivery {
    pub id: String,
    pub revision: String,
    pub attempt: String,
    pub text: String,
    pub state: InstructionState,
}

/// Read-only instruction history. Home follows placement; attribution never follows names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Instructions {
    pub project: String,
    pub home: Option<String>,
    pub current: Option<String>,
    pub revisions: Vec<InstructionRevision>,
    pub deliveries: Vec<InstructionDelivery>,
}

/// Omission retains exited-Agent-only resume; an explicit mode also restarts a running target.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ResumeParams {
    /// U3801: only the user selects permissions for this launch; omission keeps vendor defaults.
    #[serde(
        default,
        rename = "permissionMode",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(optional, type = PermissionMode)]
    #[schemars(skip)]
    pub permission_mode: Option<PermissionMode>,

    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = ResumeMode)]
    pub mode: Option<ResumeMode>,
}

/// A Steer: `text` sent to the running Agent `id` as its next prompt (H11).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct PromptParams {
    pub id: String,
    pub text: String,
}

/// One adapter-specific Signal for an Agent; for Claude Code, a hook payload.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SignalParams {
    pub id: String,
    pub attempt: String,
    #[specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>)]
    pub payload: Value,
}

/// What `agent.signal` answers when it has something to say (otherwise `null`): `drop` tells the
/// hook to exit 2, which blocks a prompt that repeats Messages already delivered (B39).
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type, JsonSchema)]
pub struct SignalOutcome {
    pub drop: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct CreateWorkstreamParams {
    pub name: String,
    pub parent: Option<String>,
    /// O3: the Door's order.
    #[serde(default)]
    #[specta(optional, type = Order)]
    pub order: Option<Order>,
}

/// U2773c: the Order read with an editor's original Project and exact node id.
/// A null Order captures the absence of an Order; it is not an unconditional write.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct CapturedOrder {
    pub order: Option<Order>,
}

/// O4, U2773c: replace the Order of Agent or Door `id`.
/// With `captured`, compare and replace atomically at execution. A mismatch is CONFLICT; a removed id is NOT_FOUND.
/// Omit `captured` for an unconditional write.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct SetOrderParams {
    pub id: String,
    pub order: Order,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = CapturedOrder)]
    pub captured: Option<CapturedOrder>,
}

/// Re-parent and position a node. `parent: None` moves it to the root.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct MoveParams {
    pub id: String,
    pub parent: Option<String>,
    pub index: u32,
}

/// A5214b: `agent.saveAsMode`, the Mode's name.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SaveAsModeParams {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RenameParams {
    pub id: String,
    pub name: String,
}

/// `ended` records an Attempt ending even when its final Kind is error.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct StatusEvent {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[specta(optional, type = bool)]
    pub ended: bool,
    pub id: String,
    pub attempt: String,
    pub status_revision: String,
    pub status: Status,
}

#[cfg(test)]
mod tests;

/// U3780a: where a tool call stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ToolCallState {
    Running,
    Done,
    Failed,
}

/// U3780a: an Agent's current or last tool call, bounded and free of terminal escapes. `summary`,
/// `arguments` and `result` are plain text; a cut one ends with a mark.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ToolCall {
    pub tool: String,
    /// One line: the command, file, pattern or query; absent for a tool with none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub summary: Option<String>,
    pub arguments: String,
    /// Absent while the call runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub result: Option<String>,
    pub state: ToolCallState,
    /// When the call started, in milliseconds since the epoch.
    #[specta(type = specta_typescript::Number)]
    pub started: i64,
    /// The final duration in milliseconds; absent while the call runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = specta_typescript::Number)]
    pub duration_ms: Option<u64>,
}

/// The `agent.toolCall` event: Agent `id` now holds `call`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ToolCallEvent {
    pub id: String,
    pub call: ToolCall,
}

/// The existing optional first prompt returned by agent.spawnPrompt.
#[derive(Serialize, Deserialize, Type, JsonSchema)]
pub struct SpawnPrompt {
    pub prompt: Option<String>,
}
