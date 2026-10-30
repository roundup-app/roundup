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

impl Placement {
    // Old receipts already contain the original row values in their inverse changeset.
    // Decode them with SQLite's iterator, so their unrelated placements get the same repair.
    fn read(boundary: &str, graph: &[u8], current: &[RailNode]) -> Result<Self, RpcError> {
        use rusqlite::{
            fallible_streaming_iterator::FallibleStreamingIterator, session::ChangesetIter,
            types::ValueRef,
        };
        if let Ok(placement) = serde_json::from_str::<Self>(boundary) {
            return Ok(placement);
        }
        let rows: Vec<(serde_json::Value, Option<serde_json::Value>, u32)> =
            serde_json::from_str(boundary).map_err(RpcError::internal)?;
        let id_text = |id: serde_json::Value| {
            id.as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| id.to_string())
        };
        let after: Vec<_> = rows
            .into_iter()
            .map(|(id, parent, order)| {
                let id = id_text(id);
                let name = current
                    .iter()
                    .find(|n| n.id == id)
                    .map(|n| n.name.clone())
                    .unwrap_or_default();
                Position {
                    id,
                    parent: parent.map(id_text),
                    order,
                    name,
                }
            })
            .collect();
        let mut before = after.clone();
        let mut input = graph;
        let input: &mut dyn std::io::Read = &mut input;
        let mut changes = ChangesetIter::start_strm(&input).map_err(sql)?;
        while let Some(item) = changes.next().map_err(sql)? {
            let op = item.op().map_err(sql)?;
            if op.table_name() != "nodes" {
                continue;
            }
            let insert = op.code() == rusqlite::hooks::Action::SQLITE_INSERT;
            if !insert && op.code() != rusqlite::hooks::Action::SQLITE_UPDATE {
                continue;
            }
            let id = if insert {
                item.new_value(0)
            } else {
                item.old_value(0)
            }
            .map_err(sql)?
            .as_i64()
            .map_err(RpcError::internal)?
            .to_string();
            if insert {
                before.push(Position {
                    id: id.clone(),
                    name: item
                        .new_value(2)
                        .map_err(sql)?
                        .as_str()
                        .map_err(RpcError::internal)?
                        .into(),
                    parent: None,
                    order: 0,
                });
            }
            let node = before
                .iter_mut()
                .find(|n| n.id == id)
                .ok_or_else(|| RpcError::internal("retained placement missing"))?;
            match item.new_value(3) {
                Ok(ValueRef::Null) => node.parent = None,
                Ok(value) => {
                    node.parent = Some(value.as_i64().map_err(RpcError::internal)?.to_string())
                }
                Err(rusqlite::Error::InvalidColumnIndex(_)) if !insert => {}
                Err(error) => return Err(sql(error)),
            }
            match item.new_value(4) {
                Ok(value) => {
                    node.order = u32::try_from(value.as_i64().map_err(RpcError::internal)?)
                        .map_err(RpcError::internal)?
                }
                Err(rusqlite::Error::InvalidColumnIndex(_)) if !insert => {}
                Err(error) => return Err(sql(error)),
            }
        }
        Ok(Self { before, after })
    }
}

