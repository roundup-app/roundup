//! Todos: items with an optional blocker list, owned by the Project.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::common::Actor;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct Todo {
    pub id: u32,
    pub title: String,
    pub body: String,
    pub done: bool,
    pub blockers: Vec<u32>,
    /// Derived: at least one blocker is not done. Never stored.
    pub blocked: bool,
    #[ts(type = "number")]
    pub created_at: i64,
    /// The Actor whose `todo.create` made this Todo. A Todo from before this field reads as `Actor::user()`.
    pub creator: Actor,
    /// The Workstream (a Rail id) this Todo belongs to; `None` is the Project root. A Todo from before this field reads as `None`.
    pub home: Option<String>,
    /// Who does the work (T16): the user, one Agent, or `None` for Unassigned. Never `creator`.
    pub owner: Option<Actor>,
    /// Links to Pads and Pad sections (T27), in the order added. A Todo from before refs reads none.
    #[serde(default)]
    pub refs: Vec<String>,
    /// T29: expected work in minutes (1 to 1440); `None` is no estimate. A Todo from before this field reads as `None`.
    pub estimate_minutes: Option<u32>,
}

/// One qualifying Hand-off for a Todo's current owner after its last owner change.
/// Project-scoped, at most one per Todo, ordered by Change.seq; no History Values.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct Handed {
    pub todo: u32,
    pub owner: Actor,
    pub seq: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct CreateParams {
    pub title: String,
    pub body: Option<String>,
    pub blockers: Option<Vec<u32>>,
    /// Omitted or `None` is Unassigned.
    #[ts(optional)]
    pub owner: Option<Actor>,
    /// T29: whole minutes, 1 to 1440; omitted or `None` is no estimate.
    #[ts(optional)]
    pub estimate_minutes: Option<u32>,
}

/// Sets the owner, `None` for Unassigned. `expected_change` is the last captured History Change
/// sequence; mismatch is CONFLICT, and omission is unconditional.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct AssignParams {
    pub id: u32,
    pub owner: Option<Actor>,
    #[ts(optional)]
    pub expected_change: Option<u32>,
}

/// T25: the Daemon hands `agent` its first open, unblocked Todo not yet handed to it (T26).
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct HandParams {
    pub agent: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct TodoId {
    pub id: u32,
}

/// Changes title/body/estimate. `estimate_minutes` is whole minutes 1 to 1440 (T29); `null` clears it, omitted leaves it. `expected_change` is the last captured History Change sequence;
/// mismatch is CONFLICT, a removed Todo is NOT_FOUND, and omission is unconditional.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct UpdateParams {
    pub id: u32,
    pub title: Option<String>,
    pub body: Option<String>,
    #[serde(default, deserialize_with = "present")]
    #[ts(optional, type = "number | null")]
    pub estimate_minutes: Option<Option<u32>>,
    #[ts(optional)]
    pub expected_change: Option<u32>,
}

/// A field that is present, `null` included, is `Some`; an absent one stays `None` by `default`.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<u32>>, D::Error> {
    Option::<u32>::deserialize(d).map(Some)
}

/// Replaces the whole blocker list. A list that would make a cycle is an error.
/// `expected_change` is the last captured History Change sequence; mismatch is CONFLICT,
/// a removed Todo is NOT_FOUND, and omission is unconditional.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct SetBlockersParams {
    pub id: u32,
    pub blockers: Vec<u32>,
    #[ts(optional)]
    pub expected_change: Option<u32>,
}

/// Moves a Todo to a Workstream, or to the Project root when `home` is `None`.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct MoveParams {
    pub id: u32,
    pub home: Option<String>,
}

/// Puts a Todo before another in the Todo order, or last when `before` is `None`.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct ReorderParams {
    pub id: u32,
    pub before: Option<u32>,
}

/// The values a Todo's history follows; list and Rail replies never carry these changes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct Values {
    pub title: String,
    pub body: String,
    pub done: bool,
    pub blockers: Vec<u32>,
    /// A change recorded before owners existed reads `None`.
    #[serde(default)]
    pub owner: Option<Actor>,
    /// A change recorded before estimates existed reads `None`.
    #[serde(default)]
    pub estimate_minutes: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct Change {
    pub seq: u32,
    /// Authenticated writer; history recorded before T19 has no known Actor.
    #[serde(default)]
    pub actor: Option<Actor>,
    /// Unix milliseconds when the Daemon recorded the Change; history recorded before it has no time.
    #[serde(default)]
    #[ts(type = "number | null")]
    pub changed_at: Option<i64>,
    /// T26: the Agent this Change handed the Todo to (`before` and `after` are equal); absent on every other Change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub handed: Option<Actor>,
    /// None denotes creation or an old Todo's current baseline.
    pub before: Option<Values>,
    pub after: Values,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct History {
    pub changes: Vec<Change>,
    /// The first change after the calling Actor's last read Touch.
    pub unread: Option<u32>,
}

/// Acknowledge only a fetched change, never changes made after the fetch.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct ReadHistoryParams {
    pub id: u32,
    pub through: u32,
}

/// A line on a Todo from the user or an Agent (T20). Not a Message and not History.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct Comment {
    pub id: u32,
    /// The authenticated Actor that called `todo.comment`.
    pub author: Actor,
    pub body: String,
    #[ts(type = "number")]
    pub created_at: i64,
    /// An Agent's comment is unread until the user opens the Todo (T23); the user's own is born read.
    pub read: bool,
}

/// Adds a comment to a Todo. The author is the calling Actor, never a param. An Agent's body is one line of at most 280 characters (T21).
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct CommentParams {
    pub id: u32,
    pub body: String,
}

/// Adds or removes a link to a Pad or Pad section on a Todo (T27): `roundup://pad/<name>?project=<key>`, ending in `#<heading>` for a section.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct RefParams {
    pub id: u32,
    pub url: String,
}

/// Whether the Pad or heading a ref names exists now; computed at read, never stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "todo/")]
pub enum RefState {
    Ok,
    Missing,
}

/// One ref of a Todo with its state (T27).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct Ref {
    pub url: String,
    pub state: RefState,
}

/// An unread Agent comment with the Todo it sits on (T23).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct UnreadComment {
    pub todo: u32,
    pub title: String,
    pub comment: Comment,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// MCP clients (M1) read this schema to decide which fields they must send.
    #[test]
    fn m1_create_params_schema_requires_only_the_title() {
        let schema = serde_json::to_value(schemars::schema_for!(CreateParams)).unwrap();
        assert_eq!(schema["required"], serde_json::json!(["title"]));
    }
}
