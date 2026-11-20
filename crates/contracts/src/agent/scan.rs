//! C7684: what `agent.repeatScan` returns.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// A block of lines in a working copy file (C7684): 1-based, inclusive.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ScanPlace {
    pub path: String,
    pub start: u32,
    pub end: u32,
}

/// Changed lines `path` `start`-`end` that `other` holds again (C7684).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ScanHit {
    pub path: String,
    pub start: u32,
    pub end: u32,
    pub other: ScanPlace,
}

/// What `agent.repeatScan` returns (C7684), sorted by `path` then `start`: `complete` is false
/// when the scan stopped at its file or time bound.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct ScanHits {
    pub hits: Vec<ScanHit>,
    pub complete: bool,
}
