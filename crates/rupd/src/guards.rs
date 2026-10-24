use super::*;

/// A Door's read of a child's Terminal, which waits out the child's Takeover.
pub(crate) fn is_child_read(method: &str) -> bool {
    matches!(
        method,
        "terminal.snapshot" | "terminal.screen" | "terminal.read" | "terminal.search"
    )
}

impl Daemon {
    pub(crate) fn register_first_steer(
        &self,
        first_steers: &mut HashMap<String, String>,
        node: &Value,
    ) {
        if let (Some(id), Some(attempt)) = (node["id"].as_str(), node["attempt"].as_str()) {
            first_steers.insert(id.to_owned(), attempt.to_owned());
            let first_steers = Arc::clone(&self.door_first_steers);
            let agents = Arc::clone(&self.agents);
            let (id, attempt) = (id.to_owned(), attempt.to_owned());
            tokio::spawn(async move {
                if agents.first_steer_completion(&id, &attempt).await.is_ok() {
                    let mut first_steers = first_steers.lock().await;
                    if first_steers.get(&id) == Some(&attempt) {
                        first_steers.remove(&id);
                    }
                }
            });
        }
    }

    /// A known Agent process cannot gain the user's control or receipt access by identifying
    /// as the user. The wire reader captures this before an earlier action can delay dispatch.
    pub(crate) fn action_actor(&self, conn: &Conn) -> Actor {
        let actor = self.terminal_writer(conn);
        if actor.kind == ActorKind::Agent {
            actor
        } else {
            conn.actor.clone()
        }
    }

    pub(crate) fn terminal_writer(&self, conn: &Conn) -> Actor {
        match conn.peer.and_then(|pid| self.agents.agent_of_peer(pid)) {
            Some(agent) => Actor {
                kind: ActorKind::Agent,
                id: agent,
                parent: None,
            },
            None if conn.actor.kind == ActorKind::Ext => conn.actor.clone(),
            None => Actor::user(),
        }
    }

