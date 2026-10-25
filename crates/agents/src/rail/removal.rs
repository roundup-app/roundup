//! Transactional Rail removal.
use super::*;

impl Rail {
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
                "measurement_owners",
                "measurement_revisions",
                "measurement_erased",
                "deliverables",
                "workstream_queue",
            ] {
                graph.attach(Some(table)).map_err(sql)?;
            }
            Some(graph)
        } else {
            None
        };
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
            });
            tx.execute("INSERT INTO rail_deletions(operation,actor,node,record,graph,boundary) VALUES(?,?,?,?,?,?)", params![
            operation, serde_json::to_string(actor).map_err(RpcError::internal)?, id,
            serde_json::to_string(&removal).map_err(RpcError::internal)?, inverse, Self::removal_boundary(&tx)?
        ]).map_err(sql)?;
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
        if boundary != Self::removal_boundary(db)? {
            return Err(RpcError::conflict(
                "Rail placement changed; resolve the conflict and retry",
            ));
        }
        let graph: Vec<u8> = db
            .query_row(
                "SELECT graph FROM rail_deletions WHERE operation=?",
                [&p.operation],
                |r| r.get(0),
            )
            .map_err(sql)?;
        // The changeset already contains every trigger's graph mutation. Replaying
        // triggers would create new instruction revisions or repeat placement effects.
        let config = rusqlite::config::DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER;
        let enabled = db.db_config(config).map_err(sql)?;
        db.set_db_config(config, false).map_err(sql)?;
        let applied = db.apply_strm(&mut graph.as_slice(), None::<fn(&str) -> bool>, |_, _| {
            ConflictAction::SQLITE_CHANGESET_ABORT
        });
        let reset = db.set_db_config(config, enabled);
        reset.map_err(sql)?;
        applied.map_err(|e| {
            RpcError::conflict(format!(
                "Rail graph changed; resolve the conflict and retry: {e}"
            ))
        })?;
        db.execute("UPDATE measurement_state SET revision=revision+1", [])
            .map_err(sql)?;
        db.execute(
            "UPDATE rail_deletions SET restored=1 WHERE operation=?",
            [&p.operation],
        )
        .map_err(sql)?;
        removal
            .deletion
            .as_mut()
            .expect("retained operation")
            .restored = true;
        Ok(removal)
    }
    fn removal_boundary(db: &Connection) -> Result<String, RpcError> {
        db.query_row("SELECT json_group_array(json_array(id,parent,ord)) FROM (SELECT id,parent,ord FROM nodes ORDER BY id)",[],|r|r.get(0)).map_err(sql)
    }
}
