//! The Rail: Workstreams, Agents and Terminals as a tree in SQLite (WAL).
//! Sibling `order` values are contiguous from 0. Workstreams sit at the root and never nest (A26);
//! an Agent sits under a Workstream or under the Agent that started it, to any depth.

mod closed;
mod owner_reads;
mod settings;
use owner_reads::OwnerReads;
mod placement;
mod queue;
mod removal;
mod view;
use view::load_nodes;

use std::path::Path;

use contracts::agent::{CapturedOrder, NodeKind, Order, RailNode, Worktree};
use contracts::project::{Mcp, Prepared, ProjectModels, RoleModels, Worktrees};
use rpc::{OpenError, RpcError};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

const GONE_AGENT: &str = "an Agent that is gone";

/// Structure only: a node's `status` is the Agents module's to fill in.
pub struct Rail {
    owner_reads: OwnerReads,
    db: Connection,
    tree_capacity: std::cell::Cell<usize>,
}

pub(super) struct ClosedPreparation {
    pub source: String,
    pub agent: String,
    pub copy: Option<Vec<u8>>,
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
            tree_capacity: Default::default(),
        })
    }

    /// Resource holders may address reserved nodes; user-facing Rail callers cannot.
    pub(super) fn resource_node(&self, id: &str) -> Result<RailNode, RpcError> {
        find(&load_nodes(&self.db, true)?, id).cloned()
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
        // NULL already materializes O3's Workstream default in the loader. Persisting
        // that implicit Order adds 40 allocations per forty-node read (R3696c).
        let work = work
            .map(serde_json::to_string)
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
        Self::created_by_in(&self.db, creator)
    }

    /// `created_by` read inside a caller's own transaction.
    pub(crate) fn created_by_in(db: &Connection, creator: &str) -> Result<Vec<String>, RpcError> {
        let mut query = db
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

    /// Last allocated identity, including removed nodes; SQLite never reuses it.
    pub fn last_id(&self) -> Result<i64, RpcError> {
        self.db
            .query_row(
                "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='nodes'), 0)",
                [],
                |row| row.get(0),
            )
            .map_err(sql)
    }

    pub fn node(&self, id: &str) -> Result<RailNode, RpcError> {
        find(&load(&self.db)?, id).cloned()
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

    /// A5213: the permission mode the saved conversation's Attempt last ran in, beside A21's data.
    pub fn save_conversation_yolo(&mut self, id: &str, yolo: bool) -> Result<(), RpcError> {
        self.db
            .execute(
                "UPDATE nodes SET conversation_yolo = ? WHERE id = ?",
                params![yolo, id],
            )
            .map_err(sql)?;
        Ok(())
    }

    /// A5213: whether the saved conversation last ran in YOLO.
    pub fn conversation_yolo(&self, id: &str) -> Result<bool, RpcError> {
        self.db
            .query_row(
                "SELECT conversation_yolo FROM nodes WHERE id = ?",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql)?
            .ok_or_else(|| RpcError::not_found(GONE_AGENT))
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
