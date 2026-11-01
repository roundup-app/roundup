//! Named actions: the App's list of what a key can do, and a run of one by name (NA5–NA9).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ArgType {
    String,
    Integer,
    Boolean,
    Choice,
}

/// One `key=value` argument of an action. `min` and `max` hold for an integer, `options` for a choice.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ActionArg {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: ArgType,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Option<specta_typescript::Number>)]
    pub min: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Option<specta_typescript::Number>)]
    pub max: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub options: Option<Vec<String>>,
}

/// NA5: one row of `action.list`. `cause` says why an unavailable action cannot run now.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ActionRow {
    pub name: String,
    pub label: String,
    pub keys: String,
    pub args: Vec<ActionArg>,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub cause: Option<String>,
    /// UA1: `user` for an action an Extension declared; absent on the App's own rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub source: Option<String>,
}

/// UA2, UA6: an Extension that failed to load or run; `cause` names the file, action or rule.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ExtensionProblem {
    pub extension: String,
    pub cause: String,
}

/// One `key=value` pair, in the order the caller gave it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ActionPair {
    pub key: String,
    pub value: String,
}

/// `action.run`: run the action `name` once with `args`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RunParams {
    pub name: String,
    #[serde(default)]
    pub args: Vec<ActionPair>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Done,
    Awaiting,
}

/// NA3: `done`, or `awaiting` when the action opened a confirm or a prompt for the user to finish.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RunResult {
    pub status: RunStatus,
}
