//! U419: an Attachment's bytes, kept by the Daemon so a path can name them.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "attachment/")]
pub struct SaveParams {
    pub name: String,
    /// Base64 of the image's bytes.
    pub data: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "attachment/")]
pub struct Saved {
    /// The absolute path of the Attachment file.
    pub path: String,
}
