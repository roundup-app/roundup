//! C7704: the Spots of the Changes view and the methods that place and read them.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::OwnedGroupKey;

/// A block of lines in a working copy file (C7684): 1-based, inclusive.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct SpotPlace {
    pub path: String,
    pub start: u32,
    pub end: u32,
}

/// Where a Spot came from (C7704): the repeat scan, or a tool that posted it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SpotSource {
    Repeats,
    Tool { name: String },
}

/// Lines `path` `start`-`end` that a `source` points at (C7704): a tool gives a `message`, the
/// repeat scan the `other` place that holds the lines again (C7684). `stale` is true when the
/// file changed since a tool posted it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Spot {
    pub source: SpotSource,
    pub path: String,
    pub start: u32,
    pub end: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = SpotPlace)]
    pub other: Option<SpotPlace>,
    pub stale: bool,
}

/// What `agent.repeatScan` returns (C7684, C7704), sorted by `path` then `start`: `complete` is false
/// when the scan stopped at its file or time bound.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ScanSpots {
    pub spots: Vec<Spot>,
    pub complete: bool,
}

/// What `agent.spots` returns (C7704): the Spots tools posted, sorted by `path`, then `start`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Spots {
    pub spots: Vec<Spot>,
}

/// One line range of a file of the Agent's folder, with what a tool says of it (C7704).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SpotInput {
    /// Relative to the Agent's folder, or absolute inside it.
    pub path: String,
    /// First line, 1-based.
    pub start: u32,
    /// Last line, at least `start`.
    pub end: u32,
    pub message: String,
}

/// `agent.postSpots` params (C7704): `spots` replace every earlier Spot of `source`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PostSpotsParams {
    pub id: String,
    /// The tool that found them, such as `oxlint` or `tests`.
    pub source: String,
    pub spots: Vec<SpotInput>,
}

/// `agent.spots` params (C7704): read through `group` an Agent with no Worktree (U7955a).
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SpotsParams {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = OwnedGroupKey)]
    pub group: Option<OwnedGroupKey>,
}