    /// Return once no Takeover holds `child`: subscribe first, so an end cannot slip past.
    pub(crate) async fn wait_takeover_end(&self, child: &str) {
        let (mut events, _) = self.subscribe();
        while self.sender.get().is_some_and(|m| m.takeover_active(child)) {
            match events.recv().await {
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    }

    /// Aggregate reads must respect each child's prior calls, not only the Door's own id.
    pub(crate) async fn door_effect_children(
        &self,
        actor: &Actor,
        method: &str,
        params: &Value,
    ) -> Result<Vec<String>, RpcError> {
        if actor.kind != ActorKind::Agent {
            return Ok(Vec::new());
        }
        let mut children: Vec<String> = match method {
            "agent.digest" => {
                let NodeId { id } = rpc::params(params.clone())?;
                // The Digest module still owns its permission and node-kind checks.
                if actor.id != id {
                    return Err(RpcError::forbidden(format!(
                        "{} may not read the digest of {}",
                        self.agents.rail_name(&actor.id)?,
                        self.agents.rail_name(&id)?
                    )));
                }
                self.rail()
                    .await?
                    .into_iter()
                    .filter(|n| n.parent.as_deref() == Some(&id) && n.status.is_some())
                    .map(|n| n.id)
                    .collect()
            }
            "workstream.rewind" | "workstream.rewindPlan" => {
                self.rewind_children(actor, method, params).await?
            }
            _ => self
                .door_effect_child(actor, method, params)
                .await?
                .into_iter()
                .collect(),
        };
        children.sort();
        children.dedup();
        Ok(children)
    }

    /// The wire reader and router must agree which effects share a child's arrival order.
    pub(crate) async fn door_effect_child(
        &self,
        actor: &Actor,
        method: &str,
        params: &Value,
    ) -> Result<Option<String>, RpcError> {
        if actor.kind != ActorKind::Agent {
            return Ok(None);
        }
        match method {
            "terminal.snapshot" | "terminal.screen" | "terminal.read" | "terminal.search"
            | "terminal.write" | "terminal.kill" | "terminal.close" | "terminal.resize" => {
                self.guard_terminal_read(actor, method, params).await
            }
            "agent.prompt"
            | "agent.setOrder"
            | "agent.interrupt"
            | "agent.resume"
            | "agent.stop"
            | "agent.discard"
            | "agent.land"
            | "agent.worktreeState"
            | "agent.changedFiles"
            | "agent.spawnPrompt"
            | "agent.run"
            | "rail.rename"
            | "rail.move"
            | "rail.remove" => Ok(Some(rpc::params::<NodeId>(params.clone())?.id)),
            _ => Ok(None),
        }
    }

    pub(crate) fn child_effects(&self, child: &str) -> Arc<tokio::sync::RwLock<()>> {
        let mut writes = self
            .child_effects
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // No historical child or completed effect needs a live lock. Weak entries keep
        // concurrent callers on one lock without retaining every Agent ever created.
        writes.retain(|_, lock| lock.strong_count() != 0);
        if let Some(lock) = writes.get(child).and_then(std::sync::Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(tokio::sync::RwLock::new(()));
        writes.insert(child.to_owned(), Arc::downgrade(&lock));
        lock
    }

    pub(crate) async fn before_prompt_effect(
        &self,
        actor: &Actor,
        method: &str,
    ) -> Result<(), RpcError> {
        let observed = match method {
            "agent.stop" | "agent.interrupt" | "agent.prompt" | "rail.rename" | "terminal.kill"
            | "terminal.close" | "terminal.resize" => actor.kind == ActorKind::Agent,
            _ => false,
        };
        if !observed {
            return Ok(());
        }
        let Some(gate) = &self.prompt_effect_gate else {
            return Ok(());
        };
        if std::fs::read_to_string(gate).ok().as_deref() != Some("before") {
            return Ok(());
        }
        std::fs::write(gate.with_extension("arrived"), method).map_err(RpcError::internal)?;
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while gate.is_file() {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .map_err(|_| RpcError::conflict("original prompt effect observer was not released"))?;
        Ok(())
    }

    /// M13: `NOT_FOUND` for an unknown Terminal, then `FORBIDDEN` when an Agent may not read it.
    /// A malformed id is left to the Terminal's own `INVALID_PARAMS`. Returns the authorized
    /// Terminal's owner so its write and the owner's Takeover use the same exclusion lock.
    pub(crate) async fn guard_terminal_read(
        &self,
        actor: &Actor,
        method: &str,
        params: &Value,
    ) -> Result<Option<String>, RpcError> {
        self.guard_terminal(actor, method, params, false).await
    }

    /// `guard_terminal_read`, or with `show` B53's wider rule for a Show request.
    pub(crate) async fn guard_terminal(
        &self,
        actor: &Actor,
        method: &str,
        params: &Value,
        show: bool,
    ) -> Result<Option<String>, RpcError> {
        if actor.kind != ActorKind::Agent {
            return Ok(None);
        }
        let Some(id) = params["id"].as_str() else {
            return Ok(None);
        };
        let terminals = self
            .modules
            .get("terminal")
            .ok_or_else(|| RpcError::internal("terminal module is not registered"))?;
        let listed = terminals
            .call(&self.ctx(Actor::daemon()), "terminal.list", Value::Null)
            .await?;
        let infos: Vec<TerminalInfo> =
            serde_json::from_value(listed).map_err(RpcError::internal)?;
        match infos.iter().find(|info| info.id == id) {
            Some(info) if show => self
                .agents
                .guard_terminal_show(actor, id, info.owner.as_deref())
                .map(|()| info.owner.clone()),
            Some(info) => self
                .agents
                .guard_terminal_read(actor, id, info.owner.as_deref(), is_child_read(method))
                .map(|()| info.owner.clone()),
            None if id.parse::<u64>().is_ok_and(|n| n.to_string() == id) => {
                Err(RpcError::not_found(format!("terminal {id}")))
            }
            None => Ok(None),
        }
    }

    /// X14: select or release one Terminal's output for this connection.
    pub(crate) async fn terminal_output(
        &self,
        conn: &Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let contracts::terminal::TerminalId { id } = rpc::params(params.clone())?;
        let port = conn
            .output
            .as_ref()
            .ok_or_else(|| RpcError::internal("this call cannot receive Terminal output"))?;
        self.guard_terminal_read(&conn.actor, method, &params)
            .await?;
        if method == "terminal.outputStop" {
            port.release(&id);
            return rpc::reply(&());
        }
        let stream = self.terminals.subscribe_output(&id)?;
        let offset = stream.start();
        port.select(&id, stream);
        rpc::reply(&contracts::terminal::OutputStarted { offset })
    }

    /// M14: an Agent opens a Terminal only in its own Workstream, one above it or one in its Reach.
    pub(crate) fn guard_terminal_open(
        &self,
        actor: &Actor,
        params: &Value,
    ) -> Result<(), RpcError> {
        let params: contracts::terminal::OpenParams = rpc::params(params.clone())?;
        match params.workstream.as_deref() {
            Some(workstream) if actor.kind == ActorKind::Agent => {
                self.agents
                    .guard_terminal_read(actor, workstream, Some(workstream), false)
            }
            None if actor.kind != ActorKind::User => Err(RpcError::forbidden(
                "only the user may open a Project-owned Terminal",
            )),
            _ => Ok(()),
        }
    }

    /// M14: an Agent's Route is between Agents that are it or in its Reach, never to itself.
    pub(crate) fn guard_route_set(&self, actor: &Actor, params: &Value) -> Result<(), RpcError> {
        if actor.kind != ActorKind::Agent {
            return Ok(());
        }
        self.agents.guard_route(actor, params)
    }

    /// B32: the user's bytes are counted before they reach the Terminal, so a Message checked
    /// after they arrive finds them. A call that is not well formed is left to the Terminal's own error.
    pub(crate) async fn note_user_input(&self, params: &Value) {
        use base64::Engine as _;
        let (Some(messages), Some(id), Some(data)) = (
            self.sender.get(),
            params["id"].as_str(),
            params["data"].as_str(),
        ) else {
            return;
        };
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) {
            messages.user_wrote(id, &bytes).await;
        }
    }

    /// T14, P12: a Todo or Pad an Agent just created gets the nearest Workstream at or above that Agent as its Home.
    pub(crate) async fn home_in_workstream(
        &self,
        method: &str,
        actor: &Actor,
        created: Value,
    ) -> Result<Value, RpcError> {
        let (namespace, move_method, key) = match method {
            "pad.create" => ("pad", "pad.move", "name"),
            _ => ("todo", "todo.move", "id"),
        };
        let nodes = self.rail().await?;
        let mut at = nodes.iter().find(|node| node.id == actor.id);
        while let Some(node) = at {
            if node.kind == contracts::agent::NodeKind::Workstream {
                let module = self.modules.get(namespace).ok_or_else(|| {
                    RpcError::internal(format!("{namespace} module is not registered"))
                })?;
                let ctx = self.ctx(Actor::daemon());
                return module
                    .call(
                        &ctx,
                        move_method,
                        json!({ key: created[key].clone(), "home": node.id }),
                    )
                    .await;
            }
            at = node
                .parent
                .as_ref()
                .and_then(|parent| nodes.iter().find(|n| &n.id == parent));
        }
        Ok(created)
    }

    /// M10: only a Door writes a Checkpoint; a Door is the Agent whose id is a Workstream's.
    pub(crate) async fn require_door(&self, actor: &Actor) -> Result<(), RpcError> {
        let is_door = actor.kind == ActorKind::Agent
            && self.rail().await?.iter().any(|node| {
                node.id == actor.id && node.kind == contracts::agent::NodeKind::Workstream
            });
        if is_door {
            return Ok(());
        }
        Err(RpcError::forbidden(format!(
            "{} is not a Door, so it may not write a Checkpoint",
            actor.id
        )))
    }

    /// T13, P12: a `todo.move` or `pad.move` names a Workstream on the Rail, or the Project root.
    pub(crate) async fn require_workstream(&self, params: &Value) -> Result<(), RpcError> {
        let home: Option<String> = rpc::params::<HomeOnly>(params.clone())?.home;
        let Some(home) = home else { return Ok(()) };
        let nodes = self.rail().await?;
        match nodes.iter().find(|node| node.id == home) {
            None => Err(RpcError::not_found(format!("rail node {home}"))),
            Some(node) if node.kind != contracts::agent::NodeKind::Workstream => {
                Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("rail node {home} is not a Workstream"),
                ))
            }
            Some(_) => Ok(()),
        }
    }

    /// T16, T17: an `owner` is the user or an Agent the Rail holds, never an Extension.
    pub(crate) async fn require_owner(&self, params: &Value) -> Result<(), RpcError> {
        let Some(owner) = rpc::params::<OwnerOnly>(params.clone())?.owner else {
            return Ok(());
        };
        match owner.kind {
            ActorKind::User if owner == Actor::user() => Ok(()),
            ActorKind::Agent => {
                let nodes = self.rail().await?;
                if nodes.iter().any(|node| {
                    node.id == owner.id && node.kind == contracts::agent::NodeKind::Agent
                }) {
                    Ok(())
                } else {
                    Err(RpcError::not_found(format!("agent {}", owner.id)))
                }
            }
            _ => Err(RpcError::new(
                code::INVALID_PARAMS,
                "an owner is the user or an Agent",
            )),
        }
    }
}
