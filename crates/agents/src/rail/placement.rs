//! Explicit Rail placement.
use super::*;

impl Rail {
    /// Put `id` at `index` among the children of `parent`, closing the gap it leaves behind.
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
        // Explicit moves supersede this surviving node's retained placement, even if
        // a later move returns it to the same parent and index.
        let retained: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='rail_deletions')",
                [],
                |r| r.get(0),
            )
            .map_err(sql)?;
        if retained {
            tx.execute("UPDATE rail_deletions SET boundary=json_set(boundary,'$.after',json((SELECT COALESCE(json_group_array(json(value)),'[]') FROM json_each(json_extract(boundary,'$.after')) WHERE json_extract(value,'$.id')<>?))) WHERE restored=0 AND json_type(boundary)='object'", [id]).map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }
}
