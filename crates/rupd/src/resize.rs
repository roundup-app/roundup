//! B6: durable acceptance and outcomes of Door resizes, using the router's per-child exclusion.
use std::path::Path;
use std::sync::Mutex;

use contracts::terminal::{ResizeAction, ResizeOutcome, ResizeParams, TerminalId};
use contracts::{Actor, ActorKind};
use rpc::{OpenError, RpcError};
use rusqlite::{Connection, params};
use serde_json::Value;

use crate::{Conn, Daemon};

pub(crate) struct Resizes(Mutex<Connection>);

struct Accepted {
    action: ResizeAction,
    actor: Actor,
    attempt: Option<String>,
    child_terminal: Option<String>,
}

impl Resizes {
    pub(crate) fn open(dir: &Path) -> Result<Self, OpenError> {
        let store = Self(Mutex::new(Connection::open(dir.join("project.db"))?));
        // Terminals do not survive Daemon restart. Never attach an old action to a reused id.
        for accepted in store
            .accepted(None)
            .map_err(|e| std::io::Error::other(e.message))?
        {
            let reason = match accepted.action.outcome {
                ResizeOutcome::Waiting { .. } => "original Terminal did not survive Daemon restart",
                ResizeOutcome::InProgress => {
                    "resize effect may have happened before Daemon restart; not retried"
                }
                _ => continue,
            };
            store
                .outcome(
                    &accepted.action.id,
                    ResizeOutcome::Dropped {
                        reason: reason.into(),
                    },
                )
                .map_err(|e| std::io::Error::other(e.message))?;
        }
        Ok(store)
    }

    fn accepted(&self, child: Option<&str>) -> Result<Vec<Accepted>, RpcError> {
        let db = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let mut query = db
            .prepare(
                "SELECT a.id,a.actor,a.agent,a.attempt,a.child_terminal,a.terminal,a.cols,a.rows,
             (SELECT outcome FROM resize_outcomes WHERE action=a.id ORDER BY seq DESC LIMIT 1)
             FROM resize_actions a WHERE (?1 IS NULL OR a.agent=?1) ORDER BY a.id",
            )
            .map_err(RpcError::internal)?;
        let rows = query
            .query_map([child], |row| {
                Ok((
                    row.get::<_, i64>(0)?.to_string(),
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, u16>(6)?,
                    row.get::<_, u16>(7)?,
                    row.get::<_, String>(8)?,
                ))
            })
            .map_err(RpcError::internal)?;
        rows.map(|row| {
            let (id, actor, agent, attempt, child_terminal, terminal, cols, rows, outcome) =
                row.map_err(RpcError::internal)?;
            Ok(Accepted {
                action: ResizeAction {
                    id,
                    agent,
                    terminal,
                    cols,
                    rows,
                    outcome: serde_json::from_str(&outcome).map_err(RpcError::internal)?,
                },
                actor: serde_json::from_str(&actor).map_err(RpcError::internal)?,
                attempt,
                child_terminal,
            })
        })
        .collect()
    }

    fn accept(
        &self,
        actor: &Actor,
        node: &contracts::agent::RailNode,
        resize: ResizeParams,
    ) -> Result<ResizeAction, RpcError> {
        let mut db = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let tx = db.transaction().map_err(RpcError::internal)?;
        tx.execute(
            "INSERT INTO resize_actions(actor,agent,attempt,child_terminal,terminal,cols,rows) VALUES(?,?,?,?,?,?,?)",
            params![serde_json::to_string(actor).map_err(RpcError::internal)?, node.id, node.attempt, node.terminal_id, resize.id, resize.cols, resize.rows]
        ).map_err(RpcError::internal)?;
        let id = tx.last_insert_rowid().to_string();
        let outcome = ResizeOutcome::Waiting {
            reason: "takeover".into(),
        };
        tx.execute(
            "INSERT INTO resize_outcomes(action,outcome) VALUES(?,?)",
            params![
                id,
                serde_json::to_string(&outcome).map_err(RpcError::internal)?
            ],
        )
        .map_err(RpcError::internal)?;
        tx.commit().map_err(RpcError::internal)?;
        Ok(ResizeAction {
            id,
            agent: node.id.clone(),
            terminal: resize.id,
            cols: resize.cols,
            rows: resize.rows,
            outcome,
        })
    }

