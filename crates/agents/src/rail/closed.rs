//! Reservation and publication of imported conversations.
use super::*;

impl Rail {
    /// Reserve both identities in one transaction. Until publication, ordinary Rail reads and
    /// mutations cannot address them. A second preparer must await/reconcile the first one.
    pub(crate) fn reserve_closed(
        &mut self,
        source: &str,
        title: &str,
    ) -> Result<(String, String), RpcError> {
        self.closed_recovery_ready(None)?;
        let tx = self.db.transaction().map_err(sql)?;
        if tx
            .query_row(
                "SELECT 1 FROM closed_sources WHERE source=?",
                [source],
                |_| Ok(()),
            )
            .optional()
            .map_err(sql)?
            .is_some()
        {
            return Err(RpcError::conflict("source already reserved or imported"));
        }
        // Insert source and nodes in the same transaction: even interruption between writes
        // cannot expose an untracked node or lose a reserved identity.
        tx.execute(
            "INSERT INTO nodes(kind,name,ord,work) VALUES('workstream',?,0,?)",
            params![
                title,
                serde_json::to_string(&workstream_order()).map_err(RpcError::internal)?
            ],
        )
        .map_err(sql)?;
        let workstream = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO nodes(kind,name,parent,ord) VALUES('agent',?,?,0)",
            params![title, workstream],
        )
        .map_err(sql)?;
        let agent = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO closed_sources(source,workstream,agent) VALUES(?,?,?)",
            params![source, workstream, agent],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)?;
        Ok((workstream.to_string(), agent.to_string()))
    }

    pub(crate) fn closed_source(
        &self,
        source: &str,
    ) -> Result<Option<(String, String, bool)>, RpcError> {
        self.db
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
            .optional()
            .map_err(sql)
    }

    /// U2875a: whether a roundup Agent already holds this vendor conversation, or an earlier
    /// import of it was recorded (removal keeps the record).
    pub(crate) fn represents_source(&self, source: &str) -> Result<bool, RpcError> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM closed_sources WHERE source=?1)
                    OR EXISTS(SELECT 1 FROM nodes WHERE conversation_id=?1)",
                [source],
                |row| row.get(0),
            )
            .map_err(sql)
    }

    pub(crate) fn closed_copy(&mut self, source: &str, copy: &[u8]) -> Result<(), RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE closed_sources SET copy=? WHERE source=? AND published=0 AND copy IS NULL",
                params![copy, source],
            )
            .map_err(sql)?;
        if changed != 1 {
            return Err(RpcError::conflict(
                "source is no longer preparing a continuation",
            ));
        }
        Ok(())
    }

    /// The only visibility transition. Continuation and Worktree readiness enter the same
    /// commit as the source tombstone. Ownership proofs remain until post-commit release.
    pub(crate) fn publish_closed(&mut self, source: &str) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        let (workstream, agent, published): (i64, i64, bool) = tx
            .query_row(
                "SELECT workstream,agent,published FROM closed_sources WHERE source=?",
                [source],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(sql)?;
        if published {
            return Ok(());
        }
        let complete: bool = tx.query_row(
            "SELECT conversation_id IS NOT NULL AND conversation_cwd IS NOT NULL
                AND attempt=0 AND terminal_id IS NULL
                AND (worktree_path IS NULL OR worktree_state='ready')
                AND EXISTS (SELECT 1 FROM closed_sources WHERE source=?2 AND copy IS NOT NULL AND refusal IS NULL)
             FROM nodes WHERE id=?1", params![agent,source], |r|r.get(0)
        ).map_err(sql)?;
        if !complete {
            return Err(RpcError::conflict(
                "closed Agent continuation or Worktree is not ready",
            ));
        }
        let order: i64 = tx.query_row("SELECT count(*) FROM nodes WHERE parent IS NULL AND NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0 AND workstream=nodes.id)",[],|r|r.get(0)).map_err(sql)?;
        tx.execute(
            "UPDATE nodes SET ord=? WHERE id=?",
            params![order, workstream],
        )
        .map_err(sql)?;
        tx.execute(
            "UPDATE closed_sources SET published=1,refusal=NULL WHERE source=?",
            [source],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    pub(crate) fn closed_copies(&self) -> Result<Vec<(String, Vec<u8>)>, RpcError> {
        self.db
            .prepare(
                "SELECT source,copy FROM closed_sources WHERE published=1 AND copy IS NOT NULL",
            )
            .map_err(sql)?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(sql)?
            .collect::<Result<_, _>>()
            .map_err(sql)
    }

    pub(crate) fn release_closed_copy(&mut self, source: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE closed_sources SET copy=NULL WHERE source=? AND published=1",
                [source],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub(crate) fn unfinished_closed(&self) -> Result<Vec<ClosedPreparation>, RpcError> {
        self.db
            .prepare("SELECT source,agent,copy FROM closed_sources WHERE published=0")
            .map_err(sql)?
            .query_map([], |r| {
                Ok(ClosedPreparation {
                    source: r.get(0)?,
                    agent: r.get::<_, i64>(1)?.to_string(),
                    copy: r.get(2)?,
                })
            })
            .map_err(sql)?
            .collect::<Result<_, _>>()
            .map_err(sql)
    }

    pub(crate) fn forget_closed(&mut self, source: &str) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        tx.execute("DELETE FROM nodes WHERE id IN (SELECT agent FROM closed_sources WHERE source=? AND published=0)",[source]).map_err(sql)?;
        tx.execute("DELETE FROM nodes WHERE id IN (SELECT workstream FROM closed_sources WHERE source=? AND published=0)",[source]).map_err(sql)?;
        tx.execute(
            "DELETE FROM closed_sources WHERE source=? AND published=0",
            [source],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)
    }

    pub(crate) fn refuse_closed(&mut self, source: &str, cause: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE closed_sources SET refusal=? WHERE source=? AND published=0",
                params![cause, source],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub(crate) fn closed_recovery_ready(&self, preparing: Option<&str>) -> Result<(), RpcError> {
        let cause: Option<String> = self
            .db
            .query_row(
                "SELECT refusal FROM closed_sources WHERE refusal IS NOT NULL LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(sql)?;
        if let Some(cause) = cause {
            return Err(RpcError::conflict(format!(
                "closed publication recovery refused: {cause}"
            )));
        }
        let pending: Option<String> = self.db.query_row(
            "SELECT source FROM closed_sources WHERE published=0 AND (?1 IS NULL OR CAST(agent AS TEXT)!=?1) LIMIT 1",
            [preparing], |row|row.get(0)
        ).optional().map_err(sql)?;
        if pending.is_some() {
            return Err(RpcError::conflict(
                "closed publication is pending reconciliation",
            ));
        }
        Ok(())
    }
}
