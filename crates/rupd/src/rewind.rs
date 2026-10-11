//! A35: `workstream.rewindPlan` and `workstream.rewind`. The Agents do the rewinding; the Daemon
//! checks who asks, ends the Takeovers the user named, tells the Door and announces the end.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use contracts::checkpoint::Checkpoint;
use contracts::message::{MessageKind, SendParams, TakeoverParams};
use contracts::workstream::{Files, RewindParams, RewindPlan, RewindPlanParams, Rewound};
use contracts::{Actor, ActorKind, EventData, Verb};
use rpc::{Module, RpcError, code, params, reply};
use serde_json::{Value, json};

use crate::Daemon;

/// Makes the Marks of a Checkpoint with the Agents' help.
pub(crate) struct AgentMarks(pub Arc<agents::Agents>);

#[async_trait]
impl checkpoints::Marker for AgentMarks {
    async fn record(&self, workstream: &str, checkpoint: u32) -> Result<(), RpcError> {
        self.0.record_marks(workstream, checkpoint).await
    }

    fn rewindable(&self, workstream: &str) -> Result<Vec<u32>, RpcError> {
        self.0.rewindable(workstream)
    }
}

/// The Workstreams being rewound; one call at a time each.
#[derive(Default)]
pub(crate) struct Rewinding(Mutex<HashSet<String>>);

struct Hold<'a> {
    set: &'a Rewinding,
    id: String,
}

impl Rewinding {
    fn take(&self, id: &str) -> Result<Hold<'_>, RpcError> {
        let mut set = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !set.insert(id.to_owned()) {
            return Err(RpcError::conflict(format!("{id} is already being rewound")));
        }
        Ok(Hold {
            set: self,
            id: id.to_owned(),
        })
    }
}

impl Drop for Hold<'_> {
    fn drop(&mut self) {
        self.set
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.id);
    }
}

fn names(plan: &RewindPlan, ids: &[String]) -> String {
    ids.iter()
        .map(|id| {
            plan.agents
                .iter()
                .find(|agent| &agent.agent == id)
                .map_or(id.as_str(), |agent| agent.name.as_str())
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// What the Door is told first after the restart: the Checkpoint, who was rewound, removed or
/// skipped, and whether files were restored.
fn told(
    title: &str,
    plan: &RewindPlan,
    done: &contracts::workstream::Rewind,
    files: Files,
) -> String {
    let mut text = format!("The Workstream was rewound to the Checkpoint \"{title}\".");
    for (what, ids) in [
        ("Rewound", &done.rewound),
        ("Removed", &done.removed),
        ("Skipped, under takeover", &done.skipped),
    ] {
        if !ids.is_empty() {
            text.push_str(&format!(" {what}: {}.", names(plan, ids)));
        }
    }
    text.push_str(match files {
        Files::Restore => " The files were restored.",
        Files::Keep => " The files were not changed.",
    });
    text
}

impl Daemon {
    async fn checkpoint_of(
        &self,
        workstream: &str,
        checkpoint: u32,
    ) -> Result<Checkpoint, RpcError> {
        let module = self
            .modules
            .get("checkpoint")
            .ok_or_else(|| RpcError::method_not_found("checkpoint.list"))?;
        let listed = module
            .call(
                &self.ctx(Actor::daemon()),
                "checkpoint.list",
                json!({ "workstream": workstream }),
            )
            .await?;
        let listed: Vec<Checkpoint> = serde_json::from_value(listed).map_err(RpcError::internal)?;
        listed
            .into_iter()
            .find(|found| found.id == checkpoint)
            .ok_or_else(|| RpcError::not_found(format!("checkpoint {checkpoint} of {workstream}")))
    }

    pub(crate) async fn rewind_call(
        &self,
        actor: &Actor,
        method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        if method == "workstream.rewindPlan" {
            let RewindPlanParams { id, checkpoint } = params(value)?;
            self.checkpoint_of(&id, checkpoint).await?;
            return reply(&self.agents.rewind_plan(&id, checkpoint).await?);
        }
        let RewindParams {
            id,
            checkpoint,
            files,
            takeover,
            proof,
        } = params(value)?;
        if actor.kind == ActorKind::Agent {
            return Err(RpcError::forbidden("only the user rewinds a Workstream"));
        }
        let held = self.rewinding.take(&id)?;
        let found = self.checkpoint_of(&id, checkpoint).await?;
        let plan = self.agents.rewind_plan(&id, checkpoint).await?;
        for named in &takeover {
            if !plan
                .agents
                .iter()
                .any(|agent| agent.takeover && &agent.agent == named)
            {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("{named} is not under a Takeover of this Workstream"),
                ));
            }
        }
        if !takeover.is_empty() && !self.agents.is_proof(proof.as_deref()) {
            return Err(RpcError::forbidden(
                "naming an Agent under Takeover needs the App's proof",
            ));
        }
        let ctx = self.ctx(Actor::user());
        if let Some(messages) = self.sender.get() {
            for named in takeover {
                messages
                    .call(&ctx, "takeover.end", json!(TakeoverParams { agent: named }))
                    .await?;
            }
        }
        let done = self.agents.rewind(&ctx, &id, checkpoint, files).await?;
        if let Some(messages) = self.sender.get() {
            let note = SendParams {
                to: id.clone(),
                kind: MessageKind::Note,
                body: told(&found.title, &plan, &done, files),
                reply_to: None,
            };
            messages.call(&ctx, "message.send", json!(note)).await?;
        }
        ctx.touch(Verb::Wrote, &format!("rail:{id}"))?;
        ctx.emit(EventData::RailChanged);
        ctx.emit(EventData::WorkstreamRewound(Rewound { id, checkpoint }));
        drop(held);
        reply(&done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a35_one_rewind_at_a_time() {
        let rewinding = Rewinding::default();

        let first = rewinding.take("1").unwrap();
        let second = rewinding.take("1").err().unwrap();
        let other = rewinding.take("2");
        drop(first);

        assert_eq!(second.code, code::CONFLICT);
        assert!(other.is_ok());
        assert!(rewinding.take("1").is_ok());
    }
}
