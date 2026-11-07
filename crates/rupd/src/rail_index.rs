//! The Rail's nodes by id, for the walks that climb to a Workstream.
use std::collections::HashMap;

use contracts::agent::{NodeKind, RailNode};

pub(crate) struct RailIndex<'a> {
    by_id: HashMap<&'a str, &'a RailNode>,
}

impl<'a> RailIndex<'a> {
    pub(crate) fn new(nodes: &'a [RailNode]) -> Self {
        Self {
            by_id: nodes.iter().map(|node| (node.id.as_str(), node)).collect(),
        }
    }

    pub(crate) fn contains(&self, id: &str) -> bool {
        self.by_id.contains_key(id)
    }

    /// The nearest Workstream at or above `id`. A Group on the way is climbed past, as is any
    /// other node that is not a Workstream.
    pub(crate) fn workstream_of(&self, id: &str) -> Option<&'a RailNode> {
        let mut at = self.by_id.get(id).copied();
        while let Some(node) = at {
            if node.kind == NodeKind::Workstream {
                return Some(node);
            }
            at = node
                .parent
                .as_deref()
                .and_then(|parent| self.by_id.get(parent).copied());
        }
        None
    }
}
