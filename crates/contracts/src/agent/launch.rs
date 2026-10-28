//! Launch parameters shared by Agent spawn and Door start.

use super::Order;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SpawnParams {
    /// U4590: initial PTY columns; absent keeps the hostless 80-column default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = u16)]
    pub cols: Option<u16>,
    /// U4590: initial PTY rows; absent keeps the hostless 24-row default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = u16)]
    pub rows: Option<u16>,

    /// U3801: only the user selects permissions for this launch; omission keeps vendor defaults.
    #[serde(
        default,
        rename = "permissionMode",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(optional, type = PermissionMode)]
    #[schemars(skip)]
    pub permission_mode: Option<PermissionMode>,
    /// U3802: an opaque engine id from `models.list`; omission keeps the current Adapter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub engine: Option<String>,

    pub cwd: String,
    pub prompt: Option<String>,
    pub parent: Option<String>,
    /// O2: replaces `prompt` for a user's spawn; an Agent's spawn gives both, and `prompt` alone is
    /// `INVALID_PARAMS` (O8).
    #[serde(default)]
    #[specta(optional, type = Order)]
    pub order: Option<Order>,
    /// A28: the child's Rail name, at most 32 characters; A9 never renames it. Name the child after
    /// its task. Without one, A9 names it from its first prompt.
    #[serde(default)]
    #[specta(optional, type = String)]
    pub name: Option<String>,
    /// A36, M12: the child's Model, an id; without one the Project's for the Role applies. Any id
    /// `models.list` offers is accepted.
    #[serde(default)]
    #[specta(optional)]
    pub model: Option<String>,
    /// A36: the child's Effort, an id from `models.list`. Only the user sets it.
    #[serde(default)]
    #[specta(optional)]
    #[schemars(skip)]
    pub effort: Option<String>,
    /// LC4: start a scout, which reads and searches only (`Read`, `Grep`, `Glob`, `Bash`) and has
    /// no skills, plugins or user instructions. Absent is false.
    #[serde(default)]
    #[specta(optional, type = bool)]
    pub scout: Option<bool>,
    /// LC12: one live reading specialist per Workstream and name; requires `scout: true`.
    #[serde(default)]
    #[specta(optional, type = String)]
    pub specialist: Option<String>,
    /// LC7: names of skills, plugins and MCP servers of the user's setup that this child needs
    /// beyond its Role's start. An unknown name fails the call.
    #[serde(default)]
    #[specta(optional, type = Extras)]
    pub extras: Option<Extras>,
}

/// LC7: names by kind. As a call's parameter, the extras to add; as the result of `agent.extras`,
/// the names that exist.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Extras {
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub plugins: Vec<String>,
    #[serde(default)]
    pub mcp: Vec<String>,
}

/// LC8: add `extras` to a running child, which is relaunched with `--resume`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct ExtrasAddParams {
    pub id: String,
    pub extras: Extras,
}

/// A36: `rail.startDoor`, with the Door's own Model and Effort when the caller sets them.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct StartDoorParams {
    /// U4590: initial PTY columns; absent keeps the hostless 80-column default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = u16)]
    pub cols: Option<u16>,
    /// U4590: initial PTY rows; absent keeps the hostless 24-row default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = u16)]
    pub rows: Option<u16>,

    /// U3801: only the user selects permissions for this launch; omission keeps vendor defaults.
    #[serde(
        default,
        rename = "permissionMode",
        skip_serializing_if = "Option::is_none"
    )]
    #[specta(optional, type = PermissionMode)]
    #[schemars(skip)]
    pub permission_mode: Option<PermissionMode>,
    /// U3802: an opaque engine id from `models.list`; omission keeps the current Adapter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub engine: Option<String>,

    pub id: String,
    #[serde(default)]
    #[specta(optional, type = String)]
    pub model: Option<String>,
    #[serde(default)]
    #[specta(optional, type = String)]
    pub effort: Option<String>,
}

/// U3801: the user's permission choice for one normal launch. YOLO ignores it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PermissionMode {
    Default,
    AcceptEdits,
    Plan,
    Auto,
}
