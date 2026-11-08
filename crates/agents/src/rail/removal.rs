//! Transactional Rail removal.
use super::*;

#[derive(serde::Serialize, serde::Deserialize)]
struct Placement {
    before: Vec<Position>,
    after: Vec<Position>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Position {
    id: String,
    name: String,
    parent: Option<String>,
    order: u32,
}

impl From<RailNode> for Position {
    fn from(node: RailNode) -> Self {
        Self {
            id: node.id,
            name: node.name,
            parent: node.parent,
            order: node.order,
        }
    }
}

impl Rail {
    /// Delete `id`. Its children (a Workstream or an Agent may have any) move to its own
    /// parent, at its place, in order, first; one transaction, so a failed delete leaves them
    /// still under `id`.
    pub fn remove(&mut self, id: AgentId) -> Result<(), StoreError> {
        let tx = self.db.transaction()?;
        let nodes = load(&tx)?;
        let node = find(&nodes, id)?;
        let parent = node.parent.as_deref();
        let mut ids = siblings(&nodes, parent);
        let at = ids
            .iter()
            .position(|sibling| *sibling == id.to_string())
            .ok_or_else(|| StoreError::invalid("Rail row is not among its siblings"))?;
        let children = siblings(&nodes, Some(&id.to_string()));
        ids.splice(at..=at, children);
        // Reparent before deleting: a child's row still points at `id` until `place` runs, and a
        // delete while one does would fail its foreign key.
        place(&tx, parent, &ids)?;
        tx.execute("DELETE FROM nodes WHERE id = ?", params![id.get()])?;
        Ok(tx.commit()?)
    }

    /// A34: Rail, Todo, Pad and Touch rows share one transaction. The callback stages the
    /// external files and Worktrees before any node leaves; its returned guard survives commit.
    pub fn remove_workstream<T, E: Into<StoreError>>(
        &mut self,
        id: AgentId,
        removal: &mut contracts::agent::Removal,
        retain: Option<(&contracts::Actor, &str)>,
        apply: impl FnOnce(&rusqlite::Transaction, &mut contracts::agent::Removal) -> Result<T, E>,
    ) -> Result<T, StoreError> {
        use rusqlite::session::{Session, invert_strm};
        let id_text = id.to_string();
        self.db.pragma_update(None, "foreign_keys", true)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut retained = if let Some(retain) = retain {
            let mut graph = Session::new(&tx)?;
            for table in [
                "nodes",
                "instruction_homes",
                "deliverables",
                "workstream_queue",
            ] {
                graph.attach(Some(table))?;
            }
            Some((retain, graph))
        } else {
            None
        };
        let before = load(&tx)?;
        let out = apply(&tx, removal).map_err(Into::<StoreError>::into)?;
        Self::remove_graph(&tx, id, removal)?;
        if let Some(((actor, operation), mut graph)) = retained.take() {
            // Queue reads prune missing nodes; retain that change before any reader can do so.
            let mut removed: Vec<_> = removal
                .removed
                .iter()
                .filter(|item| item.kind == contracts::agent::RemovalKind::Agent)
                .map(|item| item.id.as_str())
                .collect();
            removed.push(id_text.as_str());
            tx.execute(
                "DELETE FROM workstream_queue WHERE workstream IN (SELECT value FROM json_each(?))",
                [serde_json::to_string(&removed)?],
            )?;
            let mut forward = Vec::new();
            graph.changeset_strm(&mut forward)?;
            let mut inverse = Vec::new();
            invert_strm(&mut forward.as_slice(), &mut inverse)?;
            drop(graph);
            let project: String =
                tx.query_row("SELECT id FROM deliverable_project", [], |r| r.get(0))?;
            removal.deletion = Some(contracts::agent::Deletion {
                project,
                operation: operation.into(),
                id: id_text.clone(),
                restored: false,
                restoration: None,
            });
            tx.execute("INSERT INTO rail_deletions(operation,actor,node,record,graph,boundary) VALUES(?,?,?,?,?,?)", params![
            operation, serde_json::to_string(actor)?, id_text,
            serde_json::to_string(&removal)?, inverse, serde_json::to_string(&Placement { before: before.into_iter().map(Position::from).collect(), after: load(&tx)?.into_iter().map(Position::from).collect() })?
        ])?;
        }
        if let Some((_, operation)) = retain {
            tx.execute("UPDATE rail_deletions SET record=json_set(record,'$.source',(SELECT operation FROM rail_deletions WHERE json_extract(record,'$.redo')=?1),'$.sourceRestoration',(SELECT json_extract(record,'$.deletion.restoration') FROM rail_deletions WHERE json_extract(record,'$.redo')=?1)) WHERE operation=?1 AND EXISTS(SELECT 1 FROM rail_deletions WHERE json_extract(record,'$.redo')=?1)",[operation])?;
        }
        drop(retained);
        tx.commit()?;
        Ok(out)
    }

