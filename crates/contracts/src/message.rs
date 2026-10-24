//! Messages between Actors, and the Routes that decide how a Message is delivered.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::common::Actor;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "message/")]
pub enum MessageKind {
    Note,
    Question,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "message/")]
pub enum MessageStatus {
    Pending,
    Delivered,
    Dropped,
}

/// Why a Message is `dropped`
/// (`receiver gone`, B9; `not accepted`, B2; `passed`, a question's hop that was still `pending`
/// when the next was made, B13; `removed`, a `pending` note the user took back, U3782; `merged`, a pushed digest folded into a newer one, B22).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "message/")]
pub enum Reason {
    #[serde(rename = "receiver gone")]
    ReceiverGone,
    #[serde(rename = "not accepted")]
    NotAccepted,
    Passed,
    /// U3782: the user removed a `pending` note before it was typed.
    Removed,
    /// B22: two pushed digests folded into one Message.
    Merged,
}

/// A typed envelope between Actors. `reply_to` names the Message this answers, if any; `reason`
/// names why a `dropped` Message was dropped, and is `None` otherwise;
/// `passed_from` names the earlier hop of a bubbling question (B13), and is `None` for any other
/// Message and for a question's first hop.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct Message {
    pub id: u32,
    pub from: Actor,
    pub to: String,
    pub kind: MessageKind,
    pub body: String,
    #[serde(rename = "replyTo")]
    pub reply_to: Option<u32>,
    pub status: MessageStatus,
    pub reason: Option<Reason>,
    #[serde(rename = "passedFrom")]
    pub passed_from: Option<u32>,
    #[ts(type = "number")]
    pub at: i64,
    /// A32: the Iteration of the Door a `message.list {id}` answer was made for; absent elsewhere.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub iteration: Option<u32>,
}

/// `from` is never a parameter: it is always the calling Actor.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "message/")]
pub struct SendParams {
    pub to: String,
    pub kind: MessageKind,
    pub body: String,
    #[serde(rename = "replyTo", default)]
    pub reply_to: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "message/")]
pub struct MessageId {
    pub id: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "message/")]
pub struct ListParams {
    pub to: Option<String>,
    /// A32: every Message sent to or by this Door, of every Iteration, each carrying its `iteration`.
    #[serde(default)]
    #[ts(optional)]
    pub id: Option<String>,
    pub status: Option<MessageStatus>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "message/")]
pub enum Delivery {
    Auto,
    Drop,
}

/// A sender-to-receiver delivery rule. Both `from` and `to` are Actor ids.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct Route {
    pub from: String,
    pub to: String,
    pub delivery: Delivery,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "message/")]
pub struct SetRouteParams {
    pub from: String,
    pub to: String,
    pub delivery: Delivery,
}

/// Read the exact instruction and result history of one Agent in its original Project.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub struct ProgressParams {
    pub project: String,
    pub id: String,
}

/// A caller-selected target revision. Equal names never identify replacement versions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub struct ResultTarget {
    pub id: String,
    pub revision: String,
}

/// Only the declared condition is checked; no observation verifies all work.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub enum ResultCheck {
    /// Confirms the retained publication's exact bytes, never an external effect.
    Publication {
        sha256: String,
    },
    PrChecks {
        repository: String,
        number: u32,
        head: String,
    },
    Unsupported {
        source: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "message/")]
pub enum ResultState {
    Reported,
    /// An issued external effect has no authoritative acknowledgement. Acceptance alone cannot resolve it.
    UnknownEffect,
}

/// Agent and Attempt authorship comes from the authenticated connection and retained delivery.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub struct ReportParams {
    pub project: String,
    pub id: String,
    pub key: String,
    pub delivery: String,
    pub target: ResultTarget,
    pub output: crate::deliverable::DeliverableId,
    pub result: String,
    pub next: String,
    pub state: ResultState,
    pub check: ResultCheck,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub struct ResultId {
    pub project: String,
    pub id: String,
    pub report: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub struct AcceptResultParams {
    pub project: String,
    pub id: String,
    pub report: String,
    pub evidence: String,
}

/// Only the user can authorize reading this authoritative, read-only receipt endpoint.
/// HTTPS is required except for literal loopback HTTP sources; credentials and redirects are refused.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub struct ResolveResultParams {
    pub project: String,
    pub id: String,
    pub report: String,
    pub source: String,
}

