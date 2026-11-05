//! B19, B20: what a Door is told about its children.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// B19: what a Door is told about one child. `last` is one line, `todos` counts the open Todos
/// whose Home is the child, and `pads` names the child's Pads written since the previous envelope.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct DigestEntry {
    pub name: String,
    pub kind: crate::Kind,
    /// AL1: the child's link (`roundup://agent/<id>?project=<key>`, LK1), which the Door gives the user.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub link: Option<String>,
    pub last: String,
    pub todos: u32,
    pub pads: Vec<String>,
}

/// B20: one item of `agent.digest`'s `children`: a child's entry, or the last item `{more: n}` when
/// the Door has more children than the result holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(untagged)]
pub enum DigestItem {
    Child(DigestEntry),
    More { more: u32 },
}

/// What `agent.digest` returns (B20).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Digest {
    pub children: Vec<DigestItem>,
}
