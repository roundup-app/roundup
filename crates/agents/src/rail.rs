//! The Rail: Workstreams, Agents and Terminals as a tree in SQLite (WAL).
//! Sibling `order` values are contiguous from 0. Workstreams sit at the root and never nest (A26);
//! an Agent sits under a Workstream or under the Agent that started it, to any depth.

mod alert;
mod closed;
pub(crate) mod error;
mod lookup;
mod placement;
mod queue;
mod removal;
mod row;
mod settings;
mod view;
use crate::id::AgentId;
use error::StoreError;
pub use lookup::{home_in, is_home_in, maker_in, registered_in};
pub(crate) use row::NewAgent;
use view::load_nodes;

use std::path::Path;

use contracts::agent::{CapturedOrder, NodeKind, Order, RailNode, StartAttribution, Worktree};
use contracts::project::{Mcp, Prepared, ProjectModels, RoleModels, Worktrees};
use rpc::{OpenError, RpcError};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

const GONE_AGENT: &str = "an Agent that is gone";

/// The one parse of a wire id; a string that is no `AgentId` names no node.
pub(crate) fn agent_id(id: &str) -> Result<AgentId, StoreError> {
    AgentId::parse(id).ok_or_else(|| StoreError::not_found(GONE_AGENT))
}

/// Structure only: a node's `status` is the Agents module's to fill in.
pub struct Rail {
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
        let obsolete: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM nodes WHERE kind NOT IN ('workstream','agent','group') OR (kind='group' AND terminal_id IS NOT NULL) OR (kind='workstream' AND EXISTS (WITH RECURSIVE ancestors(id,parent,kind) AS (SELECT id,parent,kind FROM nodes p WHERE p.id=nodes.parent UNION ALL SELECT p.id,p.parent,p.kind FROM nodes p JOIN ancestors a ON p.id=a.parent) SELECT 1 FROM ancestors WHERE kind<>'group')))",
            [], |r| r.get(0),
        )?;
        if obsolete {
            let folder = std::path::absolute(path.parent().unwrap_or(Path::new(".")))?;
            return Err(OpenError::from(format!(
                "Local data is incompatible with this build; close roundup and delete {} to start fresh.",
                folder.display()
            )));
        }
        // Terminal ids restart at 1 with the Daemon, so a stored id could name an unrelated Terminal.
        db.execute("UPDATE nodes SET terminal_id = NULL", [])?;
        Ok(Self {
            db,
            tree_capacity: Default::default(),
        })
    }

    /// Resource holders may address reserved nodes; user-facing Rail callers cannot.
    pub(super) fn resource_node(&self, id: AgentId) -> Result<RailNode, StoreError> {
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
    ) -> Result<RailNode, StoreError> {
        self.insert_ordered(kind, name, parent, terminal_id, None, None)
    }

    /// `insert` with the node's order (O2, O3); `None` is a Workstream's default and an Agent's no order.
    pub fn insert_ordered(
        &mut self,
        kind: NodeKind,
        name: &str,
        parent: Option<&str>,
        terminal_id: Option<&str>,
        work: Option<&Order>,
        start_attribution: Option<&StartAttribution>,
    ) -> Result<RailNode, StoreError> {
        // NULL already materializes O3's Workstream default in the loader. Persisting
        // that implicit Order adds 40 allocations per forty-node read (R3696c).
        let work = work.map(serde_json::to_string).transpose()?;
        let start_attribution = start_attribution.map(serde_json::to_string).transpose()?;
        let tx = self.db.transaction()?;
        let nodes = load(&tx)?;
        check_parent(&nodes, kind, parent)?;
        let order = siblings(&nodes, parent).len() as i64;
        tx.execute(
            "INSERT INTO nodes (kind, name, parent, ord, terminal_id, work, start_attribution)
                VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                kind_name(kind),
                name,
                parent,
                order,
                terminal_id,
                work,
                start_attribution
            ],
        )?;
        let id = tx.last_insert_rowid().to_string();
        tx.commit()?;
        self.node(agent_id(&id)?)
    }

    /// O13: whether an Agent's `agent.spawn` started `id` and `door` is above it: the `parent`
    /// chain of `id` reaches `door`.
    pub fn spawned_under(&self, id: AgentId, door: AgentId) -> Result<bool, StoreError> {
        let started: Option<String> = self.db.query_row(
            "SELECT spawner FROM nodes WHERE id = ?",
            params![id.get()],
            |row| row.get(0),
        )?;
        if started.is_none() {
            return Ok(false);
        }
        let nodes = load(&self.db)?;
        let mut at = find(&nodes, id)?.parent.clone();
        while let Some(parent) = at {
            if parent == door.to_string() {
                return Ok(true);
            }
            at = find_stored(&nodes, &parent)?.parent.clone();
        }
        Ok(false)
    }

    /// DCL9: the role stored for `id`; `None` for the user's own Agents. `NOT_FOUND` for an unknown id.
    pub fn role(&self, id: AgentId) -> Result<Option<contracts::agent::SpawnRole>, StoreError> {
        self.node(id)?;
        Ok(self.db.query_row(
            "SELECT role FROM nodes WHERE id = ?",
            params![id.get()],
            |row| Ok(row.get::<_, Option<row::Word<_>>>(0)?.map(|role| role.0)),
        )?)
    }

    /// O8: the prompt kept for `id`, `None` when it has none; `NOT_FOUND` for an unknown id.
    pub fn spawn_prompt(&self, id: AgentId) -> Result<Option<String>, StoreError> {
        self.node(id)?;
        Ok(self.db.query_row(
            "SELECT spawn_prompt FROM nodes WHERE id = ?",
            params![id.get()],
            |row| row.get(0),
        )?)
    }

    /// O4, U2773c: compare the captured base and replace the Order in one immediate
    /// transaction. Refusal precedes every Touch, Event and Steer.
    pub fn set_order(
        &mut self,
        id: AgentId,
        order: &Order,
        captured: Option<&CapturedOrder>,
    ) -> Result<RailNode, StoreError> {
        let tx = self.db.transaction()?;
        let mut node = find(&load(&tx)?, id)?.clone();
        if let Some(base) = captured
            && node.work != base.order
        {
            return Err(StoreError::conflict("Order changed since it was captured"));
        }
        let json = serde_json::to_string(order)?;
        tx.execute(
            "UPDATE nodes SET work = ? WHERE id = ?",
            params![json, node.id],
        )?;
        if matches!(order, Order::Clarification { .. }) {
            tx.execute("UPDATE nodes SET visibility='shown' WHERE id=?", [id.get()])?;
            node.visibility = contracts::agent::RailVisibility::Shown;
        }
        tx.commit()?;
        node.work = Some(order.clone());
        Ok(node)
    }

    pub(super) fn order_revision(&self, id: AgentId) -> Result<Option<String>, StoreError> {
        Ok(self.db.query_row(
            "SELECT CAST(max(revision) AS TEXT) FROM instruction_revisions WHERE agent=? AND message IS NULL",
            [id.to_string()], |row| row.get(0),
        )?)
    }

    pub(super) fn prepare_instruction(
        &mut self,
        revision: &str,
        attempt: &str,
        text: &str,
        first: bool,
    ) -> Result<String, StoreError> {
        self.db.execute(
            "INSERT INTO instruction_deliveries(revision,attempt,text,state,first) VALUES(?,?,?,'prepared',?)",
            params![revision, attempt, text, first],
        )?;
        Ok(self.db.last_insert_rowid().to_string())
    }

    pub(super) fn first_instruction(
        &self,
        agent: AgentId,
        attempt: &str,
    ) -> Result<Option<String>, StoreError> {
        Ok(self.db.query_row(
            "SELECT CAST(d.id AS TEXT) FROM instruction_deliveries d JOIN instruction_revisions r ON r.revision=d.revision
             WHERE r.agent=? AND d.attempt=? AND d.first=1 ORDER BY d.id DESC LIMIT 1",
            params![agent.to_string(), attempt], |row| row.get(0),
        ).optional()?)
    }

    pub(super) fn instruction_state(
        &mut self,
        delivery: &str,
        state: contracts::agent::InstructionState,
    ) -> Result<(), StoreError> {
        let state = serde_json::to_value(state)?;
        self.db.execute(
            "UPDATE instruction_deliveries SET state=? WHERE id=?",
            params![state.as_str(), delivery],
        )?;
        Ok(())
    }

    pub(super) fn instructions(
        &mut self,
        id: AgentId,
        project: &str,
    ) -> Result<contracts::agent::Instructions, StoreError> {
        use contracts::agent::{
            Instruction, InstructionDelivery, InstructionRevision, Instructions,
        };
        let tx = self.db.transaction()?;
        let home = tx
            .query_row(
                "SELECT home FROM instruction_homes WHERE agent=?",
                [id.to_string()],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::not_found(GONE_AGENT))?;
        let rows = tx.prepare("SELECT revision,workstream,work,message,text FROM instruction_revisions WHERE agent=? ORDER BY revision")?
            .query_map([id.to_string()], |row| Ok((row.get::<_,i64>(0)?,row.get::<_,Option<String>>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,Option<u32>>(3)?,row.get::<_,Option<String>>(4)?)))
            ?.collect::<Result<Vec<_>,_>>()?;
        let mut revisions = Vec::new();
        let mut current = None;
        for (revision, workstream, work, message, text) in rows {
            let revision = revision.to_string();
            let instruction = match (work, message, text) {
                (Some(work), None, None) => {
                    current = Some(revision.clone());
                    Instruction::Order {
                        order: serde_json::from_str(&work)?,
                    }
                }
                (None, Some(message), Some(text)) => Instruction::Message { message, text },
                _ => return Err(StoreError::internal("invalid retained instruction")),
            };
            revisions.push(InstructionRevision {
                revision,
                agent: id.to_string(),
                workstream,
                instruction,
            });
        }
        let rows = tx.prepare("SELECT d.id,d.revision,d.attempt,d.text,d.state FROM instruction_deliveries d JOIN instruction_revisions r ON r.revision=d.revision WHERE r.agent=? ORDER BY d.id")?
            .query_map([id.to_string()], |row| Ok((row.get::<_,i64>(0)?,row.get::<_,i64>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?)))
            ?.collect::<Result<Vec<_>,_>>()?;
        let deliveries = rows
            .into_iter()
            .map(|(id, revision, attempt, text, state)| {
                Ok(InstructionDelivery {
                    id: id.to_string(),
                    revision: revision.to_string(),
                    attempt,
                    text,
                    state: serde_json::from_value(serde_json::Value::String(state))?,
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        let present: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM nodes WHERE id=?)",
            [id.get()],
            |row| row.get(0),
        )?;
        if !present {
            current = None;
        }
        tx.commit()?;
        Ok(Instructions {
            project: project.to_owned(),
            home,
            current,
            revisions,
            deliveries,
        })
    }

    pub fn rename(&mut self, id: AgentId, name: &str) -> Result<RailNode, StoreError> {
        // SQLite would match "01" to node 1; only the exact id names a node.
        let node = self.node(id)?;
        self.db.execute(
            "UPDATE nodes SET name = ? WHERE id = ?",
            params![name, node.id],
        )?;
        self.node(id)
    }

    /// U6380c: mark node `id` as named by the user, so no automatic rename takes its name.
    pub fn set_user_named(&mut self, id: AgentId) -> Result<(), StoreError> {
        let node = self.node(id)?;
        self.db.execute(
            "UPDATE nodes SET user_named = 1 WHERE id = ?",
            params![node.id],
        )?;
        Ok(())
    }

    /// U6380c: whether the user named node `id`.
    pub fn user_named(&self, id: AgentId) -> Result<bool, StoreError> {
        let node = self.node(id)?;
        Ok(self.db.query_row(
            "SELECT user_named FROM nodes WHERE id = ?",
            params![node.id],
            |row| row.get(0),
        )?)
    }

    pub fn allocate_attempt(
        &mut self,
        id: AgentId,
    ) -> Result<contracts::agent::Ordinal, StoreError> {
        let next = match self.node(id)?.attempt {
            Some(previous) => previous
                .next()
                .ok_or_else(|| StoreError::internal("Attempt exhausted"))?,
            None => contracts::agent::Ordinal::first(),
        };
        self.db.execute(
            "UPDATE nodes SET attempt = ?, cut_off = 0 WHERE id = ?",
            params![next.get(), id.get()],
        )?;
        Ok(next)
    }

    /// DCR1: record that a quit ended each of `ids` mid-turn; a new Attempt clears it.
    pub fn mark_cut_off(&mut self, ids: &[String]) -> Result<(), StoreError> {
        let tx = self.db.transaction()?;
        for id in ids {
            tx.execute("UPDATE nodes SET cut_off = 1 WHERE id = ?", params![id])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// DCR1: whether a quit cut `id` off mid-turn and nothing has started it since.
    pub fn is_cut_off(&self, id: AgentId) -> Result<bool, StoreError> {
        self.node(id)?;
        Ok(self.db.query_row(
            "SELECT cut_off FROM nodes WHERE id = ?",
            params![id.get()],
            |row| row.get(0),
        )?)
    }

    pub fn detach_terminal(&mut self, id: AgentId) -> Result<(), StoreError> {
        self.db.execute(
            "UPDATE nodes SET terminal_id = NULL WHERE id = ?",
            params![id.get()],
        )?;
        Ok(())
    }

    /// Record which Terminal runs the Agent `id`.
    pub fn attach_terminal(&mut self, id: AgentId, terminal_id: &str) -> Result<(), StoreError> {
        let changed = self.db.execute(
            "UPDATE nodes SET terminal_id = ? WHERE id = ?",
            params![terminal_id, id.get()],
        )?;
        if changed == 0 {
            return Err(StoreError::not_found(GONE_AGENT));
        }
        Ok(())
    }

    /// M7: record that Agent `creator` created node `id`; it goes with the node.
    pub fn set_creator(&mut self, id: AgentId, creator: &str) -> Result<(), StoreError> {
        self.db.execute(
            "UPDATE nodes SET creator = ? WHERE id = ?",
            params![creator, id.get()],
        )?;
        Ok(())
    }

    /// A5214a: turn root Agent `id` into a Workstream in place; `Ok(false)` when it is not a root
    /// Agent. `to_workstream = false` undoes it.
    pub fn convert_kind(&mut self, id: AgentId, to_workstream: bool) -> Result<bool, StoreError> {
        let (from, to) = if to_workstream {
            ("agent", "workstream")
        } else {
            ("workstream", "agent")
        };
        let changed = self.db.execute(
            "UPDATE nodes SET kind = ?1 WHERE id = ?2 AND kind = ?3 AND parent IS NULL",
            params![to, id.get(), from],
        )?;
        Ok(changed == 1)
    }

    /// M7: the ids of the Workstreams Agent `creator` created and that still exist.
    pub fn created_by(&self, creator: &str) -> Result<Vec<String>, StoreError> {
        Self::created_by_in(&self.db, creator)
    }

    /// `created_by` read inside a caller's own transaction.
    pub(crate) fn created_by_in(db: &Connection, creator: &str) -> Result<Vec<String>, StoreError> {
        let mut query = db.prepare("SELECT id FROM nodes WHERE creator = ?")?;
        let rows = query.query_map(params![creator], |row| {
            Ok(row.get::<_, i64>(0)?.to_string())
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Current Rail name for prose; an absent node has no machine identity to display.
    pub fn name(&self, id: AgentId) -> Result<String, StoreError> {
        Ok(self.db
            .query_row(
                "SELECT name FROM nodes WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0 AND (agent=nodes.id OR workstream=nodes.id))",
                [id.get()],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| GONE_AGENT.into()))
    }

    /// `name` for a wire id that may name no node (an Actor that is no Agent): it reads as gone.
    pub fn name_or_gone(&self, wire: &str) -> Result<String, StoreError> {
        match AgentId::parse(wire) {
            Some(id) => self.name(id),
            None => Ok(GONE_AGENT.into()),
        }
    }

    /// Last allocated identity, including removed nodes; SQLite never reuses it.
    pub fn last_id(&self) -> Result<i64, StoreError> {
        Ok(self.db.query_row(
            "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='nodes'), 0)",
            [],
            |row| row.get(0),
        )?)
    }

    pub fn node(&self, id: AgentId) -> Result<RailNode, StoreError> {
        find(&load(&self.db)?, id).cloned()
    }

    pub fn mark_worktree_provisioning(
        &mut self,
        id: AgentId,
        plan: &super::worktree::Provision,
    ) -> Result<(), StoreError> {
        self.db.execute("UPDATE nodes SET worktree_state='provisioning', worktree_path=?, worktree_branch=?, worktree_base=?, worktree_owner=?, worktree_commit=? WHERE id=?", params![plan.worktree.path.to_string_lossy(), plan.worktree.branch, plan.worktree.base, plan.owner, plan.commit, id.get()])?;
        Ok(())
    }

    /// Each node with a Worktree record still owned by provisioning, with its plan and whether
    /// it reached `ready`; the plan is `None` for a legacy record with no ownership proof (G6),
    /// which no caller may clean up.
    pub fn provisioning(
        &self,
    ) -> Result<Vec<(RailNode, Option<super::worktree::Provision>, bool)>, StoreError> {
        let mut records = Vec::new();
        for node in load_nodes(&self.db, true)? {
            let (state, owner, commit): (Option<String>, Option<String>, Option<String>) =
                self.db.query_row(
                    "SELECT worktree_state, worktree_owner, worktree_commit FROM nodes WHERE id=?",
                    [&node.id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )?;
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

    pub fn clear_provisioning_owner(&mut self, id: AgentId) -> Result<(), StoreError> {
        self.db.execute(
            "UPDATE nodes SET worktree_owner=NULL, worktree_commit=NULL WHERE id=?",
            [id.get()],
        )?;
        Ok(())
    }

    /// Record a Worktree Provisioning made for `id`, just before its Terminal starts.
    pub fn set_worktree(&mut self, id: AgentId, worktree: &Worktree) -> Result<(), StoreError> {
        let path = worktree.path.as_str();
        self.db.execute(
            "UPDATE nodes SET worktree_path = ?, worktree_branch = ?, worktree_base = ?,
                    worktree_state = 'ready' WHERE id = ?",
            params![path, worktree.branch, worktree.base, id.get()],
        )?;
        Ok(())
    }

    /// Undo `mark_worktree_provisioning`/`set_worktree` for a node that keeps its place on the
    /// Rail (`rail.startDoor`'s own failure path; a failed `agent.spawn` deletes the node outright).
    pub fn clear_worktree(&mut self, id: AgentId) -> Result<(), StoreError> {
        self.db
            .execute(
                "UPDATE nodes SET worktree_path = NULL, worktree_branch = NULL,
                    worktree_base = NULL, worktree_state = NULL, worktree_owner=NULL, worktree_commit=NULL WHERE id = ?",
                params![id.get()],
            )
            ?;
        Ok(())
    }

    /// A21: save the vendor conversation id and the effective cwd it was launched in, replacing
    /// any earlier save. `id` must already name a node.
    pub fn save_conversation(
        &mut self,
        id: AgentId,
        conversation_id: &str,
        cwd: &str,
    ) -> Result<(), StoreError> {
        let changed = self.db.execute(
            "UPDATE nodes SET conversation_id = ?, conversation_cwd = ? WHERE id = ?",
            params![conversation_id, cwd, id.get()],
        )?;
        if changed == 0 {
            return Err(StoreError::not_found(GONE_AGENT));
        }
        Ok(())
    }

    /// A5213: the permission mode the saved conversation's Attempt last ran in, beside A21's data.
    pub fn save_conversation_yolo(&mut self, id: AgentId, yolo: bool) -> Result<(), StoreError> {
        self.db.execute(
            "UPDATE nodes SET conversation_yolo = ? WHERE id = ?",
            params![yolo, id.get()],
        )?;
        Ok(())
    }

    /// A5213: whether the saved conversation last ran in YOLO.
    pub fn conversation_yolo(&self, id: AgentId) -> Result<bool, StoreError> {
        self.db
            .query_row(
                "SELECT conversation_yolo FROM nodes WHERE id = ?",
                [id.get()],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::not_found(GONE_AGENT))
    }

    /// The saved conversation id and cwd (A21), if any.
    pub fn conversation(&self, id: AgentId) -> Result<Option<(String, String)>, StoreError> {
        let found: (Option<String>, Option<String>) = self
            .db
            .query_row(
                "SELECT conversation_id, conversation_cwd FROM nodes WHERE id = ?
                    AND NOT EXISTS (SELECT 1 FROM closed_sources WHERE published=0 AND (workstream=nodes.id OR agent=nodes.id))",
                [id.get()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            ?
            .ok_or_else(|| StoreError::not_found(GONE_AGENT))?;
        Ok(match found {
            (Some(conversation_id), Some(cwd)) => Some((conversation_id, cwd)),
            _ => None,
        })
    }

    /// Whether `id` has A21 data; used to compute `can_resume` without exposing the id itself.
    pub fn has_conversation(&self, id: AgentId) -> Result<bool, StoreError> {
        Ok(self.conversation(id)?.is_some())
    }
}

/// O3: the order a Workstream's Door holds when none was given. An Agent holds none (O2).
fn workstream_order() -> Order {
    Order::clarification("What is this Workstream for?")
}

fn kind_name(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Group => "group",
        NodeKind::Workstream => "workstream",
        NodeKind::Agent => "agent",
    }
}

fn load(db: &Connection) -> Result<Vec<RailNode>, StoreError> {
    load_nodes(db, false)
}

fn find(nodes: &[RailNode], id: AgentId) -> Result<&RailNode, StoreError> {
    nodes
        .iter()
        .find(|node| AgentId::parse(&node.id) == Some(id))
        .ok_or_else(|| StoreError::not_found(GONE_AGENT))
}

/// `find` for an id read back from a stored node, already a node's own.
fn find_stored<'a>(nodes: &'a [RailNode], stored: &str) -> Result<&'a RailNode, StoreError> {
    nodes
        .iter()
        .find(|node| node.id == stored)
        .ok_or_else(|| StoreError::not_found(GONE_AGENT))
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
fn check_parent(
    nodes: &[RailNode],
    kind: NodeKind,
    parent: Option<&str>,
) -> Result<(), StoreError> {
    let Some(parent) = parent.map(|id| find_stored(nodes, id)).transpose()? else {
        return Ok(());
    };
    match (kind, parent.kind) {
        (NodeKind::Workstream | NodeKind::Group, NodeKind::Group) => {
            let mut at = parent.parent.as_deref();
            while let Some(id) = at {
                let ancestor = find_stored(nodes, id)?;
                if kind == NodeKind::Workstream && ancestor.kind != NodeKind::Group {
                    return Err(StoreError::conflict("Workstreams never nest"));
                }
                at = ancestor.parent.as_deref();
            }
            Ok(())
        }
        (NodeKind::Group, _) => Ok(()),
        (NodeKind::Workstream, _) => Err(StoreError::conflict(format!(
            "Workstreams never nest: a Workstream cannot sit under {}",
            parent.id
        ))),
        (NodeKind::Agent, _) => Ok(()),
    }
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
fn place(tx: &Connection, parent: Option<&str>, ids: &[String]) -> Result<(), StoreError> {
    for (order, id) in (0_i64..).zip(ids) {
        tx.execute(
            "UPDATE nodes SET parent = ?, ord = ? WHERE id = ?",
            params![parent, order, id],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
