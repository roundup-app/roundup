//! Checkpoints: the short cards of facts a Door writes when its Workstream's work reaches a point
//! worth marking (M10). A Checkpoint is not a Message.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Row {
    pub label: String,
    pub value: String,
}

/// One part of a Checkpoint, chosen by the Door.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Block {
    Rows {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        rows: Vec<Row>,
    },
    Table {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        head: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    Diagram {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        mermaid: String,
    },
    Text {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional, type = String)]
        title: Option<String>,
        text: String,
    },
}

/// `checkpoint.write`: the Workstream is the calling Door's own, never a parameter.
#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct WriteParams {
    pub title: String,
    pub blocks: Vec<Block>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, JsonSchema)]
pub struct ListParams {
    pub workstream: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type, JsonSchema)]
pub struct Checkpoint {
    /// The next integer of its Workstream: 1, then 2.
    pub id: u32,
    pub workstream: String,
    #[specta(type = specta_typescript::Number)]
    pub at: i64,
    /// Complete, usable Marks for this Workstream.
    pub rewindable: bool,
    pub title: String,
    pub blocks: Vec<Block>,
}
