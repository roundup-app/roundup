//! MC40, MC41: the user's plain config files, read by the Daemon.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

/// What the last good `look.json` and `keys.json` hold. `look` keys are `mode`, `interfaceScale`,
/// `fontFamily`, `fontSize` and `color.<token>`; `keys` is `{ "<action name>": "<press>" }`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ConfigState {
    pub look: BTreeMap<String, String>,
    pub keys: BTreeMap<String, String>,
}

/// MC40, MC41: a refused file; `cause` names the key.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ConfigProblem {
    pub file: String,
    pub cause: String,
}
