//! LH2, LH4, LH19: the links header's set of one Agent. One definition of the entry serves the side
//! call's structured-output schema (`schema`) and, through the generated types, the App's
//! catalogue for `@json-render/solid`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// The most entries a set holds.
pub const MAX_ENTRIES: usize = 12;

/// The most words a tooltip holds.
pub const MAX_TOOLTIP_WORDS: usize = 5;

/// LH19: the most made items `agent.made` lists.
pub const MAX_MADE: usize = 12;

/// What a link is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub enum LinkKind {
    #[serde(rename = "pr")]
    Pr,
    #[serde(rename = "tracker")]
    Tracker,
    #[serde(rename = "dev-server")]
    DevServer,
    #[serde(rename = "asked")]
    Asked,
}

/// One link of the header: a full URL and a tooltip of a few words.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct LinkEntry {
    pub kind: LinkKind,
    pub url: String,
    pub tooltip: String,
}

/// An Agent's link set, the shape the side call answers and `agent.links` returns.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct LinkSet {
    pub entries: Vec<LinkEntry>,
}

/// The `agent.links` event: Agent `id` now holds `set`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct LinksEvent {
    pub id: String,
    pub set: LinkSet,
}

/// The JSON schema of the call's answer, built from `LinkSet`.
///
/// # Panics
/// Never: a schema serialises.
#[must_use]
#[allow(clippy::expect_used)]
pub fn schema() -> String {
    serde_json::to_string(&schemars::schema_for!(LinkSet)).expect("a schema serialises")
}

/// LH19: what an item the Agent made for the user is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MadeKind {
    Pad,
    File,
}

/// LH19: one item an Agent made for the user to read. `id` is what the App opens it by: a Pad's
/// name or a Deliverable's id.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct MadeItem {
    pub kind: MadeKind,
    pub id: String,
    pub title: String,
}
