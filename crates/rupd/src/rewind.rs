//! A35: the Door rewinds its children to a Checkpoint with `workstream.rewindPlan` and
//! `workstream.rewind`. A child under Takeover waits as a held Door action (B6, `resize.rs`).
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use crate::Daemon;
use agents::marks::{MarkResume, Resume};
use contracts::agent::{HeldCall, NodeKind, RailNode};
use contracts::terminal::ResizeOutcome;
use contracts::workstream::{
    Files, PlanAgent, Rewind, RewindAgent, RewindParams, RewindPlan, RewindPlanParams, RewindState,
    Rewound,
};
use contracts::{Actor, ActorKind, EventData, Verb};
use rpc::{Module, RpcError, code, params, reply};
use serde_json::{Value, json};
use tokio::sync::Mutex;

#[derive(Default)]
pub(crate) struct Rewinding {
    /// One call at a time per Workstream; the slot keeps an unfinished call's progress for a retry.
    slots: Mutex<HashMap<String, Arc<Mutex<Option<Progress>>>>>,
    /// Held-action ids already covered by a `workstream.rewound`.
    announced: std::sync::Mutex<HashSet<String>>,
}

/// The work of one rewind on the children that are not under Takeover.
struct Batch {
    key: String,
    checkpoint: u32,
    files: Files,
    marks: Vec<checkpoints::Mark>,
    later: Vec<String>,
    resume: Resume,
    restored: bool,
}

struct Progress {
    checkpoint: u32,
    files: Files,
    agent: Option<String>,
    title: String,
    outcomes: Vec<RewindAgent>,
    /// The held-action rows of the children this call rewinds now.
    rows: Vec<String>,
    batch: Batch,
}

impl Batch {
    fn new(
        key: String,
        checkpoint: u32,
        files: Files,
        marks: Vec<checkpoints::Mark>,
        later: Vec<String>,
    ) -> Self {
        let retained = marks
            .iter()
            .map(|m| MarkResume::new(m.clone(), None))
            .collect();
        Self {
            key,
            checkpoint,
            files,
            marks,
            resume: Resume::new(retained, later.clone()),
            later,
            restored: false,
        }
    }
}

fn belongs(nodes: &[RailNode], node: &RailNode, id: &str) -> bool {
    let mut at = Some(node);
    while let Some(node) = at {
        if node.id == id {
            return true;
        }
        if node.kind == NodeKind::Workstream {
            return false;
        }
        at = node
            .parent
            .as_ref()
            .and_then(|parent| nodes.iter().find(|n| &n.id == parent));
    }
    false
}

fn name_of(nodes: &[RailNode], id: &str) -> String {
    nodes
        .iter()
        .find(|n| n.id == id)
        .map_or_else(|| id.to_owned(), |n| n.name.clone())
}