    fn outcome(&self, id: &str, outcome: ResizeOutcome) -> Result<(), RpcError> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .execute(
                "INSERT INTO resize_outcomes(action,outcome) VALUES(?,?)",
                params![
                    id,
                    serde_json::to_string(&outcome).map_err(RpcError::internal)?
                ],
            )
            .map_err(RpcError::internal)?;
        Ok(())
    }
}

impl Daemon {
    pub(crate) async fn resize_history(
        &self,
        conn: &Conn,
        params: Value,
    ) -> Result<Value, RpcError> {
        let TerminalId { id } = rpc::params(params)?;
        if conn.actor.kind == ActorKind::Ext {
            return Err(RpcError::forbidden(
                "only the user and the accepting Agent read resize outcomes",
            ));
        }
        self.reconcile_resizes().await?;
        let actions: Vec<_> = self
            .resizes
            .accepted(None)?
            .into_iter()
            .filter(|a| {
                a.action.terminal == id
                    && (conn.actor.kind == ActorKind::User
                        || a.actor.kind == conn.actor.kind && a.actor.id == conn.actor.id)
            })
            .map(|a| a.action)
            .collect();
        rpc::reply(&actions)
    }

    /// Called under the child's exclusive effect lock, before any later Door resize enters.
    pub(crate) async fn release_resizes(&self, child: &str) -> Result<(), RpcError> {
        let actions = self.resizes.accepted(Some(child))?;
        for accepted in actions {
            if !matches!(accepted.action.outcome, ResizeOutcome::Waiting { .. }) {
                continue;
            }
            let action = &accepted.action;
            let node = self.rail().await?.into_iter().find(|n| n.id == child);
            let terminals: Vec<contracts::terminal::TerminalInfo> = serde_json::from_value(
                self.modules["terminal"]
                    .call(&self.ctx(Actor::daemon()), "terminal.list", Value::Null)
                    .await?,
            )
            .map_err(RpcError::internal)?;
            let child_exited = accepted
                .child_terminal
                .as_ref()
                .is_some_and(|id| !terminals.iter().any(|t| &t.id == id && t.running));
            let reason = match node {
                _ if child_exited => Some("child exited before resize release"),
                None => Some("child was removed"),
                Some(n)
                    if n.attempt != accepted.attempt
                        || n.terminal_id != accepted.child_terminal =>
                {
                    Some("child Attempt changed before resize release")
                }
                Some(n)
                    if n.status
                        .as_ref()
                        .is_some_and(|s| s.kind == contracts::Kind::Done) =>
                {
                    Some("child exited before resize release")
                }
                _ => None,
            };
            let outcome = if let Some(reason) = reason {
                ResizeOutcome::Dropped {
                    reason: reason.into(),
                }
            } else {
                let params =
                    serde_json::json!({"id":action.terminal,"cols":action.cols,"rows":action.rows});
                let authorized = self.guard_terminal_read(&accepted.actor, &params).await;
                match authorized {
                    Ok(Some(owner)) if owner == child => {
                        // The durable cut precedes the physical effect, so a crash never retries it.
                        self.resizes
                            .outcome(&action.id, ResizeOutcome::InProgress)?;
                        let effect = async {
                            self.before_prompt_effect(&accepted.actor, "terminal.resize", &params)
                                .await?;
                            self.modules["terminal"]
                                .call(&self.ctx(accepted.actor), "terminal.resize", params)
                                .await?;
                            self.after_resize_effect().await
                        }
                        .await;
                        match effect {
                            Ok(()) => ResizeOutcome::Completed,
                            Err(e) => ResizeOutcome::Dropped { reason: e.message },
                        }
                    }
                    Ok(_) => ResizeOutcome::Dropped {
                        reason: "original Terminal owner changed".into(),
                    },
                    Err(e) => ResizeOutcome::Dropped { reason: e.message },
                }
            };
            self.resizes.outcome(&action.id, outcome)?;
        }
        Ok(())
    }

