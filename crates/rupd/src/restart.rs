//! A4452c: Mode restarts retain the root Agent and A35's input reservation.
use crate::*;
use contracts::agent::ModeRestartParams;
use contracts::agent::{NodeKind, RailNode};
use messages::restart::SessionRestart;

impl Daemon {
    /// A7494a: start the nested Mode that `agent.spawn` saved, through the same reservation as a
    /// Restart, so its first prompt is typed once.
    pub(crate) async fn start_nested_mode(
        &self,
        saved: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        let id = saved
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let params = serde_json::from_value(serde_json::json!({"id": id, "request": "start"}))
            .map_err(RpcError::internal)?;
        let node = self.restart_mode(&Actor::user(), params).await?;
        serde_json::to_value(node).map_err(RpcError::internal)
    }

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
        let nodes = self.rail().await?;
        let node = nodes
            .iter()
            .find(|n| n.id == p.id)
            .ok_or_else(|| RpcError::not_found(&p.id))?;
        // A7494c: a nested Mode restarts as a root Mode does.
        let under_root = node.parent.as_deref().is_none_or(|parent| {
            nodes
                .iter()
                .any(|n| n.id == parent && n.kind() == NodeKind::Agent && n.parent.is_none())
        });
        if node.kind() != NodeKind::Agent
            || !under_root
            || node
                .mode_prompt()
                .as_deref()
                .is_none_or(|prompt| prompt.trim().is_empty())
        {
            return Err(RpcError::conflict(
                "only a Mode Agent at the root or under its root starter can be restarted",
            ));
        }
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Messages unavailable"))?;
        let key = format!("mode:{}", p.request);
        // A retry reads the originally reserved text, even after the setting has changed.
        if messages.session_restart(&p.id, &key)?.is_none() {
            // U7191d: this Restart stops the old program first, so a hold another key left guards
            // nothing; it ends here, whether it came from a failure, an App reload or a Daemon restart.
            messages.take_over_restart(&p.id, &key).await?;
            messages
                .reserve_restart(&p.id, &key, node.mode_prompt().as_deref())
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
                    return Err(self.named_failure(node, None, error));
                }
            };
            state = SessionRestart::Started {
                attempt: fresh
                    .attempt()
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
                if let Err(error) = self.agents.mode_prompt(&p.id, attempt, prompt).await {
                    // U7191d: only an unknown outcome may have typed; any other failure typed
                    // nothing, so the hold frees at once.
                    if error.code != code::UNKNOWN_OUTCOME {
                        messages.free_restart(&p.id, &key).await?;
                    }
                    return Err(self.named_failure(node, Some(attempt), error));
                }
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
            let attempt = match &state {
                SessionRestart::Started { attempt }
                | SessionRestart::Typing { attempt }
                | SessionRestart::Acknowledged { attempt } => Some(attempt.as_str()),
                _ => None,
            };
            return Err(RpcError::unknown_outcome(format!(
                "{}: restart or Mode prompt outcome is unknown; it will not be typed again. \
                 Inspect the Mode Agent's Terminal, or choose Restart again to start a fresh one",
                self.failure_subject(node, attempt)
            )));
        }
        self.rail()
            .await?
            .into_iter()
            .find(|n| n.id == p.id)
            .ok_or_else(|| RpcError::not_found(p.id))
    }

    /// U7191f: the Agent, its Attempt and its Terminal's herdr-core address.
    fn failure_subject(&self, node: &RailNode, attempt: Option<&str>) -> String {
        let (id, name) = (&node.id, &node.name);
        let terminal = node
            .terminal_id()
            .and_then(|terminal| self.terminals.core_record(&terminal).ok().flatten())
            .map_or_else(|| "none".to_owned(), |(core_id, _)| core_id);
        format!(
            "Mode {name} ({id}) Attempt {} Terminal {terminal}",
            attempt.unwrap_or("none")
        )
    }

    /// U7191f: `error` naming the Agent, its Terminal address and the core error code, with one
    /// line in the Daemon's log.
    fn named_failure(
        &self,
        node: &RailNode,
        attempt: Option<&str>,
        mut error: RpcError,
    ) -> RpcError {
        if error.code == code::UNKNOWN_OUTCOME && error.message.starts_with("Mode ") {
            return error;
        }
        let subject = self.failure_subject(node, attempt);
        let core = core_code(&error.message).unwrap_or("none");
        error.message = format!("{subject} core code {core}: {}", error.message);
        eprintln!("rupd: restart failed: {}", error.message);
        error
    }
}

/// The herdr-core error code (`core_closed`, `core_silent`, ...) a message carries.
fn core_code(message: &str) -> Option<&str> {
    let start = message.find("core_")?;
    let rest = &message[start..];
    let end = rest
        .find(|c: char| !(c.is_ascii_lowercase() || c == '_'))
        .unwrap_or(rest.len());
    Some(&rest[..end])
}
