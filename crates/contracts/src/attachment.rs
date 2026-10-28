//! U419: an Attachment's bytes, kept by the Daemon so a path can name them.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct SaveParams {
    pub name: String,
    /// Base64 of the image's bytes.
    pub data: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Saved {
    /// The absolute path of the Attachment file.
    pub path: String,
}
