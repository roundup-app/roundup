//! M5159b: the Door asks each child's provider to rewind through the provider's own feature.
use contracts::agent::{NodeKind, RailNode};
use contracts::workstream::{Rewind, RewindAgent, RewindParams, RewindState};
use contracts::{Actor, ActorKind};
use rpc::{RpcError, code, params, reply};
use serde_json::Value;

use crate::Daemon;
use agents::rewind::Outcome;

/// Whether `node` sits below Workstream `door`, direct or nested, without leaving it.
fn belongs(nodes: &[RailNode], node: &RailNode, door: &str) -> bool {
    let mut at = node.parent.as_ref();
    while let Some(parent) = at {
        if parent == door {
            return true;
        }
        let up = nodes.iter().find(|n| &n.id == parent);
        if up.is_none_or(|n| n.kind == NodeKind::Workstream) {
            return false;
        }
        at = up.and_then(|n| n.parent.as_ref());
    }
    false
}

impl Daemon {
    pub(crate) async fn rewind_call(&self, actor: &Actor, value: Value) -> Result<Value, RpcError> {
        let RewindParams { id, turns } = params(value)?;
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
        if turns.is_empty() {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "name at least one child to rewind",
            ));
        }
        let mut chosen = Vec::new();
        for (at, wanted) in turns.iter().enumerate() {
            let node = nodes
                .iter()
                .find(|n| n.id == wanted.agent)
                .ok_or_else(|| RpcError::not_found(&wanted.agent))?;
            if node.kind != NodeKind::Agent || !belongs(&nodes, node, &id) {
                return Err(RpcError::forbidden(format!(
                    "{} is not a child of your Workstream",
                    node.name
                )));
            }
            if turns[..at].iter().any(|seen| seen.agent == wanted.agent) {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("{} is named twice", node.name),
                ));
            }
            if wanted.turn.trim().is_empty() {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("name the turn to return {} to", node.name),
                ));
            }
            chosen.push((node.id.clone(), node.name.clone(), wanted.turn.clone()));
        }
        let mut running = tokio::task::JoinSet::new();
        for (at, (agent, _, turn)) in chosen.iter().cloned().enumerate() {
            let agents = std::sync::Arc::clone(&self.agents);
            running.spawn(async move {
                let provider = agents.provider(&agent);
                (at, agents.rewind_native(&agent, provider, &turn).await)
            });
        }
        let mut outcomes = Vec::new();
        while let Some(done) = running.join_next().await {
            outcomes.push(done.map_err(RpcError::internal)?);
        }
        outcomes.sort_by_key(|(at, _)| *at);
        let agents = chosen
            .into_iter()
            .zip(outcomes)
            .map(|((agent, name, _), (_, outcome))| {
                let (state, reason) = match outcome {
                    Outcome::Rewound => (RewindState::Rewound, None),
                    Outcome::Unavailable(why) => (RewindState::Unavailable, Some(why)),
                    Outcome::Failed(why) => (RewindState::Failed, Some(why)),
                };
                RewindAgent {
                    agent,
                    name,
                    state,
                    reason,
                }
            })
            .collect();
        reply(&Rewind { agents })
    }
}
