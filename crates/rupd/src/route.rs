use super::*;

/// The `owner` of a `todo.create` or `todo.assign`.
#[derive(serde::Deserialize)]
pub(crate) struct OwnerOnly {
    pub(crate) owner: Option<Actor>,
}

/// The `home` of a `todo.move` or `pad.move`.
#[derive(serde::Deserialize)]
pub(crate) struct HomeOnly {
    pub(crate) home: Option<String>,
}

impl Daemon {
    /// Answer one request line. Notifications (no `id`) get no answer.
    pub(crate) async fn dispatch(
        &self,
        conn: &mut Conn,
        line: &str,
        actor: Option<Actor>,
    ) -> Option<Value> {
        let Ok(request) = serde_json::from_str::<Value>(line) else {
            return Some(failure(
                &Value::Null,
                &RpcError::new(code::PARSE_ERROR, "parse error"),
            ));
        };
        let id = request.get("id").cloned();
        let method = request["method"].as_str().unwrap_or_default();
        let params = request.get("params").cloned().unwrap_or(Value::Null);
        if method == "terminal.write" {
            // A child may not turn its Terminal keystrokes into a user's answer by claiming
            // `user`; H21's process identity applies here. The wire reader already resolved it.
            let actor = actor.unwrap_or_else(|| self.terminal_writer(conn));
            if actor.kind == ActorKind::Agent {
                conn.actor = actor;
            }
        } else if method.starts_with("deliverable.")
            || method.starts_with("reaction.")
            || matches!(
                method,
                "message.progress"
                    | "message.report"
                    | "message.acceptResult"
                    | "message.verifyResult"
                    | "message.resolveResult"
                    | "message.reconcileWork"
                    | "message.resumeWork"
            )
            || matches!(
                method,
                "rail.rename"
                    | "workstream.setAuto"
                    | "agent.spawn"
                    | "agent.stop"
                    | "agent.interrupt"
                    | "agent.prompt"
                    | "agent.setOrder"
                    | "agent.resume"
                    | "agent.actionHistory"
                    | "agent.instructions"
                    | "workstream.rewind"
                    | "workstream.rewindPlan"
            )
        {
            conn.actor = actor.unwrap_or_else(|| self.action_actor(conn));
        }
        let outcome = self.route(conn, method, params).await;
        let id = id?;
        Some(match outcome {
            Ok(result) => {
                let mut envelope = serde_json::Map::new();
                envelope.insert("jsonrpc".into(), Value::String("2.0".into()));
                envelope.insert("id".into(), id);
                envelope.insert("result".into(), result);
                Value::Object(envelope)
            }
            Err(err) => failure(&id, &err),
        })
    }

