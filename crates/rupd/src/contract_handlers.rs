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
        let db = self.naming.lock().expect("naming preferences poisoned");
        if method == "daemon.getNaming" {
            return rpc::reply(&crate::data::read_naming(&db).map_err(RpcError::internal)?);
        }
        let settings: contracts::project::NamingSettings = rpc::params(params)?;
        if settings.naming_guide.trim().is_empty() {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "Enter a naming guide before saving.",
            ));
        }
        crate::data::write_naming(&db, &settings).map_err(RpcError::internal)?;
        rpc::reply(&())
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

    pub(super) async fn rpc_link_read(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.link_read(conn, params).await
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

    pub(super) async fn rpc_project_resources(
        &self,
        _conn: &mut Conn,
        _method: &str,
        _params: Value,
    ) -> Result<Value, RpcError> {
        self.project_resources().await
    }

    pub(super) async fn rpc_attachment_save(
        &self,
        _conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.attachments.save(params)
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
