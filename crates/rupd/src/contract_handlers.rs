//! Existing Daemon handlers selected by the contract declarations.
use crate::{Conn, Daemon};
use rpc::RpcError;
use serde_json::Value;

impl Daemon {
    pub(super) async fn rpc_deliverable_publish(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.deliverable_call(conn, method, params).await
    }

    pub(super) async fn rpc_deliverable_list(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.deliverable_call(conn, method, params).await
    }

    pub(super) async fn rpc_deliverable_get(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.deliverable_call(conn, method, params).await
    }

    pub(super) async fn rpc_deliverable_resolve(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.deliverable_call(conn, method, params).await
    }

    pub(super) async fn rpc_deliverable_move(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.deliverable_call(conn, method, params).await
    }

    pub(super) async fn rpc_deliverable_remove(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.deliverable_call(conn, method, params).await
    }

    pub(super) async fn rpc_daemon_ping(
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

    pub(super) async fn rpc_daemon_methods(
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

    pub(super) async fn rpc_daemon_identify(
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

    pub(super) async fn rpc_events_subscribe(
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

    pub(super) async fn rpc_provenance_history(
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

    pub(super) async fn rpc_provenance_touched(
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

    pub(super) async fn rpc_terminal_output(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.terminal_output(conn, method, params).await
    }

    pub(super) async fn rpc_terminal_output_stop(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.terminal_output(conn, method, params).await
    }

    pub(super) async fn rpc_todo_refs(
        &self,
        _conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.todo_refs(params)
    }

    pub(super) async fn rpc_agent_context(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.awareness(conn, method, params).await
    }

    pub(super) async fn rpc_agent_brief(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.awareness(conn, method, params).await
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

    pub(super) async fn rpc_reaction_create(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.reaction_call(conn, method, params).await
    }

    pub(super) async fn rpc_reaction_preview(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.reaction_call(conn, method, params).await
    }

    pub(super) async fn rpc_reaction_list(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.reaction_call(conn, method, params).await
    }

    pub(super) async fn rpc_reaction_get(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.reaction_call(conn, method, params).await
    }

    pub(super) async fn rpc_reaction_stop(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.reaction_call(conn, method, params).await
    }

    pub(super) async fn rpc_reaction_run(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.reaction_call(conn, method, params).await
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

    pub(super) async fn rpc_message_progress(
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

    pub(super) async fn rpc_message_report(
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

    pub(super) async fn rpc_message_accept_result(
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

    pub(super) async fn rpc_message_verify_result(
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

    pub(super) async fn rpc_message_resolve_result(
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

    pub(super) async fn rpc_message_reconcile_work(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.resume_call(conn, method, params).await
    }

    pub(super) async fn rpc_message_resume_work(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.resume_call(conn, method, params).await
    }

    pub(super) async fn rpc_workstream_clear(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.clear(&conn.actor, params).await
    }

    pub(super) async fn rpc_workstream_rewind_plan(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let children = self.rewind_children(&conn.actor, method, &params).await?;
        self.rewind_call(&conn.actor, method, params, children)
            .await
    }

    pub(super) async fn rpc_workstream_rewind(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let children = self.rewind_children(&conn.actor, method, &params).await?;
        self.rewind_call(&conn.actor, method, params, children)
            .await
    }

    pub(super) async fn rpc_workstream_handoff(
        &self,
        conn: &mut Conn,
        _method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        self.handoff(&conn.actor, params).await
    }

    pub(super) async fn rpc_todo_start_workstream(
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

    pub(super) async fn rpc_workstream_queue(
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

    pub(super) async fn rpc_workstream_dequeue(
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

    pub(super) async fn rpc_workstream_queue_move(
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

    pub(super) async fn rpc_workstream_start_now(
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

    pub(super) async fn rpc_project_set_workstream_cap(
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