    pub(crate) async fn route_inner(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.start_pushes();
        self.start_queue();
        let namespace = method.split('.').next().unwrap_or_default();
        if matches!(method, "daemon.identify" | "events.subscribe") {
            return builtin::call(self, conn, namespace, method, &params)
                .expect("connection-state methods are built in");
        }
        if matches!(method, "terminal.output" | "terminal.outputStop") {
            return self.terminal_output(conn, method, params).await;
        }
        if method == "agent.actionHistory" {
            return self.action_history(conn, params).await;
        }
        if method == "terminal.resizeHistory" {
            return self.resize_history(conn, params).await;
        }
        // These Door calls account for their physical effects before returning, including
        // uncertain outcomes. Begin must not grant the child while an effect can still run.
        let children = self
            .door_effect_children(&conn.actor, method, &params)
            .await?;
        if matches!(method, "workstream.rewind" | "workstream.rewindPlan") {
            // The wire reader selects only for an Agent; the Door's authority is decided here for every caller.
            let children = self.rewind_children(&conn.actor, method, &params).await?;
            return self
                .rewind_call(&conn.actor, method, params, children)
                .await;
        }
        let child = children.first();
        let _ordered_effect = if matches!(
            method,
            "terminal.resize"
                | "terminal.close"
                | "terminal.kill"
                | "terminal.write"
                | "rail.rename"
                | "agent.stop"
        ) {
            if let Some(child) = child {
                let guard = self.child_effects(child).write_owned().await;
                if method == "terminal.resize" {
                    if let Some(receipt) = self.hold_resize(conn, child, params.clone()).await? {
                        return Ok(receipt);
                    }
                } else if let Some(receipt) = self
                    .hold_child_action(conn, child, method, params.clone())
                    .await?
                {
                    return Ok(receipt);
                }
                Some(guard)
            } else {
                None
            }
        } else {
            None
        };
        let mut door_effects = Vec::new();
        if !matches!(
            method,
            "terminal.resize"
                | "terminal.close"
                | "terminal.kill"
                | "terminal.write"
                | "rail.rename"
                | "agent.stop"
        ) {
            // Multi-child reads acquire in one stable order, so two reads cannot deadlock.
            for child in &children {
                let guard = loop {
                    // A Door's read of a taken-over child waits for the Takeover's end,
                    // behind the actions released then.
                    if is_child_read(method) {
                        self.wait_takeover_end(child).await;
                    }
                    let guard = if !self.sender.get().is_some_and(|m| m.takeover_active(child))
                        && self.held_actions.waiting(child)?
                    {
                        let guard = self.child_effects(child).write_owned().await;
                        // A newer begin may have won while this call waited for exclusion.
                        if !self.sender.get().is_some_and(|m| m.takeover_active(child)) {
                            self.release_actions(child).await?;
                        }
                        guard.downgrade()
                    } else {
                        // With no older queue, Interrupt must still reach an in-flight Steer.
                        self.child_effects(child).read_owned().await
                    };
                    // Begin needs the write lock, so a begin since the wait shows here.
                    if is_child_read(method)
                        && self.sender.get().is_some_and(|m| m.takeover_active(child))
                    {
                        continue;
                    }
                    break guard;
                };
                // Begin needs the write lock, so this check under the read guard is final.
                let guard = if matches!(
                    method,
                    "agent.interrupt" | "agent.prompt" | "agent.setOrder" | "agent.resume"
                ) && self.sender.get().is_some_and(|m| m.takeover_active(child))
                {
                    drop(guard);
                    let write = self.child_effects(child).write_owned().await;
                    if let Some(receipt) = self
                        .hold_child_action(conn, child, method, params.clone())
                        .await?
                    {
                        return Ok(receipt);
                    }
                    write.downgrade()
                } else {
                    guard
                };
                door_effects.push(guard);
            }
        }
        let _takeover = if method == "takeover.begin" && conn.actor.kind == ActorKind::User {
            let contracts::message::TakeoverParams { agent } = rpc::params(params.clone())?;
            Some(self.child_effects(&agent).write_owned().await)
        } else {
            None
        };
        // A Door's spawn publishes the child before its detached first Steer completes.
        // Hold registration through that publication so begin cannot miss the effect.
        let mut first_steers = if method == "agent.spawn" && conn.actor.kind == ActorKind::Agent {
            Some(self.door_first_steers.lock().await)
        } else {
            None
        };
        if method == "takeover.begin" && conn.actor.kind == ActorKind::User {
            let contracts::message::TakeoverParams { agent } = rpc::params(params.clone())?;
            let attempt = self.door_first_steers.lock().await.get(&agent).cloned();
            if let Some(attempt) = attempt
                && self
                    .rail()
                    .await?
                    .iter()
                    .any(|node| node.id == agent && node.attempt.as_deref() == Some(&attempt))
            {
                self.agents
                    .first_steer_completion(&agent, &attempt)
                    .await
                    .map_err(|err| {
                        RpcError::conflict(format!(
                            "cannot acquire Takeover of {agent}: first Steer completion is unknown: {err}"
                        ))
                    })?;
                self.door_first_steers.lock().await.remove(&agent);
            }
        }
        if matches!(method, "agent.context" | "agent.brief") {
            return self.awareness(conn, method, params).await;
        }
        self.before_prompt_effect(&conn.actor, method).await?;
        if matches!(
            method,
            "message.progress"
                | "message.report"
                | "message.acceptResult"
                | "message.verifyResult"
                | "message.resolveResult"
        ) {
            return self
                .evidence_call(
                    conn,
                    method,
                    params,
                    time::OffsetDateTime::now_utc().unix_timestamp(),
                )
                .await;
        }
        if resume::is_resume_method(method) {
            return self.resume_call(conn, method, params).await;
        }
        if namespace == "deliverable" {
            return self.deliverable_call(conn, method, params).await;
        }
        if namespace == "reaction" {
            return self.reaction_call(conn, method, params).await;
        }
        if method == "attachment.save" {
            return self.attachments.save(params);
        }
        if method == "link.read" {
            return self.link_read(conn, params).await;
        }
        if method == "todo.refs" {
            return self.todo_refs(params);
        }
        if method == "todo.addRef" {
            self.require_ref_target(&params)?;
        }
        if method == "project.resources" {
            return self.project_resources().await;
        }
        match method {
            "workstream.clear" => return self.clear(&conn.actor, params).await,
            "workstream.handoff" => return self.handoff(&conn.actor, params).await,
            _ => {}
        }
        if method == "agent.skills" {
            return self.skills(params).await;
        }
        if method == "checkpoint.write" {
            self.require_door(&conn.actor).await?;
        }
        if method == "agent.digest" {
            return self.digest(conn, params).await;
        }
        if method == "agent.wake" {
            let waker = self
                .waker()
                .ok_or_else(|| RpcError::internal("messages are not open"))?;
            return rpc::reply(&waker.ask(&conn.actor, params).await?);
        }
        if let Some(outcome) = builtin::call(self, conn, namespace, method, &params) {
            return outcome;
        }
        if matches!(
            method,
            "todo.startWorkstream"
                | "workstream.queue"
                | "workstream.dequeue"
                | "workstream.queueMove"
                | "workstream.startNow"
                | "project.setWorkstreamCap"
        ) {
            // P9: a start spends usage, so only the user's own choice changes what starts.
            if method != "workstream.queue" && conn.actor.kind != ActorKind::User {
                return Err(RpcError::forbidden(
                    "only the user starts a Workstream or changes the Queue",
                ));
            }
            return self.queuer().call(&conn.actor, method, params).await;
        }
        // X12: the Agents module resolves Workstream and Project ownership.
        let namespace = if method == "terminal.open" {
            "agent"
        } else {
            namespace
        };
        let module = self
            .modules
            .get(namespace)
            .ok_or_else(|| RpcError::method_not_found(method))?;
        if matches!(method, "todo.move" | "pad.move") {
            if method == "pad.move" && conn.actor.kind == ActorKind::Agent {
                return Err(RpcError::forbidden("an Agent may not move a pad"));
            }
            self.require_workstream(&params).await?;
        }
        if matches!(method, "todo.create" | "todo.assign") {
            self.require_owner(&params).await?;
        }
        if matches!(
            method,
            "terminal.snapshot"
                | "terminal.screen"
                | "terminal.read"
                | "terminal.search"
                | "terminal.write"
                | "terminal.resize"
                | "terminal.kill"
                | "terminal.close"
        ) {
            self.guard_terminal_read(&conn.actor, method, &params)
                .await?;
        }
        if method == "terminal.show" {
            self.guard_terminal(&conn.actor, method, &params, true)
                .await?;
        }
        if method == "terminal.open" {
            self.guard_terminal_open(&conn.actor, &params)?;
        }
        if method == "route.set" {
            self.guard_route_set(&conn.actor, &params)?;
        }
        if method == "terminal.write" {
            let write: contracts::terminal::WriteParams = rpc::params(params.clone())?;
            {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&write.data)
                    .map_err(|err| {
                        RpcError::new(code::INVALID_PARAMS, format!("data is not base64: {err}"))
                    })?;
                if conn.actor.kind == ActorKind::User {
                    self.note_user_input(&params).await;
                }
                self.agents
                    .write_terminal(&conn.actor, &write.id, bytes)
                    .await?;
                return rpc::reply(&());
            }
        }
        if method == "rail.remove" {
            let NodeId { id } = rpc::params(params.clone())?;
            if self
                .rail()
                .await?
                .iter()
                .any(|n| n.id == id && n.kind == contracts::agent::NodeKind::Workstream)
            {
                return self.remove_workstream(&conn.actor, &id).await;
            }
        }
        let outcome = if method == "agent.spawn" && params["specialist"].is_string() {
            self.spawn_specialist(&conn.actor, params.clone()).await
        } else {
            module
                .call(&self.ctx(conn.actor.clone()), method, params.clone())
                .await
        };
        if outcome.is_ok()
            && (method == "message.send"
                || (method == "agent.signal" && params["payload"]["hook_event_name"] == "Stop"))
        {
            let id = if method == "message.send" {
                conn.actor.id.as_str()
            } else {
                params["id"].as_str().unwrap_or_default()
            };
            let is_specialist = self
                .specialists
                .lock()
                .await
                .values()
                .any(|specialist| specialist.id == id);
            // Ordinary hooks must not wait behind a specialist's spawn registration:
            // first-input completion can itself depend on those hooks returning.
            if is_specialist {
                // Takeover acquisition and ordinary spawn use this same effect/registration order.
                let _effect = self.child_effects(id).read_owned().await;
                let mut registration = self.door_first_steers.lock().await;
                let repair = if method == "message.send" {
                    self.specialist_summary(&conn.actor, &params).await
                } else {
                    self.specialist_stop(&params).await
                };
                match repair {
                    Ok(Some(node)) => self.register_first_steer(&mut registration, &node),
                    Ok(None) => {}
                    Err(err) => eprintln!("rupd: specialist handoff: {}", err.message),
                }
            }
        }
        if method == "takeover.end" && outcome.is_ok() {
            let contracts::message::TakeoverParams { agent } = rpc::params(params.clone())?;
            // Message release can await an already-recorded prompt. A new Takeover must
            // remain independent of that typing, and it wins over this older release.
            let _release = self.child_effects(&agent).write_owned().await;
            if !self
                .sender
                .get()
                .is_some_and(|messages| messages.takeover_active(&agent))
            {
                self.release_actions(&agent).await?;
            }
        }
        if let (Some(first_steers), Ok(node)) = (&mut first_steers, &outcome) {
            self.register_first_steer(first_steers, node);
        }
        if matches!(method, "todo.create" | "pad.create") && conn.actor.kind == ActorKind::Agent {
            return self.home_in_workstream(method, &conn.actor, outcome?).await;
        }
        if method == "rail.remove" && outcome.is_ok() {
            self.reset_orphaned_homes().await?;
            self.reset_orphaned_owners().await?;
            self.reset_orphaned_pad_homes().await?;
            return outcome;
        }
        if method == "pad.delete" && outcome.is_ok() {
            self.publications.invalidate_revoked()?;
        }
        outcome
    }
}
