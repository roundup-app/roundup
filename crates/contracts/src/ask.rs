//! The user's Ask, its verbatim parts, and their durable delivery state (A40–A42).
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ask/")]
pub struct Ask {
    pub id: String,
    pub text: String,
    pub at: i64,
    pub parts: Vec<AskPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub submission: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ask/")]
pub struct AskPart {
    pub text: String,
    pub placement: Placement,
    pub state: State,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "ask/")]
pub enum Placement {
    Routed {
        workstream: String,
    },
    New {
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        workstream: Option<String>,
    },
    Unclear {
        question: String,
        candidates: Vec<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "ask/")]
pub enum State {
    Placing,
    Waiting,
    Queued,
    Typed,
    Failed,
    Dropped,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "ask/")]
pub struct SendParams {
    pub text: String,
    // A caller-captured revision identity. Equal replay returns its original Ask.
    #[ts(optional)]
    pub submission: Option<String>,
    // Captured destination; never resolve the text's leading name when supplied.
    #[ts(optional)]
    pub workstream: Option<String>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "ask/")]
pub struct PickParams {
    pub id: String,
    pub part: usize,
    pub target: Target,
}

#[derive(Deserialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "ask/")]
pub enum Target {
    Workstream {
        id: String,
    },
    New {
        #[ts(optional)]
        title: Option<String>,
    },
    Drop,
}
