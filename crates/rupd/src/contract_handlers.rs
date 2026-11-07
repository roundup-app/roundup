//! Daemon handlers selected by the contract declarations: each takes the connection and the
//! decoded params, and returns the declared result.
use crate::{Conn, Daemon};
use contracts::ActorKind;
use rpc::RpcError;

impl Daemon {
    pub(super) async fn daemon_get_naming(
        &self,
        conn: &mut Conn,
    ) -> Result<contracts::project::NamingSettings, RpcError> {
        user_naming(conn)?;
        let db = self.naming.lock();
        crate::data::read_naming(&db).map_err(RpcError::internal)
    }

    pub(super) async fn daemon_set_naming(
        &self,
        conn: &mut Conn,
        settings: contracts::project::NamingSettings,
    ) -> Result<(), RpcError> {
        user_naming(conn)?;
        if settings.naming_guide.trim().is_empty() {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "Enter a naming guide before saving.",
            ));
        }
        let db = self.naming.lock();
        crate::data::write_naming(&db, &settings).map_err(RpcError::internal)
    }

    /// FK5977: only the user forks the data folder; the copy runs off the connection's task.
    pub(super) async fn data_fork(
        &self,
        conn: &mut Conn,
        params: contracts::data::ForkParams,
    ) -> Result<contracts::data::ForkResult, RpcError> {
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user forks the data folder"));
        }
        let params = crate::fork::ForkRequest::try_from(params)
            .map_err(|message| RpcError::new(rpc::code::INVALID_PARAMS, message))?;
        let root = crate::data::naming_path(&self.data_dir)
            .parent()
            .map(std::path::Path::to_path_buf)
            .unwrap_or_else(|| self.data_dir.clone());
        tokio::task::spawn_blocking(move || crate::fork::fork(&root, &params))
            .await
            .map_err(RpcError::internal)?
    }

    /// U5239e: write the overrides as `{ "<action name>": "<press>" }`; only the user exports their shortcuts.
    pub(super) async fn shortcuts_export(
        &self,
        conn: &mut Conn,
        p: contracts::link::ShortcutFileExport,
    ) -> Result<(), RpcError> {
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user exports shortcuts"));
        }
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
        })
    }

    pub(super) async fn agent_wake(
        &self,
        conn: &mut Conn,
        params: contracts::agent::WakeParams,
    ) -> Result<contracts::agent::Woken, RpcError> {
        let waker = self
            .waker()
            .ok_or_else(|| RpcError::internal("messages are not open"))?;
        waker.ask(&conn.actor, params).await
    }

    /// DCL1a: one delivery pass for the Agent, now; the user only.
    pub(super) async fn message_retry_delivery(
        &self,
        conn: &mut Conn,
        id: contracts::agent::NodeId,
    ) -> Result<(), RpcError> {
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user retries a delivery"));
        }
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Message holder is unavailable"))?;
        messages.retry_delivery(&id.id).await;
        Ok(())
    }

    pub(super) async fn workstream_restart(
        &self,
        conn: &mut Conn,
        p: contracts::workstream::RestartParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        self.restart_session(&conn.actor, p).await
    }

    pub(super) async fn todo_start_workstream(
        &self,
        conn: &mut Conn,
        p: contracts::workstream::StartWorkstreamParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        user_queue(conn)?;
        self.queuer().start_workstream(&conn.actor, p).await
    }

    pub(super) async fn workstream_queue(
        &self,
        _conn: &mut Conn,
    ) -> Result<contracts::workstream::QueueState, RpcError> {
        self.queuer().state().await
    }

    pub(super) async fn workstream_dequeue(
        &self,
        conn: &mut Conn,
        p: contracts::workstream::QueuedWorkstream,
    ) -> Result<(), RpcError> {
        user_queue(conn)?;
        self.queuer().dequeue(p)
    }

    pub(super) async fn workstream_queue_move(
        &self,
        conn: &mut Conn,
        p: contracts::workstream::QueueMoveParams,
    ) -> Result<(), RpcError> {
        user_queue(conn)?;
        self.queuer().queue_move(p)
    }

    pub(super) async fn workstream_start_now(
        &self,
        conn: &mut Conn,
        p: contracts::workstream::QueuedWorkstream,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        user_queue(conn)?;
        self.queuer().start_now(&conn.actor, p).await
    }

    pub(super) async fn project_set_workstream_cap(
        &self,
        conn: &mut Conn,
        p: contracts::workstream::CapParams,
    ) -> Result<(), RpcError> {
        user_queue(conn)?;
        self.queuer().set_cap(p)
    }
}

fn user_naming(conn: &Conn) -> Result<(), RpcError> {
    if conn.actor.kind != ActorKind::User {
        return Err(RpcError::forbidden(
            "only the user controls global naming preferences",
        ));
    }
    Ok(())
}

/// Only `workstream.queue` is open to an Agent.
fn user_queue(conn: &Conn) -> Result<(), RpcError> {
    if conn.actor.kind != ActorKind::User {
        return Err(RpcError::forbidden(
            "only the user starts a Workstream or changes the Queue",
        ));
    }
    Ok(())
}
