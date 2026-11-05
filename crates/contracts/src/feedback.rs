//! FB3 to FB5 (`scenarios/feedback-report.md`): a Feedback report the Daemon posts through the
//! owner's `gh`, or keeps.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// FB4: the owner's line, the shot and the App's facts. The Daemon adds its own facts (FB3).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SendParams {
    /// The report's key: a repeated Send with it returns the first result.
    pub id: String,
    pub text: String,
    /// The PNG, base64; absent when the owner dropped it or the capture failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub shot: Option<String>,
    /// The App's facts as the form showed them.
    pub facts: String,
    /// FB6: the Feedback Issue's URL.
    pub target: String,
    /// The id of the Rail node the owner had selected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub selected: Option<String>,
}

/// FB5: post a kept report again; `target` replaces the saved one when the owner changed it.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RetryParams {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub target: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum Sent {
    /// The comment's URL.
    Posted { url: String },
    /// The report is saved in `folder`; `cause` is one line.
    Kept { folder: String, cause: String },
}
