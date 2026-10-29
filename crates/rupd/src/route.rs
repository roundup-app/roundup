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
    ) -> Option<Frame> {
        let Ok(request) = serde_json::from_str::<Value>(line) else {
            return Some(
                failure(
                    &Value::Null,
                    &RpcError::new(code::PARSE_ERROR, "parse error"),
                )
                .into(),
            );
        };
        self.dispatch_parsed(conn, request, actor).await
    }

    /// `dispatch` for a line the caller already parsed.
    pub(crate) async fn dispatch_parsed(
        &self,
        conn: &mut Conn,
        request: Value,
        actor: Option<Actor>,
    ) -> Option<Frame> {
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
                "terminal.catchUp"
                    | "todo.delete"
                    | "todo.deletion"
                    | "todo.restore"
                    | "rail.remove"
                    | "rail.deletion"
                    | "rail.restore"
                    | "message.progress"
                    | "message.report"
                    | "message.acceptResult"
                    | "message.verifyResult"
                    | "message.resolveResult"
                    | "message.reconcileWork"
                    | "message.resumeWork"
            )
            || matches!(
                method,
                "daemon.getNaming"
                    | "daemon.setNaming"
                    | "rail.rename"
                    | "workstream.setAuto"
                    | "agent.spawn"
                    | "agent.stop"
                    | "agent.interrupt"
                    | "agent.prompt"
                    | "agent.setOrder"
                    | "agent.resume"
                    | "agent.instructions"
                    | "workstream.rewind"
                    | "workstream.rewindPlan"
            )
        {
            conn.actor = actor.unwrap_or_else(|| self.action_actor(conn));
        }
        let outcome = if matches!(method, "rail.tree" | "rail.list") {
            self.rail_reply(conn).await
        } else if method == "daemon.ping" {
            // Every guard in `route_inner` passes a ping, so only its entry steps remain.
            self.auto.start(|| self.reader());
            self.start_pushes();
            self.start_queue();
            Ok(rpc::Reply::Json(builtin::ping_json(self)))
        } else {
            self.route(conn, method, params)
                .await
                .map(rpc::Reply::Value)
        };
        let id = id?;
        Some(match outcome {
            Ok(rpc::Reply::Value(result)) => {
                let mut envelope = serde_json::Map::new();
                envelope.insert("jsonrpc".into(), Value::String("2.0".into()));
                envelope.insert("id".into(), id);
                envelope.insert("result".into(), result);
                Frame::Value(Value::Object(envelope))
            }
            Ok(rpc::Reply::Json(result)) => Frame::Json(format!(
                r#"{{"jsonrpc":"2.0","id":{id},"result":{result}}}"#
            )),
            Err(err) => failure(&id, &err).into(),
        })
    }

    /// `rail.tree` and `rail.list`, written without a `Value` tree. No guard in `route_inner`
    /// applies to them (they name no child and no Terminal), so this keeps only its entry steps.
    async fn rail_reply(&self, conn: &Conn) -> Result<rpc::Reply, RpcError> {
        self.auto.start(|| self.reader());
        self.start_pushes();
        self.start_queue();
        let rail = self
            .modules
            .get("rail")
            .ok_or_else(|| RpcError::method_not_found("rail.tree"))?;
        rail.call_reply(&self.ctx(conn.actor.clone()), "rail.tree", Value::Null)
            .await
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
        // These transport/awareness calls already preceded prompt effects; preserve that policy.
        if !matches!(
            method,
            "daemon.identify"
                | "events.subscribe"
                | "terminal.output"
                | "terminal.outputStop"
                | "workstream.rewind"
                | "workstream.rewindPlan"
                | "agent.context"
                | "agent.brief"
        ) {
            self.before_prompt_effect(&conn.actor, method).await?;
        }
        if method == "todo.restore" && conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user restores deleted Todos"));
        }
        let owner = contracts::methods::owner_namespace(method).unwrap_or(namespace);
        if owner == "daemon" {
            return contracts::daemon_methods!(rpc::dispatch_methods, self, conn, method, params);
        }
        if method == "todo.addRef" {
            self.require_ref_target(&params)?;
        }
        if method == "checkpoint.write" {
            self.require_door(&conn.actor).await?;
        }
        let module = self
            .modules
            .get(owner)
            .ok_or_else(|| RpcError::method_not_found(method))?;
        if matches!(method, "todo.move" | "pad.move") {
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
                self.agents
                    .write_terminal(&conn.actor, &write.id, bytes)
                    .await?;
                return rpc::reply(&());
            }
        }
        if method == "rail.remove" {
            let removal: contracts::agent::RemoveParams = rpc::params(params.clone())?;
            if removal.operation.is_some() {
                return self.remove_reversible(&conn.actor, removal).await;
            }
            let NodeId { id } = rpc::params(params.clone())?;
            if self
                .rail()
                .await?
                .iter()
                .any(|n| n.id == id && n.kind == contracts::agent::NodeKind::Workstream)
            {
                return self
                    .remove_workstream(&conn.actor, &id, removal.scope.unwrap_or_default())
                    .await;
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
            if is_specialist {
                let repair = if method == "message.send" {
                    self.specialist_summary(&conn.actor, &params).await
                } else {
                    self.specialist_stop(&params).await
                };
                if let Err(err) = repair {
                    eprintln!("rupd: specialist handoff: {}", err.message);
                }
            }
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
