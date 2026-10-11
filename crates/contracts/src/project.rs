//! Per-Project settings (G1, `scenarios/worktrees.md`): today, only the `worktrees` toggle.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct Worktrees {
    pub on: bool,
    /// The command Landing runs in a Worktree before it fast-forwards the Base. `None` is
    /// allowed: isolation needs no check, though Landing then refuses (`check_missing`).
    pub check: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ProjectSettings {
    pub worktrees: Worktrees,
    /// A36: the Model and Effort the user set per Role, and the Models a Door may start a child on.
    pub models: ProjectModels,
}

/// A36: one Model or Effort the Adapter offers. Outside the Adapter `id` is opaque (P4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct Choice {
    pub id: String,
    pub label: String,
}

/// A36: `models.list`, the Models and Efforts the Adapter offers.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "project/")]
pub struct ModelList {
    pub models: Vec<Choice>,
    pub efforts: Vec<Choice>,
}

/// A36: the Model and Effort of one Role; `None` passes nothing, so the user's own default applies.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct RoleModels {
    pub role: String,
    pub model: Option<String>,
    pub effort: Option<String>,
}

/// A36: what `project.setModels` takes and `project.get` returns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct ProjectModels {
    pub roles: Vec<RoleModels>,
    /// The Models a Door may start a child Agent on; empty for a Project that never set it.
    pub allowed: Vec<String>,
}

/// M8: ask the App to open the Project at `path`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct OpenParams {
    /// An absolute path to an existing folder.
    pub path: String,
}

/// M8: ask the App to give this Project another name (S10's rule, but never empty).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "project/")]
pub struct RenameParams {
    pub name: String,
}

/// M8: what the Daemon asks of the App, which no Daemon can reach but by an Event.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "project/")]
pub enum Requested {
    Open { path: String },
    Rename { path: String, name: String },
}
