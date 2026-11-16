//! MC1, MC2: a Machine is herdr-core's, read and added through it; roundup keeps no row.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// One Machine as herdr-core lists it: its `name`, and the rest of what the core sent.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Machine {
    pub name: String,
    /// Every other field of herdr-core's entry, kept as the core sent it.
    #[serde(default)]
    #[specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>)]
    pub details: serde_json::Value,
    /// MC15: whether roundup's ssh to this Machine answers; absent before it has tried.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub reachable: Option<bool>,
    /// MC26: whether no bridge to this Machine is up, for its Agents' rows to show; absent when
    /// the Daemon holds none for it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub away: Option<bool>,
    /// MC75: whether this Machine's herdr-core is older than this Mac's; absent when either
    /// version is unknown or the Machine is offline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub outdated: Option<bool>,
}

/// `machine.add`: the ssh name of the machine to add.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct AddParams {
    /// An ssh name, as `ssh <name>` takes it.
    pub name: String,
}

/// `machine.remove`: the name of the listed machine herdr-core forgets (MC71).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct RemoveParams {
    /// A name `machine.list` gave; This Mac's own name is refused.
    pub name: String,
}

/// `machine.update`: the name of the listed machine whose herdr-core the CLI updates (MC72).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct UpdateParams {
    /// A name `machine.list` gave; This Mac's own name is refused.
    pub name: String,
}
