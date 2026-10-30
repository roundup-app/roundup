//! A5168a, A5168b (`scenarios/workstream-github.md`): the GitHub tools, which run the owner's own `gh`.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// A PR or an Issue by its number in the Project's repository.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct Number {
    pub number: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SetBodyParams {
    pub number: i32,
    pub body: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Open,
    Closed,
    Merged,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Pr {
    pub number: u32,
    pub url: String,
    pub title: String,
    pub body: String,
    pub state: State,
    pub draft: bool,
    /// Auto-merge is enabled.
    #[serde(rename = "autoMerge")]
    pub auto_merge: bool,
    /// The head commit.
    pub head: String,
    #[serde(rename = "mergedAt")]
    pub merged_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Issue {
    pub number: u32,
    pub url: String,
    pub title: String,
    pub body: String,
    pub state: State,
    pub labels: Vec<String>,
    #[serde(rename = "stateReason")]
    pub state_reason: Option<String>,
}
