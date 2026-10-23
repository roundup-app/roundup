//! The Rail: Workstreams, Agents and Terminals as a tree in SQLite (WAL).
//! Sibling `order` values are contiguous from 0. Workstreams sit at the root and never nest (A26);
//! an Agent sits under a Workstream or under the Agent that started it, to any depth.

mod measurement;
mod queue;
pub use measurement::MeasurementWait;
pub(crate) use measurement::{Timing, decision_wait};

use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use contracts::agent::{CapturedOrder, NodeKind, Order, RailNode, Worktree};
use contracts::project::{Mcp, Prepared, ProjectModels, RoleModels, Worktrees};
use rpc::{OpenError, RpcError};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

const GONE_AGENT: &str = "an Agent that is gone";

/// Structure only: a node's `status` is the Agents module's to fill in.
pub struct Rail {
    owner_reads: OwnerReads,
    db: Connection,
    measurement_observing: Arc<tokio::sync::Semaphore>,
    measurement_revision: Option<String>,
    measurement_failure: Option<String>,
}

pub(super) struct ClosedPreparation {
    pub source: String,
    pub agent: String,
    pub copy: Option<Vec<u8>>,
}

// R16 attribution (#1901, r16/owner-transaction): a fresh WAL reader's lock/unlock
// syscalls dominate the owner step. A schema-only peer lets SQLite share its local
// read lock. It must never supply owner facts: the authoritative query stays fresh.
struct OwnerReads {
    wake: Option<std::sync::mpsc::SyncSender<()>>,
    pending: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl OwnerReads {
    fn open(path: &Path) -> Self {
        let (wake, receive) = std::sync::mpsc::sync_channel(1);
        let pending = Arc::new(AtomicBool::new(false));
        let peer_pending = Arc::clone(&pending);
        let path = path.to_owned();
        let thread = std::thread::Builder::new()
            .name("Terminal owner reads".into())
            .spawn(move || {
                if let Err(error) = read_leases(&path, receive, &peer_pending) {
                    eprintln!("Terminal owner read lease stopped: {error}");
                }
            });
        let thread = match thread {
            Ok(thread) => Some(thread),
            Err(error) => {
                eprintln!("Terminal owner read lease unavailable: {error}");
                None
            }
        };
        Self {
            wake: Some(wake),
            pending,
            thread,
        }
    }

    fn wake(&self) {
        // R16 attribution (#1913): each unnecessary channel submission costs
        // 130–160 ns in the release Daemon. A pending attempt needs no further input.
        // This flag carries no owner facts and never renews the peer's deadline.
        if self.pending.load(Ordering::Relaxed) {
            return;
        }
        if !self.pending.swap(true, Ordering::Relaxed)
            && let Some(wake) = &self.wake
        {
            // A disconnected peer disables only the optimization, not the query.
            let _ = wake.try_send(());
        }
    }
}

fn read_leases(
    path: &Path,
    receive: std::sync::mpsc::Receiver<()>,
    pending: &AtomicBool,
) -> rusqlite::Result<()> {
    if receive.recv().is_err() {
        return Ok(());
    }
    let db = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::default() & !rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    db.busy_timeout(std::time::Duration::ZERO)?;
    let mut checkpoint = db.prepare("PRAGMA wal_checkpoint(PASSIVE)")?;
    let mut begin = db.prepare("BEGIN DEFERRED")?;
    let mut schema = db.prepare("SELECT rootpage FROM sqlite_schema LIMIT 1")?;
    let mut rollback = db.prepare("ROLLBACK")?;
    loop {
        let (busy, frames, copied): (i64, i64, i64) =
            checkpoint.query_row([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        // Do not overlap leases with unfinished backfill: renewing old snapshots
        // indefinitely would starve checkpoints under sustained input and writes.
        let leased = busy == 0 && frames >= 0 && frames == copied;
        if leased {
            begin.execute([])?;
            schema.exists([])?;
        }
        // Input cannot renew this deadline. Release even if no call ever follows;
        // an unsuccessful checkpoint must not start a retry for every keystroke either.
        std::thread::sleep(std::time::Duration::from_millis(5));
        if leased {
            rollback.execute([])?;
        }
        // Rearm only after rollback (or a skipped attempt's sleep), before waiting.
        // The flag synchronizes only wake admission; the channel publishes work.
        pending.store(false, Ordering::Relaxed);
        if receive.recv().is_err() {
            return Ok(());
        }
    }
}

impl Drop for OwnerReads {
    fn drop(&mut self) {
        self.wake.take();
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            eprintln!("Terminal owner read lease thread panicked");
        }
    }
}

impl Rail {
    pub fn open(path: &Path) -> Result<Self, OpenError> {
        let mut db = Connection::open(path)?;
        db.set_transaction_behavior(rusqlite::TransactionBehavior::Immediate);
        db.pragma_update(None, "journal_mode", "WAL")?;
        crate::schema::open(&mut db, path)?;
        // Terminal ids restart at 1 with the Daemon, so a stored id could name an unrelated Terminal.
        db.execute("UPDATE nodes SET terminal_id = NULL", [])?;
        // A25: a Rail stored by an earlier Daemon holds `room` where this one writes `workstream`.
        db.execute(
            "UPDATE nodes SET kind = 'workstream' WHERE kind = 'room'",
            [],
        )?;
        drop_terminal_nodes(&db)?;
        flatten_workstreams(&mut db)?;
        Ok(Self {
            owner_reads: OwnerReads::open(path),
            db,
            measurement_observing: Arc::new(tokio::sync::Semaphore::new(1)),
            measurement_revision: None,
            measurement_failure: None,
        })
    }

    /// Reserve both identities in one transaction. Until publication, ordinary Rail reads and
    /// mutations cannot address them. A second preparer must await/reconcile the first one.
    pub(super) fn reserve_closed(
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

    pub(super) fn closed_source(
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
    pub(super) fn represents_source(&self, source: &str) -> Result<bool, RpcError> {
        self.db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM closed_sources WHERE source=?1)
                    OR EXISTS(SELECT 1 FROM nodes WHERE conversation_id=?1)",
                [source],
                |row| row.get(0),
            )
            .map_err(sql)
    }

    pub(super) fn closed_copy(&mut self, source: &str, copy: &[u8]) -> Result<(), RpcError> {
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
    pub(super) fn publish_closed(&mut self, source: &str) -> Result<(), RpcError> {
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

    pub(super) fn closed_copies(&self) -> Result<Vec<(String, Vec<u8>)>, RpcError> {
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

    pub(super) fn release_closed_copy(&mut self, source: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE closed_sources SET copy=NULL WHERE source=? AND published=1",
                [source],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub(super) fn unfinished_closed(&self) -> Result<Vec<ClosedPreparation>, RpcError> {
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

    pub(super) fn forget_closed(&mut self, source: &str) -> Result<(), RpcError> {
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

    pub(super) fn refuse_closed(&mut self, source: &str, cause: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE closed_sources SET refusal=? WHERE source=? AND published=0",
                params![cause, source],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub(super) fn closed_recovery_ready(&self, preparing: Option<&str>) -> Result<(), RpcError> {
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

    /// Resource holders may address reserved nodes; user-facing Rail callers cannot.
    pub(super) fn resource_node(&self, id: &str) -> Result<RailNode, RpcError> {
        find(&load_nodes(&self.db, true)?, id).cloned()
    }

    /// Receiver identity and persisted Attempt, without loading Rail presentation fields.
    pub fn terminal_owner(
        &mut self,
        terminal: &str,
    ) -> Result<Option<(String, Option<String>)>, RpcError> {
        // R16 owner-read attribution: preparation costs 11.0–11.5 µs of 18.7–19.6 µs
        // on the measured 7763 host (r16/owner-read). Reuse compiled SQL, never owner facts:
        // each query still binds and reads under Rail then Attempts, including negative reads.
        self.owner_reads.wake();
        // R16 attribution (#1917, r16/owner-execution): 10 → 8 unowned VM steps.
        // Rust stops at the second row, so SQL needs no limit counter. IS avoids
        // a NULL-parameter branch for bound &str; the explicit predicate keeps
        // the partial covering index and excludes unattached rows.
        self.db
            .with_cached_rows(
                "SELECT id, attempt FROM nodes WHERE terminal_id IS ? AND terminal_id IS NOT NULL",
                [terminal],
                |rows| {
                    let Some(row) = rows.next().map_err(sql)? else {
                        return Ok(None);
                    };
                    let id = row.get::<_, i64>(0).map_err(sql)?.to_string();
                    let attempt = match row.get::<_, i64>(1).map_err(sql)? {
                        0 => None,
                        n => Some(n.to_string()),
                    };
                    if rows.next().map_err(sql)?.is_some() {
                        return Err(RpcError::conflict("Terminal has more than one receiver"));
                    }
                    Ok(Some((id, attempt)))
                },
            )
            .map_err(sql)?
    }

    /// Every node, each parent before its children, siblings by `order`.
    pub fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
        let mut flat = load(&self.db)?;
        flat.sort_by_key(|node| node.order);
        let mut out = Vec::with_capacity(flat.len());
        descend(&flat, None, &mut out);
        Ok(out)
    }

    /// Append a node under `parent` (`None` is the root); `check_parent` says which kinds fit where.
    #[cfg(test)]
    pub fn insert(
        &mut self,
        kind: NodeKind,
        name: &str,
        parent: Option<&str>,
        terminal_id: Option<&str>,
    ) -> Result<RailNode, RpcError> {
        self.insert_ordered(kind, name, parent, terminal_id, None)
    }

    /// `insert` with the node's order (O2, O3); `None` is a Workstream's default and an Agent's no order.
    pub fn insert_ordered(
        &mut self,
        kind: NodeKind,
        name: &str,
        parent: Option<&str>,
        terminal_id: Option<&str>,
        work: Option<&Order>,
    ) -> Result<RailNode, RpcError> {
        let work = match (work, kind) {
            (Some(order), _) => Some(order.clone()),
            (None, NodeKind::Workstream) => Some(workstream_order()),
            (None, NodeKind::Agent) => None,
        }
        .map(|order| serde_json::to_string(&order))
        .transpose()
        .map_err(RpcError::internal)?;
        let tx = self.db.transaction().map_err(sql)?;
        let nodes = load(&tx)?;
        check_parent(&nodes, kind, parent)?;
        let order = siblings(&nodes, parent).len() as i64;
        tx.execute(
            "INSERT INTO nodes (kind, name, parent, ord, terminal_id, work)
                VALUES (?, ?, ?, ?, ?, ?)",
            params![kind_name(kind), name, parent, order, terminal_id, work],
        )
        .map_err(sql)?;
        let id = tx.last_insert_rowid().to_string();
        tx.commit().map_err(sql)?;
        self.node(&id)
    }

    /// O13: record that Agent `spawner` started node `id`.
    pub fn set_spawner(&mut self, id: &str, spawner: &str) -> Result<(), RpcError> {
        self.node(id)?;
        self.db
            .execute(
                "UPDATE nodes SET spawner = ? WHERE id = ?",
                params![spawner, id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// O13: whether an Agent's `agent.spawn` started `id` and `door` is above it: the `parent`
    /// chain of `id` reaches `door`.
    pub fn spawned_under(&self, id: &str, door: &str) -> Result<bool, RpcError> {
        let started: Option<String> = self
            .db
            .query_row(
                "SELECT spawner FROM nodes WHERE id = ?",
                params![id],
                |row| row.get(0),
            )
            .map_err(sql)?;
        if started.is_none() {
            return Ok(false);
        }
        let nodes = load(&self.db)?;
        let mut at = find(&nodes, id)?.parent.clone();
        while let Some(parent) = at {
            if parent == door {
                return Ok(true);
            }
            at = find(&nodes, &parent)?.parent.clone();
        }
        Ok(false)
    }

    /// O8: keep the prompt an Agent's spawn gave beside its order.
    pub fn set_spawn_prompt(&mut self, id: &str, prompt: &str) -> Result<(), RpcError> {
        self.node(id)?;
        self.db
            .execute(
                "UPDATE nodes SET spawn_prompt = ? WHERE id = ?",
                params![prompt, id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// O8: the prompt kept for `id`, `None` when it has none; `NOT_FOUND` for an unknown id.
    pub fn spawn_prompt(&self, id: &str) -> Result<Option<String>, RpcError> {
        self.node(id)?;
        self.db
            .query_row(
                "SELECT spawn_prompt FROM nodes WHERE id = ?",
                params![id],
                |row| row.get(0),
            )
            .map_err(sql)
    }

    /// O4, U2773c: compare the captured base and replace the Order in one immediate
    /// transaction. Refusal precedes every Touch, Event and Steer.
    pub fn set_order(
        &mut self,
        id: &str,
        order: &Order,
        captured: Option<&CapturedOrder>,
    ) -> Result<RailNode, RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        let mut node = find(&load(&tx)?, id)?.clone();
        if let Some(base) = captured
            && node.work != base.order
        {
            return Err(RpcError::conflict("Order changed since it was captured"));
        }
        let json = serde_json::to_string(order).map_err(RpcError::internal)?;
        tx.execute(
            "UPDATE nodes SET work = ? WHERE id = ?",
            params![json, node.id],
        )
        .map_err(sql)?;
        tx.commit().map_err(sql)?;
        node.work = Some(order.clone());
        Ok(node)
    }

    pub(super) fn order_revision(&self, id: &str) -> Result<Option<String>, RpcError> {
        self.db.query_row(
            "SELECT CAST(max(revision) AS TEXT) FROM instruction_revisions WHERE agent=? AND message IS NULL",
            [id], |row| row.get(0),
        ).map_err(sql)
    }

    pub(super) fn prepare_instruction(
        &mut self,
        revision: &str,
        attempt: &str,
        text: &str,
        first: bool,
    ) -> Result<String, RpcError> {
        self.db.execute(
            "INSERT INTO instruction_deliveries(revision,attempt,text,state,first) VALUES(?,?,?,'prepared',?)",
            params![revision, attempt, text, first],
        ).map_err(sql)?;
        Ok(self.db.last_insert_rowid().to_string())
    }

    pub(super) fn first_instruction(
        &self,
        agent: &str,
        attempt: &str,
    ) -> Result<Option<String>, RpcError> {
        self.db.query_row(
            "SELECT CAST(d.id AS TEXT) FROM instruction_deliveries d JOIN instruction_revisions r ON r.revision=d.revision
             WHERE r.agent=? AND d.attempt=? AND d.first=1 ORDER BY d.id DESC LIMIT 1",
            params![agent, attempt], |row| row.get(0),
        ).optional().map_err(sql)
    }

    pub(super) fn instruction_state(
        &mut self,
        id: &str,
        state: contracts::agent::InstructionState,
    ) -> Result<(), RpcError> {
        let state = serde_json::to_value(state).map_err(RpcError::internal)?;
        self.db
            .execute(
                "UPDATE instruction_deliveries SET state=? WHERE id=?",
                params![state.as_str(), id],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub(super) fn instructions(
        &mut self,
        id: &str,
        project: &str,
    ) -> Result<contracts::agent::Instructions, RpcError> {
        use contracts::agent::{
            Instruction, InstructionDelivery, InstructionRevision, Instructions,
        };
        let tx = self.db.transaction().map_err(sql)?;
        let home = tx
            .query_row(
                "SELECT home FROM instruction_homes WHERE agent=?",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)?
            .ok_or_else(|| RpcError::not_found(GONE_AGENT))?;
        let rows = tx.prepare("SELECT revision,workstream,work,message,text FROM instruction_revisions WHERE agent=? ORDER BY revision").map_err(sql)?
            .query_map([id], |row| Ok((row.get::<_,i64>(0)?,row.get::<_,Option<String>>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,Option<u32>>(3)?,row.get::<_,Option<String>>(4)?)))
            .map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;
        let mut revisions = Vec::new();
        let mut current = None;
        for (revision, workstream, work, message, text) in rows {
            let revision = revision.to_string();
            let instruction = match (work, message, text) {
                (Some(work), None, None) => {
                    current = Some(revision.clone());
                    Instruction::Order {
                        order: serde_json::from_str(&work).map_err(RpcError::internal)?,
                    }
                }
                (None, Some(message), Some(text)) => Instruction::Message { message, text },
                _ => return Err(RpcError::internal("invalid retained instruction")),
            };
            revisions.push(InstructionRevision {
                revision,
                agent: id.to_owned(),
                workstream,
                instruction,
            });
        }
        let rows = tx.prepare("SELECT d.id,d.revision,d.attempt,d.text,d.state FROM instruction_deliveries d JOIN instruction_revisions r ON r.revision=d.revision WHERE r.agent=? ORDER BY d.id").map_err(sql)?
            .query_map([id], |row| Ok((row.get::<_,i64>(0)?,row.get::<_,i64>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?)))
            .map_err(sql)?.collect::<Result<Vec<_>,_>>().map_err(sql)?;
        let deliveries = rows
            .into_iter()
            .map(|(id, revision, attempt, text, state)| {
                Ok(InstructionDelivery {
                    id: id.to_string(),
                    revision: revision.to_string(),
                    attempt,
                    text,
                    state: serde_json::from_value(serde_json::Value::String(state))
                        .map_err(RpcError::internal)?,
                })
            })
            .collect::<Result<Vec<_>, RpcError>>()?;
        let present: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM nodes WHERE CAST(id AS TEXT)=?)",
                [id],
                |row| row.get(0),
            )
            .map_err(sql)?;
        if !present {
            current = None;
        }
        tx.commit().map_err(sql)?;
        Ok(Instructions {
            project: project.to_owned(),
            home,
            current,
            revisions,
            deliveries,
        })
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<RailNode, RpcError> {
        // SQLite would match "01" to node 1; only the exact id names a node.
        let node = self.node(id)?;
        self.db
            .execute(
                "UPDATE nodes SET name = ? WHERE id = ?",
                params![name, node.id],
            )
            .map_err(sql)?;
        self.node(id)
    }

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
        tx.commit().map_err(sql)
    }

    pub fn allocate_attempt(&mut self, id: &str) -> Result<String, RpcError> {
        let node = self.node(id)?;
        let previous = node
            .attempt
            .as_deref()
            .unwrap_or("0")
            .parse::<i64>()
            .map_err(sql_ordinal)?;
        let next = previous
            .checked_add(1)
            .ok_or_else(|| RpcError::internal("Attempt exhausted"))?;
        self.db
            .execute(
                "UPDATE nodes SET attempt = ? WHERE id = ?",
                params![next, id],
            )
            .map_err(sql)?;
        Ok(next.to_string())
    }

    /// A32: the Door of Workstream `id` is now in Iteration `iteration`.
    pub fn set_iteration(&mut self, id: &str, iteration: u32) -> Result<(), RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE nodes SET iteration = ? WHERE id = ?",
                params![iteration, id],
            )
            .map_err(sql)?;
        if changed == 0 {
            return Err(RpcError::not_found(GONE_AGENT));
        }
        Ok(())
    }

    pub fn detach_terminal(&mut self, id: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE nodes SET terminal_id = NULL WHERE id = ?",
                params![id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// Record which Terminal runs the Agent `id`.
    pub fn attach_terminal(&mut self, id: &str, terminal_id: &str) -> Result<(), RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE nodes SET terminal_id = ? WHERE id = ?",
                params![terminal_id, id],
            )
            .map_err(sql)?;
        if changed == 0 {
            return Err(RpcError::not_found(GONE_AGENT));
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
        removal: &contracts::agent::Removal,
        apply: impl FnOnce(&Connection) -> Result<T, RpcError>,
    ) -> Result<T, RpcError> {
        self.db
            .pragma_update(None, "foreign_keys", true)
            .map_err(sql)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(sql)?;
        let out = apply(&tx)?;
        let nodes = load(&tx)?;
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
        place(&tx, node.parent.as_deref(), &ids)?;
        for item in removal.removed.iter().rev() {
            if item.kind == contracts::agent::RemovalKind::Agent {
                tx.execute("DELETE FROM nodes WHERE id = ?", [&item.id])
                    .map_err(sql)?;
            }
        }
        tx.execute("DELETE FROM nodes WHERE id = ?", [id])
            .map_err(sql)?;
        tx.commit().map_err(sql)?;
        Ok(out)
    }

    /// M7: record that Agent `creator` created node `id`; it goes with the node.
    pub fn set_creator(&mut self, id: &str, creator: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE nodes SET creator = ? WHERE id = ?",
                params![creator, id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// M7: the ids of the Workstreams Agent `creator` created and that still exist.
    pub fn created_by(&self, creator: &str) -> Result<Vec<String>, RpcError> {
        let mut query = self
            .db
            .prepare("SELECT id FROM nodes WHERE creator = ?")
            .map_err(sql)?;
        let rows = query
            .query_map(params![creator], |row| {
                Ok(row.get::<_, i64>(0)?.to_string())
            })
            .map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }

    /// Current Rail name for prose; an absent node has no machine identity to display.
    pub fn name(&self, id: &str) -> Result<String, RpcError> {
        self.db
            .query_row(
                "SELECT name FROM nodes WHERE id = ?1 AND CAST(id AS TEXT) = ?1 AND NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0 AND (agent=nodes.id OR workstream=nodes.id))",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)
            .map(|name| name.unwrap_or_else(|| GONE_AGENT.into()))
    }

    pub fn node(&self, id: &str) -> Result<RailNode, RpcError> {
        find(&load(&self.db)?, id).cloned()
    }

    /// The Project's `worktrees` setting; `{on: false, check: null}` for a Project that never
    /// had it set (G1).
    pub fn get_worktrees(&self) -> Result<Worktrees, RpcError> {
        self.db
            .query_row(
                "SELECT worktrees_on, worktrees_check FROM settings WHERE id = 0",
                [],
                |row| {
                    Ok(Worktrees {
                        on: row.get(0)?,
                        check: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(sql)
            .map(|found| {
                found.unwrap_or(Worktrees {
                    on: false,
                    check: None,
                })
            })
    }

    pub fn set_worktrees(&mut self, worktrees: &Worktrees) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO settings (id, worktrees_on, worktrees_check) VALUES (0, ?, ?)
                 ON CONFLICT (id) DO UPDATE SET worktrees_on = excluded.worktrees_on,
                    worktrees_check = excluded.worktrees_check",
                params![worktrees.on, worktrees.check],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// M2219: the Project's `mcp` setting; `{on: true}` for a Project that never set it.
    pub fn get_mcp(&self) -> Result<Mcp, RpcError> {
        self.db
            .query_row("SELECT mcp_on FROM settings WHERE id = 0", [], |row| {
                Ok(Mcp { on: row.get(0)? })
            })
            .optional()
            .map_err(sql)
            .map(|found| found.unwrap_or(Mcp { on: true }))
    }

    pub fn set_mcp(&mut self, mcp: &Mcp) -> Result<(), RpcError> {
        self.db
            .execute(
                "INSERT INTO settings (id, mcp_on) VALUES (0, ?)
                 ON CONFLICT (id) DO UPDATE SET mcp_on = excluded.mcp_on",
                params![mcp.on],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// G2542: the Project's prepared-directory configuration; empty for a Project that never set it.
    pub fn get_prepared(&self) -> Result<Prepared, RpcError> {
        let (readiness, timeout_ms, setup) = self
            .db
            .query_row(
                "SELECT readiness, timeout_ms, setup FROM prepared_config WHERE id = 0",
                [],
                |row| Ok((row.get(0)?, row.get::<_, Option<i64>>(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(sql)?
            .unwrap_or((None, None, None));
        let mut query = self
            .db
            .prepare("SELECT path FROM prepared_dirs ORDER BY ord")
            .map_err(sql)?;
        let enrolled = query
            .query_map([], |row| row.get(0))
            .map_err(sql)?
            .collect::<Result<_, _>>()
            .map_err(sql)?;
        Ok(Prepared {
            enrolled,
            readiness,
            timeout_ms: timeout_ms.and_then(|ms| u64::try_from(ms).ok()),
            setup,
        })
    }

    /// Replace the configuration in one transaction; a directory kept keeps its unavailable mark.
    pub fn set_prepared(&mut self, prepared: &Prepared) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        tx.execute(
            "INSERT INTO prepared_config (id, readiness, timeout_ms, setup) VALUES (0, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET readiness = excluded.readiness,
                timeout_ms = excluded.timeout_ms, setup = excluded.setup",
            params![
                prepared.readiness,
                prepared
                    .timeout_ms
                    .map(|ms| i64::try_from(ms).unwrap_or(i64::MAX)),
                prepared.setup
            ],
        )
        .map_err(sql)?;
        tx.execute("DELETE FROM prepared_dirs WHERE ord < 0 OR path NOT IN (SELECT value FROM json_each(?))", [serde_json::to_string(&prepared.enrolled).map_err(RpcError::internal)?]).map_err(sql)?;
        for (ord, path) in prepared.enrolled.iter().enumerate() {
            tx.execute(
                "INSERT INTO prepared_dirs (path, ord) VALUES (?, ?)
                 ON CONFLICT (path) DO UPDATE SET ord = excluded.ord",
                params![path, i64::try_from(ord).unwrap_or(i64::MAX)],
            )
            .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    /// Why an enrolled directory is unavailable, or `None` when it is not.
    pub fn prepared_unavailable(&self, path: &str) -> Result<Option<String>, RpcError> {
        self.db
            .query_row(
                "SELECT unavailable FROM prepared_dirs WHERE path = ?",
                [path],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)
            .map(Option::flatten)
    }

    pub fn set_prepared_unavailable(
        &mut self,
        path: &str,
        reason: Option<&str>,
    ) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE prepared_dirs SET unavailable = ? WHERE path = ?",
                params![reason, path],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// The node that holds `path` as its Worktree, whatever its state.
    pub fn worktree_owner_of(&self, path: &str) -> Result<Option<String>, RpcError> {
        self.db
            .query_row(
                "SELECT id FROM nodes WHERE worktree_path = ?",
                [path],
                |row| row.get::<_, i64>(0).map(|id| id.to_string()),
            )
            .optional()
            .map_err(sql)
    }

    /// G2542c: persist `plan` for `id` only if no node holds its directory and the directory is
    /// available, in one statement, so two starts never both win. `false` when taken.
    pub fn reserve_prepared(
        &mut self,
        id: &str,
        plan: &super::worktree::Provision,
    ) -> Result<bool, RpcError> {
        self.closed_recovery_ready(Some(id))?;
        let path = plan.worktree.path.to_string_lossy();
        let changed = self
            .db
            .execute(
                "UPDATE nodes SET worktree_state='provisioning', worktree_path=?1, worktree_branch=?2,
                    worktree_base=?3, worktree_owner=?4, worktree_commit=?5
                 WHERE id=?6
                   AND NOT EXISTS (SELECT 1 FROM nodes WHERE worktree_path = ?1)
                   AND EXISTS (SELECT 1 FROM prepared_dirs WHERE path = ?1 AND unavailable IS NULL)",
                params![
                    path,
                    plan.worktree.branch,
                    plan.worktree.base,
                    plan.owner,
                    plan.commit,
                    id
                ],
            )
            .map_err(sql)?;
        Ok(changed == 1)
    }

    /// A36: the Models and Efforts set per Role, one entry for each of `roles` in order (`None`s
    /// for one never set), and the Models a Door may use.
    pub fn get_models(&self, roles: &[&str]) -> Result<ProjectModels, RpcError> {
        let mut set = self
            .db
            .prepare("SELECT role, model, effort FROM role_models")
            .map_err(sql)?;
        let set: Vec<RoleModels> = set
            .query_map([], |row| {
                Ok(RoleModels {
                    role: row.get(0)?,
                    model: row.get(1)?,
                    effort: row.get(2)?,
                })
            })
            .map_err(sql)?
            .collect::<Result<_, _>>()
            .map_err(sql)?;
        let roles = roles
            .iter()
            .map(|role| {
                set.iter()
                    .find(|found| found.role == *role)
                    .cloned()
                    .unwrap_or_else(|| RoleModels {
                        role: (*role).to_owned(),
                        model: None,
                        effort: None,
                    })
            })
            .collect();
        Ok(ProjectModels { roles })
    }

    /// A36: replace the Project's Models whole.
    pub fn set_models(&mut self, models: &ProjectModels) -> Result<(), RpcError> {
        let tx = self.db.transaction().map_err(sql)?;
        tx.execute("DELETE FROM role_models", []).map_err(sql)?;
        for role in &models.roles {
            tx.execute(
                "INSERT INTO role_models (role, model, effort) VALUES (?, ?, ?)",
                params![role.role, role.model, role.effort],
            )
            .map_err(sql)?;
        }
        tx.commit().map_err(sql)
    }

    /// A36: store the Model and Effort node `id` runs on.
    pub fn set_pair(
        &mut self,
        id: &str,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> Result<(), RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE nodes SET model = ?, effort = ? WHERE id = ?",
                params![model, effort, id],
            )
            .map_err(sql)?;
        if changed == 0 {
            return Err(RpcError::not_found(GONE_AGENT));
        }
        Ok(())
    }

    pub fn mark_worktree_provisioning(
        &mut self,
        id: &str,
        plan: &super::worktree::Provision,
    ) -> Result<(), RpcError> {
        self.db.execute("UPDATE nodes SET worktree_state='provisioning', worktree_path=?, worktree_branch=?, worktree_base=?, worktree_owner=?, worktree_commit=? WHERE id=?", params![plan.worktree.path.to_string_lossy(), plan.worktree.branch, plan.worktree.base, plan.owner, plan.commit, id]).map_err(sql)?;
        Ok(())
    }

    /// Each node with a Worktree record still owned by provisioning, with its plan and whether
    /// it reached `ready`; the plan is `None` for a legacy record with no ownership proof (G6),
    /// which no caller may clean up.
    pub fn provisioning(
        &self,
    ) -> Result<Vec<(RailNode, Option<super::worktree::Provision>, bool)>, RpcError> {
        let mut records = Vec::new();
        for node in load_nodes(&self.db, true)? {
            let (state, owner, commit): (Option<String>, Option<String>, Option<String>) = self
                .db
                .query_row(
                    "SELECT worktree_state, worktree_owner, worktree_commit FROM nodes WHERE id=?",
                    [&node.id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(sql)?;
            if state.as_deref() == Some("provisioning") && owner.is_none() {
                records.push((node.clone(), None, false));
                continue;
            }
            if let (Some(owner), Some(commit), Some(worktree)) = (owner, commit, &node.worktree) {
                records.push((
                    node.clone(),
                    Some(super::worktree::Provision {
                        worktree: super::worktree::Worktree::from(worktree),
                        owner,
                        commit,
                    }),
                    state.as_deref() == Some("ready"),
                ));
            }
        }
        Ok(records)
    }

    pub fn clear_provisioning_owner(&mut self, id: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE nodes SET worktree_owner=NULL, worktree_commit=NULL WHERE id=?",
                [id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// Record a Worktree Provisioning made for `id`, just before its Terminal starts.
    pub fn set_worktree(&mut self, id: &str, worktree: &Worktree) -> Result<(), RpcError> {
        let path = worktree.path.as_str();
        self.db
            .execute(
                "UPDATE nodes SET worktree_path = ?, worktree_branch = ?, worktree_base = ?,
                    worktree_state = 'ready' WHERE id = ?",
                params![path, worktree.branch, worktree.base, id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// Undo `mark_worktree_provisioning`/`set_worktree` for a node that keeps its place on the
    /// Rail (`rail.startDoor`'s own failure path; a failed `agent.spawn` deletes the node outright).
    pub fn clear_worktree(&mut self, id: &str) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE nodes SET worktree_path = NULL, worktree_branch = NULL,
                    worktree_base = NULL, worktree_state = NULL, worktree_owner=NULL, worktree_commit=NULL WHERE id = ?",
                params![id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// A21: save the vendor conversation id and the effective cwd it was launched in, replacing
    /// any earlier save. `id` must already name a node.
    pub fn save_conversation(
        &mut self,
        id: &str,
        conversation_id: &str,
        cwd: &str,
    ) -> Result<(), RpcError> {
        let changed = self
            .db
            .execute(
                "UPDATE nodes SET conversation_id = ?, conversation_cwd = ? WHERE id = ?",
                params![conversation_id, cwd, id],
            )
            .map_err(sql)?;
        if changed == 0 {
            return Err(RpcError::not_found(GONE_AGENT));
        }
        Ok(())
    }

    /// The saved conversation id and cwd (A21), if any.
    pub fn conversation(&self, id: &str) -> Result<Option<(String, String)>, RpcError> {
        let found: (Option<String>, Option<String>) = self
            .db
            .query_row(
                "SELECT conversation_id, conversation_cwd FROM nodes WHERE id = ?
                    AND NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0 AND (workstream=nodes.id OR agent=nodes.id))",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(sql)?
            .ok_or_else(|| RpcError::not_found(GONE_AGENT))?;
        Ok(match found {
            (Some(conversation_id), Some(cwd)) => Some((conversation_id, cwd)),
            _ => None,
        })
    }

    /// Whether `id` has A21 data; used to compute `can_resume` without exposing the id itself.
    pub fn has_conversation(&self, id: &str) -> Result<bool, RpcError> {
        Ok(self.conversation(id)?.is_some())
    }
}

fn sql_ordinal(err: std::num::ParseIntError) -> RpcError {
    RpcError::internal(err)
}

fn sql(err: rusqlite::Error) -> RpcError {
    RpcError::internal(err)
}

/// X11: a Rail stored by an earlier Daemon may hold nodes of kind `terminal`; their programs are
/// gone, so they go, and each parent's remaining children close the gap.
fn drop_terminal_nodes(db: &Connection) -> rusqlite::Result<()> {
    let parents: Vec<Option<i64>> = db
        .prepare("SELECT DISTINCT parent FROM nodes WHERE kind = 'terminal'")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    db.execute("DELETE FROM nodes WHERE kind = 'terminal'", [])?;
    for parent in parents {
        let ids: Vec<i64> = db
            .prepare("SELECT id FROM nodes WHERE parent IS ? ORDER BY ord, id")?
            .query_map(params![parent], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        for (at, id) in ids.iter().enumerate() {
            db.execute(
                "UPDATE nodes SET ord = ? WHERE id = ?",
                params![at as i64, id],
            )?;
        }
    }
    Ok(())
}

/// O3: the order a Workstream's Door holds when none was given. An Agent holds none (O2).
fn workstream_order() -> Order {
    Order::clarification("What is this Workstream for?")
}

fn kind_name(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Workstream => "workstream",
        NodeKind::Agent => "agent",
    }
}

fn load(db: &Connection) -> Result<Vec<RailNode>, RpcError> {
    load_nodes(db, false)
}

fn load_nodes(db: &Connection, include_preparation: bool) -> Result<Vec<RailNode>, RpcError> {
    let mut query = db
        .prepare(
            "SELECT id, kind, name, parent, ord, attempt, terminal_id,
                worktree_path, worktree_branch, worktree_base, work, model, effort, iteration,
                conversation_id IS NOT NULL AND conversation_cwd IS NOT NULL FROM nodes
                WHERE ? OR NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0
                    AND (workstream=nodes.id OR agent=nodes.id))",
        )
        .map_err(sql)?;
    let rows = query
        .query_map([include_preparation], |row| {
            let kind = match row.get::<_, String>(1)?.as_str() {
                "group" | "workstream" => NodeKind::Workstream,
                _ => NodeKind::Agent,
            };
            let worktree = match (
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ) {
                (Some(path), Some(branch), Some(base)) => Some(Worktree { path, branch, base }),
                _ => None,
            };
            let stored = row
                .get::<_, Option<String>>(10)?
                .and_then(|json| serde_json::from_str(&json).ok());
            let work = match kind {
                NodeKind::Workstream => Some(stored.unwrap_or_else(workstream_order)),
                NodeKind::Agent => stored,
            };
            Ok(RailNode {
                id: row.get::<_, i64>(0)?.to_string(),
                kind,
                name: row.get(2)?,
                parent: row.get::<_, Option<i64>>(3)?.map(|id| id.to_string()),
                order: row.get(4)?,
                status: None,
                status_revision: None,
                attempt: match row.get::<_, i64>(5)? {
                    0 => None,
                    n => Some(n.to_string()),
                },
                terminal_id: row.get(6)?,
                worktree,
                // R16/#1365: 40 per-row conversation queries cost 209 µs in the release
                // profile. Load availability here; presentation gates it on the live Attempt.
                can_resume: row.get(14)?,
                yolo: false,
                channel: None,
                stray: Vec::new(),
                work,
                model: row.get(11)?,
                effort: row.get(12)?,
                iteration: (kind == NodeKind::Workstream)
                    .then(|| row.get(13))
                    .transpose()?,
                inbox: None,
                tool_call: None,
                overview: None,
            })
        })
        .map_err(sql)?;
    rows.collect::<Result<_, _>>().map_err(sql)
}

fn find<'a>(nodes: &'a [RailNode], id: &str) -> Result<&'a RailNode, RpcError> {
    nodes
        .iter()
        .find(|node| node.id == id)
        .ok_or_else(|| RpcError::not_found(GONE_AGENT))
}

/// Ids of the children of `parent`, by `order`.
fn siblings(nodes: &[RailNode], parent: Option<&str>) -> Vec<String> {
    let mut children: Vec<_> = nodes
        .iter()
        .filter(|node| node.parent.as_deref() == parent)
        .collect();
    children.sort_by_key(|node| node.order);
    children.into_iter().map(|node| node.id.clone()).collect()
}

fn descend(nodes: &[RailNode], parent: Option<&str>, out: &mut Vec<RailNode>) {
    for node in nodes.iter().filter(|node| node.parent.as_deref() == parent) {
        out.push(node.clone());
        descend(nodes, Some(&node.id), out);
    }
}

/// A26: a Workstream sits at the root. An Agent sits under a Workstream or under the Agent that
/// started it.
fn check_parent(nodes: &[RailNode], kind: NodeKind, parent: Option<&str>) -> Result<(), RpcError> {
    let Some(parent) = parent.map(|id| find(nodes, id)).transpose()? else {
        return Ok(());
    };
    match (kind, parent.kind) {
        (NodeKind::Workstream, _) => Err(RpcError::conflict(format!(
            "Workstreams never nest: a Workstream cannot sit under {}",
            parent.id
        ))),
        (NodeKind::Agent, _) => Ok(()),
    }
}

/// A26: a Rail stored by an earlier Daemon may hold a Workstream under another. Each moves to
/// the root, after the last root node, in the order of depth then `order`; the siblings it leaves
/// stay contiguous from 0. Nothing else changes.
fn flatten_workstreams(db: &mut Connection) -> Result<(), RpcError> {
    let tx = db.transaction().map_err(sql)?;
    let nodes = load(&tx)?;
    let depth = |node: &RailNode| {
        let mut depth = 0;
        let mut at = node.parent.as_deref();
        while let Some(parent) = at.filter(|_| depth <= nodes.len()) {
            depth += 1;
            at = nodes
                .iter()
                .find(|candidate| candidate.id == parent)
                .and_then(|candidate| candidate.parent.as_deref());
        }
        depth
    };
    let mut nested: Vec<&RailNode> = nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Workstream && node.parent.is_some())
        .collect();
    if nested.is_empty() {
        return Ok(());
    }
    nested.sort_by_key(|node| (depth(node), node.order, node.id.parse::<i64>().unwrap_or(0)));
    let mut roots = siblings(&nodes, None);
    let left: Vec<String> = nested
        .iter()
        .filter_map(|node| node.parent.clone())
        .collect();
    roots.extend(nested.iter().map(|node| node.id.clone()));
    place(&tx, None, &roots)?;
    for parent in left {
        let rest: Vec<String> = siblings(&nodes, Some(&parent))
            .into_iter()
            .filter(|id| nested.iter().all(|node| &node.id != id))
            .collect();
        place(&tx, Some(&parent), &rest)?;
    }
    tx.commit().map_err(sql)
}

/// Is `node` the ancestor `id` or a descendant of it?
fn is_within(nodes: &[RailNode], node: &str, id: &str) -> bool {
    let mut at = Some(node);
    while let Some(current) = at {
        if current == id {
            return true;
        }
        at = nodes
            .iter()
            .find(|candidate| candidate.id == current)
            .and_then(|candidate| candidate.parent.as_deref());
    }
    false
}

/// Make `ids` the children of `parent`, in that order, numbered from 0.
fn place(tx: &Connection, parent: Option<&str>, ids: &[String]) -> Result<(), RpcError> {
    for (order, id) in (0_i64..).zip(ids) {
        tx.execute(
            "UPDATE nodes SET parent = ?, ord = ? WHERE id = ?",
            params![parent, order, id],
        )
        .map_err(sql)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use contracts::agent::NodeKind;
    use rpc::code;

    use super::Rail;

    fn rail() -> (tempfile::TempDir, Rail) {
        let dir = tempfile::tempdir().unwrap();
        let rail = Rail::open(&dir.path().join("agents.db")).unwrap();
        (dir, rail)
    }

    #[test]
    fn u2875c_each_reservation_write_rolls_back_without_a_partial_rail_entry() {
        for failure in [
            "CREATE TRIGGER fail AFTER INSERT ON nodes WHEN NEW.kind='workstream' BEGIN SELECT RAISE(ABORT,'interrupted Workstream write'); END;",
            "CREATE TRIGGER fail AFTER INSERT ON nodes WHEN NEW.kind='agent' BEGIN SELECT RAISE(ABORT,'interrupted Agent write'); END;",
            "CREATE TRIGGER fail AFTER INSERT ON closed_sources BEGIN SELECT RAISE(ABORT,'interrupted source write'); END;",
        ] {
            let (dir, mut rail) = rail();
            rail.db.execute_batch(failure).unwrap();
            assert!(rail.reserve_closed("failed", "hidden").is_err());
            assert!(rail.tree().unwrap().is_empty());
            drop(rail);
            let mut rail = Rail::open(&dir.path().join("agents.db")).unwrap();
            assert!(rail.tree().unwrap().is_empty());
            assert!(rail.closed_source("failed").unwrap().is_none());
            rail.db.execute_batch("DROP TRIGGER fail").unwrap();
            rail.reserve_closed("failed", "retry").unwrap();
        }
    }

    #[test]
    fn u2875c_final_commit_failure_keeps_both_nodes_unpublished() {
        let (dir, mut rail) = rail();
        let (workstream, agent) = rail.reserve_closed("failed", "hidden").unwrap();
        rail.closed_copy("failed", b"opaque ownership").unwrap();
        rail.save_conversation(&agent, "retained", "/project")
            .unwrap();
        // A deferred FK failure happens at COMMIT, after every publication statement ran.
        rail.db.execute_batch("PRAGMA foreign_keys=ON;
            CREATE TABLE commit_guard (source TEXT REFERENCES closed_sources(source) DEFERRABLE INITIALLY DEFERRED);
            CREATE TRIGGER fail AFTER UPDATE OF published ON closed_sources WHEN NEW.published=1
            BEGIN INSERT INTO commit_guard VALUES('absent'); END;").unwrap();
        assert!(rail.publish_closed("failed").is_err());
        assert!(rail.tree().unwrap().is_empty());
        assert!(rail.node(&workstream).is_err());
        assert!(rail.has_conversation(&agent).is_err());
        drop(rail);
        let mut rail = Rail::open(&dir.path().join("agents.db")).unwrap();
        assert!(rail.tree().unwrap().is_empty());
        rail.db.execute_batch("DROP TRIGGER fail").unwrap();
        rail.publish_closed("failed").unwrap();
        assert_eq!(rail.tree().unwrap().len(), 2);
    }

    #[test]
    fn a2703a_rail_resolves_current_names_and_gone_agents() {
        let (_dir, mut rail) = rail();
        let node = rail.insert(NodeKind::Agent, "sad", None, None).unwrap();
        assert_eq!(rail.name(&node.id).unwrap(), "sad");
        rail.rename(&node.id, "glad").unwrap();
        assert_eq!(rail.name(&node.id).unwrap(), "glad");
        assert_eq!(rail.name("7013").unwrap(), "an Agent that is gone");
        rail.db.execute_batch("DROP TABLE nodes").unwrap();
        assert_eq!(rail.name(&node.id).unwrap_err().code, code::INTERNAL);
    }

    #[test]
    fn r16_loaded_rail_keeps_complete_conversation_availability_in_tree_order() {
        let (_dir, mut rail) = rail();
        let first = rail
            .insert(NodeKind::Workstream, "first", None, None)
            .unwrap();
        let child = rail
            .insert(NodeKind::Agent, "child", Some(&first.id), None)
            .unwrap();
        let second = rail
            .insert(NodeKind::Workstream, "second", None, None)
            .unwrap();
        rail.db.execute("UPDATE nodes SET conversation_id = 'saved', conversation_cwd = '/project' WHERE id = ?", [&child.id]).unwrap();
        rail.db
            .execute(
                "UPDATE nodes SET conversation_id = 'partial' WHERE id = ?",
                [&second.id],
            )
            .unwrap();
        let tree = rail.tree().unwrap();
        assert_eq!(
            tree.iter()
                .map(|n| (n.id.as_str(), n.can_resume))
                .collect::<Vec<_>>(),
            [
                (first.id.as_str(), false),
                (child.id.as_str(), true),
                (second.id.as_str(), false),
            ]
        );
        assert!(rail.node(&child.id).unwrap().can_resume);
    }

    #[test]
    fn a7_attempt_exhaustion_does_not_wrap_or_change_the_node() {
        let (_dir, mut rail) = rail();
        let node = rail
            .insert(NodeKind::Workstream, "workstream", None, None)
            .unwrap();
        rail.db
            .execute("UPDATE nodes SET attempt = ?", [i64::MAX])
            .unwrap();
        let before = rail.node(&node.id).unwrap();
        assert_eq!(
            rail.allocate_attempt(&node.id).unwrap_err().code,
            code::INTERNAL
        );
        assert_eq!(rail.node(&node.id).unwrap(), before);
    }

    #[test]
    fn a6_nothing_nests_under_an_agent() {
        let (_dir, mut rail) = rail();
        let group = rail.insert(NodeKind::Workstream, "g", None, None).unwrap();
        {
            let kind = NodeKind::Agent;
            let leaf = rail.insert(kind, "leaf", None, Some("1")).unwrap();
            let inserted = rail
                .insert(NodeKind::Workstream, "x", Some(&leaf.id), None)
                .unwrap_err();
            let moved = rail.move_node(&group.id, Some(&leaf.id), 0).unwrap_err();
            assert_eq!(
                (inserted.code, moved.code),
                (code::CONFLICT, code::CONFLICT),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn a6_rename_needs_the_exact_id() {
        let (_dir, mut rail) = rail();
        let group = rail.insert(NodeKind::Workstream, "g", None, None).unwrap();
        let err = rail.rename(&format!("0{}", group.id), "other").unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND);
        assert_eq!(rail.tree().unwrap()[0].name, "g");
    }

    #[test]
    fn x11_a_stored_terminal_node_is_dropped_on_open() {
        let (dir, mut rail) = rail();
        let group = rail.insert(NodeKind::Workstream, "g", None, None).unwrap();
        for name in ["a", "b", "c"] {
            rail.insert(NodeKind::Agent, name, Some(&group.id), None)
                .unwrap();
        }
        rail.db
            .execute("UPDATE nodes SET kind = 'terminal' WHERE name = 'b'", [])
            .unwrap();
        drop(rail);

        let reopened = Rail::open(&dir.path().join("agents.db")).unwrap();

        let tree = reopened.tree().unwrap();
        let rest: Vec<_> = tree.iter().map(|n| (n.name.as_str(), n.order)).collect();
        assert_eq!(rest, [("g", 0), ("a", 0), ("c", 1)]);
        assert!(tree.iter().all(|n| n.name != "b"));
    }

    #[test]
    fn a8_reopening_unlinks_every_terminal_id() {
        let (dir, mut rail) = rail();
        rail.insert(NodeKind::Agent, "claude", None, Some("1"))
            .unwrap();
        rail.insert(NodeKind::Agent, "shell", None, Some("2"))
            .unwrap();
        drop(rail);

        let reopened = Rail::open(&dir.path().join("agents.db")).unwrap();
        let ids: Vec<_> = reopened
            .tree()
            .unwrap()
            .into_iter()
            .map(|n| n.terminal_id)
            .collect();
        assert_eq!(ids, [None, None]);
    }

    #[test]
    fn a6_removing_a_node_closes_the_gap_among_its_siblings() {
        let (_dir, mut rail) = rail();
        let ids: Vec<_> = ["a", "b", "c"]
            .map(|name| {
                rail.insert(NodeKind::Workstream, name, None, None)
                    .unwrap()
                    .id
            })
            .into();
        rail.remove(&ids[1]).unwrap();
        let tree = rail.tree().unwrap();
        let rest: Vec<_> = tree.iter().map(|n| (n.name.as_str(), n.order)).collect();
        assert_eq!(rest, [("a", 0), ("c", 1)]);
    }

    /// A16: moving a Workstream's children and deleting the Workstream are one transaction. A trigger
    /// that only rejects the DELETE (the UPDATEs `place` runs are untouched) tells this apart
    /// from a mutant that commits the move before deleting in a second transaction: there, the
    /// move would survive even though the delete failed.
    #[test]
    fn a16_a_groups_delete_failing_after_a_successful_move_rolls_both_back() {
        let (_dir, mut rail) = rail();
        let group = rail.insert(NodeKind::Workstream, "g", None, None).unwrap();
        let child = rail
            .insert(NodeKind::Agent, "child", Some(&group.id), None)
            .unwrap();
        rail.db
            .execute_batch(
                "CREATE TRIGGER forbid_delete BEFORE DELETE ON nodes
                 BEGIN SELECT RAISE(ABORT, 'delete forbidden'); END;",
            )
            .unwrap();

        let err = rail.remove(&group.id).unwrap_err();

        assert_eq!(err.code, code::INTERNAL);
        let found = rail.node(&child.id).unwrap();
        assert_eq!(found.parent.as_deref(), Some(group.id.as_str()));
    }
}
