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
        mut request: Value,
        actor: Option<Actor>,
    ) -> Option<Frame> {
        let id = request.get("id").cloned();
        let params = request
            .get_mut("params")
            .map(Value::take)
            .unwrap_or(Value::Null);
        let method = request["method"].as_str().unwrap_or_default();
        if method == "terminal.write" {
            // A child may not turn its Terminal keystrokes into a user's answer by claiming
            // `user`; H21's process identity applies here. The wire reader already resolved it.
            let actor = actor.unwrap_or_else(|| self.terminal_writer(conn));
            if actor.kind == ActorKind::Agent {
                conn.actor = actor;
            }
        } else if method.starts_with("deliverable.")
            || matches!(method, "project.open" | "project.start")
            || crate::actions::is_action(method)
            || matches!(
                method,
                "terminal.catchUp"
                    | "todo.delete"
                    | "todo.deletion"
                    | "todo.restore"
                    | "todo.redo"
                    | "rail.remove"
                    | "rail.deletion"
                    | "rail.restore"
                    | "rail.redo"
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
                    | "rail.group"
                    | "rail.removeSelection"
                    | "rail.rename"
                    | "rail.setAlertLevel"
                    | "workstream.setAuto"
                    | "agent.spawn"
                    | "agent.stop"
                    | "agent.interrupt"
                    | "agent.prompt"
                    | "agent.setOrder"
                    | "agent.setVisibility"
                    | "agent.resume"
                    | "agent.instructions"
            )
        {
            conn.actor = actor.unwrap_or_else(|| self.action_actor(conn));
        }
        let outcome = if method == "rail.tree" {
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

    /// `rail.tree`, written without a `Value` tree. No guard in `route_inner`
    /// applies to it (it names no child and no Terminal), so this keeps only its entry steps.
    async fn rail_reply(&self, conn: &Conn) -> Result<rpc::Reply, RpcError> {
        self.auto.start(|| self.reader());
        self.start_pushes();
        self.start_queue();
        let rail = self
            .modules
            .get("rail")
            .ok_or_else(|| RpcError::method_not_found("rail.tree"))?;
        let reply = rail
            .call_reply(&self.ctx(conn.actor.clone()), "rail.tree", Value::Null)
            .await?;
        self.with_waiting(reply).await
    }

    /// `rail.tree` as a connection reads it: the Rail with each Workstream's state and waiting count.
    pub(crate) async fn presented_rail(
        &self,
        conn: &Conn,
    ) -> Result<Vec<contracts::agent::RailNode>, RpcError> {
        match self.rail_reply(conn).await? {
            rpc::Reply::Value(value) => serde_json::from_value(value),
            rpc::Reply::Json(json) => serde_json::from_str(&json),
        }
        .map_err(RpcError::internal)
    }

    /// DCL2, DCL10, DCL10c: each Workstream's state, and each stopped Door's waiting count, read from the stored backlog on every
    /// reply; a Workstream whose Door has a live program carries none.
    async fn with_waiting(&self, reply: rpc::Reply) -> Result<rpc::Reply, RpcError> {
        let counts = match self.sender.get() {
            Some(messages) => messages.waiting_counts().await?,
            None => Default::default(),
        };
        // DCL5: a stalled Door shows its own stall on its row; it is sent no Message about it.
        let stalled = self.agents.stalled(crate::facts::STALL_MS);
        let mut nodes: Vec<contracts::agent::RailNode> = match reply {
            rpc::Reply::Value(value) => serde_json::from_value(value),
            rpc::Reply::Json(json) => serde_json::from_str(&json),
        }
        .map_err(RpcError::internal)?;
        for node in &mut nodes {
            // DCL1: the cause rides the Agent's row and, through its Door, the Workstream's.
            let cause = self
                .sender
                .get()
                .and_then(|messages| messages.delivery_failure(&node.id));
            node.unreachable = cause.map(str::to_owned);
            node.resume = self.agents.resume_wait(&node.id);
            if node.kind == contracts::agent::NodeKind::Workstream {
                node.waiting = counts
                    .get(&node.id)
                    .copied()
                    .filter(|n| *n > 0 && messages::ended(node));
                if stalled.contains(&node.id)
                    && let Some(status) = node.status.as_mut()
                {
                    status.label = "stalled".into();
                }
            }
        }
        crate::workstream_state::derive(&mut nodes, &stalled);
        Ok(rpc::Reply::Value(rpc::reply(&nodes)?))
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
                | "agent.context"
                | "agent.brief"
        ) {
            self.before_prompt_effect(&conn.actor, method).await?;
        }
        if matches!(method, "todo.restore" | "todo.redo") && conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user restores deleted Todos"));
        }
        if method == "rail.tree" {
            return rpc::reply(&self.presented_rail(conn).await?);
        }
        let owner = contracts::methods::owner_namespace(method).unwrap_or(namespace);
        if owner == "daemon" {
            return contracts::daemon_methods!(rpc::dispatch_methods, self, conn, method, params);
        }
        if method == "todo.addRef" {
            self.require_ref_target(&params)?;
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
            let write: contracts::terminal::WriteParams = rpc::params(params)?;
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
        if method == "rail.removeSelection" {
            return self
                .remove_selection(&conn.actor, rpc::params(params)?)
                .await;
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
        if method == "agent.setVisibility" {
            let p: contracts::agent::SetVisibilityParams = rpc::params(params.clone())?;
            // Run target and actor guards before looking at Message evidence.
            let nodes = self.rail().await?;
            let node = nodes
                .iter()
                .find(|n| n.id == p.id)
                .ok_or_else(|| RpcError::new(code::NOT_FOUND, "Agent not found"))?;
            if node.kind != contracts::agent::NodeKind::Agent
                || (conn.actor.kind == ActorKind::Agent
                    && (node.parent.as_deref() != Some(&conn.actor.id)
                        || !nodes.iter().any(|n| {
                            n.id == conn.actor.id
                                && n.kind == contracts::agent::NodeKind::Workstream
                        })))
            {
                return Err(RpcError::forbidden(
                    "only a Door may choose visibility for its direct Agent children",
                ));
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
        if matches!(method, "pad.delete" | "pad.redoDelete") && outcome.is_ok() {
            self.publications.invalidate_revoked()?;
        }
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    use std::sync::Mutex;

    #[derive(Clone, Default)]
    struct Input(Arc<Mutex<Vec<Vec<u8>>>>);
    impl io::Write for Input {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().push(bytes.to_vec());
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    struct Listed;
    #[async_trait::async_trait]
    impl Module for Listed {
        fn namespaces(&self) -> &'static [&'static str] {
            &["terminal"]
        }
        async fn call(&self, _: &Ctx, method: &str, _: Value) -> Result<Value, RpcError> {
            assert_eq!(method, "terminal.list");
            Ok(
                json!([{"id":"1", "incarnation":"fixture", "cwd":"/", "program":"", "running":true, "owner":"1"}]),
            )
        }
    }
    fn fixture() -> (tempfile::TempDir, Daemon, Conn, Input) {
        let dir = tempfile::tempdir().unwrap();
        let input = Input::default();
        input.0.lock().unwrap().reserve(4);
        let recorded = input.clone();
        let mut daemon = test_daemon_with_agents(dir.path(), |_: agents::Agents| {
            let bus = Bus::new();
            let terminals = Arc::new(
                terminal::Terminals::open(dir.path(), bus.clone())
                    .unwrap()
                    .with_test_input(recorded),
            );
            agents::Agents::open(dir.path(), dir.path(), bus, terminals).unwrap()
        })
        .unwrap();
        rusqlite::Connection::open(dir.path().join("project.db")).unwrap().execute_batch(
            "INSERT INTO nodes(id,kind,name,ord) VALUES(1,'agent','Writer',0),(2,'agent','Other',1);"
        ).unwrap();
        daemon.register(Arc::new(Listed));
        let (events, _) = mpsc::unbounded_channel();
        let conn = Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        (dir, daemon, conn, input)
    }
    fn actor(id: &str) -> Actor {
        Actor {
            kind: ActorKind::Agent,
            id: id.into(),
            parent: None,
        }
    }
    fn request(params: Value) -> Value {
        json!({"jsonrpc":"2.0", "id":7, "method":"terminal.write", "params":params})
    }

    #[test]
    fn r5638c_dispatch_consumes_large_write_without_payload_clones() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (_dir, daemon, mut conn, input) = fixture();
        let bytes: Vec<u8> = (0..786432).map(|n| n as u8).collect();
        let encoded = STANDARD.encode(&bytes);
        assert_eq!(encoded.len(), 1048576);
        let new_request = request(json!({"id":"1", "data":encoded}));
        let old_request = new_request.clone();
        let old_actor = actor("1");
        let new_actor = old_actor.clone();
        // Warm only entry tasks, not either measured request or envelope.
        rt.block_on(daemon.dispatch(&mut conn, r#"{"id":0,"method":"daemon.ping"}"#, None));
        rt.block_on(async {
            tokio::task::yield_now().await;
            tokio::task::yield_now().await;
        });
        let (mut old_reply, mut new_reply) = (None, None);
        let before = allocation_counter::measure(|| {
            // Check 3's two clones; production below supplies identical guards, decode and effect.
            let params = old_request["params"].clone();
            let mut copied = old_request;
            copied["params"] = params.clone();
            std::hint::black_box(params);
            old_reply = rt.block_on(daemon.dispatch_parsed(&mut conn, copied, Some(old_actor)));
        });
        assert_eq!(input.0.lock().unwrap().len(), 1);
        let after = allocation_counter::measure(|| {
            new_reply =
                rt.block_on(daemon.dispatch_parsed(&mut conn, new_request, Some(new_actor)));
        });
        let reply = new_reply.unwrap().into_value();
        assert_eq!(reply, json!({"jsonrpc":"2.0", "id":7, "result":null}));
        assert_eq!(old_reply.unwrap().into_value(), reply);
        assert_eq!(input.0.lock().unwrap().as_slice(), &[bytes.clone(), bytes]);
        eprintln!(
            "1 MiB encoded write allocated bytes: old={} new={}",
            before.bytes_total, after.bytes_total
        );
        assert!(before.bytes_total >= after.bytes_total + 2 * 1048576 - 4096);
        assert!(
            after.bytes_total < 2_000_000,
            "new dispatch still copies an encoded payload"
        );
    }

    #[tokio::test]
    async fn r5638d_resolved_agent_cannot_write_as_user() {
        let (_dir, daemon, mut conn, input) = fixture();
        let reply = daemon
            .dispatch_parsed(
                &mut conn,
                request(json!({"id":"1","data":"!"})),
                Some(actor("2")),
            )
            .await
            .unwrap()
            .into_value();
        assert_eq!(conn.actor, actor("2"));
        assert_eq!(reply["error"]["code"], code::FORBIDDEN);
        assert!(input.0.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn r5638d_malformed_write_has_no_effect() {
        let (_dir, daemon, mut conn, input) = fixture();
        for params in [
            Value::Null,
            json!(false),
            json!(3),
            json!("params"),
            json!([]),
            json!({}),
            json!({"id":"1"}),
            json!({"data":"eA=="}),
            json!({"id":1,"data":"eA=="}),
            json!({"id":"1","data":3}),
            json!({"id":"1","data":"!"}),
        ] {
            let req = request(params);
            let reply = daemon
                .dispatch_parsed(&mut conn, req, Some(actor("1")))
                .await
                .unwrap()
                .into_value();
            assert_eq!(reply["error"]["code"], code::INVALID_PARAMS);
            assert!(input.0.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn r5638d_absent_write_params_has_no_effect() {
        let (_dir, daemon, mut conn, input) = fixture();
        let reply = daemon
            .dispatch_parsed(
                &mut conn,
                json!({"id":7,"method":"terminal.write"}),
                Some(actor("1")),
            )
            .await
            .unwrap()
            .into_value();
        assert_eq!(reply["error"]["code"], code::INVALID_PARAMS);
        assert!(input.0.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn r5638d_unknown_terminal_has_no_effect() {
        let (_dir, daemon, mut conn, input) = fixture();
        for data in ["eA==", "!"] {
            let reply = daemon
                .dispatch_parsed(
                    &mut conn,
                    request(json!({"id":"999","data":data})),
                    Some(actor("1")),
                )
                .await
                .unwrap()
                .into_value();
            assert_eq!(reply["error"]["code"], code::NOT_FOUND);
            assert!(input.0.lock().unwrap().is_empty());
        }
    }
    #[tokio::test]
    async fn r5638e_replies_preserve_arbitrary_ids() {
        let (_dir, daemon, mut conn, input) = fixture();
        for id in [
            Value::Null,
            json!(true),
            json!(false),
            json!(-17),
            json!(u64::MAX),
            json!(1.25),
            json!([1, "x"]),
            json!({"终\n\0":"\\\""}),
            json!("终\n\t\0\\\""),
        ] {
            for caller in ["1", "2"] {
                let mut req = request(json!({"id":"1","data":"eA=="}));
                req["id"] = id.clone();
                let line = daemon
                    .dispatch_parsed(&mut conn, req, Some(actor(caller)))
                    .await
                    .unwrap()
                    .into_line()
                    .unwrap();
                let reply: Value = serde_json::from_slice(&line).unwrap();
                assert_eq!(reply["id"], id);
                assert_eq!(reply.get("result").is_some(), caller == "1");
            }
        }
        assert_eq!(input.0.lock().unwrap().len(), 9);
        let parse = daemon
            .dispatch(&mut conn, "{", None)
            .await
            .unwrap()
            .into_value();
        assert_eq!(parse["id"], Value::Null);
        assert_eq!(parse["error"]["code"], code::PARSE_ERROR);
    }
    #[tokio::test]
    async fn r5638e_notifications_preserve_effects_without_replies() {
        let (_dir, daemon, mut conn, input) = fixture();
        for caller in ["1", "2"] {
            let mut req = request(json!({"id":"1","data":"eA=="}));
            req.as_object_mut().unwrap().remove("id");
            assert!(
                daemon
                    .dispatch_parsed(&mut conn, req, Some(actor(caller)))
                    .await
                    .is_none()
            );
            assert_eq!(input.0.lock().unwrap().as_slice(), &[b"x".to_vec()]);
        }
    }
}