    pub(crate) async fn hold_resize(
        &self,
        conn: &Conn,
        child: &str,
        params: Value,
    ) -> Result<Option<Value>, RpcError> {
        // Pre-existing held actions always release before a later resize can overtake them.
        if !self.sender.get().is_some_and(|m| m.takeover_active(child)) {
            self.release_resizes(child).await?;
            return Ok(None);
        }
        let resize: ResizeParams = rpc::params(params)?;
        if resize.cols == 0 || resize.rows == 0 {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "cols and rows must be at least 1",
            ));
        }
        let node = self
            .rail()
            .await?
            .into_iter()
            .find(|n| n.id == child)
            .ok_or_else(|| RpcError::not_found(format!("child {child}")))?;
        rpc::reply(&self.resizes.accept(&conn.actor, &node, resize)?).map(Some)
    }

    /// B6's crash observer pauses after the physical effect and before its completion record.
    async fn after_resize_effect(&self) -> Result<(), RpcError> {
        let Some(gate) = &self.prompt_effect_gate else {
            return Ok(());
        };
        if std::fs::read_to_string(gate).ok().as_deref() != Some("after-resize") {
            return Ok(());
        }
        std::fs::write(gate.with_extension("arrived"), "terminal.resize.after")
            .map_err(RpcError::internal)?;
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while gate.is_file() {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .map_err(|_| {
            RpcError::unknown_outcome(
                "resize observer was not released; effect may have happened; do not retry",
            )
        })?;
        Ok(())
    }

    pub(crate) async fn reconcile_resizes(&self) -> Result<(), RpcError> {
        let terminals: Vec<contracts::terminal::TerminalInfo> = serde_json::from_value(
            self.modules["terminal"]
                .call(&self.ctx(Actor::daemon()), "terminal.list", Value::Null)
                .await?,
        )
        .map_err(RpcError::internal)?;
        for accepted in self.resizes.accepted(None)? {
            if !matches!(accepted.action.outcome, ResizeOutcome::Waiting { .. }) {
                continue;
            }
            for id in [
                Some(accepted.action.terminal.as_str()),
                accepted.child_terminal.as_deref(),
            ]
            .into_iter()
            .flatten()
            {
                if !terminals.iter().any(|t| t.id == id && t.running) {
                    self.resize_exit(id).await?;
                }
            }
        }
        Ok(())
    }

    /// Exit accounting runs from the Daemon's event observer, not from a caller's connection.
    pub(crate) async fn resize_exit(&self, terminal: &str) -> Result<(), RpcError> {
        let pending = self.resizes.accepted(None)?;
        for accepted in pending {
            if matches!(accepted.action.outcome, ResizeOutcome::Waiting { .. })
                && (accepted.action.terminal == terminal
                    || accepted.child_terminal.as_deref() == Some(terminal))
            {
                let _child = self
                    .child_effects(&accepted.action.agent)
                    .write_owned()
                    .await;
                // Release may have completed while this observer waited for the child.
                if self
                    .resizes
                    .accepted(Some(&accepted.action.agent))?
                    .iter()
                    .any(|a| {
                        a.action.id == accepted.action.id
                            && matches!(a.action.outcome, ResizeOutcome::Waiting { .. })
                    })
                {
                    self.resizes.outcome(
                        &accepted.action.id,
                        ResizeOutcome::Dropped {
                            reason: "child or original Terminal exited before resize release"
                                .into(),
                        },
                    )?;
                }
            }
        }
        Ok(())
    }
}