    fn remove_graph(
        db: &Connection,
        id: AgentId,
        removal: &contracts::agent::Removal,
    ) -> Result<(), StoreError> {
        let nodes = load(db)?;
        let node = find(&nodes, id)?;
        let mut selected: Vec<_> = removal
            .removed
            .iter()
            .filter(|item| item.kind == contracts::agent::RemovalKind::Agent)
            .map(|item| item.id.as_str())
            .collect();
        selected.push(&node.id);
        fn surviving_children(
            nodes: &[RailNode],
            parent: Option<&str>,
            selected: &[&str],
            out: &mut Vec<String>,
        ) {
            for id in siblings(nodes, parent) {
                if selected.contains(&id.as_str()) {
                    surviving_children(nodes, Some(&id), selected, out);
                } else {
                    out.push(id);
                }
            }
        }
        // Flatten only removed ancestors; unchosen subtrees keep their internal relationships.
        for parent in std::iter::once(None).chain(
            nodes
                .iter()
                .filter(|n| !selected.contains(&n.id.as_str()))
                .map(|n| Some(n.id.as_str())),
        ) {
            let mut children = Vec::new();
            surviving_children(&nodes, parent, &selected, &mut children);
            place(db, parent, &children)?;
        }
        // Reparenting has detached every survivor. Delete selected children before ancestors.
        fn delete_selected(
            db: &Connection,
            nodes: &[RailNode],
            key: &str,
            selected: &[&str],
        ) -> Result<(), StoreError> {
            for child in nodes.iter().filter(|n| n.parent.as_deref() == Some(key)) {
                delete_selected(db, nodes, &child.id, selected)?;
            }
            if selected.contains(&key) {
                db.execute("DELETE FROM nodes WHERE id=?", [key])?;
            }
            Ok(())
        }
        for root in nodes.iter().filter(|n| n.parent.is_none()) {
            delete_selected(db, &nodes, &root.id, &selected)?;
        }
        Ok(())
    }

    pub(crate) fn deletion(
        &self,
        actor: &contracts::Actor,
        operation: &str,
    ) -> Result<Option<contracts::agent::Removal>, StoreError> {
        Self::read_deletion(&self.db, actor, operation)
    }