impl Daemon {
    /// The children a call selects, sorted. Only the Door of Workstream `id` may ask, and it may
    /// select one child below it or, with no `agent`, every child.
    pub(crate) async fn rewind_children(
        &self,
        actor: &Actor,
        method: &str,
        value: &Value,
    ) -> Result<Vec<String>, RpcError> {
        let (id, agent) = if method == "workstream.rewind" {
            let p: RewindParams = params(value.clone())?;
            (p.id, p.agent)
        } else {
            let p: RewindPlanParams = params(value.clone())?;
            (p.id, p.agent)
        };
        let nodes = self.rail().await?;
        let door = nodes
            .iter()
            .find(|n| n.id == id && n.kind == NodeKind::Workstream)
            .ok_or_else(|| RpcError::not_found(&id))?;
        if actor.kind != ActorKind::Agent || actor.id != door.id {
            return Err(RpcError::forbidden(
                "only the Door of a Workstream rewinds its children",
            ));
        }
        let mut children: Vec<String> = nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Agent && belongs(&nodes, n, &id))
            .map(|n| n.id.clone())
            .collect();
        if let Some(agent) = agent {
            if !nodes.iter().any(|n| n.id == agent) {
                return Err(RpcError::not_found(&agent));
            }
            if !children.contains(&agent) {
                return Err(RpcError::forbidden(format!(
                    "{agent} is not a child of Workstream {id}"
                )));
            }
            children = vec![agent];
        } else if children.is_empty() {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "the Workstream has no child to rewind",
            ));
        }
        children.sort();
        children.dedup();
        Ok(children)
    }

    /// The Checkpoint's title and its usable Marks.
    async fn rewind_marks(
        &self,
        nodes: &[RailNode],
        id: &str,
        checkpoint: u32,
    ) -> Result<(String, checkpoints::Marks), RpcError> {
        let door = nodes
            .iter()
            .find(|n| n.id == id && n.kind == NodeKind::Workstream)
            .ok_or_else(|| RpcError::not_found(id))?;
        let cards: Vec<contracts::checkpoint::Checkpoint> = serde_json::from_value(
            self.checkpoints
                .call(
                    &self.ctx(Actor::daemon()),
                    "checkpoint.list",
                    json!({"workstream": id}),
                )
                .await?,
        )
        .map_err(RpcError::internal)?;
        let card = cards
            .iter()
            .find(|c| c.id == checkpoint)
            .ok_or_else(|| RpcError::not_found("Checkpoint"))?;
        let marks = self
            .checkpoints
            .marks(id, checkpoint, door.iteration.unwrap_or(1))?;
        Ok((card.title.clone(), marks))
    }

    /// A removed child must not leave a descendant that is not selected without its parent.
    fn rewind_orphans(
        nodes: &[RailNode],
        selected: &[String],
        marks: &checkpoints::Marks,
    ) -> Result<(), RpcError> {
        for later in selected
            .iter()
            .filter(|c| !marks.agents.iter().any(|m| &m.agent == *c))
        {
            if let Some(orphan) = nodes
                .iter()
                .find(|n| n.id != *later && !selected.contains(&n.id) && belongs(nodes, n, later))
            {
                return Err(RpcError::conflict(format!(
                    "{} started after the Checkpoint; removing it would leave {} without its parent",
                    name_of(nodes, later),
                    orphan.name
                )));
            }
        }
        Ok(())
    }

    pub(crate) async fn rewind_call(
        &self,
        actor: &Actor,
        method: &str,
        value: Value,
        children: Vec<String>,
    ) -> Result<Value, RpcError> {
        if method == "workstream.rewindPlan" {
            let RewindPlanParams { id, checkpoint, .. } = params(value)?;
            return reply(&self.rewind_plan(&id, checkpoint, &children).await?);
        }
        let rewind: RewindParams = params(value)?;
        reply(&self.rewind_run(actor, rewind, children).await?)
    }

    async fn rewind_plan(
        &self,
        id: &str,
        checkpoint: u32,
        children: &[String],
    ) -> Result<RewindPlan, RpcError> {
        let nodes = self.rail().await?;
        let (_, marks) = self.rewind_marks(&nodes, id, checkpoint).await?;
        Self::rewind_orphans(&nodes, children, &marks)?;
        let mut agents = Vec::new();
        for child in children {
            let takeover = self.sender.get().is_some_and(|m| m.takeover_active(child));
            // B6: reading a taken-over child waits for the user to give it back.
            self.wait_takeover_end(child).await;
            let mark = marks.agents.iter().find(|m| &m.agent == child);
            let files_changed = match mark {
                Some(mark) => agents::marks::changed_files(mark)
                    .await?
                    .iter()
                    .map(|path| String::from_utf8_lossy(path).into_owned())
                    .collect(),
                None => Vec::new(),
            };
            agents.push(PlanAgent {
                agent: child.clone(),
                name: name_of(&nodes, child),
                takeover,
                created_after: mark.is_none(),
                files_changed,
            });
        }
        let files_changed = agents.iter().any(|a| !a.files_changed.is_empty());
        Ok(RewindPlan {
            agents,
            files_changed,
        })
    }

    async fn rewind_run(
        &self,
        actor: &Actor,
        rewind: RewindParams,
        children: Vec<String>,
    ) -> Result<Rewind, RpcError> {
        let RewindParams {
            id,
            checkpoint,
            files,
            agent,
        } = rewind.clone();
        let slot = self
            .rewinding
            .slots
            .lock()
            .await
            .entry(id.clone())
            .or_default()
            .clone();
        let mut slot = slot
            .try_lock()
            .map_err(|_| RpcError::conflict("Workstream is already being rewound"))?;
        // No Takeover can begin on a selected child while its effects are held.
        let mut locks = Vec::new();
        for child in &children {
            locks.push(self.child_effects(child).write_owned().await);
        }
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Messages unavailable"))?;
        let nodes = self.rail().await?;
        if let Some(p) = slot.as_ref() {
            if p.checkpoint != checkpoint || p.files != files || p.agent != agent {
                return Err(RpcError::conflict(
                    "continue the unfinished rewind with the same choices",
                ));
            }
            let now = p
                .outcomes
                .iter()
                .find(|o| o.state != RewindState::Waiting && messages.takeover_active(&o.agent));
            if let Some(held) = now {
                return Err(RpcError::conflict(format!(
                    "{} is under Takeover; the unfinished rewind continues after it is given back",
                    held.name
                )));
            }
        } else {
            let (title, marks) = self.rewind_marks(&nodes, &id, checkpoint).await?;
            Self::rewind_orphans(&nodes, &children, &marks)?;
            let mut immediate = Vec::new();
            let mut later = Vec::new();
            let mut retained = Vec::new();
            for child in &children {
                if messages.takeover_active(child) {
                    continue;
                }
                immediate.push(child.clone());
                match marks.agents.iter().find(|m| &m.agent == child) {
                    Some(mark) => retained.push(mark.clone()),
                    None => later.push(child.clone()),
                }
            }
            if files == Files::Restore {
                self.rewind_protect_takeover(&nodes, &retained)?;
            }
            let mut outcomes = Vec::new();
            let mut rows = Vec::new();
            for child in &children {
                let node = nodes
                    .iter()
                    .find(|n| &n.id == child)
                    .ok_or_else(|| RpcError::not_found(child))?;
                let call = HeldCall::Rewind(RewindParams {
                    id: id.clone(),
                    checkpoint,
                    files,
                    agent: Some(child.clone()),
                });
                let waiting = !immediate.contains(child);
                let row = self.held_actions.accept_as(
                    actor,
                    node,
                    call,
                    if waiting {
                        ResizeOutcome::Waiting {
                            reason: "takeover".into(),
                        }
                    } else {
                        ResizeOutcome::InProgress
                    },
                )?;
                if !waiting {
                    rows.push(row.id.clone());
                }
                outcomes.push(RewindAgent {
                    agent: child.clone(),
                    name: node.name.clone(),
                    state: if waiting {
                        RewindState::Waiting
                    } else if later.contains(child) {
                        RewindState::Removed
                    } else {
                        RewindState::Rewound
                    },
                    reason: waiting.then(|| "the user holds Takeover of this child".to_owned()),
                    action: Some(row.id),
                });
            }
            let key = format!(
                "rewind:{id}:{checkpoint}:{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(RpcError::internal)?
                    .as_nanos()
            );
            *slot = Some(Progress {
                checkpoint,
                files,
                agent,
                title,
                outcomes,
                rows,
                batch: Batch::new(key, checkpoint, files, retained, later),
            });
        }
        let p = slot.as_mut().expect("selected above");
        for row in &p.rows {
            self.held_actions.outcome(row, ResizeOutcome::InProgress)?;
        }
        let ctx = self.ctx(actor.clone());
        if let Err(error) = self.rewind_batch(&ctx, &id, &mut p.batch).await {
            for row in &p.rows {
                self.held_actions.outcome(
                    row,
                    ResizeOutcome::Dropped {
                        reason: format!("{}; call again to continue", error.message),
                    },
                )?;
            }
            return Err(error);
        }
        for row in &p.rows {
            self.held_actions.outcome(row, ResizeOutcome::Completed)?;
        }
        let result = Rewind {
            checkpoint: p.title.clone(),
            files,
            agents: p.outcomes.clone(),
        };
        *slot = None;
        drop(slot);
        drop(locks);
        self.rewind_settled(&id, checkpoint).await;
        Ok(result)
    }

    /// Restoring a Worktree that a child under Takeover also works in would change its files.
    fn rewind_protect_takeover(
        &self,
        nodes: &[RailNode],
        marks: &[checkpoints::Mark],
    ) -> Result<(), RpcError> {
        let Some(messages) = self.sender.get() else {
            return Ok(());
        };
        let mut protected: Vec<PathBuf> = Vec::new();
        for node in nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Agent && messages.takeover_active(&n.id))
        {
            let path = node
                .worktree
                .as_ref()
                .map_or(self.project.as_path(), |w| std::path::Path::new(&w.path));
            protected.push(path.canonicalize().map_err(RpcError::internal)?);
        }
        for mark in marks {
            let root = std::path::Path::new(&mark.worktree)
                .canonicalize()
                .map_err(RpcError::internal)?;
            if protected.contains(&root) {
                return Err(RpcError::conflict(
                    "files are shared with a child under Takeover; keep the files or rewind it alone after Takeover",
                ));
            }
        }
        Ok(())
    }

    /// Stop, restore and resume the batch's children, as `agent.stop` and A22's resume do. Steps
    /// already done are kept in `batch`, so a retry does not repeat them.
    async fn rewind_batch(
        &self,
        ctx: &rpc::Ctx,
        id: &str,
        batch: &mut Batch,
    ) -> Result<(), RpcError> {
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Messages unavailable"))?;
        let retained: Vec<String> = batch.marks.iter().map(|m| m.agent.clone()).collect();
        // Reserve before stopping anything: queued Messages stay put until the restart.
        for agent in &retained {
            messages.reserve_restart(agent, &batch.key, None).await?;
        }
        for agent in &batch.later {
            messages.reserve_retirement(agent, &batch.key).await?;
        }
        self.agents.stop_marks(ctx, &mut batch.resume).await?;
        if !batch.restored {
            if batch.files == Files::Restore {
                for mark in &batch.marks {
                    agents::marks::restore_files(mark).await?;
                }
            }
            batch.restored = true;
        }
        self.agents.resume_marks(ctx, &mut batch.resume).await?;
        let nodes = self.rail().await?;
        for agent in &retained {
            let attempt = nodes
                .iter()
                .find(|n| &n.id == agent)
                .and_then(|n| n.attempt.as_deref())
                .ok_or_else(|| RpcError::conflict("restarted Agent missing"))?;
            messages.release_restart(agent, &batch.key, attempt).await?;
        }
        for agent in &batch.later {
            messages.complete_retirement(agent, &batch.key).await?;
        }
        self.checkpoints.invalidate_after(id, batch.checkpoint)?;
        ctx.touch(Verb::Wrote, &format!("rail:{id}"))
    }
}

