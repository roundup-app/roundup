//! A4452c: fresh Door sessions retain the Workstream and A35's input reservation.
use crate::*;
use contracts::agent::{NodeKind, RailNode};
use contracts::workstream::RestartParams;
use messages::restart::SessionRestart;

impl Daemon {
    pub(crate) async fn restart_session(
        &self,
        actor: &Actor,
        p: RestartParams,
    ) -> Result<RailNode, RpcError> {
        if actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user may restart a Door session",
            ));
        }
        if p.request.is_empty() || p.request.len() > 128 {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "restart request must contain 1 to 128 bytes",
            ));
        }
        let _gate = self.restarting.lock().await;
        let node = self
            .rail()
            .await?
            .into_iter()
            .find(|n| n.id == p.id)
            .ok_or_else(|| RpcError::not_found(&p.id))?;
        if node.kind != NodeKind::Workstream {
            return Err(RpcError::conflict("only a Workstream has a Door"));
        }
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Messages unavailable"))?;
        let key = format!("opening:{}", p.request);
        // A retry reads the originally reserved text, even after the setting has changed.
        if messages.session_restart(&p.id, &key)?.is_none() {
            messages
                .reserve_restart(&p.id, &key, node.opening_prompt.as_deref())
                .await?;
        }
        let (prompt, mut state) = messages
            .session_restart(&p.id, &key)?
            .ok_or_else(|| RpcError::conflict("restart not reserved"))?;
        if matches!(state, SessionRestart::Reserved) {
            self.agents.stop_door(actor.clone(), &p.id).await?;
            messages.set_session_restart(&p.id, &key, SessionRestart::Starting)?;
            let fresh = self
                .agents
                .restart_door(
                    &self.ctx(actor.clone()),
                    &p.id,
                    std::time::Duration::from_secs(15),
                )
                .await?;
            state = SessionRestart::Started {
                attempt: fresh
                    .attempt
                    .ok_or_else(|| RpcError::internal("fresh Door has no Attempt"))?,
            };
            messages.set_session_restart(&p.id, &key, state.clone())?;
        }
        if let SessionRestart::Started { attempt } = &state {
            if let Some(prompt) = &prompt {
                messages.set_session_restart(
                    &p.id,
                    &key,
                    SessionRestart::Typing {
                        attempt: attempt.clone(),
                    },
                )?;
                self.agents.opening_prompt(&p.id, attempt, prompt).await?;
            }
            state = SessionRestart::Acknowledged {
                attempt: attempt.clone(),
            };
            messages.set_session_restart(&p.id, &key, state.clone())?;
        }
        if let SessionRestart::Acknowledged { attempt } = &state {
            if prompt.is_some() {
                messages.record_restart_prompt(&p.id, &key, attempt).await?;
            }
            messages.release_restart(&p.id, &key, attempt).await?;
            state = SessionRestart::Released {
                attempt: attempt.clone(),
            };
            messages.set_session_restart(&p.id, &key, state.clone())?;
        }
        if !matches!(state, SessionRestart::Released { .. }) {
            return Err(RpcError::unknown_outcome(
                "restart or Opening prompt outcome is unknown; it will not be typed again. Inspect the Door's Terminal",
            ));
        }
        self.rail()
            .await?
            .into_iter()
            .find(|n| n.id == p.id)
            .ok_or_else(|| RpcError::not_found(p.id))
    }
}
