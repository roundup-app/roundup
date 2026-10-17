//! B6: one durable ledger for held Door resizes, renames and stops, using per-child exclusion.
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use contracts::agent::{HeldAction, HeldCall, NodeId, SetOrderParams};
use contracts::decision::AnswerParams;
use contracts::terminal::{ResizeAction, ResizeOutcome, ResizeParams, TerminalId};
use contracts::{Actor, ActorKind};
use rpc::{OpenError, RpcError};
use rusqlite::{Connection, params};
use serde_json::Value;

use crate::{Conn, Daemon};

pub(crate) struct HeldActions {
    db: Mutex<Connection>,
    arrivals: Mutex<HashMap<String, tokio::sync::watch::Receiver<bool>>>,
}

struct Accepted {
    action: HeldAction,
    actor: Actor,
    attempt: Option<String>,
    child_terminal: Option<String>,
}

impl HeldActions {
    pub(crate) fn open(dir: &Path) -> Result<Self, OpenError> {
        let store = Self {
            db: Mutex::new(Connection::open(dir.join("project.db"))?),
            arrivals: Mutex::new(HashMap::new()),
        };
        // Terminals do not survive Daemon restart. Never attach an old action to a reused id.
        for accepted in store
            .accepted(None)
            .map_err(|e| std::io::Error::other(e.message))?
        {
            let reason = match accepted.action.outcome {
                ResizeOutcome::Waiting { .. }
                    if matches!(
                        accepted.action.call,
                        HeldCall::Rename(_) | HeldCall::Rewind(_)
                    ) =>
                {
                    continue;
                }
                ResizeOutcome::Waiting { .. } if attempt_bound(&accepted.action.call) => {
                    "original Attempt did not survive Daemon restart"
                }
                ResizeOutcome::Waiting { .. } => "original Terminal did not survive Daemon restart",
                ResizeOutcome::InProgress => {
                    "action effect may have happened before Daemon restart; not retried"
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

    /// Registration precedes task spawning: scheduler order must not become acceptance order.
    pub(crate) fn arrive(
        &self,
        child: String,
        ordered: bool,
    ) -> (
        Option<tokio::sync::watch::Receiver<bool>>,
        Option<tokio::sync::watch::Sender<bool>>,
    ) {
        let mut arrivals = self.arrivals.lock().unwrap_or_else(|e| e.into_inner());
        arrivals.retain(|_, prior| !*prior.borrow() && prior.has_changed().is_ok());
        let before = arrivals.get(&child).cloned();
        if !ordered {
            // Steering calls may interrupt each other, but cannot overtake an earlier resize.
            return (before, None);
        }
        let (done, next) = tokio::sync::watch::channel(false);
        arrivals.insert(child, next);
        (before, Some(done))
    }

    pub(crate) fn finish_arrival(&self, done: tokio::sync::watch::Sender<bool>) {
        let _ = done.send(true);
        // Completed children retain neither order tokens nor historical map entries.
        self.arrivals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|_, prior| !*prior.borrow() && prior.has_changed().is_ok());
    }

    /// A35: every recorded rewind of Workstream `id` with its latest outcome.
    pub(crate) fn rewinds(&self, id: &str) -> Result<Vec<(String, ResizeOutcome)>, RpcError> {
        Ok(self
            .accepted(None)?
            .into_iter()
            .filter(|a| matches!(&a.action.call, HeldCall::Rewind(r) if r.id == id))
            .map(|a| (a.action.id, a.action.outcome))
            .collect())
    }

    pub(crate) fn waiting(&self, child: &str) -> Result<bool, RpcError> {
        Ok(self
            .accepted(Some(child))?
            .iter()
            .any(|accepted| matches!(accepted.action.outcome, ResizeOutcome::Waiting { .. })))
    }

    fn accepted(&self, child: Option<&str>) -> Result<Vec<Accepted>, RpcError> {
        let db = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let mut query = db
            .prepare(
                "SELECT a.id,a.actor,a.agent,a.attempt,a.child_terminal,a.method,a.params,
             (SELECT outcome FROM door_action_outcomes WHERE action=a.id ORDER BY seq DESC LIMIT 1)
             FROM door_actions a WHERE (?1 IS NULL OR a.agent=?1) ORDER BY a.id",
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
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(RpcError::internal)?;
        rows.map(|row| {
            let (id, actor, agent, attempt, child_terminal, method, params, outcome) =
                row.map_err(RpcError::internal)?;
            Ok(Accepted {
                action: HeldAction {
                    id,
                    agent,
                    call: serde_json::from_value(serde_json::json!({"method":method,"params":serde_json::from_str::<Value>(&params).map_err(RpcError::internal)?})).map_err(RpcError::internal)?,
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
        call: HeldCall,
    ) -> Result<HeldAction, RpcError> {
        let outcome = ResizeOutcome::Waiting {
            reason: "takeover".into(),
        };
        self.accept_as(actor, node, call, outcome)
    }

    /// Record an action with its first outcome: A35's rewind also records the children it
    /// rewinds at once, so every selected child's outcome is readable later.
    pub(crate) fn accept_as(
        &self,
        actor: &Actor,
        node: &contracts::agent::RailNode,
        call: HeldCall,
        outcome: ResizeOutcome,
    ) -> Result<HeldAction, RpcError> {
        let method = action_method(&call);
        let params = action_params(&call)?;
        let mut db = self.db.lock().unwrap_or_else(|e| e.into_inner());
        let tx = db.transaction().map_err(RpcError::internal)?;
        tx.execute("INSERT INTO door_actions(actor,agent,attempt,child_terminal,method,params) VALUES(?,?,?,?,?,?)",
            params![serde_json::to_string(actor).map_err(RpcError::internal)?,node.id,node.attempt,node.terminal_id,method,params.to_string()]).map_err(RpcError::internal)?;
        let id = tx.last_insert_rowid().to_string();
        tx.execute(
            "INSERT INTO door_action_outcomes(action,outcome) VALUES(?,?)",
            params![
                id,
                serde_json::to_string(&outcome).map_err(RpcError::internal)?
            ],
        )
        .map_err(RpcError::internal)?;
        tx.commit().map_err(RpcError::internal)?;
        Ok(HeldAction {
            id,
            agent: node.id.clone(),
            call,
            outcome,
        })
    }

    pub(crate) fn outcome(&self, id: &str, outcome: ResizeOutcome) -> Result<(), RpcError> {
        self.db
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .execute(
                "INSERT INTO door_action_outcomes(action,outcome) VALUES(?,?)",
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
    pub(crate) async fn action_history(
        &self,
        conn: &Conn,
        params: Value,
    ) -> Result<Value, RpcError> {
        let NodeId { id } = rpc::params(params)?;
        if conn.actor.kind == ActorKind::Ext {
            return Err(RpcError::forbidden(
                "only the user and accepting Agent read held actions",
            ));
        }
        self.reconcile_actions().await?;
        rpc::reply(
            &self
                .held_actions
                .accepted(Some(&id))?
                .into_iter()
                .filter(|a| {
                    conn.actor.kind == ActorKind::User
                        || a.actor.kind == conn.actor.kind && a.actor.id == conn.actor.id
                })
                .map(|a| a.action)
                .collect::<Vec<_>>(),
        )
    }

    pub(crate) async fn hold_child_action(
        &self,
        conn: &Conn,
        child: &str,
        method: &str,
        params: Value,
    ) -> Result<Option<Value>, RpcError> {
        if !self.sender.get().is_some_and(|m| m.takeover_active(child)) {
            self.release_actions(child).await?;
            return Ok(None);
        }
        if method == "agent.setOrder"
            && conn.actor.kind == ActorKind::Agent
            && conn.actor.id == child
        {
            // An Agent's own Order is not a Door action on a child.
            return Ok(None);
        }
        let call = match method {
            "terminal.close" => HeldCall::Close(rpc::params(params)?),
            "terminal.kill" => HeldCall::Kill(rpc::params(params)?),
            "terminal.write" => HeldCall::Write(rpc::params(params)?),
            "rail.rename" => HeldCall::Rename(rpc::params(params)?),
            "agent.setOrder" => {
                let order: SetOrderParams = rpc::params(params)?;
                order
                    .order
                    .validate_explicit()
                    .map_err(|message| RpcError::new(rpc::code::INVALID_PARAMS, message))?;
                HeldCall::SetOrder(order)
            }
            "agent.resume" => HeldCall::Resume(rpc::params(params)?),
            "agent.stop" => HeldCall::Stop(rpc::params(params)?),
            "agent.interrupt" => HeldCall::Interrupt(rpc::params(params)?),
            "agent.prompt" => HeldCall::Prompt(rpc::params(params)?),
            "decision.answer" => {
                if conn.actor.kind == ActorKind::Agent && conn.actor.id == child {
                    // An Agent's own answer is not a Door action on a child.
                    return Ok(None);
                }
                let mut answer: AnswerParams = rpc::params(params)?;
                // The original prompt is fixed now, so release never answers a later one.
                let identity = match answer.identity.take() {
                    Some(identity) => identity,
                    None => serde_json::from_value(
                        self.modules["decision"]
                            .call(
                                &self.ctx(conn.actor.clone()),
                                "decision.capture",
                                serde_json::json!({"id": answer.id}),
                            )
                            .await?,
                    )
                    .map_err(RpcError::internal)?,
                };
                if identity.agent != child || identity.decision != answer.id {
                    return Err(RpcError::conflict(format!(
                        "original prompt {} is not a prompt of {child}",
                        answer.id
                    )));
                }
                answer.identity = Some(identity);
                // An Agent's answer never carries the App's proof; none is stored.
                answer.proof = None;
                HeldCall::Answer(answer)
            }
            _ => return Err(RpcError::method_not_found(method)),
        };
        if terminal_call(&call) {
            // The Terminal's owner is the child, checked again at release.
            self.guard_terminal_read(&conn.actor, "terminal.write", &action_params(&call)?)
                .await?;
        } else {
            self.agents
                .guard_reach(&conn.actor, child, matches!(call, HeldCall::Rename(_)))?;
        }
        let node = self
            .rail()
            .await?
            .into_iter()
            .find(|n| n.id == child)
            .ok_or_else(|| RpcError::not_found(format!("child {child}")))?;
        rpc::reply(&self.held_actions.accept(&conn.actor, &node, call)?).map(Some)
    }

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
        self.reconcile_actions().await?;
        let actions: Vec<_> = self
            .held_actions
            .accepted(None)?
            .into_iter()
            .filter(|a| {
                matches!(a.action.call, HeldCall::Resize(_))
                    && original_terminal(&a.action.call) == Some(id.as_str())
                    && (conn.actor.kind == ActorKind::User
                        || a.actor.kind == conn.actor.kind && a.actor.id == conn.actor.id)
            })
            .map(|a| resize_action(a.action))
            .collect::<Result<Vec<_>, _>>()?;
        rpc::reply(&actions)
    }

    /// Called under the child's exclusive effect lock, before a later Door action enters.
    pub(crate) async fn release_actions(&self, child: &str) -> Result<(), RpcError> {
        let actions = self.held_actions.accepted(Some(child))?;
        for accepted in actions {
            if !matches!(accepted.action.outcome, ResizeOutcome::Waiting { .. }) {
                continue;
            }
            let action = &accepted.action;
            let method = action_method(&action.call);
            let params = action_params(&action.call)?;
            let node = self.rail().await?.into_iter().find(|n| n.id == child);
            let terminals: Vec<contracts::terminal::TerminalInfo> = serde_json::from_value(
                self.modules["terminal"]
                    .call(&self.ctx(Actor::daemon()), "terminal.list", Value::Null)
                    .await?,
            )
            .map_err(RpcError::internal)?;
            let child_exited = terminal_call(&action.call)
                && accepted
                    .child_terminal
                    .as_ref()
                    .is_some_and(|id| !terminals.iter().any(|t| &t.id == id && t.running));
            let reason = match node {
                _ if child_exited => Some("child exited before action release"),
                None => Some("child was removed"),
                Some(n)
                    if !node_bound(&action.call)
                        && (n.attempt != accepted.attempt
                            || terminal_call(&action.call)
                                && n.terminal_id != accepted.child_terminal) =>
                {
                    Some("child Attempt changed before action release")
                }
                Some(n)
                    if !matches!(
                        action.call,
                        HeldCall::Rename(_) | HeldCall::Resume(_) | HeldCall::Rewind(_)
                    ) && n
                        .status
                        .as_ref()
                        .is_some_and(|s| s.kind == contracts::Kind::Done) =>
                {
                    Some("child exited before action release")
                }
                _ => None,
            };
            let outcome = if let Some(reason) = reason {
                ResizeOutcome::Dropped {
                    reason: reason.into(),
                }
            } else {
                let effect = async {
                    if terminal_call(&action.call) {
                        let owner = self
                            .guard_terminal_read(&accepted.actor, "terminal.write", &params)
                            .await?;
                        if owner.as_deref() != Some(child) {
                            return Err(RpcError::conflict("original Terminal owner changed"));
                        }
                    } else {
                        // Reach is checked again at execution: moving a child does not grant authority.
                        self.agents.guard_reach(
                            &accepted.actor,
                            child,
                            matches!(action.call, HeldCall::Rename(_)),
                        )?;
                    }
                    self.held_actions
                        .outcome(&action.id, ResizeOutcome::InProgress)?;
                    self.before_prompt_effect(&accepted.actor, method, &params)
                        .await?;
                    let ctx = self.ctx(accepted.actor);
                    if matches!(
                        action.call,
                        HeldCall::Stop(_) | HeldCall::Interrupt(_) | HeldCall::Prompt(_)
                    ) {
                        let attempt = accepted
                            .attempt
                            .as_deref()
                            .ok_or_else(|| RpcError::conflict("original Attempt is unavailable"))?;
                        match &action.call {
                            HeldCall::Stop(_) => {
                                self.agents.stop_attempt(&ctx, child, attempt).await?;
                            }
                            HeldCall::Prompt(prompt) => {
                                self.agents
                                    .prompt_attempt(&ctx, prompt.clone(), attempt)
                                    .await?;
                            }
                            _ => self.agents.interrupt_attempt(&ctx, child, attempt).await?,
                        }
                    } else if let HeldCall::Rewind(rewind) = &action.call {
                        self.release_rewind(&ctx.actor, rewind).await?;
                    } else if let HeldCall::Write(write) = &action.call {
                        use base64::Engine;
                        let bytes = base64::engine::general_purpose::STANDARD
                            .decode(&write.data)
                            .map_err(|err| RpcError::internal(format!("held bytes: {err}")))?;
                        self.agents
                            .write_terminal(
                                &ctx.actor,
                                &ctx.actor,
                                &write.id,
                                bytes,
                                write.identity.clone(),
                            )
                            .await?;
                    } else {
                        let namespace = method.split('.').next().unwrap_or_default();
                        let mut settling = 0;
                        loop {
                            let outcome = self.modules[namespace]
                                .call(&ctx, method, params.clone())
                                .await;
                            // An exit marks the child done before its run settles. A refused
                            // Resume had no effect, so waiting for the settle repeats nothing.
                            if let Err(e) = &outcome
                                && matches!(action.call, HeldCall::Resume(_))
                                && e.code == rpc::code::CONFLICT
                                && settling < 100
                                && self.rail().await?.iter().any(|n| {
                                    n.id == child
                                        && n.status
                                            .as_ref()
                                            .is_some_and(|s| s.kind == contracts::Kind::Done)
                                })
                            {
                                settling += 1;
                                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                                continue;
                            }
                            outcome?;
                            break;
                        }
                    }
                    self.after_action_effect(method).await?;
                    Ok::<(), RpcError>(())
                }
                .await;
                match effect {
                    Ok(()) => ResizeOutcome::Completed,
                    Err(e) => ResizeOutcome::Dropped { reason: e.message },
                }
            };
            self.held_actions.outcome(&action.id, outcome)?;
            if let HeldCall::Rewind(rewind) = &action.call {
                self.rewind_settled(&rewind.id, rewind.checkpoint).await;
            }
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
            self.release_actions(child).await?;
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
        rpc::reply(&resize_action(self.held_actions.accept(
            &conn.actor,
            &node,
            HeldCall::Resize(resize),
        )?)?)
        .map(Some)
    }

    /// B6's crash observer pauses after the physical effect and before its completion record.
    async fn after_action_effect(&self, method: &str) -> Result<(), RpcError> {
        let Some(gate) = &self.prompt_effect_gate else {
            return Ok(());
        };
        let boundary = match method {
            "rail.rename" => "after-rename",
            "agent.stop" => "after-stop",
            "agent.interrupt" => "after-interrupt",
            "agent.prompt" => "after-prompt",
            "terminal.write" => "after-write",
            _ => "after-resize",
        };
        if std::fs::read_to_string(gate).ok().as_deref() != Some(boundary) {
            return Ok(());
        }
        std::fs::write(gate.with_extension("arrived"), format!("{method}.after"))
            .map_err(RpcError::internal)?;
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while gate.is_file() {
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .map_err(|_| {
            RpcError::unknown_outcome(
                "action observer was not released; effect may have happened; do not retry",
            )
        })?;
        Ok(())
    }

    pub(crate) async fn reconcile_actions(&self) -> Result<(), RpcError> {
        let terminals: Vec<contracts::terminal::TerminalInfo> = serde_json::from_value(
            self.modules["terminal"]
                .call(&self.ctx(Actor::daemon()), "terminal.list", Value::Null)
                .await?,
        )
        .map_err(RpcError::internal)?;
        for accepted in self.held_actions.accepted(None)? {
            if !matches!(accepted.action.outcome, ResizeOutcome::Waiting { .. }) {
                continue;
            }
            if attempt_bound(&accepted.action.call) {
                let child = &accepted.action.agent;
                let _child = self.child_effects(child).write_owned().await;
                if !self.held_actions.accepted(Some(child))?.iter().any(|a| {
                    a.action.id == accepted.action.id
                        && matches!(a.action.outcome, ResizeOutcome::Waiting { .. })
                }) {
                    continue;
                }
                let node = self.rail().await?.into_iter().find(|n| &n.id == child);
                let reason = match node {
                    None => Some("child was removed before action release"),
                    Some(n) if n.attempt != accepted.attempt => {
                        Some("original Attempt changed before action release")
                    }
                    Some(n)
                        if n.status
                            .as_ref()
                            .is_some_and(|s| s.kind == contracts::Kind::Done) =>
                    {
                        Some("original Attempt is stopped or stopping")
                    }
                    _ => None,
                };
                if let Some(reason) = reason {
                    self.held_actions.outcome(
                        &accepted.action.id,
                        ResizeOutcome::Dropped {
                            reason: reason.into(),
                        },
                    )?;
                } else if !self.sender.get().is_some_and(|m| m.takeover_active(child)) {
                    self.release_actions(child).await?;
                }
                continue;
            }
            if node_bound(&accepted.action.call) {
                if !self
                    .sender
                    .get()
                    .is_some_and(|m| m.takeover_active(&accepted.action.agent))
                {
                    let _child = self
                        .child_effects(&accepted.action.agent)
                        .write_owned()
                        .await;
                    if !self
                        .sender
                        .get()
                        .is_some_and(|m| m.takeover_active(&accepted.action.agent))
                    {
                        self.release_actions(&accepted.action.agent).await?;
                    }
                }
                continue;
            }
            for id in [
                original_terminal(&accepted.action.call),
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
        let pending = self.held_actions.accepted(None)?;
        for accepted in pending {
            if matches!(accepted.action.outcome, ResizeOutcome::Waiting { .. })
                && terminal_call(&accepted.action.call)
                && (original_terminal(&accepted.action.call) == Some(terminal)
                    || accepted.child_terminal.as_deref() == Some(terminal))
            {
                let _child = self
                    .child_effects(&accepted.action.agent)
                    .write_owned()
                    .await;
                // Release may have completed while this observer waited for the child.
                if self
                    .held_actions
                    .accepted(Some(&accepted.action.agent))?
                    .iter()
                    .any(|a| {
                        a.action.id == accepted.action.id
                            && matches!(a.action.outcome, ResizeOutcome::Waiting { .. })
                    })
                {
                    self.held_actions.outcome(
                        &accepted.action.id,
                        ResizeOutcome::Dropped {
                            reason: "child or original Terminal exited before action release"
                                .into(),
                        },
                    )?;
                }
            }
        }
        Ok(())
    }
}

/// A rename, an Order or a Resume belongs to the child node, so a replacement Attempt still takes it.
fn node_bound(call: &HeldCall) -> bool {
    matches!(
        call,
        HeldCall::Rename(_) | HeldCall::SetOrder(_) | HeldCall::Resume(_) | HeldCall::Rewind(_)
    )
}

/// These die with their Attempt: a restart or a replacement Attempt drops them.
fn attempt_bound(call: &HeldCall) -> bool {
    matches!(
        call,
        HeldCall::Stop(_) | HeldCall::Interrupt(_) | HeldCall::Prompt(_) | HeldCall::Answer(_)
    )
}

fn terminal_call(call: &HeldCall) -> bool {
    matches!(
        call,
        HeldCall::Resize(_) | HeldCall::Close(_) | HeldCall::Kill(_) | HeldCall::Write(_)
    )
}

fn resize_action(action: HeldAction) -> Result<ResizeAction, RpcError> {
    let HeldCall::Resize(resize) = action.call else {
        return Err(RpcError::internal(
            "child action cannot be read as a resize",
        ));
    };
    Ok(ResizeAction {
        id: action.id,
        agent: action.agent,
        terminal: resize.id,
        cols: resize.cols,
        rows: resize.rows,
        outcome: action.outcome,
    })
}

fn action_method(call: &HeldCall) -> &'static str {
    match call {
        HeldCall::Resize(_) => "terminal.resize",
        HeldCall::Close(_) => "terminal.close",
        HeldCall::Kill(_) => "terminal.kill",
        HeldCall::Write(_) => "terminal.write",
        HeldCall::Rename(_) => "rail.rename",
        HeldCall::SetOrder(_) => "agent.setOrder",
        HeldCall::Resume(_) => "agent.resume",
        HeldCall::Answer(_) => "decision.answer",
        HeldCall::Stop(_) => "agent.stop",
        HeldCall::Interrupt(_) => "agent.interrupt",
        HeldCall::Prompt(_) => "agent.prompt",
        HeldCall::Rewind(_) => "workstream.rewind",
    }
}

fn action_params(call: &HeldCall) -> Result<Value, RpcError> {
    match call {
        HeldCall::Resize(params) => serde_json::to_value(params),
        HeldCall::Rename(params) => serde_json::to_value(params),
        HeldCall::SetOrder(params) => serde_json::to_value(params),
        HeldCall::Answer(params) => serde_json::to_value(params),
        HeldCall::Close(params) | HeldCall::Kill(params) => serde_json::to_value(params),
        HeldCall::Stop(params) | HeldCall::Interrupt(params) | HeldCall::Resume(params) => {
            serde_json::to_value(params)
        }
        HeldCall::Prompt(params) => serde_json::to_value(params),
        HeldCall::Write(params) => serde_json::to_value(params),
        HeldCall::Rewind(params) => serde_json::to_value(params),
    }
    .map_err(RpcError::internal)
}

fn original_terminal(call: &HeldCall) -> Option<&str> {
    match call {
        HeldCall::Resize(params) => Some(&params.id),
        HeldCall::Close(params) | HeldCall::Kill(params) => Some(&params.id),
        HeldCall::Write(params) => Some(&params.id),
        HeldCall::Rename(_)
        | HeldCall::SetOrder(_)
        | HeldCall::Resume(_)
        | HeldCall::Answer(_)
        | HeldCall::Stop(_)
        | HeldCall::Interrupt(_)
        | HeldCall::Prompt(_)
        | HeldCall::Rewind(_) => None,
    }
}
