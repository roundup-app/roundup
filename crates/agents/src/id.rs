//! `AgentId`: a node id parsed once at the RPC edge; the wire stays a `String`.

use std::num::NonZeroI64;

/// An Agent's node id: a positive decimal with no sign and no leading zero, so `"01"` is not
/// Agent 1. Only `parse` makes one, so a `;` or `../` never reaches a shell word or a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AgentId(NonZeroI64);

impl AgentId {
    /// `None` for anything `contracts::Ordinal::parse` refuses: digits only, no leading zero,
    /// positive, within `i64`. It allocates nothing, since the Rail parses one per node (R3696c).
    pub fn parse(id: &str) -> Option<Self> {
        if !id.bytes().all(|b| b.is_ascii_digit()) || id.starts_with('0') {
            return None;
        }
        id.parse().ok().map(Self)
    }

    /// The node's row id, which SQLite compares as an integer, so no text cast is needed.
    pub fn get(self) -> i64 {
        self.0.get()
    }
}

impl std::fmt::Display for AgentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}