/// Response of a user-selected authoritative receipt endpoint. The Daemon reads these bytes;
/// an Agent's report, publication or supplied RPC verdict cannot stand in for them.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub struct ResultResolution {
    pub target: ResultTarget,
    pub revision: String,
    /// Source observation time, Unix seconds; accepted only within the preceding 60 seconds.
    #[ts(type = "number")]
    pub observed_at: i64,
    pub outcome: ResultOutcome,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub enum ResultOutcome {
    Completed,
    NotPerformed,
    Inconclusive { cause: String },
}

/// Immutable claim, retaining attribution and exact instruction/output identity.
/// order_revision precedes this exact instruction; it is never the Order at report time.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct ResultReport {
    pub order_revision: Option<String>,
    pub report: String,
    pub author: Actor,
    pub attempt: String,
    pub home: Option<String>,
    pub request: ReportParams,
    pub instruction: crate::agent::InstructionRevision,
    pub publication: crate::deliverable::Deliverable,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct ResultAcceptance {
    pub actor: Actor,
    pub evidence: String,
}

/// A Daemon observation of the report's declared source, never caller-supplied authority.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "verdict", rename_all = "kebab-case")]
#[ts(export, export_to = "message/")]
pub enum ResultObservation {
    Passed {
        revision: String,
    },
    Unknown {
        cause: String,
        action: String,
    },
    /// Fresh exact-version external evidence from a source explicitly authorized by the user.
    Resolved {
        source: String,
        authorizer: Actor,
        evidence: ResultResolution,
    },
}

/// Unresolved external effects remain current despite later claims or changed instructions.
/// Other current results require the same instruction and latest reported target version.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct ResultProgress {
    pub report: ResultReport,
    pub current: bool,
    pub acceptances: Vec<ResultAcceptance>,
    pub observations: Vec<ResultObservation>,
    pub availability: crate::deliverable::Resolution,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct Progress {
    pub instructions: crate::agent::Instructions,
    pub results: Vec<ResultProgress>,
}

/// U3078d: the user's explicit choice to resume one Agent's unfinished work. `request` is the
/// client's retry key; the same key with other bytes is refused, and a fresh key never accepts an
/// action a decision already holds. `action` limits the resume to one reconciled action.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "message/")]
pub struct ResumeWorkParams {
    pub project: String,
    pub id: String,
    pub request: String,
    #[serde(default)]
    #[ts(optional)]
    pub action: Option<String>,
}

/// One unfinished action for exact instruction/target/output versions. `id` hashes those
/// versions and the pending next step, never a report key, so it is stable across retries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct ContinuationAction {
    pub id: String,
    pub report: String,
    pub target: ResultTarget,
    pub output: String,
    pub instruction: String,
    pub next: String,
    /// The accepted decision (or reaction firing) that already holds this action.
    pub decision: Option<String>,
}

/// Work that cannot be continued now: an unknown or unavailable fact, with its cause and the
/// action that checks it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct ContinuationBlock {
    pub report: String,
    pub target: ResultTarget,
    pub cause: String,
    pub action: String,
}

/// Retained evidence that was confirmed for its exact version. `current` is false for an older
/// version, which verifies nothing about the version that replaced it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct ContinuationContext {
    pub report: String,
    pub target: ResultTarget,
    pub current: bool,
    pub confirmed: String,
}

/// The Daemon's read of one Agent's retained evidence, changing nothing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct Reconciliation {
    pub agent: String,
    pub actions: Vec<ContinuationAction>,
    pub blocked: Vec<ContinuationBlock>,
    pub context: Vec<ContinuationContext>,
    pub pending_checks: Vec<ResultTarget>,
}

/// An accepted decision and the one successor Message it made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct ContinuationDecision {
    pub id: String,
    pub request: String,
    pub actions: Vec<String>,
    pub message: u32,
}

/// `decision` is absent when no unfinished work was eligible, and then no Message was made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "message/")]
pub struct ResumeWork {
    pub decision: Option<ContinuationDecision>,
    pub reconciliation: Reconciliation,
}
