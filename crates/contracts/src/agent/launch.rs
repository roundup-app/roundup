//! Creation parameters for Agents, Workstreams and Door starts.

use super::Order;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SpawnParams {
    /// A5765e: immutable source names and identities, supplied only by the target user connection.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "StartAttribution::deserialize_present"
    )]
    #[specta(optional, type = StartAttribution)]
    #[schemars(skip)]
    pub start_attribution: Option<StartAttribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = super::RailVisibility)]
    pub visibility: Option<super::RailVisibility>,
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
    /// DCL9: an Agent's spawn names the Subagent's role, `job` or `consult`; without one the call
    /// is refused. The user's own spawn has no role.
    #[serde(default)]
    #[specta(optional, type = SpawnRole)]
    pub role: Option<SpawnRole>,
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
    /// U6414a: the App sends `true` when `name` is one it supplied, not one the user typed; the
    /// row is then not marked as named by the user. Only the user's spawn may say so.
    #[serde(default, rename = "appNamed", skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    #[schemars(skip)]
    pub app_named: Option<bool>,
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

/// DCL9: what a Subagent is for. A Job owns one bounded outcome and ends with a report; a Consult
/// answers questions and rests when idle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SpawnRole {
    Job,
    Consult,
}

impl SpawnRole {
    /// The stored and wire spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Job => "job",
            Self::Consult => "consult",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct CreateWorkstreamParams {
    /// A5765e: only the target user connection may supply source attribution.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "StartAttribution::deserialize_present"
    )]
    #[specta(optional, type = StartAttribution)]
    #[schemars(skip)]
    pub start_attribution: Option<StartAttribution>,
    pub name: String,
    pub parent: Option<String>,
    /// O3: the Door's order.
    #[serde(default)]
    #[specta(optional, type = Order)]
    pub order: Option<Order>,
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
    /// A5765: exact first prompt for a fresh Door; omission retains the normal order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    #[schemars(skip)]
    pub prompt: Option<String>,
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

/// A5765e: descriptive source identity captured at creation; never a target-local Actor or authority.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StartAttribution {
    pub project: String,
    pub agent: String,
    pub project_name: String,
    pub agent_name: String,
}

impl StartAttribution {
    // Explicit null is input too: reject it rather than treating it as omission.
    pub(super) fn deserialize_present<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Self>, D::Error> {
        Self::deserialize(deserializer).map(Some)
    }
}