impl Rail {
    pub(super) fn prepare_placements(db: &Connection) -> Result<(), RpcError> {
        let mut query = db.prepare("SELECT operation,boundary,graph FROM rail_deletions WHERE restored=0 AND json_type(boundary)='array'").map_err(sql)?;
        let rows = query
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                ))
            })
            .map_err(sql)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql)?;
        let current = load(db)?;
        for (operation, boundary, graph) in rows {
            let placement = Placement::read(&boundary, &graph, &current)?;
            db.execute(
                "UPDATE rail_deletions SET boundary=? WHERE operation=?",
                params![
                    serde_json::to_string(&placement).map_err(RpcError::internal)?,
                    operation
                ],
            )
            .map_err(sql)?;
        }
        Ok(())
    }

    /// Delete `id`. Its children (a Workstream or an Agent may have any) move to its own
    /// parent, at its place, in order, first; one transaction, so a failed delete leaves them
    /// still under `id`.
    pub fn remove(&mut self, id: &str) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        let nodes = load(&tx)?;
        let node = find(&nodes, id)?;
        let parent = node.parent.as_deref();
        let mut ids = siblings(&nodes, parent);
        let at = ids
            .iter()
            .position(|sibling| sibling == id)
            .expect("id is among its own parent's siblings");
        let children = siblings(&nodes, Some(id));
        ids.splice(at..=at, children);
        // Reparent before deleting: a child's row still points at `id` until `place` runs, and a
        // delete while one does would fail its foreign key.
        place(&tx, parent, &ids)?;
        tx.execute("DELETE FROM nodes WHERE id = ?", params![id])
            .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    /// A34: Rail, Todo, Pad and Touch rows share one transaction. The callback stages the
    /// external files and Worktrees before any node leaves; its returned guard survives commit.
    pub fn remove_workstream<T>(
        &mut self,
        id: &str,
        removal: &mut contracts::agent::Removal,
        retain: Option<(&contracts::Actor, &str)>,
        apply: impl FnOnce(&Connection, &mut contracts::agent::Removal) -> Result<T, RpcError>,
    ) -> Result<T, RpcError> {
        use rusqlite::session::{Session, invert_strm};
        self.db
            .pragma_update(None, "foreign_keys", true)
            .map_err(sql)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql)?;
        let mut graph = if retain.is_some() {
            let mut graph = Session::new(&tx).map_err(sql)?;
            for table in [
                "nodes",
                "instruction_homes",
                "deliverables",
                "workstream_queue",
            ] {
                graph.attach(Some(table)).map_err(sql)?;
            }
            Some(graph)
        } else {
            None
        };
        let before = load(&tx)?;
        let out = apply(&tx, removal)?;
        Self::remove_graph(&tx, id, removal)?;
        if let Some((actor, operation)) = retain {
            let mut graph = graph.take().expect("retained graph");
            // Queue reads prune missing nodes; retain that change before any reader can do so.
            tx.execute("DELETE FROM workstream_queue WHERE workstream=?", [id])
                .map_err(sql)?;
            let mut forward = Vec::new();
            graph.changeset_strm(&mut forward).map_err(sql)?;
            let mut inverse = Vec::new();
            invert_strm(&mut forward.as_slice(), &mut inverse).map_err(sql)?;
            drop(graph);
            let project: String = tx
                .query_row("SELECT id FROM deliverable_project", [], |r| r.get(0))
                .map_err(sql)?;
            removal.deletion = Some(contracts::agent::Deletion {
                project,
                operation: operation.into(),
                id: id.into(),
                restored: false,
                restoration: None,
            });
            tx.execute("INSERT INTO rail_deletions(operation,actor,node,record,graph,boundary) VALUES(?,?,?,?,?,?)", params![
            operation, serde_json::to_string(actor).map_err(RpcError::internal)?, id,
            serde_json::to_string(&removal).map_err(RpcError::internal)?, inverse, serde_json::to_string(&Placement { before: before.into_iter().map(Position::from).collect(), after: load(&tx)?.into_iter().map(Position::from).collect() }).map_err(RpcError::internal)?
        ]).map_err(sql)?;
        }
        if let Some((_, operation)) = retain {
            tx.execute("UPDATE rail_deletions SET record=json_set(record,'$.source',(SELECT operation FROM rail_deletions WHERE json_extract(record,'$.redo')=?1),'$.sourceRestoration',(SELECT json_extract(record,'$.deletion.restoration') FROM rail_deletions WHERE json_extract(record,'$.redo')=?1)) WHERE operation=?1 AND EXISTS(SELECT 1 FROM rail_deletions WHERE json_extract(record,'$.redo')=?1)",[operation]).map_err(sql)?;
        }
        drop(graph);
        tx.commit().map_err(sql)?;
        Ok(out)
    }

    fn remove_graph(
        db: &Connection,
        id: &str,
        removal: &contracts::agent::Removal,
    ) -> Result<(), RpcError> {
        let nodes = load(db)?;
        let node = find(&nodes, id)?;
        let mut ids = siblings(&nodes, node.parent.as_deref());
        let at = ids
            .iter()
            .position(|s| s == id)
            .expect("Workstream is a sibling");
        ids.splice(
            at..=at,
            removal
                .kept
                .iter()
                .filter(|i| i.kind == contracts::agent::RemovalKind::Agent)
                .map(|i| i.id.clone()),
        );
        place(db, node.parent.as_deref(), &ids)?;
        for item in removal.removed.iter().rev() {
            if item.kind == contracts::agent::RemovalKind::Agent {
                db.execute("DELETE FROM nodes WHERE id = ?", [&item.id])
                    .map_err(sql)?;
            }
        }
        db.execute("DELETE FROM nodes WHERE id = ?", [id])
            .map_err(sql)?;
        Ok(())
    }

    pub(crate) fn deletion(
        &self,
        actor: &contracts::Actor,
        operation: &str,
    ) -> Result<Option<contracts::agent::Removal>, RpcError> {
        Self::read_deletion(&self.db, actor, operation)
    }

    fn read_deletion(
        db: &Connection,
        actor: &contracts::Actor,
        operation: &str,
    ) -> Result<Option<contracts::agent::Removal>, RpcError> {
        let row: Option<(String, String, bool)> = db
            .query_row(
                "SELECT actor, record, restored FROM rail_deletions WHERE operation=?",
                [operation],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(sql)?;
        row.map(|(author, record, restored)| {
            if serde_json::from_str::<contracts::Actor>(&author).map_err(RpcError::internal)?
                != *actor
            {
                return Err(RpcError::forbidden("removal belongs to another Actor"));
            }
            let mut removal: contracts::agent::Removal =
                serde_json::from_str(&record).map_err(RpcError::internal)?;
            removal
                .deletion
                .as_mut()
                .expect("retained operation")
                .restored = restored;
            Ok(removal)
        })
        .transpose()
    }

    /// The owning Todo transaction coordinates Rail and Pad restoration. It must commit
    /// before any events, Touches or file guards are published.
    pub fn restore_removal_in(
        db: &Connection,
        actor: &contracts::Actor,
        p: &contracts::agent::DeletionParams,
    ) -> Result<contracts::agent::Removal, RpcError> {
        use rusqlite::session::ConflictAction;
        if db.is_autocommit() {
            return Err(RpcError::internal(
                "Rail restoration requires a transaction",
            ));
        }
        let project: String = db
            .query_row("SELECT id FROM deliverable_project", [], |r| r.get(0))
            .map_err(sql)?;
        if project != p.project {
            return Err(RpcError::forbidden("removal belongs to another Project"));
        }
        let mut removal = Self::read_deletion(db, actor, &p.operation)?
            .ok_or_else(|| RpcError::not_found("Rail removal"))?;
        if removal
            .deletion
            .as_ref()
            .expect("retained operation")
            .restored
        {
            return Ok(removal);
        }
        let boundary: String = db
            .query_row(
                "SELECT boundary FROM rail_deletions WHERE operation=?",
                [&p.operation],
                |r| r.get(0),
            )
            .map_err(sql)?;
        let current = load(db)?;
        let graph: Vec<u8> = db
            .query_row(
                "SELECT graph FROM rail_deletions WHERE operation=?",
                [&p.operation],
                |r| r.get(0),
            )
            .map_err(sql)?;
        let placement = Placement::read(&boundary, &graph, &current)?;
        let restored_ids: Vec<_> = removal
            .removed
            .iter()
            .filter(|item| matches!(item.kind, contracts::agent::RemovalKind::Agent))
            .map(|item| item.id.as_str())
            .chain(std::iter::once(
                removal
                    .deletion
                    .as_ref()
                    .expect("retained operation")
                    .id
                    .as_str(),
            ))
            .collect();
        {
            for node in placement
                .before
                .iter()
                .filter(|node| restored_ids.contains(&node.id.as_str()))
            {
                if let Some(blocker) = current.iter().find(|live| live.id == node.id) {
                    let removable = actor.kind != contracts::ActorKind::Agent
                        || in_reach(db, &current, &actor.id, &blocker.id)?;
                    return Err(RpcError::undo_identity(
                        &blocker.id,
                        &blocker.name,
                        removable,
                    ));
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
                    return Err(RpcError::undo_parent(parent, name));
                }
            }
        }
        // The changeset already contains every trigger's graph mutation. Replaying
        // triggers would create new instruction revisions or repeat placement effects.
        let config = rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER;
        let enabled = db.db_config(config).map_err(sql)?;
        db.set_db_config(config, false).map_err(sql)?;
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
        reset.map_err(sql)?;
        applied.map_err(|_| {
            RpcError::conflict("Can't undo this removal because retained work is unavailable. The deletion is retained; undo the later removal first.")
        })?;
        let mut affected = Vec::new();
        {
            // Restore all surviving placements before inserting retained relationships. Changeset
            // order updates are bookkeeping and cannot decide whether a user's move wins.
            for node in &current {
                db.execute(
                    "UPDATE nodes SET parent=?,ord=? WHERE id=?",
                    params![node.parent, node.order, node.id],
                )
                .map_err(sql)?;
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
            reconnect.sort_by_key(|node| node.order);
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
        )
        .map_err(sql)?;
        let restoration: String = db
            .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
            .map_err(sql)?;
        let deletion = removal.deletion.as_mut().expect("retained operation");
        deletion.restored = true;
        deletion.restoration = Some(restoration);
        db.execute(
            "UPDATE rail_deletions SET record=json_set(record,'$.deletion',json(?2)) WHERE operation=?1",
            params![p.operation,serde_json::to_string(&removal.deletion).map_err(RpcError::internal)?],
        )
        .map_err(sql)?;
        Ok(removal)
    }
}

/// M7: whether `id` is in Agent `agent`'s Reach, read inside the restoring transaction.
fn in_reach(db: &Connection, nodes: &[RailNode], agent: &str, id: &str) -> Result<bool, RpcError> {
    let created = Rail::created_by_in(db, agent)?;
    Ok(crate::reach::reach_of(nodes, created, agent).contains(id))
}

impl Rail {
    pub(crate) fn acknowledge_restoration_in(
        db: &Connection,
        operation: &str,
    ) -> Result<(), RpcError> {
        let boundary = Self::restored_boundary(db, operation)?;
        db.execute("UPDATE rail_deletions SET record=json_set(record,'$.restoredBoundary',json(?2)) WHERE operation=?1",params![operation,serde_json::to_string(&boundary).map_err(RpcError::internal)?]).map_err(sql)?;
        Ok(())
    }

    fn restored_boundary(db: &Connection, operation: &str) -> Result<Vec<String>, RpcError> {
        // Read only retained identities. Order normalization is bookkeeping, not user placement.
        let mut result = Vec::new();
        for (table, predicate, ignored) in [
            (
                "nodes",
                "CAST(id AS TEXT) IN (SELECT node FROM rail_deletions WHERE operation=?1 UNION SELECT json_extract(value,'$.id') FROM rail_deletions,json_each(record,'$.removed') WHERE operation=?1 AND json_extract(value,'$.kind')='agent')",
                "ord",
            ),
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
            let mut q = db
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(sql)?;
            let columns = q
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(sql)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(sql)?;
            let columns = columns
                .into_iter()
                .filter(|c| c != ignored && !(table == "todos" && c == "updated_at"))
                .map(|c| format!("\"{c}\""))
                .collect::<Vec<_>>()
                .join(",");
            let value: String = db.query_row(&format!("SELECT json_group_array(json_array({columns})) FROM (SELECT * FROM {table} WHERE {predicate} ORDER BY 1,2)"),[operation],|r|r.get(0)).map_err(sql)?;
            result.push(value);
        }
        Ok(result)
    }

    pub(crate) fn redo_removal<T>(
        &mut self,
        actor: &contracts::Actor,
        p: &contracts::agent::RedoParams,
        apply: impl FnOnce(&Connection, &mut contracts::agent::Removal) -> Result<T, RpcError>,
    ) -> Result<(contracts::agent::Removal, Option<T>), RpcError> {
        if p.operation.is_empty() || p.operation.len() > 96 {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "removal needs a key of 1–96 bytes",
            ));
        }
        if let Some(previous) = Self::read_deletion(&self.db, actor, &p.operation)? {
            let request:(Option<String>,Option<String>)=self.db.query_row("SELECT json_extract(record,'$.source'),json_extract(record,'$.sourceRestoration') FROM rail_deletions WHERE operation=?",[&p.operation],|r|Ok((r.get(0)?,r.get(1)?))).map_err(sql)?;
            if request != (Some(p.source.clone()), Some(p.restoration.clone()))
                || previous
                    .deletion
                    .as_ref()
                    .expect("retained operation")
                    .project
                    != p.project
            {
                return Err(RpcError::conflict("Redo key names another operation"));
            }
            return Ok((previous, None));
        }
        let mut removal = Self::read_deletion(&self.db, actor, &p.source)?
            .ok_or_else(|| RpcError::not_found("Rail removal"))?;
        let source = removal.deletion.as_ref().expect("retained operation");
        if source.project != p.project {
            return Err(RpcError::forbidden("removal belongs to another Project"));
        }
        if !source.restored || source.restoration.as_deref() != Some(&p.restoration) {
            return Err(RpcError::conflict(
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
        let out = self.remove_workstream(&id, &mut removal, Some((actor,&p.operation)), |db,removal| {
            let (expected,successor):(Option<String>,Option<String>) = db.query_row("SELECT json_extract(record,'$.restoredBoundary'),json_extract(record,'$.redo') FROM rail_deletions WHERE operation=?",[&p.source],|r|Ok((r.get(0)?,r.get(1)?))).map_err(sql)?;
            let current = serde_json::to_string(&Self::restored_boundary(db,&p.source)?).map_err(RpcError::internal)?;
            if successor.is_some() || expected.as_deref()!=Some(current.as_str()) {
                return Err(RpcError::conflict("Can't redo: retained work changed, moved or was replaced. Restore its previous values and placement before retrying; the operation is retained."));
            }
            let out = apply(db,removal)?;
            db.execute("UPDATE rail_deletions SET record=json_set(record,'$.redo',?2) WHERE operation=?1",params![p.source,p.operation]).map_err(sql)?;
            Ok(out)
        })?;
        Ok((removal, Some(out)))
    }
}
