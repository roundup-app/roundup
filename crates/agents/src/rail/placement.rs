//! Explicit Rail placement.
use super::*;

impl Rail {
    pub fn move_node(
        &mut self,
        id: &str,
        parent: Option<&str>,
        index: u32,
    ) -> Result<(), RpcError> {
        let name = self.name(id)?;
        let parent_name = parent.map(|id| self.name(id)).transpose()?;
        let tx = self.db.transaction().map_err(sql)?;
        let nodes = load(&tx)?;
        let node = find(&nodes, id)?;
        check_parent(&nodes, node.kind, parent)?;
        // Only a start nests an Agent under an Agent (A6, A26).
        if let Some(under) = parent.map(|id| find(&nodes, id)).transpose()?
            && node.kind == NodeKind::Agent
            && under.kind == NodeKind::Agent
        {
            return Err(RpcError::conflict(format!(
                "{name} cannot move under Agent {}: only a start nests it",
                parent_name.as_deref().unwrap_or(GONE_AGENT)
            )));
        }
        if parent.is_some_and(|parent| is_within(&nodes, parent, id)) {
            return Err(RpcError::conflict(format!(
                "{name} cannot move into itself"
            )));
        }
        let without = |parent: Option<&str>| {
            let mut ids = siblings(&nodes, parent);
            ids.retain(|sibling| sibling != id);
            ids
        };
        let mut ids = without(parent);
        ids.insert((index as usize).min(ids.len()), id.to_owned());
        place(&tx, parent, &ids)?;
        if node.parent.as_deref() != parent {
            place(
                &tx,
                node.parent.as_deref(),
                &without(node.parent.as_deref()),
            )?;
        }
        tx.commit().map_err(sql)
    }

}
