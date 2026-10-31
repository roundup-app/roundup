//! SK10, SK11: the state of the skill and hook roundup installs for outside Claude Code sessions.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// One installed item: `skill` or `hook`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SkillItem {
    pub item: String,
    /// `current`, `outdated`, `missing`, `foreign`, `unreadable` or `unsupported` after
    /// `skill.status`; the outcome (`installed`, `updated`, `unchanged`, `removed`, `missing`,
    /// `foreign`, `unreadable`, `unsupported`) after `skill.setup` and `skill.remove`.
    pub state: String,
    pub path: String,
}

/// The items after a `skill.*` call, in the order `skill`, `hook`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SkillSetup {
    pub items: Vec<SkillItem>,
}
