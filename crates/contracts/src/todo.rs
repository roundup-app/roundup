//! Todos: items with an optional blocker list, owned by the Project.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::{Actor, Owner};

/// A Todo's optional urgency; unset is distinct from Low.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    Medium,
    High,
    Urgent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Todo {
    pub id: u32,
    pub title: String,
    pub body: String,
    pub done: bool,
    pub blockers: Vec<u32>,
    /// Derived: at least one blocker is not done. Never stored.
    pub blocked: bool,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
    /// T30: the time of the Todo's last Change (title, body, done, owner, blockers or priority); `created_at` on creation. A Todo from before this field reads its latest Change time, or `created_at`.
    #[serde(default)]
    #[specta(type = specta_typescript::Number)]
    pub updated_at: i64,
    /// The Actor whose `todo.create` made this Todo. A Todo from before this field reads as `Actor::user()`.
    pub creator: Actor,
    /// The Workstream (a Rail id) this Todo belongs to; `None` is the Project root. A Todo from before this field reads as `None`.
    pub home: Option<String>,
    /// Who does the work (T16): the user, one Agent, or `None` for Unassigned. Never `creator`.
    pub owner: Option<Actor>,
    /// Links to Pads and Pad sections (T27), in the order added. A Todo from before refs reads none.
    #[serde(default)]
    pub refs: Vec<String>,
    /// U4698c: unset is no priority.
    #[serde(default)]
    pub priority: Option<Priority>,
}

/// One qualifying Hand-off for a Todo's current owner after its last owner change.
/// Project-scoped, at most one per Todo, ordered by Change.seq; no History Values.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Handed {
    pub todo: u32,
    pub owner: Actor,
    pub seq: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct CreateParams {
    pub title: String,
    pub body: Option<String>,
    pub blockers: Option<Vec<u32>>,
    /// Omitted or `None` is Unassigned.
    #[specta(optional, type = Owner)]
    pub owner: Option<Owner>,
    /// U4698c: unset is no priority.
    #[serde(default)]
    #[specta(optional, type = Option<Priority>)]
    pub priority: Option<Priority>,
}

/// Sets the owner, `None` for Unassigned. `expected_change` is the last captured History Change
/// sequence; mismatch is CONFLICT, and omission is unconditional.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct AssignParams {
    pub id: u32,
    pub owner: Option<Owner>,
    #[specta(optional, type = u32)]
    pub expected_change: Option<u32>,
}

/// T25: the Daemon hands `agent` its first open, unblocked Todo not yet handed to it (T26).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct HandParams {
    pub agent: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct TodoId {
    pub id: u32,
}

/// Changes title/body/priority. `expected_change` is the last captured History Change sequence;
/// mismatch is CONFLICT, a removed Todo is NOT_FOUND, and omission is unconditional.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct UpdateParams {
    pub id: u32,
    pub title: Option<String>,
    pub body: Option<String>,
    /// Omitted preserves priority; null clears it; otherwise low, medium, high or urgent.
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(optional, type = Option<Priority>)]
    pub priority: Option<Option<Priority>>,
    #[specta(optional, type = u32)]
    pub expected_change: Option<u32>,
}

/// A field that is present, `null` included, is `Some`; an absent one stays `None` by `default`.
fn present<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

/// Replaces the whole blocker list. A list that would make a cycle is an error.
/// `expected_change` is the last captured History Change sequence; mismatch is CONFLICT,
/// a removed Todo is NOT_FOUND, and omission is unconditional.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SetBlockersParams {
    pub id: u32,
    pub blockers: Vec<u32>,
    #[specta(optional, type = u32)]
    pub expected_change: Option<u32>,
}

/// Moves a Todo to a Workstream, or to the Project root when `home` is `None`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct MoveParams {
    pub id: u32,
    pub home: Option<String>,
}

