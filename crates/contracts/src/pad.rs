//! Pads: shared markdown notes belonging to a Home.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct Pad {
    /// Opaque never-reused creation identity within this Project; retain the Project too.
    pub incarnation: String,
    pub name: String,
    pub text: String,
    #[specta(type = specta_typescript::Number)]
    pub updated_at: i64,
    /// 1 at creation, plus one with each change to `text` (P15).
    #[specta(type = specta_typescript::Number)]
    pub revision: u64,
    /// The Rail id of the Workstream the Pad belongs to, or `None` for the Project root (P12).
    pub home: Option<String>,
}

/// Create a shared Pad.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct CreateParams {
    pub name: String,
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct PadName {
    pub name: String,
}

/// Rewrite the whole text. Supplied guards are checked in the same write transaction.
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

/// Rename this exact creation under its captured, exact spelling.
/// Incarnations are Project-scoped: submit on the originally captured Project connection.
/// Missing name is NOT_FOUND; a changed spelling/incarnation or occupied destination is
/// CONFLICT. Refusal changes no text, mirror, Touch or Event. Content Revision is unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameParams {
    pub name: String,
    pub new_name: String,
    pub expected_incarnation: String,
}

/// Delete the current Pad, retaining its authoritative state in the same transaction.
/// Supply an operation before dispatch to reconcile a lost reply using `pad.getDeletion`.
/// Reusing an operation with different guards refuses; it never deletes a replacement.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct DeleteParams {
    pub name: String,
    #[serde(default)]
    #[specta(optional, type = String)]
    pub operation: Option<String>,
    #[serde(default, rename = "expectedIncarnation")]
    #[specta(optional, type = String)]
    pub expected_incarnation: Option<String>,
}

/// Originating Project and deletion operation; neither grants authority.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct DeletionId {
    pub project: String,
    pub operation: String,
}

/// Immutable pre-deletion state plus the durable consumption fact. A replay returns
/// this receipt without repeating effects, even if the restored Pad was edited/deleted.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Deletion {
    pub project: String,
    pub operation: String,
    pub pad: Pad,
    pub restored: bool,
}

/// Reconcile an unknown deletion on its originating Project connection. Returns
/// NOT_FOUND if no operation committed; that is the only safe signal to retry deletion.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct GetDeletionParams {
    pub operation: String,
}

/// Put this creation before another Pad of the same Home, or last with null `before`.
/// User only. A replaced creation, self target or other Home is CONFLICT;
/// a missing name is NOT_FOUND. Text, Revision, and Home remain unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReorderParams {
    pub name: String,
    pub before: Option<String>,
    pub expected_incarnation: String,
}
