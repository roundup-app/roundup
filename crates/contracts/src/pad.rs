//! Pads: markdown notes owned by an Agent or the user. The owner may rewrite; everyone else may only append.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::Actor;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Pad {
    /// Opaque never-reused creation identity within this Project; retain the Project too.
    pub incarnation: String,
    pub name: String,
    pub owner: Actor,
    pub text: String,
    #[specta(type = specta_typescript::Number)]
    pub updated_at: i64,
    /// 1 at creation, plus one with each change to `text` (P15).
    #[specta(type = specta_typescript::Number)]
    pub revision: u64,
    /// The Rail id of the Workstream the Pad belongs to, or `None` for the Project root (P12).
    pub home: Option<String>,
}

/// The owner is the calling Actor.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct CreateParams {
    pub name: String,
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct PadName {
    pub name: String,
}

/// Rewrite the whole text. Owner only. Supplied guards are checked in the same write transaction.
/// `expectedRevision` mismatch is CONFLICT naming the current Revision.
/// `expectedIncarnation` mismatch is CONFLICT; a missing Pad is NOT_FOUND.
/// Omitted guards keep name-based current-content semantics.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct WriteParams {
    pub name: String,
    pub text: String,
    #[serde(default, rename = "expectedRevision")]
    #[specta(optional, type = Option<specta_typescript::Number>)]
    pub expected_revision: Option<u64>,
    /// Creation captured with the draft in its original Project. Independent of content Revision.
    #[serde(default, rename = "expectedIncarnation")]
    #[specta(optional, type = String)]
    pub expected_incarnation: Option<String>,
}

/// Add to the end. Anyone; counts as a write in Provenance.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct AppendParams {
    pub name: String,
    pub text: String,
}

/// Add under a Markdown heading: at the end of its section. Anyone; counts as a write in Provenance (P15).
/// `heading` ignores case, runs of whitespace and leading `#`. With `expectedRevision`, the call fails with `CONFLICT` when the Pad's revision differs.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct AppendSectionParams {
    pub name: String,
    pub heading: String,
    pub text: String,
    #[serde(default, rename = "expectedRevision")]
    #[specta(optional, type = Option<specta_typescript::Number>)]
    pub expected_revision: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SetOwnerParams {
    pub name: String,
    pub owner: Actor,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct ExportParams {
    pub name: String,
    pub path: String,
}

/// Project-wide. `true` mirrors every Pad to `pads/<name>.md` in the Project's data folder (N1); the app database stays the source of truth.
/// `false` stops mirroring and first imports edits made to those files.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct SetStorageParams {
    pub files: bool,
}

/// Moves a Pad to a Workstream, or to the Project root when `home` is `None`.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct MoveParams {
    pub name: String,
    pub home: Option<String>,
}
