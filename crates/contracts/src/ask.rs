//! The user's Ask, its verbatim parts, and their durable delivery state (A40–A42).
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::agent::RailNode;

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct Ask {
    pub id: String,
    pub text: String,
    #[specta(type = specta_typescript::BigInt)]
    pub at: i64,
    pub parts: Vec<AskPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub submission: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct AskPart {
    pub text: String,
    pub placement: Placement,
    pub state: State,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Placement {
    Routed {
        workstream: String,
        /// U6271a: the open Project the Workstream belongs to, when the Placement call named it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        project: Option<String>,
    },
    New {
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        workstream: Option<String>,
        /// U6271a: the open Project the new Workstream starts in.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        project: Option<String>,
    },
    Unclear {
        question: String,
        candidates: Vec<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Placing,
    Waiting,
    Queued,
    Typed,
    Failed,
    Dropped,
}

#[derive(Deserialize, Type, JsonSchema)]
pub struct SendParams {
    pub text: String,
    // A caller-captured revision identity. Equal replay returns its original Ask.
    #[specta(optional, type = String)]
    pub submission: Option<String>,
    // Captured destination; never resolve the text's leading name when supplied.
    #[specta(optional, type = String)]
    pub workstream: Option<String>,
    // U6271a: the Project the owner fixed; the Placement call then makes no Project choice.
    #[serde(default)]
    #[specta(optional, type = String)]
    pub project: Option<String>,
    // U6271a: parts `ask.place` already placed; stored as given, with no second Placement call.
    #[serde(default)]
    #[specta(optional)]
    pub parts: Option<Vec<PlacedPart>>,
}

/// U6271a: one checked span of an Ask with the Placement it received.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct PlacedPart {
    pub text: String,
    pub placement: Placement,
}

/// U6271a: an open Project's name and its complete `rail.tree`, supplied by the App.
#[derive(Deserialize, Type, JsonSchema)]
pub struct ProjectTree {
    pub name: String,
    pub tree: Vec<RailNode>,
}

#[derive(Deserialize, Type, JsonSchema)]
pub struct PlaceParams {
    pub text: String,
    pub projects: Vec<ProjectTree>,
    #[serde(default)]
    #[specta(optional, type = String)]
    pub project: Option<String>,
}

#[derive(Deserialize, Type, JsonSchema)]
pub struct PickParams {
    pub id: String,
    #[specta(type = specta_typescript::Number)]
    pub part: usize,
    pub target: Target,
}

#[derive(Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    Workstream {
        id: String,
    },
    New {
        #[specta(optional, type = String)]
        title: Option<String>,
    },
    Drop,
}