    fn read_deletion(
        db: &Connection,
        actor: &contracts::Actor,
        operation: &str,
    ) -> Result<Option<contracts::agent::Removal>, StoreError> {
        let row: Option<(String, String, bool)> = db
            .query_row(
                "SELECT actor, record, restored FROM rail_deletions WHERE operation=?",
                [operation],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        row.map(|(author, record, restored)| {
            if serde_json::from_str::<contracts::Actor>(&author)? != *actor {
                return Err(StoreError::forbidden("removal belongs to another Actor"));
            }
            let mut removal: contracts::agent::Removal = serde_json::from_str(&record)?;
            retained_mut(&mut removal)?.restored = restored;
            Ok(removal)
        })
        .transpose()
    }

    /// The owning Todo transaction coordinates Rail and Pad restoration. It must commit
    /// before any events, Touches or file guards are published.
    pub fn restore_removal_in(
        db: &rusqlite::Transaction,
        actor: &contracts::Actor,
        p: &contracts::agent::DeletionParams,
    ) -> Result<contracts::agent::Removal, StoreError> {
        use rusqlite::session::ConflictAction;
        let project: String =
            db.query_row("SELECT id FROM deliverable_project", [], |r| r.get(0))?;
        if project != p.project {
            return Err(StoreError::forbidden("removal belongs to another Project"));
        }
        let mut removal = Self::read_deletion(db, actor, &p.operation)?
            .ok_or_else(|| StoreError::not_found("Rail removal"))?;
        if retained(&removal)?.restored {
            return Ok(removal);
        }
        let boundary: String = db.query_row(
            "SELECT boundary FROM rail_deletions WHERE operation=?",
            [&p.operation],
            |r| r.get(0),
        )?;
        let current = load(db)?;
        let graph: Vec<u8> = db.query_row(
            "SELECT graph FROM rail_deletions WHERE operation=?",
            [&p.operation],
            |r| r.get(0),
        )?;
        let placement: Placement = serde_json::from_str(&boundary)?;
        let restored_ids: Vec<_> = removal
            .removed
            .iter()
            .filter(|item| matches!(item.kind, contracts::agent::RemovalKind::Agent))
            .map(|item| item.id.as_str())
            .chain(std::iter::once(retained(&removal)?.id.as_str()))
            .collect();
        {
            for node in placement
                .before
                .iter()
                .filter(|node| restored_ids.contains(&node.id.as_str()))
            {
                if let Some(blocker) = current.iter().find(|live| live.id == node.id) {
                    let removable = actor.kind != contracts::ActorKind::Agent
                        || match (AgentId::parse(&actor.id), AgentId::parse(&blocker.id)) {
                            (Some(agent), Some(id)) => in_reach(db, &current, agent, id)?,
                            _ => false,
                        };
                    return Err(
                        RpcError::undo_identity(&blocker.id, &blocker.name, removable).into(),
                    );
                }
                if let Some(parent) = &node.parent
                    && !restored_ids.contains(&parent.as_str())
                    && !current.iter().any(|live| live.id == *parent)
                {
                    let name = placement
                        .before
                        .iter()
                        .find(|n| n.id == *parent)
                        .map(|n| n.name.as_str())
                        .unwrap_or("Original Home");
                    return Err(RpcError::undo_parent(parent, name).into());
                }
            }
        }
        // The changeset already contains every trigger's graph mutation. Replaying
        // triggers would create new instruction revisions or repeat placement effects.
        let config = rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER;
        let enabled = db.db_config(config)?;
        db.set_db_config(config, false)?;
        let applied = db.apply_strm(
            &mut graph.as_slice(),
            None::<fn(&str) -> bool>,
            |kind, item| {
                // A surviving row's newer values win. Inserts never replace an occupied identity.
                if matches!(
                    kind,
                    rusqlite::session::ConflictType::SQLITE_CHANGESET_DATA
                        | rusqlite::session::ConflictType::SQLITE_CHANGESET_NOTFOUND
                ) && item
                    .op()
                    .is_ok_and(|op| op.code() == rusqlite::hooks::Action::SQLITE_UPDATE)
                {
                    ConflictAction::SQLITE_CHANGESET_OMIT
                } else {
                    ConflictAction::SQLITE_CHANGESET_ABORT
                }
            },
        );
        let reset = db.set_db_config(config, enabled);
        reset?;
        applied.map_err(|_| {
            StoreError::conflict("Can't undo this removal because retained work is unavailable. The deletion is retained; undo the later removal first.")
        })?;
        let mut affected = Vec::new();
        {
            // Restore all surviving placements before inserting retained relationships. Changeset
            // order updates are bookkeeping and cannot decide whether a user's move wins.
            for node in &current {
                db.execute(
                    "UPDATE nodes SET parent=?,ord=? WHERE id=?",
                    params![node.parent, node.order, node.id],
                )?;
            }
            let mut reconnect: Vec<_> = placement
                .before
                .iter()
                .filter(|node| {
                    restored_ids.contains(&node.id.as_str())
                        || placement
                            .after
                            .iter()
                            .find(|n| n.id == node.id)
                            .is_some_and(|after| {
                                after.parent != node.parent
                                    && current
                                        .iter()
                                        .find(|n| n.id == node.id)
                                        .is_some_and(|live| live.parent == after.parent)
                            })
                })
                .collect();
            // Following restored siblings must be in place before they anchor earlier ones.
            reconnect.sort_by_key(|node| std::cmp::Reverse(node.order));
            for node in reconnect {
                affected.push(node.parent.clone());
                if let Some(previous) = current.iter().find(|live| live.id == node.id) {
                    affected.push(previous.parent.clone());
                }
                let live = load(db)?;
                let mut ids = siblings(&live, node.parent.as_deref());
                ids.retain(|id| id != &node.id);
                let following = placement
                    .before
                    .iter()
                    .filter(|n| n.parent == node.parent && n.order > node.order)
                    .filter_map(|n| {
                        ids.iter()
                            .position(|id| id == &n.id)
                            .map(|index| (n.order, index))
                    })
                    .min_by_key(|(order, _)| *order);
                ids.insert(
                    following.map_or(ids.len(), |(_, index)| index),
                    node.id.clone(),
                );
                place(db, node.parent.as_deref(), &ids)?;
            }
        }
        let nodes = load(db)?;
        affected.sort();
        affected.dedup();
        for parent in affected {
            place(db, parent.as_deref(), &siblings(&nodes, parent.as_deref()))?;
        }
        db.execute(
            "UPDATE rail_deletions SET restored=1 WHERE operation=?",
            [&p.operation],
        )?;
        let restoration: String =
            db.query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))?;
        let deletion = retained_mut(&mut removal)?;
        deletion.restored = true;
        deletion.restoration = Some(restoration);
        db.execute(
            "UPDATE rail_deletions SET record=json_set(record,'$.deletion',json(?2)) WHERE operation=?1",
            params![p.operation,serde_json::to_string(&removal.deletion)?],
        )
        ?;
        Ok(removal)
    }
}

