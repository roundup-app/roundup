//! A3195, A3197: the Project's Workstream cap and Queue, stored in the Rail's database.
use super::*;
use contracts::workstream::{QueueEntry, QueueFailure, StartChoice};

impl Rail {
    /// `None` is no cap, as for a Project that never set it.
    pub fn get_workstream_cap(&self) -> Result<Option<u32>, RpcError> {
        self.db
            .query_row(
                "SELECT workstream_cap FROM settings WHERE id = 0",
                [],
                |row| row.get::<_, Option<u32>>(0),
            )
            .optional()
            .map_err(sql)
            .map(Option::flatten)
    }

    pub fn set_workstream_cap(&mut self, cap: Option<u32>) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO settings (id, workstream_cap) VALUES (0, ?)
                 ON CONFLICT (id) DO UPDATE SET workstream_cap = excluded.workstream_cap",
                params![cap],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// The entries in Queue order. An entry whose Workstream left the Rail goes first.
    pub fn queue_entries(&mut self) -> Result<Vec<QueueEntry>, RpcError> {
        self.db
            .execute(
                "DELETE FROM workstream_queue WHERE workstream NOT IN (SELECT id FROM nodes)",
                [],
            )
            .map_err(sql)?;
        self.db
            .prepare(
                "SELECT workstream, after_todo, failure_code, failure_message
                 FROM workstream_queue ORDER BY ord",
            )
            .map_err(sql)?
            .query_map([], |row| {
                let after: Option<u32> = row.get(1)?;
                let code: Option<i64> = row.get(2)?;
                Ok(QueueEntry {
                    workstream: row.get::<_, i64>(0)?.to_string(),
                    start: after
                        .map_or(StartChoice::Queued, |todo| StartChoice::AfterTodo { todo }),
                    failure: code.map(|code| QueueFailure {
                        code,
                        message: row.get(3).unwrap_or_default(),
                    }),
                })
            })
            .map_err(sql)?
            .collect::<Result<_, _>>()
            .map_err(sql)
    }

    /// Append `workstream` (a Rail id) last; `after` is the Todo it waits for.
    pub fn queue_push(&mut self, workstream: &str, after: Option<u32>) -> Result<(), RpcError> {
        let id: i64 = workstream.parse().map_err(sql_ordinal)?;
        self.db
            .execute(
                "INSERT OR REPLACE INTO workstream_queue (workstream, ord, after_todo)
                 VALUES (?, (SELECT COALESCE(MAX(ord) + 1, 0) FROM workstream_queue), ?)",
                params![id, after],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// Whether an entry was removed.
    pub fn queue_remove(&mut self, workstream: &str) -> Result<bool, RpcError> {
        let id: i64 = workstream.parse().map_err(sql_ordinal)?;
        let removed = self
            .db
            .execute("DELETE FROM workstream_queue WHERE workstream = ?", [id])
            .map_err(sql)?;
        Ok(removed > 0)
    }

    /// Place the entry at `index`, clamped; `false` when `workstream` is not queued.
    pub fn queue_place(&mut self, workstream: &str, index: usize) -> Result<bool, RpcError> {
        let mut order: Vec<String> = self
            .queue_entries()?
            .into_iter()
            .map(|entry| entry.workstream)
            .collect();
        let Some(at) = order.iter().position(|id| id == workstream) else {
            return Ok(false);
        };
        let id = order.remove(at);
        order.insert(index.min(order.len()), id);
        let tx = self.db.transaction().map_err(sql)?;
        for (place, id) in order.iter().enumerate() {
            tx.execute(
                "UPDATE workstream_queue SET ord = ? WHERE workstream = ?",
                params![place as i64, id.parse::<i64>().map_err(sql_ordinal)?],
            )
            .map_err(sql)?;
        }
        tx.commit().map_err(sql)?;
        Ok(true)
    }

    /// Record (`Some`) or clear (`None`) the failure of an entry's last start.
    pub fn queue_fail(
        &mut self,
        workstream: &str,
        failure: Option<(i64, &str)>,
    ) -> Result<(), RpcError> {
        let id: i64 = workstream.parse().map_err(sql_ordinal)?;
        self.db
            .execute(
                "UPDATE workstream_queue SET failure_code = ?, failure_message = ? WHERE workstream = ?",
                params![failure.map(|f| f.0), failure.map(|f| f.1), id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// A deleted Todo frees its entry as `queued`.
    pub fn queue_free(&mut self, workstream: &str) -> Result<(), RpcError> {
        let id: i64 = workstream.parse().map_err(sql_ordinal)?;
        self.db
            .execute(
                "UPDATE workstream_queue SET after_todo = NULL WHERE workstream = ?",
                [id],
            )
            .map_err(sql)?;
        Ok(())
    }
}
