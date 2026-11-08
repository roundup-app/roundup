//! Explicit Rail placement.
use super::*;

impl Rail {
    /// Put `id` at `index` among the children of `parent`, closing the gap it leaves behind.
    pub fn move_node(
        &mut self,
        id: &str,
        parent: Option<&str>,
        index: u32,
    ) -> Result<(), StoreError> {
        let name = self.name(id)?;
        let parent_name = parent.map(|id| self.name(id)).transpose()?;
        let tx = self.db.transaction()?;
        let nodes = load(&tx)?;
        let node = find(&nodes, id)?;
        check_parent(&nodes, node.kind, parent)?;
        if node.kind == NodeKind::Group
            && nodes
                .iter()
                .any(|n| n.kind == NodeKind::Workstream && is_within(&nodes, &n.id, id))
        {
            check_parent(&nodes, NodeKind::Workstream, parent)?;
        }
        // Only a start nests an Agent under an Agent (A6, A26).
        if let Some(under) = parent.map(|id| find(&nodes, id)).transpose()?
            && node.kind == NodeKind::Agent
            && under.kind == NodeKind::Agent
        {
            return Err(StoreError::conflict(format!(
                "{name} cannot move under Agent {}: only a start nests it",
                parent_name.as_deref().unwrap_or(GONE_AGENT)
            )));
        }
        if parent.is_some_and(|parent| is_within(&nodes, parent, id)) {
            return Err(StoreError::conflict(format!(
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
            tx.execute("UPDATE nodes SET visibility='shown' WHERE id=?", [id])?;
            place(
                &tx,
                node.parent.as_deref(),
                &without(node.parent.as_deref()),
            )?;
        }
        // Explicit moves supersede this surviving node's retained placement, even if
        // a later move returns it to the same parent and index.
        let retained: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='rail_deletions')",
            [],
            |r| r.get(0),
        )?;
        if retained {
            tx.execute("UPDATE rail_deletions SET boundary=json_set(boundary,'$.after',json((SELECT COALESCE(json_group_array(json(value)),'[]') FROM json_each(json_extract(boundary,'$.after')) WHERE json_extract(value,'$.id')<>?))) WHERE restored=0 AND json_type(boundary)='object'", [id])?;
        }
        Ok(tx.commit()?)
    }
}

impl Rail {
    /// U5690c: collect identities in one transaction, using the pre-action tree order.
    pub fn group(&mut self, ids: &[String]) -> Result<RailNode, StoreError> {
        let tx = self.db.transaction()?;
        let nodes = load(&tx)?;
        for id in ids {
            find(&nodes, id)?;
        }
        let chosen: std::collections::HashSet<_> = ids.iter().map(String::as_str).collect();
        if chosen.len() < 2 {
            return Err(StoreError::invalid("select at least two Rail rows"));
        }
        // Walk existing sibling ordinals, independent of request/click order.
        fn walk(
            nodes: &[RailNode],
            parent: Option<&str>,
            chosen: &std::collections::HashSet<&str>,
            selected: &mut Vec<String>,
        ) {
            for id in siblings(nodes, parent) {
                if chosen.contains(id.as_str()) {
                    selected.push(id.clone());
                }
                walk(nodes, Some(&id), chosen, selected);
            }
        }
        let mut selected = Vec::new();
        walk(&nodes, None, &chosen, &mut selected);
        let Some(first_id) = selected.first() else {
            return Err(StoreError::invalid("select at least two Rail rows"));
        };
        let first = find(&nodes, first_id)?;
        let mut destination = first.parent.as_deref();
        while let Some(id) = destination {
            if !chosen.contains(id)
                && selected
                    .iter()
                    .all(|selected| is_within(&nodes, selected, id))
            {
                break;
            }
            destination = find(&nodes, id)?.parent.as_deref();
        }
        // Selected nodes become direct children; unselected descendants stay attached.
        // The destination is a strict unselected ancestor, so this cannot create a cycle.
        let mut branch = first;
        while branch.parent.as_deref() != destination {
            let Some(up) = branch.parent.as_deref() else {
                return Err(StoreError::invalid("no common ancestor"));
            };
            branch = find(&nodes, up)?;
        }
        let siblings_before = siblings(&nodes, destination);
        let index = siblings_before
            .iter()
            .take_while(|id| *id != &branch.id)
            .filter(|id| !chosen.contains(id.as_str()))
            .count();
        tx.execute(
            "INSERT INTO nodes(kind,name,parent,ord) VALUES('group','Group',?,?)",
            params![destination, index as i64],
        )?;
        let group = tx.last_insert_rowid().to_string();
        let mut parents: std::collections::HashSet<Option<&str>> = selected
            .iter()
            .map(|id| find(&nodes, id).map(|node| node.parent.as_deref()))
            .collect::<Result<_, _>>()?;
        parents.insert(destination);
        for parent in parents {
            let mut remaining: Vec<_> = siblings(&nodes, parent)
                .into_iter()
                .filter(|id| !chosen.contains(id.as_str()))
                .collect();
            if parent == destination {
                remaining.insert(index, group.clone());
            }
            place(&tx, parent, &remaining)?;
        }
        place(&tx, Some(&group), &selected)?;
        // A user grouping supersedes retained undo placement just as an explicit move does.
        let retained: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name='rail_deletions')",
            [],
            |r| r.get(0),
        )?;
        if retained {
            for id in &selected {
                tx.execute("UPDATE rail_deletions SET boundary=json_set(boundary,'$.after',json((SELECT COALESCE(json_group_array(json(value)),'[]') FROM json_each(json_extract(boundary,'$.after')) WHERE json_extract(value,'$.id')<>?))) WHERE restored=0 AND json_type(boundary)='object'", [id])?;
            }
        }
        tx.commit()?;
        self.node(&group)
    }
}
