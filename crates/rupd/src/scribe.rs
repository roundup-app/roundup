//! P11: `pad.ask`, the user's one input to a Pad's Scribe, and the binding that gives it the right to rewrite that Pad.

use std::sync::{Arc, OnceLock};

use contracts::agent::{NodeKind, RailNode, SpawnParams};
use contracts::message::{Message, MessageKind, SendParams};
use contracts::pad::{AskParams, Asked};
use contracts::{Actor, ActorKind, Kind};
use rpc::{Module, RpcError, code, params, reply};
use serde_json::{Value, json};

use super::Daemon;

/// What `pad.ask` needs besides the router, set once at `open`.
#[derive(Default)]
pub struct Scribing {
    handles: OnceLock<(Arc<pads::Pads>, Arc<agents::Agents>)>,
    /// Two first asks of one Pad start one Scribe: the second waits for the first's binding.
    asking: tokio::sync::Mutex<()>,
}

impl Scribing {
    pub fn set(&self, pads: Arc<pads::Pads>, agents: Arc<agents::Agents>) {
        let _ = self.handles.set((pads, agents));
    }
}

/// The longest Rail name an Agent may take (A28).
const NAME_CHARS: usize = 32;

impl Daemon {
    pub(crate) async fn pad_ask(&self, actor: &Actor, value: Value) -> Result<Value, RpcError> {
        if actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user may ask a pad"));
        }
        let AskParams { name, text } = params(value)?;
        let (pads, agents) = self
            .scribing
            .handles
            .get()
            .ok_or_else(|| RpcError::internal("no pads module to ask"))?;
        if text.trim().is_empty() {
            return Err(RpcError::new(code::INVALID_PARAMS, "ask is empty"));
        }
        let pad = pads.exists(&name)?;
        let _one_at_a_time = self.scribing.asking.lock().await;
        let ctx = self.ctx(actor.clone());
        let nodes = self.rail().await?;
        let bound = pads.scribe(&pad.name)?;
        let mut live = bound
            .as_deref()
            .and_then(|id| nodes.iter().find(|node| node.id == id));
        if let Some(node) = live
            && matches!(
                node.status.as_ref().map(|s| &s.kind),
                Some(Kind::Done | Kind::Error)
            )
        {
            if node.can_resume {
                agents
                    .call(&ctx, "agent.resume", json!({ "id": node.id }))
                    .await?;
            } else {
                agents
                    .call(&ctx, "rail.remove", json!({ "id": node.id }))
                    .await?;
                live = None;
            }
        }
        let agent = match live {
            Some(node) => node.id.clone(),
            None => {
                let started = agents
                    .spawn_scribe(
                        &ctx,
                        SpawnParams {
                            cwd: self.project.to_string_lossy().into_owned(),
                            prompt: None,
                            parent: None,
                            order: None,
                            name: Some(scribe_name(&pad.name)),
                        },
                        &|id| pads.bind_scribe(&pad.name, id),
                    )
                    .await?;
                started.id
            }
        };
        let messages = self
            .modules
            .get("message")
            .ok_or_else(|| RpcError::internal("message module is not registered"))?;
        let sent = messages
            .call(
                &ctx,
                "message.send",
                json!(SendParams {
                    to: agent.clone(),
                    kind: MessageKind::Note,
                    body: text,
                    reply_to: None,
                }),
            )
            .await?;
        let message: Message = serde_json::from_value(sent).map_err(RpcError::internal)?;
        reply(&Asked { agent, message })
    }

    /// P11: a Scribe whose node left the Rail loses its right.
    pub(crate) async fn end_orphaned_scribes(&self) -> Result<(), RpcError> {
        let Some((pads, _)) = self.scribing.handles.get() else {
            return Ok(());
        };
        let live: Vec<String> = self
            .rail()
            .await?
            .into_iter()
            .filter(|node: &RailNode| node.kind == NodeKind::Agent)
            .map(|node| node.id)
            .collect();
        pads.retain_scribes(&live)
    }
}

/// `<pad> scribe`, cut to a Rail name.
fn scribe_name(pad: &str) -> String {
    format!("{pad} scribe").chars().take(NAME_CHARS).collect()
}
