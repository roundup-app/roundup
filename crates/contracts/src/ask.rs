//! The user's Ask, its verbatim parts, and their durable delivery state (A40–A42).
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

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
    },
    New {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        workstream: Option<String>,
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
