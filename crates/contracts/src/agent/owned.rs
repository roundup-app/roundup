//! What the Agent's Worktree or an owned group is compared as, and the params that read it (U7672a, U7853a, U7955a).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::OwnedGroupKey;

/// What the Agent's own Worktree is compared as, against the remote's main (U7672a): everything
/// in its folder now, or its commits only.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CompareTarget {
    #[default]
    Tree,
    Branch,
}

/// The Agent's changed-file list: the remote's main against its Worktree's `to` (U7672a).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ChangedFilesParams {
    pub id: String,
    #[serde(default)]
    #[specta(optional, type = CompareTarget)]
    pub to: CompareTarget,
    /// U7955a: read the checkout of this owned group instead of the Worktree (see `CompareFileParams`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = OwnedGroupKey)]
    pub group: Option<OwnedGroupKey>,
}

/// Select one relative path in an Agent's Worktree (U2540a) and the `to` it is compared as. With
/// `group` the path is read in that group's checkout instead, as Changes lists it (U7853a); an
/// Agent with no Worktree is read only this way, and `to` stays `tree`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CompareFileParams {
    pub id: String,
    pub path: String,
    #[serde(default)]
    #[specta(optional, type = CompareTarget)]
    pub to: CompareTarget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = OwnedGroupKey)]
    pub group: Option<OwnedGroupKey>,
}
