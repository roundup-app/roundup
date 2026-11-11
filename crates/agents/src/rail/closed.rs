//! Reservation and publication of imported conversations.
use super::*;

impl Rail {
    /// Reserve both identities in one transaction. Until publication, ordinary Rail reads and
    /// mutations cannot address them. A second preparer must await/reconcile the first one.
    pub(crate) fn reserve_closed(
        &mut self,
        source: &str,
        title: &str,
    ) -> Result<(String, String), StoreError> {
        self.closed_recovery_ready(None)?;
        let tx = self.db.transaction()?;
        if tx
            .query_row(
                "SELECT 1 FROM closed_sources WHERE source=?",
                [source],
                |_| Ok(()),
            )
            .optional()?
            .is_some()
        {
            return Err(StoreError::conflict("source already reserved or imported"));
        }
        // Insert source and nodes in the same transaction: even interruption between writes
        // cannot expose an untracked node or lose a reserved identity.
        tx.execute(
            "INSERT INTO nodes(kind,name,ord,work) VALUES('workstream',?,0,?)",
            params![title, serde_json::to_string(&workstream_order())?],
        )?;
        let workstream = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent',?,?,0)",
            params![title, workstream],
        )?;
        let agent = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO closed_sources(source,workstream,agent) VALUES(?,?,?)",
            params![source, workstream, agent],
        )?;
        tx.commit()?;
        Ok((workstream.to_string(), agent.to_string()))
    }

    pub(crate) fn closed_source(
        &self,
        source: &str,
    ) -> Result<Option<(String, String, bool)>, StoreError> {
        Ok(self
            .db
            .query_row(
                "SELECT workstream,agent,published FROM closed_sources WHERE source=?",
                [source],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?.to_string(),
                        row.get::<_, i64>(1)?.to_string(),
                        row.get(2)?,
                    ))
                },
            )
            .optional()?)
    }

    /// U2875a: whether a roundup Agent already holds this vendor conversation, or an earlier
    /// import of it was recorded (removal keeps the record).
    pub(crate) fn represents_source(&self, source: &str) -> Result<bool, StoreError> {
        Ok(self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM closed_sources WHERE source=?1)
                    OR EXISTS(SELECT 1 FROM nodes WHERE conversation_id=?1)",
            [source],
            |row| row.get(0),
        )?)
    }

    pub(crate) fn closed_copy(&mut self, source: &str, copy: &[u8]) -> Result<(), StoreError> {
        let changed = self.db.execute(
            "UPDATE closed_sources SET copy=? WHERE source=? AND published=0 AND copy IS NULL",
            params![copy, source],
        )?;
        if changed != 1 {
            return Err(StoreError::conflict(
                "source is no longer preparing a continuation",
            ));
        }
        Ok(())
    }

    /// The only visibility transition. Continuation and Worktree readiness enter the same
    /// commit as the source tombstone. Ownership proofs remain until post-commit release.
    pub(crate) fn publish_closed(&mut self, source: &str) -> Result<(), StoreError> {
        let tx = self.db.transaction()?;
        let (workstream, agent, published): (i64, i64, bool) = tx.query_row(
            "SELECT workstream,agent,published FROM closed_sources WHERE source=?",
            [source],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        if published {
            return Ok(());
        }
        let complete: bool = tx.query_row(
            "SELECT conversation_id IS NOT NULL AND conversation_cwd IS NOT NULL
                AND attempt=0 AND terminal_id IS NULL
                AND (worktree_path IS NULL OR worktree_state='ready')
                AND EXISTS (SELECT 1 FROM closed_sources WHERE source=?2 AND copy IS NOT NULL AND refusal IS NULL)
             FROM nodes WHERE id=?1", params![agent,source], |r|r.get(0)
        )?;
        if !complete {
            return Err(StoreError::conflict(
                "closed Agent continuation or Worktree is not ready",
            ));
        }
        let order: i64 = tx.query_row("SELECT count(*) FROM nodes WHERE parent IS NULL AND NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0 AND workstream=nodes.id)",[],|r|r.get(0))?;
        tx.execute(
            "UPDATE nodes SET ord=? WHERE id=?",
            params![order, workstream],
        )?;
        tx.execute(
            "UPDATE closed_sources SET published=1,refusal=NULL WHERE source=?",
            [source],
        )?;
        Ok(tx.commit()?)
    }

    pub(crate) fn closed_copies(&self) -> Result<Vec<(String, Vec<u8>)>, StoreError> {
        Ok(self
            .db
            .prepare(
                "SELECT source,copy FROM closed_sources WHERE published=1 AND copy IS NOT NULL",
            )?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?)
    }

    pub(crate) fn release_closed_copy(&mut self, source: &str) -> Result<(), StoreError> {
        self.db.execute(
            "UPDATE closed_sources SET copy=NULL WHERE source=? AND published=1",
            [source],
        )?;
        Ok(())
    }

    pub(crate) fn unfinished_closed(&self) -> Result<Vec<ClosedPreparation>, StoreError> {
        Ok(self
            .db
            .prepare("SELECT source,agent,copy FROM closed_sources WHERE published=0")?
            .query_map([], |r| {
                Ok(ClosedPreparation {
                    source: r.get(0)?,
                    agent: r.get::<_, i64>(1)?.to_string(),
                    copy: r.get(2)?,
                })
            })?
            .collect::<Result<_, _>>()?)
    }

    pub(crate) fn forget_closed(&mut self, source: &str) -> Result<(), RpcError> {
        Ok(self.forget_closed_rows(source)?)
    }

    fn forget_closed_rows(&mut self, source: &str) -> Result<(), StoreError> {
        let tx = self.db.transaction()?;
        tx.execute("DELETE FROM nodes WHERE id IN (SELECT agent FROM closed_sources WHERE source=? AND published=0)",[source])?;
        tx.execute("DELETE FROM nodes WHERE id IN (SELECT workstream FROM closed_sources WHERE source=? AND published=0)",[source])?;
        tx.execute(
            "DELETE FROM closed_sources WHERE source=? AND published=0",
            [source],
        )?;
        Ok(tx.commit()?)
    }

    pub(crate) fn refuse_closed(&mut self, source: &str, cause: &str) -> Result<(), StoreError> {
        self.db.execute(
            "UPDATE closed_sources SET refusal=? WHERE source=? AND published=0",
            params![cause, source],
        )?;
        Ok(())
    }

    pub(crate) fn closed_recovery_ready(
        &self,
        preparing: Option<AgentId>,
    ) -> Result<(), StoreError> {
        let cause: Option<String> = self
            .db
            .query_row(
                "SELECT refusal FROM closed_sources WHERE refusal IS NOT NULL LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(cause) = cause {
            return Err(StoreError::conflict(format!(
                "closed publication recovery refused: {cause}"
            )));
        }
        let pending: Option<String> = self.db.query_row(
            "SELECT source FROM closed_sources WHERE published=0 AND (?1 IS NULL OR agent!=?1) LIMIT 1",
            [preparing.map(AgentId::get)], |row|row.get(0)
        ).optional()?;
        if pending.is_some() {
            return Err(StoreError::conflict(
                "closed publication is pending reconciliation",
            ));
        }
        Ok(())
    }
}
