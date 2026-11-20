//! C7707: finding a Message, Pad or Todo by the words in it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// `limit` defaults to 20 and is capped at 50.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct FindParams {
    pub query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub limit: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SearchKind {
    Message,
    Pad,
    Todo,
}

/// A matched word: UTF-16 code unit offsets into `SearchHit.snippet`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

/// `id` is the Message id, Pad name or Todo id as a string. `opens` is a Message's Agent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct SearchHit {
    pub kind: SearchKind,
    pub id: String,
    pub title: String,
    pub snippet: String,
    pub ranges: Vec<Span>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub opens: Option<String>,
}

/// The ranked hits, and whether a further hit exists beyond `limit`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Found {
    pub hits: Vec<SearchHit>,
    pub more: bool,
}
