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
}

/// `machine.add`: the ssh name of the machine to add.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct AddParams {
    /// An ssh name, as `ssh <name>` takes it.
    pub name: String,
}
