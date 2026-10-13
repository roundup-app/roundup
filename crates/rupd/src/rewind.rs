//! A35: selection, consent and retry progress at the Daemon's rewind RPC seam.
use std::collections::HashMap;
use std::sync::Arc;

use crate::Daemon;
use agents::marks::{MarkResume, Resume};
use contracts::agent::{NodeKind, RailNode};
use contracts::message::TakeoverParams;
use contracts::workstream::{
    Files, PlanAgent, Rewind, RewindParams, RewindPlan, RewindPlanParams, Rewound,
};
use contracts::{Actor, ActorKind, EventData, Verb};
use rpc::{Module, RpcError, code, params, reply};
use serde_json::{Value, json};
use tokio::sync::Mutex;

#[derive(Default)]
pub(crate) struct Rewinding(Mutex<HashMap<String, Arc<Mutex<Option<Progress>>>>>);

struct Progress {
    checkpoint: u32,
    files: Files,
    takeover: Vec<String>,
    marks: Vec<checkpoints::Mark>,
    result: Rewind,
    resume: Resume,
    note: Option<String>,
    key: String,
    ended_takeovers: std::collections::HashSet<String>,
    restored: bool,
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

impl Daemon {
    async fn rewind_plan(
        &self,
        id: &str,
        checkpoint: u32,
    ) -> Result<(RewindPlan, checkpoints::Marks, String), RpcError> {
        let ctx = self.ctx(Actor::daemon());
        let nodes: Vec<RailNode> =
            serde_json::from_value(self.agents.call(&ctx, "rail.tree", json!({})).await?)
                .map_err(RpcError::internal)?;
        let door = nodes
            .iter()
            .find(|n| n.id == id && n.kind == NodeKind::Workstream)
            .ok_or_else(|| RpcError::not_found(id))?;
        let cards: Vec<contracts::checkpoint::Checkpoint> = serde_json::from_value(
            self.checkpoints
                .call(&ctx, "checkpoint.list", json!({"workstream": id}))
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
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Messages unavailable"))?;
        let mut agents = Vec::new();
        for node in nodes.iter().filter(|n| belongs(&nodes, n, id)) {
            let mark = marks.agents.iter().find(|m| m.agent == node.id);
            let files_changed = match mark {
                Some(mark) => agents::marks::changed_files(mark)
                    .await?
                    .iter()
                    .map(|path| String::from_utf8_lossy(path).into_owned())
                    .collect(),
                None => Vec::new(),
            };
            agents.push(PlanAgent {
                agent: node.id.clone(),
                name: node.name.clone(),
                takeover: messages.takeover_active(&node.id),
                created_after: mark.is_none(),
                files_changed,
            });
        }
        if marks
            .agents
            .iter()
            .any(|mark| !agents.iter().any(|a| a.agent == mark.agent))
        {
            return Err(RpcError::conflict("a marked Agent has left the Workstream"));
        }
        let files_changed = agents.iter().any(|a| !a.files_changed.is_empty());
        Ok((
            RewindPlan {
                agents,
                files_changed,
            },
            marks,
            card.title.clone(),
        ))
    }

    pub(crate) async fn rewind_call(
        &self,
        actor: &Actor,
        method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        if method == "workstream.rewindPlan" {
            let RewindPlanParams { id, checkpoint } = params(value)?;
            return reply(&self.rewind_plan(&id, checkpoint).await?.0);
        }
        let RewindParams {
            id,
            checkpoint,
            files,
            mut takeover,
            proof,
        } = params(value)?;
        if actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user rewinds a Workstream"));
        }
        takeover.sort();
        takeover.dedup();
        if !takeover.is_empty()
            && (self.proof.is_none() || self.proof.as_deref() != proof.as_deref())
        {
            return Err(RpcError::forbidden(
                "naming a Takeover Agent needs the App's proof",
            ));
        }
        let slot = self
            .rewinding
            .0
            .lock()
            .await
            .entry(id.clone())
            .or_default()
            .clone();
        let mut slot = slot
            .try_lock()
            .map_err(|_| RpcError::conflict("Workstream is already being rewound"))?;
        if let Some(p) = slot.as_ref() {
            if p.checkpoint != checkpoint || p.files != files || p.takeover != takeover {
                return Err(RpcError::conflict(
                    "continue the unfinished rewind with the same choices",
                ));
            }
        } else {
            let (plan, marks, title) = self.rewind_plan(&id, checkpoint).await?;
            for named in &takeover {
                if !plan.agents.iter().any(|a| a.agent == *named && a.takeover) {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        "Agent is not under Takeover in this plan",
                    ));
                }
            }
            let mut result = Rewind {
                rewound: vec![],
                removed: vec![],
                skipped: vec![],
            };
            for agent in &plan.agents {
                if agent.takeover && !takeover.contains(&agent.agent) {
                    result.skipped.push(agent.agent.clone());
                } else if agent.created_after {
                    result.removed.push(agent.agent.clone());
                } else {
                    result.rewound.push(agent.agent.clone());
                }
            }
            let mut text = format!("The Workstream was rewound to the Checkpoint \"{title}\".");
            for (label, ids) in [
                ("Rewound", &result.rewound),
                ("Removed", &result.removed),
                ("Skipped, under takeover", &result.skipped),
            ] {
                if !ids.is_empty() {
                    let names: Vec<_> = plan
                        .agents
                        .iter()
                        .filter(|a| ids.contains(&a.agent))
                        .map(|a| a.name.as_str())
                        .collect();
                    text.push_str(&format!(" {label}: {}.", names.join(", ")));
                }
            }
            text.push_str(if files == Files::Restore {
                " The files were restored."
            } else {
                " The files were not changed."
            });
            let note = result.rewound.contains(&id).then_some(text);
            let marks: Vec<_> = marks
                .agents
                .into_iter()
                .filter(|m| result.rewound.contains(&m.agent))
                .collect();
            let retained = marks
                .iter()
                .map(|m| {
                    MarkResume::new(m.clone(), if m.agent == id { note.clone() } else { None })
                })
                .collect();
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
                takeover: takeover.clone(),
                resume: Resume::new(retained, result.removed.clone()),
                marks,
                result,
                note,
                key,
                ended_takeovers: Default::default(),
                restored: false,
            });
        }
        let p = slot.as_mut().expect("selected above");
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Messages unavailable"))?;
        let ctx = self.ctx(Actor::user());
        // Reserve before ending consented Takeovers or stopping anything: queued Messages stay put.
        for agent in &p.result.rewound {
            messages
                .reserve_restart(
                    agent,
                    &p.key,
                    if agent == &id {
                        p.note.as_deref()
                    } else {
                        None
                    },
                )
                .await?;
        }
        for agent in &p.result.removed {
            messages.reserve_retirement(agent, &p.key).await?;
        }
        for agent in &p.takeover {
            if p.ended_takeovers.contains(agent) {
                continue;
            }
            messages
                .call(
                    &ctx,
                    "takeover.end",
                    json!(TakeoverParams {
                        agent: agent.clone()
                    }),
                )
                .await?;
            p.ended_takeovers.insert(agent.clone());
        }
        self.agents.stop_marks(&ctx, &mut p.resume).await?;
        if !p.restored {
            if files == Files::Restore {
                for mark in &p.marks {
                    agents::marks::restore_files(mark).await?;
                }
            }
            p.restored = true;
        }
        self.agents.resume_marks(&ctx, &mut p.resume).await?;
        let nodes: Vec<RailNode> =
            serde_json::from_value(self.agents.call(&ctx, "rail.tree", json!({})).await?)
                .map_err(RpcError::internal)?;
        for agent in &p.result.rewound {
            let attempt = nodes
                .iter()
                .find(|n| &n.id == agent)
                .and_then(|n| n.attempt.as_deref())
                .ok_or_else(|| RpcError::conflict("restarted Agent missing"))?;
            if agent == &id && p.note.is_some() {
                messages
                    .record_restart_prompt(agent, &p.key, attempt)
                    .await?;
            }
            messages.release_restart(agent, &p.key, attempt).await?;
        }
        for agent in &p.result.removed {
            messages.complete_retirement(agent, &p.key).await?;
        }
        self.checkpoints.invalidate_after(&id, checkpoint)?;
        ctx.touch(Verb::Wrote, &format!("rail:{id}"))?;
        let result = p.result.clone();
        *slot = None;
        ctx.emit(EventData::RailChanged);
        ctx.emit(EventData::WorkstreamRewound(Rewound { id, checkpoint }));
        reply(&result)
    }
}
