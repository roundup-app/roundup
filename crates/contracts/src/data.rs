//! Fork (`scenarios/data-fork.md`): `data.fork` copies the live data folder into a new Fork data folder.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// FK5977d: the fixed set of Fork colours; the App's Token for each is U4's work.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ForkColour {
    Red,
    Orange,
    Amber,
    Green,
    Teal,
    Blue,
    Violet,
    Pink,
}

/// FK5977b: `all` or `none` of a Project's Agents.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ForkAgentsAll {
    All,
    None,
}

/// FK5977b: which of a Project's Agents a Fork keeps.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(untagged)]
pub enum ForkAgents {
    Keyword(ForkAgentsAll),
    Ids(Vec<String>),
}

fn yes() -> bool {
    true
}

/// FK5977b: what a Fork keeps of one Project; each boolean defaults to true.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ForkProject {
    pub key: String,
    #[serde(default = "all_agents")]
    pub agents: ForkAgents,
    #[serde(default = "yes")]
    pub todos: bool,
    #[serde(default = "yes")]
    pub pads: bool,
    #[serde(default = "yes")]
    pub messages: bool,
    #[serde(default = "yes")]
    pub history: bool,
}

fn all_agents() -> ForkAgents {
    ForkAgents::Keyword(ForkAgentsAll::All)
}

/// FK5977a: `path` must not exist or be empty, and lie neither inside the live folder nor around it.
/// With no `projects` the Fork keeps everything.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ForkParams {
    pub name: String,
    pub colour: ForkColour,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<ForkProject>)]
    pub projects: Option<Vec<ForkProject>>,
}

/// FK5977a: what one Project of the Fork holds, by row.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Forked {
    pub key: String,
    pub agents: Vec<String>,
    pub todos: u32,
    pub pads: u32,
    pub messages: u32,
    pub history: u32,
}

/// FK5977a: the Fork's data path and each Project it holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ForkResult {
    pub path: String,
    pub projects: Vec<Forked>,
}

/// FK5977d: `<path>/fork.json`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ForkRecord {
    pub name: String,
    pub colour: ForkColour,
    pub source: String,
    pub created_ms: u64,
    pub projects: Option<Vec<ForkProject>>,
}