/// The deletion a retained removal record carries.
fn retained(
    removal: &contracts::agent::Removal,
) -> Result<&contracts::agent::Deletion, StoreError> {
    removal
        .deletion
        .as_ref()
        .ok_or_else(|| StoreError::not_found("Rail removal"))
}

fn retained_mut(
    removal: &mut contracts::agent::Removal,
) -> Result<&mut contracts::agent::Deletion, StoreError> {
    removal
        .deletion
        .as_mut()
        .ok_or_else(|| StoreError::not_found("Rail removal"))
}

/// M7: whether `id` is in Agent `agent`'s Reach, read inside the restoring transaction.
fn in_reach(
    db: &Connection,
    nodes: &[RailNode],
    agent: AgentId,
    id: AgentId,
) -> Result<bool, StoreError> {
    let agent = agent.to_string();
    let created = Rail::created_by_in(db, &agent)?;
    Ok(crate::reach::reach_of(nodes, created, &agent).contains(&id.to_string()))
}

impl Rail {
    pub(crate) fn acknowledge_restoration_in(
        db: &Connection,
        operation: &str,
    ) -> Result<(), StoreError> {
        let boundary = Self::restored_boundary(db, operation)?;
        db.execute("UPDATE rail_deletions SET record=json_set(record,'$.restoredBoundary',json(?2)) WHERE operation=?1",params![operation,serde_json::to_string(&boundary)?])?;
        Ok(())
    }