/// Puts a Todo before another in the Todo order, or last when `before` is `None`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct ReorderParams {
    pub id: u32,
    pub before: Option<u32>,
}

/// The values a Todo's history follows; list and Rail replies never carry these changes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Values {
    pub title: String,
    pub body: String,
    pub done: bool,
    pub blockers: Vec<u32>,
    /// A change recorded before owners existed reads `None`.
    #[serde(default)]
    pub owner: Option<Actor>,
    /// U4698c: unset is no priority.
    #[serde(default)]
    pub priority: Option<Priority>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Change {
    pub seq: u32,
    /// Authenticated writer; history recorded before T19 has no known Actor.
    #[serde(default)]
    pub actor: Option<Actor>,
    /// Unix milliseconds when the Daemon recorded the Change; history recorded before it has no time.
    #[serde(default)]
    #[specta(type = Option<specta_typescript::Number>)]
    pub changed_at: Option<i64>,
    /// T26: the Agent this Change handed the Todo to (`before` and `after` are equal); absent on every other Change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Actor)]
    pub handed: Option<Actor>,
    /// None denotes creation or an old Todo's current baseline.
    pub before: Option<Values>,
    pub after: Values,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct History {
    pub changes: Vec<Change>,
    /// The first change after the calling Actor's last read Touch.
    pub unread: Option<u32>,
}

/// Acknowledge only a fetched change, never changes made after the fetch.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct ReadHistoryParams {
    pub id: u32,
    pub through: u32,
}

/// A line on a Todo from the user or an Agent (T20). Not a Message and not History.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Comment {
    pub id: u32,
    /// The authenticated Actor that called `todo.comment`.
    pub author: Actor,
    pub body: String,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
    /// An Agent's comment is unread until the user opens the Todo (T23); the user's own is born read.
    pub read: bool,
}

/// Adds a comment to a Todo. The author is the calling Actor, never a param. An Agent's body is one line of at most 280 characters (T21).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct CommentParams {
    pub id: u32,
    pub body: String,
}

/// Adds or removes a link to a Pad or Pad section on a Todo (T27): `roundup://pad/<name>?project=<key>`, ending in `#<heading>` for a section.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RefParams {
    pub id: u32,
    pub url: String,
}

/// Whether the Pad or heading a ref names exists now; computed at read, never stored.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum RefState {
    Ok,
    Missing,
}

/// One ref of a Todo with its state (T27).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Ref {
    pub url: String,
    pub state: RefState,
}

/// An unread Agent comment with the Todo it sits on (T23).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
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

/// A caller-captured key binds one exact chosen set in its original Project.
/// Retry only with the same key and ids after an unknown transport outcome.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DeleteParams {
    pub operation: String,
    pub ids: Vec<u32>,
}

/// Selects retained Daemon data, never a caller-authored replacement snapshot.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DeletionParams {
    pub operation: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum DeletionState {
    Deleted,
    Restored,
}

/// Acknowledged successful subset and absent chosen ids. RPC refusal acknowledges no
/// deletion; a lost reply is unknown until todo.deletion or equal-key replay responds.
/// A null reconciliation has no retained operation: retry the SAME key, never a new one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
pub struct Deletion {
    pub operation: String,
    pub deleted: Vec<u32>,
    pub missing: Vec<u32>,
    pub state: DeletionState,
    /// Server-created restored identity. Redo must echo this acknowledgement from
    /// restore or readback; the same operation key in another Project cannot match.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub restoration: Option<String>,
}

/// Redo only the successful restored subset of `source` in this Project, for its Actor.
/// Capture a fresh `operation` before dispatch. Replay that pair or read todo.deletion
/// with the new key after an unknown reply. Restore the new operation to undo again.
/// Changed/replaced targets refuse atomically; repair the cause and retry the same pair.
#[derive(Clone, Debug, Serialize, Deserialize, specta::Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RedoParams {
    pub source: String,
    pub restoration: String,
    pub operation: String,
}
