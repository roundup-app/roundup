//! The file comparison `agent.compareFile` returns (U2540a, U7694a).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::ChangedStatus;

/// Exact present bytes use SHA-256 revisions; an absent side uses `absent`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum FileContent {
    Absent {
        revision: String,
    },
    Text {
        revision: String,
        text: String,
    },
    Binary {
        revision: String,
    },
    /// U7694a: a PNG, JPEG, GIF or WebP by its header. `size` is the side's bytes; `data` is
    /// their base64, left out over the 4 MiB limit.
    Image {
        revision: String,
        mime: String,
        size: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        data: Option<String>,
    },
}

/// Merge-base versus current disk content, never the index (U2540a).
/// Each side is capped at 4 MiB; oversized or special files fail explicitly.
/// Status is null when no change remains against the merge base.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileComparison {
    pub base: String,
    pub old_path: String,
    pub new_path: String,
    pub status: Option<ChangedStatus>,
    pub old: FileContent,
    pub new: FileContent,
}
