//! Checkpoints: the short cards of facts a Door writes when its Workstream's work reaches a point
//! worth marking (M10). A Checkpoint is not a Message.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A Door's `title` is at most this many characters.
pub const MAX_TITLE: usize = 80;
/// A Checkpoint holds 1 to this many Blocks.
pub const MAX_BLOCKS: usize = 8;
/// A `rows` or `table` Block holds at most this many rows.
pub const MAX_ROWS: usize = 12;
/// A `table` Block holds at most this many columns.
pub const MAX_COLUMNS: usize = 6;
/// A `diagram` Block's `mermaid` source is at most this many characters.
pub const MAX_MERMAID: usize = 2000;
/// A `text` Block is at most this many characters.
pub const MAX_TEXT: usize = 400;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "checkpoint/")]
pub struct Row {
    pub label: String,
    pub value: String,
}

/// One part of a Checkpoint, chosen by the Door.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "checkpoint/")]
pub enum Block {
    Rows {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        title: Option<String>,
        rows: Vec<Row>,
    },
    Table {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        title: Option<String>,
        head: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    Diagram {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        title: Option<String>,
        mermaid: String,
    },
    Text {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        title: Option<String>,
        text: String,
    },
}

/// `checkpoint.write`: the Workstream is the calling Door's own, never a parameter.
#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "checkpoint/")]
pub struct WriteParams {
    pub title: String,
    pub blocks: Vec<Block>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "checkpoint/")]
pub struct ListParams {
    pub workstream: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "checkpoint/")]
pub struct Checkpoint {
    /// The next integer of its Workstream: 1, then 2.
    pub id: u32,
    pub workstream: String,
    #[ts(type = "number")]
    pub at: i64,
    pub title: String,
    pub blocks: Vec<Block>,
}
