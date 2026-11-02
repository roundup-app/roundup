//! U5501: only an authenticated user can change Agent alert levels.
use super::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AlertLevel {
    #[default]
    Default,
    All,
    Quiet,
}

/// One Agent, or every current Agent recursively inside a Workstream, including its Door.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SetAlertLevelParams {
    /// Absolute Project folder; prevents a Project-local id addressing another Project.
    pub project: String,
    pub id: String,
    pub level: AlertLevel,
}
