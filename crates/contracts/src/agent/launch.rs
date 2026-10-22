//! Launch parameters shared by Agent spawn and Door start.

use super::Order;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "agent/")]
pub struct SpawnParams {
    pub cwd: String,
    pub prompt: Option<String>,
    pub parent: Option<String>,
    /// O2: replaces `prompt` for a user's spawn; an Agent's spawn gives both, and `prompt` alone is
    /// `INVALID_PARAMS` (O8).
    #[serde(default)]
    #[ts(optional)]
    pub order: Option<Order>,
    /// A28: the child's Rail name, at most 32 characters; A9 never renames it. Name the child after
    /// its task. Without one, A9 names it from its first prompt.
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    /// A36, M12: the child's Model, an id; without one the Project's for the Role applies. Any id
    /// `models.list` offers is accepted.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub model: Option<String>,
    /// A36: the child's Effort, an id from `models.list`. Only the user sets it.
    #[serde(default)]
    #[ts(optional = nullable)]
    #[schemars(skip)]
    pub effort: Option<String>,
    /// LC4: start a scout, which reads and searches only (`Read`, `Grep`, `Glob`, `Bash`) and has
    /// no skills, plugins or user instructions. Absent is false.
    #[serde(default)]
    #[ts(optional)]
    pub scout: Option<bool>,
    /// LC12: one live reading specialist per Workstream and name; requires `scout: true`.
    #[serde(default)]
    #[ts(optional)]
    pub specialist: Option<String>,
    /// LC7: names of skills, plugins and MCP servers of the user's setup that this child needs
    /// beyond its Role's start. An unknown name fails the call.
    #[serde(default)]
    #[ts(optional)]
    pub extras: Option<Extras>,
}

/// LC7: names by kind. As a call's parameter, the extras to add; as the result of `agent.extras`,
/// the names that exist.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "agent/")]
pub struct Extras {
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub plugins: Vec<String>,
    #[serde(default)]
    pub mcp: Vec<String>,
}

/// LC8: add `extras` to a running child, which is relaunched with `--resume`.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "agent/")]
pub struct ExtrasAddParams {
    pub id: String,
    pub extras: Extras,
}

/// A36: `rail.startDoor`, with the Door's own Model and Effort when the caller sets them.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "agent/")]
pub struct StartDoorParams {
    pub id: String,
    #[serde(default)]
    #[ts(optional)]
    pub model: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub effort: Option<String>,
}
