//! H7200: `agent.handoff` starts a builder in its caller's place; the caller ends after its reply.
use crate::*;
use contracts::agent::{HandoffParams, RailNode};

/// A handoff whose builder runs and whose caller is yet to end or restart (H7200b).
pub(crate) struct Pending {
    caller: String,
    builder: String,
    mode: bool,
}

impl Daemon {
    /// H7200a: only an Agent hands off, and only itself.
    pub(crate) async fn handoff(
        &self,
        actor: &Actor,
        p: HandoffParams,
    ) -> Result<RailNode, RpcError> {
        if actor.kind != ActorKind::Agent {
            return Err(RpcError::forbidden(
                "handoff acts only on its caller: an Agent hands itself off",
            ));
        }
        let ctx = self.ctx(actor.clone());
        let _: contracts::pad::Pad = self
            .reader()
            .call("pad", "pad.read", json!({"name": p.pad}), actor.clone())
            .await?;
        let caller = self
            .rail()
            .await?
            .into_iter()
            .find(|n| n.id == actor.id)
            .ok_or_else(|| RpcError::not_found(&actor.id))?;
        let mode = caller.parent.is_none() && caller.mode_prompt().is_some();
        let builder = self.agents.start_handoff(&ctx, p.order, &p.pad).await?;
        self.handoffs.lock().push(Pending {
            caller: actor.id.clone(),
            builder: builder.id.clone(),
            mode,
        });
        Ok(builder)
    }

    /// H7200b, H7200e: once the caller's reply is sent, end it, or restart it when it is a Mode.
    pub(crate) async fn finish_handoff(&self, caller: &str) {
        let done: Vec<Pending> = {
            let mut pending = self.handoffs.lock();
            let (done, rest) = std::mem::take(&mut *pending)
                .into_iter()
                .partition(|handoff| handoff.caller == caller);
            *pending = rest;
            done
        };
        for handoff in done {
            let ended = if handoff.mode {
                let request = format!("handoff:{}", handoff.builder);
                let restart =
                    serde_json::from_value(json!({"id": handoff.caller, "request": request}));
                match restart {
                    Ok(restart) => self.restart_mode(&Actor::user(), restart).await.map(drop),
                    Err(err) => Err(RpcError::internal(err)),
                }
            } else {
                self.agents.end_caller(Actor::user(), &handoff.caller).await
            };
            if let Err(err) = ended {
                eprintln!("rupd: handoff of {}: {}", handoff.caller, err.message);
            }
        }
    }
}
