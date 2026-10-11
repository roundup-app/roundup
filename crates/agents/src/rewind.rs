//! A35: Marks, the plan of a rewind and the rewind itself. A Mark is what the Daemon keeps for
//! one Agent when a Checkpoint is written: how far its conversation had come and a snapshot of
//! its Worktree's working files. A rewind restarts each Agent on a copy of its conversation cut
//! at the Mark; it never types a command into an Agent (P9).

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use contracts::agent::{NodeKind, RailNode};
use contracts::workstream::{Files, PlanAgent, Rewind, RewindPlan};
use rpc::{Ctx, OpenError, RpcError};
use rusqlite::{Connection, OptionalExtension, params};

use crate::{Agents, RESUME_ACK_BOUND, worktree};

/// What a Mark holds for one Agent. A field is `None` for an Agent with no conversation yet and
/// for one with no Worktree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Mark {
    pub agent: String,
    pub conversation: Option<String>,
    pub cwd: Option<String>,
    /// How long the conversation's file was.
    pub bytes: Option<u64>,
    /// The commit that holds the snapshot of the working files.
    pub snapshot: Option<String>,
}

/// The Marks and the progress of a rewind, in SQLite.
pub(crate) struct Marks {
    db: Mutex<Connection>,
}

impl Marks {
    pub fn open(path: &Path) -> Result<Self, OpenError> {
        let db = Connection::open(path)?;
        db.pragma_update(None, "journal_mode", "WAL")?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS marks (
                workstream TEXT NOT NULL,
                checkpoint INTEGER NOT NULL,
                agent TEXT NOT NULL,
                conversation TEXT,
                cwd TEXT,
                bytes INTEGER,
                snapshot TEXT,
                PRIMARY KEY (workstream, checkpoint, agent)
            );
            CREATE TABLE IF NOT EXISTS progress (
                workstream TEXT NOT NULL,
                checkpoint INTEGER NOT NULL,
                agent TEXT NOT NULL,
                step TEXT NOT NULL,
                conversation TEXT,
                PRIMARY KEY (workstream, checkpoint, agent)
            );",
        )?;
        Ok(Self { db: Mutex::new(db) })
    }

    fn db(&self) -> MutexGuard<'_, Connection> {
        self.db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn record(&self, workstream: &str, checkpoint: u32, marks: &[Mark]) -> Result<(), RpcError> {
        let mut db = self.db();
        let tx = db.transaction().map_err(RpcError::internal)?;
        for mark in marks {
            tx.execute(
                "INSERT OR REPLACE INTO marks
                 (workstream, checkpoint, agent, conversation, cwd, bytes, snapshot)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    workstream,
                    checkpoint,
                    mark.agent,
                    mark.conversation,
                    mark.cwd,
                    mark.bytes.map(|bytes| bytes as i64),
                    mark.snapshot
                ],
            )
            .map_err(RpcError::internal)?;
        }
        tx.commit().map_err(RpcError::internal)
    }

    fn rows(&self, workstream: &str, checkpoint: u32) -> Result<Vec<Mark>, RpcError> {
        let db = self.db();
        let mut statement = db
            .prepare(
                "SELECT agent, conversation, cwd, bytes, snapshot FROM marks
                 WHERE workstream = ?1 AND checkpoint = ?2 ORDER BY agent",
            )
            .map_err(RpcError::internal)?;
        statement
            .query_map(params![workstream, checkpoint], |row| {
                Ok(Mark {
                    agent: row.get(0)?,
                    conversation: row.get(1)?,
                    cwd: row.get(2)?,
                    bytes: row.get::<_, Option<i64>>(3)?.map(|bytes| bytes as u64),
                    snapshot: row.get(4)?,
                })
            })
            .and_then(Iterator::collect)
            .map_err(RpcError::internal)
    }

    fn rewindable(&self, workstream: &str) -> Result<Vec<u32>, RpcError> {
        let db = self.db();
        let mut statement = db
            .prepare(
                "SELECT DISTINCT checkpoint FROM marks WHERE workstream = ?1 ORDER BY checkpoint",
            )
            .map_err(RpcError::internal)?;
        statement
            .query_map(params![workstream], |row| row.get(0))
            .and_then(Iterator::collect)
            .map_err(RpcError::internal)
    }

    /// Delete every Mark of a Checkpoint after `checkpoint`; returns the rows deleted.
    fn forget_after(
        &self,
        workstream: &str,
        checkpoint: u32,
    ) -> Result<Vec<(u32, Mark)>, RpcError> {
        let mut db = self.db();
        let tx = db.transaction().map_err(RpcError::internal)?;
        let gone: Vec<(u32, Mark)> = {
            let mut statement = tx
                .prepare(
                    "SELECT checkpoint, agent, conversation, cwd, bytes, snapshot FROM marks
                     WHERE workstream = ?1 AND checkpoint > ?2",
                )
                .map_err(RpcError::internal)?;
            statement
                .query_map(params![workstream, checkpoint], |row| {
                    Ok((
                        row.get(0)?,
                        Mark {
                            agent: row.get(1)?,
                            conversation: row.get(2)?,
                            cwd: row.get(3)?,
                            bytes: row.get::<_, Option<i64>>(4)?.map(|bytes| bytes as u64),
                            snapshot: row.get(5)?,
                        },
                    ))
                })
                .and_then(Iterator::collect)
                .map_err(RpcError::internal)?
        };
        tx.execute(
            "DELETE FROM marks WHERE workstream = ?1 AND checkpoint > ?2",
            params![workstream, checkpoint],
        )
        .map_err(RpcError::internal)?;
        tx.commit().map_err(RpcError::internal)?;
        Ok(gone)
    }

    fn step(&self, workstream: &str, checkpoint: u32, agent: &str) -> Result<Step, RpcError> {
        let found: Option<(String, Option<String>)> = self
            .db()
            .query_row(
                "SELECT step, conversation FROM progress
                 WHERE workstream = ?1 AND checkpoint = ?2 AND agent = ?3",
                params![workstream, checkpoint, agent],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(RpcError::internal)?;
        Ok(match found {
            None => Step::Todo,
            Some((step, _)) if step == "removed" => Step::Removed,
            Some((step, _)) if step == "restarted" => Step::Restarted,
            Some((_, conversation)) => Step::Copied(conversation),
        })
    }

    fn set_step(
        &self,
        workstream: &str,
        checkpoint: u32,
        agent: &str,
        step: &str,
        conversation: Option<&str>,
    ) -> Result<(), RpcError> {
        self.db()
            .execute(
                "INSERT OR REPLACE INTO progress (workstream, checkpoint, agent, step, conversation)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![workstream, checkpoint, agent, step, conversation],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }

    fn removed(&self, workstream: &str, checkpoint: u32) -> Result<Vec<String>, RpcError> {
        let db = self.db();
        let mut statement = db
            .prepare(
                "SELECT agent FROM progress WHERE workstream = ?1 AND checkpoint = ?2
                 AND step = 'removed' ORDER BY rowid",
            )
            .map_err(RpcError::internal)?;
        statement
            .query_map(params![workstream, checkpoint], |row| row.get(0))
            .and_then(Iterator::collect)
            .map_err(RpcError::internal)
    }

    fn finish(&self, workstream: &str, checkpoint: u32) -> Result<(), RpcError> {
        self.db()
            .execute(
                "DELETE FROM progress WHERE workstream = ?1 AND checkpoint = ?2",
                params![workstream, checkpoint],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }
}

/// How far a rewind has come for one Agent.
enum Step {
    Todo,
    /// Its conversation is the copy with this id.
    Copied(Option<String>),
    Restarted,
    Removed,
}

fn snapshot_name(workstream: &str, checkpoint: u32, agent: &str) -> String {
    format!("{workstream}/{checkpoint}/{agent}")
}

/// A random version 4 UUID, as Claude Code names a conversation.
fn new_conversation_id() -> Result<String, RpcError> {
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut random| random.read_exact(&mut bytes))
        .map_err(RpcError::internal)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

/// The first `bytes` bytes of `source`, cut after the last whole line, written to `target` with
/// every `sessionId` field set to `conversation`.
fn copy_cut(source: &Path, bytes: u64, target: &Path, conversation: &str) -> Result<(), RpcError> {
    let mut whole = Vec::new();
    std::fs::File::open(source)
        .and_then(|file| file.take(bytes).read_to_end(&mut whole))
        .map_err(|error| {
            RpcError::conflict(format!(
                "conversation_missing: {}: {error}",
                source.display()
            ))
        })?;
    let end = whole
        .iter()
        .rposition(|b| *b == b'\n')
        .map_or(0, |at| at + 1);
    let mut copy = Vec::with_capacity(end);
    for line in String::from_utf8_lossy(&whole[..end]).lines() {
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(mut entry) if entry.get("sessionId").is_some() => {
                entry["sessionId"] = conversation.into();
                copy.extend(entry.to_string().into_bytes());
            }
            _ => copy.extend(line.as_bytes()),
        }
        copy.push(b'\n');
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(RpcError::internal)?;
    }
    std::fs::write(target, copy).map_err(RpcError::internal)
}

/// The Agents of Workstream `workstream`, the Door first, then the rest in Rail order.
fn agents_of(nodes: &[RailNode], workstream: &str) -> Vec<RailNode> {
    let mut found: Vec<RailNode> = nodes
        .iter()
        .filter(|node| node.id == workstream && node.kind == NodeKind::Workstream)
        .cloned()
        .collect();
    let mut under: HashSet<String> = HashSet::from([workstream.to_owned()]);
    loop {
        let before = under.len();
        for node in nodes {
            if node.kind == NodeKind::Agent
                && node
                    .parent
                    .as_ref()
                    .is_some_and(|parent| under.contains(parent))
                && under.insert(node.id.clone())
            {
                found.push(node.clone());
            }
        }
        if under.len() == before {
            return found;
        }
    }
}

/// How many Agents lie between `node` and its Workstream.
fn depth(nodes: &[RailNode], node: &RailNode) -> usize {
    let mut depth = 0;
    let mut at = node;
    while let Some(parent) = at
        .parent
        .as_ref()
        .and_then(|parent| nodes.iter().find(|n| &n.id == parent))
    {
        depth += 1;
        at = parent;
    }
    depth
}

impl Agents {
    fn workstream_nodes(
        &self,
        workstream: &str,
    ) -> Result<(Vec<RailNode>, Vec<RailNode>), RpcError> {
        let nodes = self.shared.tree()?;
        if !nodes
            .iter()
            .any(|node| node.id == workstream && node.kind == NodeKind::Workstream)
        {
            return Err(RpcError::not_found(format!("workstream {workstream}")));
        }
        let agents = agents_of(&nodes, workstream);
        Ok((nodes, agents))
    }

    fn takes_over(&self, agent: &str) -> bool {
        self.shared
            .takeover
            .as_ref()
            .is_some_and(|active| active(agent))
    }

    /// A35: record a Mark for every Agent of `workstream` as Checkpoint `checkpoint` is written.
    /// A Mark that cannot be made leaves the Checkpoint not `rewindable`.
    pub async fn record_marks(&self, workstream: &str, checkpoint: u32) -> Result<(), RpcError> {
        let (_, agents) = self.workstream_nodes(workstream)?;
        let mut marks = Vec::new();
        for node in agents {
            let (conversation, cwd, bytes) = match self.shared.rail().conversation(&node.id)? {
                Some((conversation, cwd)) => {
                    let bytes = self
                        .launcher
                        .conversation_file(Path::new(&cwd), &conversation)
                        .and_then(|file| std::fs::metadata(file).ok())
                        .map(|meta| meta.len());
                    match bytes {
                        Some(_) => (Some(conversation), Some(cwd), bytes),
                        None => (None, Some(cwd), None),
                    }
                }
                None => (None, None, None),
            };
            let snapshot = match &node.worktree {
                Some(record) => {
                    let (git, wt) = (self.shared.git.clone(), worktree::Worktree::from(record));
                    let name = snapshot_name(workstream, checkpoint, &node.id);
                    Some(
                        tokio::task::spawn_blocking(move || git.snapshot(&wt, &name))
                            .await
                            .map_err(RpcError::internal)??,
                    )
                }
                None => None,
            };
            marks.push(Mark {
                agent: node.id,
                conversation,
                cwd,
                bytes,
                snapshot,
            });
        }
        self.marks.record(workstream, checkpoint, &marks)
    }

    /// A35: the Checkpoints of `workstream` that have Marks.
    pub fn rewindable(&self, workstream: &str) -> Result<Vec<u32>, RpcError> {
        self.marks.rewindable(workstream)
    }

    fn marks_of(&self, workstream: &str, checkpoint: u32) -> Result<Vec<Mark>, RpcError> {
        let marks = self.marks.rows(workstream, checkpoint)?;
        if marks.is_empty() {
            return Err(RpcError::conflict(format!(
                "checkpoint {checkpoint} of {workstream} is not rewindable"
            )));
        }
        Ok(marks)
    }

    /// A35: what a rewind to `checkpoint` would do. Changes nothing.
    pub async fn rewind_plan(
        &self,
        workstream: &str,
        checkpoint: u32,
    ) -> Result<RewindPlan, RpcError> {
        let (_, agents) = self.workstream_nodes(workstream)?;
        let marks = self.marks_of(workstream, checkpoint)?;
        let mut plan = Vec::new();
        for node in agents {
            let mark = marks.iter().find(|mark| mark.agent == node.id);
            let files_changed = match (mark.and_then(|m| m.snapshot.clone()), &node.worktree) {
                (Some(snapshot), Some(record)) => {
                    let (git, wt) = (self.shared.git.clone(), worktree::Worktree::from(record));
                    tokio::task::spawn_blocking(move || git.changed_since(&wt, &snapshot))
                        .await
                        .map_err(RpcError::internal)??
                }
                _ => Vec::new(),
            };
            plan.push(PlanAgent {
                takeover: self.takes_over(&node.id),
                created_after: mark.is_none(),
                agent: node.id,
                name: node.name,
                files_changed,
            });
        }
        let files_changed = plan.iter().any(|agent| !agent.files_changed.is_empty());
        Ok(RewindPlan {
            agents: plan,
            files_changed,
        })
    }

    /// A35: take every Agent of `workstream` back to `checkpoint`, except an Agent under
    /// Takeover. A step that failed is done again by the next call with the same parameters; one
    /// that finished is not.
    pub async fn rewind(
        &self,
        ctx: &Ctx,
        workstream: &str,
        checkpoint: u32,
        files: Files,
    ) -> Result<Rewind, RpcError> {
        let (nodes, agents) = self.workstream_nodes(workstream)?;
        let marks = self.marks_of(workstream, checkpoint)?;
        let mut result = Rewind {
            rewound: Vec::new(),
            removed: self.marks.removed(workstream, checkpoint)?,
            skipped: Vec::new(),
        };
        let mut later: Vec<&RailNode> = agents
            .iter()
            .filter(|node| !marks.iter().any(|mark| mark.agent == node.id))
            .collect();
        later.sort_by_key(|node| std::cmp::Reverse(depth(&nodes, node)));
        for node in later {
            if self.takes_over(&node.id) {
                result.skipped.push(node.id.clone());
                continue;
            }
            self.shared
                .end_with(ctx.actor.clone(), &node.id, true, false, true)
                .await?;
            self.marks
                .set_step(workstream, checkpoint, &node.id, "removed", None)?;
            result.removed.push(node.id.clone());
        }
        // The Door is restarted last, once what is told to it has happened.
        for node in agents.iter().rev() {
            let Some(mark) = marks.iter().find(|mark| mark.agent == node.id) else {
                continue;
            };
            if self.takes_over(&node.id) {
                result.skipped.push(node.id.clone());
                continue;
            }
            self.rewind_agent(ctx, workstream, checkpoint, node, mark, files)
                .await?;
            result.rewound.push(node.id.clone());
        }
        for (stale, mark) in self.marks.forget_after(workstream, checkpoint)? {
            if mark.snapshot.is_some() {
                self.shared.git.forget_snapshot(
                    &self.shared.project_dir,
                    &snapshot_name(workstream, stale, &mark.agent),
                );
            }
        }
        self.marks.finish(workstream, checkpoint)?;
        Ok(result)
    }

    async fn rewind_agent(
        &self,
        ctx: &Ctx,
        workstream: &str,
        checkpoint: u32,
        node: &RailNode,
        mark: &Mark,
        files: Files,
    ) -> Result<(), RpcError> {
        let id = node.id.as_str();
        let copied = match self.marks.step(workstream, checkpoint, id)? {
            Step::Restarted => return Ok(()),
            Step::Removed => return Ok(()),
            Step::Copied(copied) => Some(copied),
            Step::Todo => None,
        };
        if copied.is_none() {
            self.shared.stop(ctx.actor.clone(), id).await?;
            if files == Files::Restore
                && let (Some(snapshot), Some(record)) = (mark.snapshot.clone(), &node.worktree)
            {
                let (git, wt) = (self.shared.git.clone(), worktree::Worktree::from(record));
                tokio::task::spawn_blocking(move || git.restore(&wt, &snapshot))
                    .await
                    .map_err(RpcError::internal)??;
            }
            let fresh = match (&mark.conversation, &mark.cwd, mark.bytes) {
                (Some(conversation), Some(cwd), Some(bytes)) => {
                    let copy = new_conversation_id()?;
                    let (source, target) = self
                        .conversation_files(cwd, conversation, &copy)
                        .ok_or_else(|| {
                            RpcError::conflict("conversation_missing: no config folder")
                        })?;
                    copy_cut(&source, bytes, &target, &copy)?;
                    self.shared.rail().save_conversation(id, &copy, cwd)?;
                    Some(copy)
                }
                // No conversation had begun at the Checkpoint: the next start is a fresh one.
                _ => {
                    self.shared.rail().clear_conversation(id)?;
                    None
                }
            };
            self.marks
                .set_step(workstream, checkpoint, id, "copied", fresh.as_deref())?;
        }
        if copied == Some(None) || (copied.is_none() && mark.conversation.is_none()) {
            // No conversation had begun at the Checkpoint: a Door starts fresh, so it can be
            // told; any other Agent stays stopped until it is started.
            if node.kind == NodeKind::Workstream {
                self.start_door(ctx, id).await?;
            }
        } else {
            self.resume_saved(ctx, id, RESUME_ACK_BOUND).await?;
        }
        self.marks
            .set_step(workstream, checkpoint, id, "restarted", None)
    }

    fn conversation_files(&self, cwd: &str, from: &str, to: &str) -> Option<(PathBuf, PathBuf)> {
        let cwd = Path::new(cwd);
        Some((
            self.launcher.conversation_file(cwd, from)?,
            self.launcher.conversation_file(cwd, to)?,
        ))
    }
}
