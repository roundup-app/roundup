//! Deliberately published Project results; local targets name retained immutable revisions.
use crate::Actor;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// A Pad target binds the source incarnation returned by pad.read and its expected Revision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PublicationTarget {
    Pad {
        name: String,
        // A recreated name is not the selected Pad.
        incarnation: String,
        #[specta(type = specta_typescript::Number)]
        revision: u64,
    },
    /// Relative to the maker's authorized root, never an arbitrary absolute file.
    File { path: String },
    /// A mutable current target; no remote contents or availability are claimed.
    External { url: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PublishParams {
    pub key: String,
    pub title: String,
    pub target: PublicationTarget,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PublishedTarget {
    Pad {
        name: String,
        incarnation: String,
        #[specta(type = specta_typescript::Number)]
        revision: u64,
        #[specta(type = specta_typescript::Number)]
        length: u64,
        sha256: String,
    },
    File {
        path: String,
        #[specta(type = specta_typescript::Number)]
        length: u64,
        sha256: String,
    },
    External {
        url: String,
        availability: ExternalAvailability,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalAvailability {
    NotChecked,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Deliverable {
    pub project: String,
    pub id: String,
    pub maker: Actor,
    pub maker_name: String,
    pub home: Option<String>,
    pub title: String,
    #[specta(type = specta_typescript::Number)]
    pub published_at: i64,
    pub target: PublishedTarget,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DeliverableId {
    pub project: String,
    pub id: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ListParams {
    pub home: Option<String>,
    pub maker: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MoveParams {
    pub project: String,
    pub id: String,
    pub home: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum UnavailableCause {
    MissingRevision,
    IntegrityFailure,
    AccessRevoked,
    SourceUnknown,
    MaterializationFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Resolution {
    Retained {
        path: String,
        sha256: String,
    },
    External {
        url: String,
        availability: ExternalAvailability,
    },
    Unavailable {
        cause: UnavailableCause,
    },
}
