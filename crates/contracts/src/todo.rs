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

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct TodoId {
    pub id: u32,
}

/// Changes title/body. `expected_change` is the last captured History Change sequence;
/// mismatch is CONFLICT, a removed Todo is NOT_FOUND, and omission is unconditional.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "todo/")]
pub struct UpdateParams {
    pub id: u32,
    pub title: Option<String>,
    pub body: Option<String>,
    #[ts(optional)]
    pub expected_change: Option<u32>,
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
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "todo/")]
pub struct Change {
    pub seq: u32,
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
