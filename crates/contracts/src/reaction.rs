//! NR1 (`scenarios/named-reactions.md`): saved Project reactions. A definition is immutable; stopping
//! one and creating another is how it changes.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::Actor;

/// What a reaction waits for. `agents` combines Agent ids only; a PR's checks and one instant are
/// separate conditions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
#[ts(export, export_to = "reaction/")]
pub enum Condition {
    /// One to twenty distinct Agents finished: every one, or with `any` the first.
    Agents {
        ids: Vec<String>,
        #[serde(default)]
        #[ts(optional)]
        any: Option<bool>,
    },
    /// The required checks of a named PR's head passed.
    PrChecks { repository: String, number: u32 },
    /// One explicit instant: RFC 3339 with its UTC offset, and what to do when it is missed.
    Instant { at: String, late: LatePolicy },
}

/// NR6: what a missed instant does once, before expiry.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "reaction/")]
pub enum LatePolicy {
    OnceBeforeExpiry,
    Skip,
}

/// NR6 `reaction.preview`: a civil date, time and UTC offset the user typed. There is no zone name: an
/// offset is the only form with no ambiguous or nonexistent local time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "reaction/")]
pub struct PreviewParams {
    /// `YYYY-MM-DD`.
    pub date: String,
    /// `HH:MM` or `HH:MM:SS`.
    pub time: String,
    /// `Z` or `+HH:MM` / `-HH:MM`.
    pub offset: String,
}

/// What activation keeps: `at` is the exact `Condition::Instant` text to submit, `utc` the instant it
/// resolves to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "reaction/")]
pub struct Preview {
    pub at: String,
    pub utc: String,
    pub offset: String,
}

/// `reaction.create`: the caller's Actor comes from its connection, never from here.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "reaction/")]
pub struct CreateParams {
    /// The caller's retry key: the same operation and payload answer with the first definition.
    pub operation: String,
    /// A label, never an identity.
    pub name: String,
    /// The Agent id the instruction is sent to.
    pub target: String,
    /// The exact words delivered as one Message at each firing.
    pub instruction: String,
    pub condition: Condition,
    /// Finite and positive; the default is one. Above one needs `rearm` on an Agents condition.
    #[serde(default)]
    #[ts(optional)]
    pub max_firings: Option<u32>,
    /// Re-arm after a firing; only an Agents condition may.
    #[serde(default)]
    #[ts(optional)]
    pub rearm: Option<bool>,
    /// RFC 3339 with its UTC offset, later than now.
    pub expires_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "reaction/")]
pub struct ReactionId {
    pub id: String,
}

/// `reaction.run`: spends one remaining firing; `operation` makes a retry return the first result.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(deny_unknown_fields)]
#[ts(export, export_to = "reaction/")]
pub struct RunParams {
    pub id: String,
    pub operation: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "reaction/")]
pub enum State {
    Active,
    Stopped,
}

/// Whether the condition's source is being watched; `not-observing` until its slice lands.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "reaction/")]
pub struct Observation {
    pub health: String,
    #[ts(type = "number | null")]
    pub cursor: Option<u64>,
}

/// An accepted firing and the Message it made (NR3, NR8). `matched` says whether a condition held; an
/// explicit run claims none. `outcome` is the Message's status in the history, and a delivered Message
/// is not verified work.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "reaction/")]
pub struct Firing {
    pub id: String,
    pub ordinal: u32,
    pub message: u32,
    pub matched: bool,
    /// The source facts it was accepted on, frozen; an Agent's result in it is reported, not verified.
    pub evidence: String,
    /// The definition's bytes when it was accepted, frozen.
    pub definition: String,
    /// `pending`, `held`, `delivered` or `dropped`.
    pub outcome: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "reaction/")]
pub struct Reaction {
    pub project: String,
    pub id: String,
    pub name: String,
    /// The Actor that authorized it.
    pub actor: Actor,
    /// P6: where the target sat when it was saved.
    pub home: Option<String>,
    pub target: String,
    pub instruction: String,
    pub condition: Condition,
    pub max_firings: u32,
    pub remaining: u32,
    pub rearm: bool,
    /// RFC 3339 with its offset, as saved.
    pub expires_at: String,
    pub created_at: String,
    pub state: State,
    pub observation: Observation,
    pub firings: Vec<Firing>,
}
