//! M10's limits. A write over any of them is `INVALID_PARAMS` and writes nothing.

use contracts::checkpoint::{
    Block, MAX_BLOCKS, MAX_COLUMNS, MAX_MERMAID, MAX_ROWS, MAX_TEXT, MAX_TITLE, WriteParams,
};
use rpc::{RpcError, code};

fn invalid(what: String) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, what)
}

fn at_most(what: &str, got: usize, limit: usize) -> Result<(), RpcError> {
    if got > limit {
        return Err(invalid(format!("{what} is {got}, at most {limit}")));
    }
    Ok(())
}

pub(crate) fn write(p: &WriteParams) -> Result<(), RpcError> {
    at_most("title characters", p.title.chars().count(), MAX_TITLE)?;
    if p.blocks.is_empty() {
        return Err(invalid("a Checkpoint needs at least one Block".into()));
    }
    at_most("blocks", p.blocks.len(), MAX_BLOCKS)?;
    p.blocks.iter().try_for_each(block)
}

fn block(block: &Block) -> Result<(), RpcError> {
    match block {
        Block::Rows { rows, .. } => at_most("rows", rows.len(), MAX_ROWS),
        Block::Table { head, rows, .. } => {
            at_most("rows", rows.len(), MAX_ROWS)?;
            let widest = rows.iter().map(Vec::len).fold(head.len(), usize::max);
            at_most("columns", widest, MAX_COLUMNS)
        }
        Block::Diagram { mermaid, .. } => {
            at_most("mermaid characters", mermaid.chars().count(), MAX_MERMAID)
        }
        Block::Text { text, .. } => at_most("text characters", text.chars().count(), MAX_TEXT),
    }
}