impl Daemon {
    /// B6: a held rewind of `params.agent` runs when its Takeover ends, under the child's effect
    /// lock. The Checkpoint and the selection are revalidated first; a refusal is a dropped reason.
    pub(crate) async fn release_rewind(
        &self,
        actor: &Actor,
        rewind: &RewindParams,
    ) -> Result<(), RpcError> {
        let child = rewind
            .agent
            .clone()
            .ok_or_else(|| RpcError::internal("held rewind names no child"))?;
        let children = self
            .rewind_children(actor, "workstream.rewind", &json!(rewind))
            .await?;
        let nodes = self.rail().await?;
        let (_, marks) = self
            .rewind_marks(&nodes, &rewind.id, rewind.checkpoint)
            .await?;
        Self::rewind_orphans(&nodes, &children, &marks)?;
        let (retained, later) = match marks.agents.iter().find(|m| m.agent == child) {
            Some(mark) => (vec![mark.clone()], vec![]),
            None => (vec![], vec![child.clone()]),
        };
        if rewind.files == Files::Restore {
            self.rewind_protect_takeover(&nodes, &retained)?;
        }
        let key = format!(
            "rewind:{}:{}:{child}:{}",
            rewind.id,
            rewind.checkpoint,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(RpcError::internal)?
                .as_nanos()
        );
        let mut batch = Batch::new(key, rewind.checkpoint, rewind.files, retained, later);
        self.rewind_batch(&self.ctx(actor.clone()), &rewind.id, &mut batch)
            .await
    }

    /// `workstream.rewound` and one `rail.changed`, once, when no rewind of the Workstream waits,
    /// runs or failed half-way.
    pub(crate) async fn rewind_settled(&self, id: &str, checkpoint: u32) {
        if let Some(slot) = self.rewinding.slots.lock().await.get(id)
            && slot.try_lock().map_or(true, |p| p.is_some())
        {
            return;
        }
        let Ok(rows) = self.held_actions.rewinds(id) else {
            return;
        };
        let mut announced = self
            .rewinding
            .announced
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let pending = rows.iter().any(|(_, outcome)| {
            matches!(
                outcome,
                ResizeOutcome::Waiting { .. } | ResizeOutcome::InProgress
            )
        });
        if pending || rows.iter().all(|(row, _)| announced.contains(row)) {
            return;
        }
        announced.extend(rows.into_iter().map(|(row, _)| row));
        let ctx = self.ctx(Actor::daemon());
        ctx.emit(EventData::RailChanged);
        ctx.emit(EventData::WorkstreamRewound(Rewound {
            id: id.to_owned(),
            checkpoint,
        }));
    }
}
