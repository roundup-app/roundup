//! A4452c: Mode restarts retain the root Agent and A35's input reservation.
use crate::*;
use contracts::agent::ModeRestartParams;
use contracts::agent::{NodeKind, RailNode};
use messages::restart::SessionRestart;

impl Daemon {
    pub(crate) async fn restart_mode(
        &self,
        actor: &Actor,
        p: ModeRestartParams,
    ) -> Result<RailNode, RpcError> {
        if actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user may restart a Mode Agent",
            ));
        }
        let _gate = self.restarting.lock().await;
        let node = self
            .rail()
            .await?
            .into_iter()
            .find(|n| n.id == p.id)
            .ok_or_else(|| RpcError::not_found(&p.id))?;
        if node.kind != NodeKind::Agent
            || node.parent.is_some()
            || node
                .mode_prompt
                .as_deref()
                .is_none_or(|prompt| prompt.trim().is_empty())
        {
            return Err(RpcError::conflict(
                "only a root Mode Agent can be restarted",
            ));
        }
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Messages unavailable"))?;
        let key = format!("mode:{}", p.request);
        // A retry reads the originally reserved text, even after the setting has changed.
        if messages.session_restart(&p.id, &key)?.is_none() {
            messages
                .reserve_restart(&p.id, &key, node.mode_prompt.as_deref())
                .await?;
        }
        let (prompt, mut state) = messages
            .session_restart(&p.id, &key)?
            .ok_or_else(|| RpcError::conflict("restart not reserved"))?;
        if matches!(state, SessionRestart::Reserved) {
            self.agents
                .stop_before_restart(actor.clone(), &p.id)
                .await?;
            messages.set_session_restart(&p.id, &key, SessionRestart::Starting)?;
            let fresh = match self
                .agents
                .restart_mode(
                    &self.ctx(actor.clone()),
                    &p,
                    std::time::Duration::from_secs(15),
                )
                .await
            {
                Ok(fresh) => fresh,
                Err(error) => {
                    // The lifecycle result confirms cleanup; an interrupted/unknown launch
                    // keeps Starting. Retain the reservation and its original prompt bytes.
                    if error.code != code::UNKNOWN_OUTCOME {
                        messages.set_session_restart(&p.id, &key, SessionRestart::Reserved)?;
                    }
                    return Err(error);
                }
            };
            state = SessionRestart::Started {
                attempt: fresh
                    .attempt
                    .ok_or_else(|| RpcError::internal("fresh Mode Agent has no Attempt"))?
                    .to_string(),
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
                self.agents.mode_prompt(&p.id, attempt, prompt).await?;
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
                "restart or Mode prompt outcome is unknown; it will not be typed again. Inspect the Mode Agent's Terminal",
            ));
        }
        self.rail()
            .await?
            .into_iter()
            .find(|n| n.id == p.id)
            .ok_or_else(|| RpcError::not_found(p.id))
    }
}