    fn restored_boundary(db: &Connection, operation: &str) -> Result<Vec<String>, StoreError> {
        // Read only retained identities. Order normalization is bookkeeping, not user placement.
        let mut result = Vec::new();
        let mut q = db
            .prepare("SELECT node FROM rail_deletions WHERE operation=?1 UNION SELECT json_extract(value,'$.id') FROM rail_deletions,json_each(record,'$.removed') WHERE operation=?1 AND json_extract(value,'$.kind')='agent'")?;
        let retained_nodes = q
            .query_map([operation], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let nodes_predicate = format!(
            "id IN ({})",
            retained_nodes
                .iter()
                .filter_map(|id| AgentId::parse(id))
                .map(|id| id.get().to_string())
                .collect::<Vec<_>>()
                .join(",")
        );
        for (table, predicate, ignored) in [
            ("nodes", nodes_predicate.as_str(), "ord"),
            (
                "todos",
                "CAST(id AS TEXT) IN (SELECT id FROM rail_removal_items WHERE operation=?1 AND kind IN ('todo-home','todo-owner') UNION SELECT value FROM todo_deletions,json_each(result,'$.deleted') WHERE operation=(SELECT id FROM rail_removal_items WHERE operation=?1 AND kind='todo-operation'))",
                "pos",
            ),
            (
                "blockers",
                "todo IN (SELECT value FROM todo_deletions,json_each(result,'$.deleted') WHERE operation=(SELECT id FROM rail_removal_items WHERE operation=?1 AND kind='todo-operation')) OR blocker IN (SELECT value FROM todo_deletions,json_each(result,'$.deleted') WHERE operation=(SELECT id FROM rail_removal_items WHERE operation=?1 AND kind='todo-operation'))",
                "",
            ),
            (
                "pads",
                "name IN (SELECT id FROM rail_removal_items WHERE operation=?1 AND kind='pad')",
                "",
            ),
            (
                "pad_sources",
                "CAST(incarnation AS TEXT) IN (SELECT incarnation FROM rail_removal_items WHERE operation=?1 AND kind='pad')",
                "",
            ),
        ] {
            let mut q = db.prepare(&format!("PRAGMA table_info({table})"))?;
            let columns = q
                .query_map([], |r| r.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?;
            let columns = columns
                .into_iter()
                .filter(|c| c != ignored && !(table == "todos" && c == "updated_at"))
                .map(|c| format!("\"{c}\""))
                .collect::<Vec<_>>()
                .join(",");
            let value: String = db.query_row(&format!("SELECT json_group_array(json_array({columns})) FROM (SELECT * FROM {table} WHERE {predicate} ORDER BY 1,2)"),[operation],|r|r.get(0))?;
            result.push(value);
        }
        Ok(result)
    }

    pub(crate) fn redo_removal<T, E: Into<StoreError>>(
        &mut self,
        actor: &contracts::Actor,
        p: &contracts::agent::RedoParams,
        apply: impl FnOnce(&rusqlite::Transaction, &mut contracts::agent::Removal) -> Result<T, E>,
    ) -> Result<(contracts::agent::Removal, Option<T>), StoreError> {
        if p.operation.is_empty() || p.operation.len() > 96 {
            return Err(StoreError::invalid("removal needs a key of 1–96 bytes"));
        }
        if let Some(previous) = Self::read_deletion(&self.db, actor, &p.operation)? {
            let request:(Option<String>,Option<String>)=self.db.query_row("SELECT json_extract(record,'$.source'),json_extract(record,'$.sourceRestoration') FROM rail_deletions WHERE operation=?",[&p.operation],|r|Ok((r.get(0)?,r.get(1)?)))?;
            if request != (Some(p.source.clone()), Some(p.restoration.clone()))
                || retained(&previous)?.project != p.project
            {
                return Err(StoreError::conflict("Redo key names another operation"));
            }
            return Ok((previous, None));
        }
        let mut removal = Self::read_deletion(&self.db, actor, &p.source)?
            .ok_or_else(|| StoreError::not_found("Rail removal"))?;
        let source = retained(&removal)?;
        if source.project != p.project {
            return Err(StoreError::forbidden("removal belongs to another Project"));
        }
        if !source.restored || source.restoration.as_deref() != Some(&p.restoration) {
            return Err(StoreError::conflict(
                "Redo requires the acknowledged Rail restoration",
            ));
        }
        let id = source.id.clone();
        removal.deletion = None;
        let tree = load(&self.db)?;
        let mut selected: Vec<_> = removal
            .removed
            .iter()
            .filter(|i| i.kind == contracts::agent::RemovalKind::Agent)
            .map(|i| i.id.clone())
            .collect();
        selected.push(id.clone());
        // Promote only surviving direct children of removed nodes. A newer move elsewhere wins.
        removal
            .kept
            .retain(|item| item.kind != contracts::agent::RemovalKind::Agent);
        for node in &tree {
            if node
                .parent
                .as_ref()
                .is_some_and(|parent| selected.contains(parent))
                && !selected.contains(&node.id)
            {
                removal.kept.push(contracts::agent::KeptItem {
                    id: node.id.clone(),
                    kind: contracts::agent::RemovalKind::Agent,
                    name: node.name.clone(),
                    reason: contracts::agent::KeptReason::Running,
                });
            }
        }
        let out = self.remove_workstream(agent_id(&id)?, &mut removal, Some((actor,&p.operation)), |db,removal| -> Result<_, StoreError> {
            let (expected,successor):(Option<String>,Option<String>) = db.query_row("SELECT json_extract(record,'$.restoredBoundary'),json_extract(record,'$.redo') FROM rail_deletions WHERE operation=?",[&p.source],|r|Ok((r.get(0)?,r.get(1)?)))?;
            let current = serde_json::to_string(&Self::restored_boundary(db,&p.source)?)?;
            if successor.is_some() || expected.as_deref()!=Some(current.as_str()) {
                return Err(StoreError::conflict("Can't redo: retained work changed, moved or was replaced. Restore its previous values and placement before retrying; the operation is retained."));
            }
            let out = apply(db,removal).map_err(Into::<StoreError>::into)?;
            db.execute("UPDATE rail_deletions SET record=json_set(record,'$.redo',?2) WHERE operation=?1",params![p.source,p.operation])?;
            Ok(out)
        })?;
        Ok((removal, Some(out)))
    }
}
