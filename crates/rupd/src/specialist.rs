use super::*;

pub(crate) struct Specialist {
    pub(crate) id: String,
    actor: Actor,
    params: contracts::agent::SpawnParams,
    handoff: Option<SpecialistHandoff>,
}

pub(crate) enum SpecialistHandoff {
    Awaiting(u32),
    Ready(String),
}

impl Daemon {
    pub(crate) async fn spawn_specialist(
        &self,
        actor: &Actor,
        params: Value,
    ) -> Result<Value, RpcError> {
        let typed: contracts::agent::SpawnParams = rpc::params(params.clone())?;
        if actor.kind != ActorKind::Agent || typed.scout != Some(true) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "specialist requires an Agent's scout: true start",
            ));
        }
        let name = typed.specialist.clone().expect("specialist spawn");
        if name.trim().is_empty() {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "specialist name must not be empty",
            ));
        }
        let mut specialists = self.specialists.lock().await;
        let nodes = self.rail().await?;
        let mut at = nodes.iter().find(|node| node.id == actor.id);
        let workstream = loop {
            let node = at.ok_or_else(|| {
                RpcError::new(code::INVALID_PARAMS, "a specialist needs a Workstream")
            })?;
            if node.kind == contracts::agent::NodeKind::Workstream {
                break node.id.clone();
            }
            at = node
                .parent
                .as_ref()
                .and_then(|parent| nodes.iter().find(|n| &n.id == parent));
        };
        specialists.retain(|_, specialist| {
            nodes.iter().any(|n| {
                n.id == specialist.id
                    && (matches!(specialist.handoff, Some(SpecialistHandoff::Ready(_)))
                        || (n.terminal_id.is_some()
                            && n.status
                                .as_ref()
                                .is_some_and(|s| s.kind != contracts::Kind::Done)))
            })
        });
        let key = (workstream, name);
        if let Some(specialist) = specialists.get_mut(&key)
            && let Some(node) = nodes.iter().find(|n| n.id == specialist.id)
        {
            // A failed replacement start retains its summary and retries without another request.
            if node.terminal_id.is_none()
                && matches!(specialist.handoff, Some(SpecialistHandoff::Ready(_)))
            {
                return self.replace_specialist(specialist).await;
            }
            return rpc::reply(node);
        }
        let node = self
            .agents
            .call(&self.ctx(actor.clone()), "agent.spawn", params.clone())
            .await?;
        specialists.insert(
            key,
            Specialist {
                id: node["id"].as_str().expect("spawn id").to_owned(),
                actor: actor.clone(),
                params: typed,
                handoff: None,
            },
        );
        Ok(node)
    }
}

impl Daemon {
    pub(crate) async fn specialist_stop(&self, params: &Value) -> Result<Option<Value>, RpcError> {
        let signal: contracts::agent::SignalParams = rpc::params(params.clone())?;
        if signal.payload["hook_event_name"] != "Stop" {
            return Ok(None);
        }
        let id = signal.id.as_str();
        let mut specialists = self.specialists.lock().await;
        let Some(specialist) = specialists.values_mut().find(|s| s.id == id) else {
            return Ok(None);
        };
        let nodes = self.rail().await?;
        if !nodes.iter().any(|n| {
            n.id == id
                && n.attempt.as_deref() == Some(signal.attempt.as_str())
                && n.terminal_id.is_some()
        }) {
            return Ok(None);
        }
        match specialist.handoff {
            Some(SpecialistHandoff::Awaiting(_)) => return Ok(None),
            Some(SpecialistHandoff::Ready(_)) => {
                return self.replace_specialist(specialist).await.map(Some);
            }
            None => {}
        }
        let payload = signal.payload;
        let size =
            tokio::task::spawn_blocking(move || agents::claude_code::context_tokens(&payload))
                .await
                .map_err(RpcError::internal)??;
        if size.is_none_or(|size| size < 160_000) {
            return Ok(None);
        }
        let message = self.modules["message"].call(&self.ctx(specialist.actor.clone()), "message.send", json!({
            "to": id, "kind":"note", "body": "Your context reached 160k tokens. Send a handoff summary of at most 600 bytes to your parent with message_send, using replyTo to answer this Message. Retain findings and unfinished work; a replacement specialist will continue."
        })).await?;
        let message: contracts::message::Message =
            serde_json::from_value(message).map_err(RpcError::internal)?;
        specialist.handoff = Some(SpecialistHandoff::Awaiting(message.id));
        Ok(None)
    }

    pub(crate) async fn specialist_summary(
        &self,
        actor: &Actor,
        params: &Value,
    ) -> Result<Option<Value>, RpcError> {
        if actor.kind != ActorKind::Agent {
            return Ok(None);
        }
        let sent: contracts::message::SendParams = rpc::params(params.clone())?;
        let mut specialists = self.specialists.lock().await;
        let Some(specialist) = specialists.values_mut().find(|s| s.id == actor.id) else {
            return Ok(None);
        };
        let Some(SpecialistHandoff::Awaiting(request)) = specialist.handoff else {
            return Ok(None);
        };
        if sent.reply_to != Some(request)
            || sent.to != specialist.actor.id
            || sent.kind != contracts::message::MessageKind::Note
        {
            return Ok(None);
        }
        if sent.body.is_empty() || sent.body.len() > 600 {
            return Ok(None);
        }
        specialist.handoff = Some(SpecialistHandoff::Ready(sent.body));
        self.replace_specialist(specialist).await.map(Some)
    }

    pub(crate) async fn replace_specialist(
        &self,
        specialist: &mut Specialist,
    ) -> Result<Value, RpcError> {
        let Some(SpecialistHandoff::Ready(summary)) = &specialist.handoff else {
            return Err(RpcError::conflict("specialist summary is pending"));
        };
        let mut params = specialist.params.clone();
        if params.order.is_none() {
            params.order = Some(contracts::agent::Order::Work {
                title: Some("Continue specialist reading".into()),
                ask: "Continue the standing specialist's reading".into(),
                done: Some("Report findings to the parent".into()),
                limits: vec!["Read and search only".into()],
            });
        }
        params.prompt = Some(format!(
            "{}\n\n## Handoff from the previous specialist\n\n{summary}",
            params.prompt.as_deref().unwrap_or_default()
        ));
        self.agents
            .call(
                &self.ctx(Actor::daemon()),
                "agent.stop",
                json!({"id":specialist.id}),
            )
            .await?;
        let node = self
            .agents
            .call(
                &self.ctx(specialist.actor.clone()),
                "agent.spawn",
                serde_json::to_value(params).map_err(RpcError::internal)?,
            )
            .await?;
        specialist.id = node["id"].as_str().expect("spawn id").to_owned();
        specialist.handoff = None;
        Ok(node)
    }
}
