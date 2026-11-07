//! Existing Daemon handlers selected by the contract declarations.
use crate::{Conn, Daemon};
use rpc::RpcError;
use serde_json::Value;

impl Daemon {
    pub(super) async fn rpc_naming(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        if conn.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user controls global naming preferences",
            ));
        }
        if method == "daemon.getNaming" {
            self.get_naming()
        } else {
            self.set_naming(rpc::params(params)?)
        }
    }

    fn get_naming(&self) -> Result<Value, RpcError> {
        let db = self.naming.lock().expect("naming preferences poisoned");
        rpc::reply(&crate::data::read_naming(&db).map_err(RpcError::internal)?)
    }

    fn set_naming(&self, settings: contracts::project::NamingSettings) -> Result<Value, RpcError> {
        if settings.naming_guide.trim().is_empty() {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "Enter a naming guide before saving.",
            ));
        }
        let db = self.naming.lock().expect("naming preferences poisoned");
        crate::data::write_naming(&db, &settings).map_err(RpcError::internal)?;
        rpc::reply(&())
    }

    /// FK5977: only the user forks the data folder; the copy runs off the connection's task.
    pub(super) async fn rpc_data_fork(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        if conn.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden("only the user forks the data folder"));
        }
        let params: crate::fork::ForkRequest = rpc::params(params)?;
        let root = crate::data::naming_path(&self.data_dir)
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| self.data_dir.clone());
        let result = tokio::task::spawn_blocking(move || crate::fork::fork(&root, &params))
            .await
            .map_err(RpcError::internal)??;
        rpc::reply(&result)
    }

    pub(super) async fn rpc_skill(
        &self,
        conn: &mut Conn,
        method: &str,
        _params: Value,
    ) -> Result<Value, RpcError> {
        self.skill(conn, method)
    }

    pub(super) async fn rpc_builtin(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        crate::builtin::call(
            self,
            conn,
            method.split('.').next().unwrap_or_default(),
            method,
            &params,
        )
        .expect("declared built-in method")
    }

    pub(super) async fn github_call(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.github(conn, method, params).await
    }

    pub(super) async fn feedback_call(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.feedback(conn, method, params).await
    }

    pub(super) async fn rpc_link_read(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.link_read(conn, params).await
    }

    /// U5239e: write the overrides as `{ "<action name>": "<press>" }`; only the user exports their shortcuts.
    pub(super) async fn rpc_shortcuts_export(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        if conn.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden("only the user exports shortcuts"));
        }
        let p: contracts::link::ShortcutFileExport = rpc::params(params)?;
        if !std::path::Path::new(&p.path).is_absolute() {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                format!("export path must be absolute: {}", p.path),
            ));
        }
        let text = serde_json::to_string_pretty(&p.keys).map_err(RpcError::internal)?;
        std::fs::write(&p.path, text + "\n").map_err(|err| {
            RpcError::new(
                rpc::code::INTERNAL,
                format!("cannot export to {}: {err}", p.path),
            )
        })?;
        rpc::reply(&())
    }

    pub(super) async fn rpc_todo_refs(
        &self,
        _conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.todo_refs(params)
    }

    pub(super) async fn rpc_agent_skills(
        &self,
        _conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.skills(params).await
    }

    pub(super) async fn rpc_agent_digest(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.digest(conn, params).await
    }

    pub(super) async fn rpc_agent_wake(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let waker = self
            .waker()
            .ok_or_else(|| RpcError::internal("messages are not open"))?;
        rpc::reply(&waker.ask(&conn.actor, params).await?)
    }

    pub(super) async fn rpc_rewind(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.rewind_call(&conn.actor, params).await
    }

    pub(super) async fn rpc_project_resources(
        &self,
        _conn: &mut Conn,
        _method: &str,
        _params: Value,
    ) -> Result<Value, RpcError> {
        self.project_resources().await
    }

    pub(super) async fn rpc_evidence(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.evidence_call(
            conn,
            method,
            params,
            time::OffsetDateTime::now_utc().unix_timestamp(),
        )
        .await
    }

    /// DCL1a: one delivery pass for the Agent, now; the user only.
    pub(super) async fn rpc_message_retry_delivery(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        if conn.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden("only the user retries a delivery"));
        }
        let id: contracts::agent::NodeId = rpc::params(params)?;
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Message holder is unavailable"))?;
        messages.retry_delivery(&id.id).await;
        rpc::reply(&())
    }

    pub(super) async fn rpc_workstream_restart(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        rpc::reply(
            &self
                .restart_session(&conn.actor, rpc::params(params)?)
                .await?,
        )
    }

    pub(super) async fn rpc_queue(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        if method != "workstream.queue" && conn.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user starts a Workstream or changes the Queue",
            ));
        }
        self.queuer().call(&conn.actor, method, params).await
    }
}
