//! NA6–NA9: `action.list` and `action.run` are relayed live to the App that registered with
//! `action.serve`. The Daemon holds no action list of its own.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use contracts::action::{ActionRow, RunParams};
use contracts::{ActorKind, Verb};
use rpc::{RpcError, code};
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};

use crate::connection::Frame;
use crate::{Conn, Daemon};

/// NA9: how long the Daemon waits for the App's answer.
const CALL_TIMEOUT: Duration = Duration::from_secs(10);

type Pending = HashMap<u64, oneshot::Sender<Result<Value, RpcError>>>;

struct App {
    frames: mpsc::UnboundedSender<Frame>,
    pending: Pending,
}

/// The one registered answerer. Dropping it drops its pending senders, which ends those calls as lost.
#[derive(Default)]
pub(crate) struct Answerer {
    app: Mutex<Option<App>>,
    next: AtomicU64,
    timeout: Option<Duration>,
}

enum Relay {
    NoApp,
    Lost,
    Answer(Result<Value, RpcError>),
}

impl Answerer {
    #[cfg(test)]
    pub(crate) fn with_timeout(timeout: Duration) -> Self {
        Self {
            timeout: Some(timeout),
            ..Self::default()
        }
    }

    /// A second registration replaces the first (NA6 policy).
    fn register(&self, frames: mpsc::UnboundedSender<Frame>) {
        let previous = self.app.lock().replace(App {
            frames,
            pending: Pending::new(),
        });
        if let Some(previous) = previous {
            // A closed old connection has no live confirmation left to invalidate.
            let _ = previous
                .frames
                .send(json!({"jsonrpc":"2.0", "method":"action.closed"}).into());
        }
    }

    /// The App's connection closed: its registration ends and its pending calls are lost.
    pub(crate) fn closed(&self, frames: &mpsc::UnboundedSender<Frame>) {
        let mut app = self.app.lock();
        if app
            .as_ref()
            .is_some_and(|app| app.frames.same_channel(frames))
        {
            *app = None;
        }
    }

    /// An answer line from `frames`' connection; one from any other connection is ignored.
    pub(crate) fn answer(&self, frames: &mpsc::UnboundedSender<Frame>, line: &Value) {
        let Some(id) = line["id"].as_u64() else {
            return;
        };
        let mut app = self.app.lock();
        let Some(app) = app.as_mut().filter(|app| app.frames.same_channel(frames)) else {
            return;
        };
        let Some(waiting) = app.pending.remove(&id) else {
            return;
        };
        let answer = match line.get("error") {
            Some(error) => Err(serde_json::from_value(error.clone())
                .unwrap_or_else(|_| RpcError::internal("the App's refusal was malformed"))),
            None => Ok(line.get("result").cloned().unwrap_or(Value::Null)),
        };
        let _ = waiting.send(answer);
    }

    async fn relay(&self, method: &str, params: Value) -> Relay {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut app = self.app.lock();
            let Some(app) = app.as_mut() else {
                return Relay::NoApp;
            };
            let request = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
            if app.frames.send(request.into()).is_err() {
                return Relay::NoApp;
            }
            app.pending.insert(id, tx);
        }
        let answer = if matches!(method, "project.open" | "project.start") {
            // Consent has no clock deadline; losing the registered connection ends the wait.
            rx.await.ok()
        } else {
            tokio::time::timeout(self.timeout.unwrap_or(CALL_TIMEOUT), rx)
                .await
                .ok()
                .and_then(Result::ok)
        };
        match answer {
            Some(answer) => Relay::Answer(answer),
            _ => {
                if let Some(app) = self.app.lock().as_mut() {
                    app.pending.remove(&id);
                }
                Relay::Lost
            }
        }
    }
}

fn app_closed() -> RpcError {
    RpcError::new(
        code::APP_CLOSED,
        "the roundup App is not open; open it and retry",
    )
}

fn invalid(message: String) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, message)
}

impl Daemon {
    /// Validate the folder, relay `method` to the App and answer what the App answered, with the
    /// folder as resolved here.
    async fn project_relay(
        &self,
        conn: &Conn,
        method: &str,
        path: &str,
        start: Option<&contracts::project::StartParams>,
    ) -> Result<(String, Value), RpcError> {
        let folder = std::path::Path::new(path);
        if !folder.is_absolute() {
            return Err(invalid(format!("path {path} is not absolute")));
        }
        if !folder.is_dir() {
            return Err(RpcError::not_found(format!("directory {path}")));
        }
        let path = folder
            .canonicalize()
            .map_err(RpcError::internal)?
            .to_string_lossy()
            .into_owned();
        let agent = match conn.actor.kind {
            ActorKind::Agent => {
                let nodes = self.rail().await?;
                let node = nodes
                    .iter()
                    .find(|node| {
                        node.id == conn.actor.id
                            && matches!(
                                node.kind,
                                contracts::agent::NodeKind::Agent
                                    | contracts::agent::NodeKind::Workstream
                            )
                    })
                    .ok_or_else(|| {
                        RpcError::forbidden("Project opening requires an existing Agent or Door")
                    })?;
                Some(json!({"id": node.id, "name": node.name}))
            }
            ActorKind::User if start.is_none() => None,
            ActorKind::User => {
                return Err(RpcError::forbidden(
                    "Project start requires an existing Agent or Door",
                ));
            }
            ActorKind::Ext => {
                return Err(RpcError::forbidden(
                    "only the user or an existing Agent opens a Project",
                ));
            }
        };
        let mut request = json!({"path": path, "source": self.project, "agent": agent});
        if let Some(start) = &start
            && let Some(object) = request.as_object_mut()
        {
            object.insert("kind".to_owned(), json!(start.kind));
            object.insert("name".to_owned(), json!(start.name));
            object.insert("prompt".to_owned(), json!(start.prompt));
        }
        match self.actions.relay(method, request).await {
            Relay::NoApp => Err(app_closed()),
            Relay::Lost => Err(RpcError::new(
                code::UNKNOWN_OUTCOME,
                format!(
                    "the App connection was lost while opening {path}; inspect open Projects before retrying"
                ),
            )),
            Relay::Answer(answer) => Ok((path, answer?)),
        }
    }

    pub(super) async fn project_open(
        &self,
        conn: &mut Conn,
        p: contracts::project::OpenParams,
    ) -> Result<contracts::project::Opened, RpcError> {
        let (path, value) = self
            .project_relay(conn, "project.open", &p.path, None)
            .await?;
        let opened: contracts::project::Opened =
            serde_json::from_value(value).map_err(RpcError::internal)?;
        if opened.path != path {
            return Err(RpcError::new(
                code::UNKNOWN_OUTCOME,
                "the App answered with a different Project; inspect open Projects before retrying",
            ));
        }
        self.ctx(conn.actor.clone())
            .touch(Verb::Wrote, &format!("project:{}", opened.path))?;
        Ok(opened)
    }

    pub(super) async fn project_start(
        &self,
        conn: &mut Conn,
        mut start: contracts::project::StartParams,
    ) -> Result<contracts::project::StartedRow, RpcError> {
        start.name = agents::agent_name(&start.name).map_err(|reason| invalid(reason.into()))?;
        if start.prompt.trim().is_empty() {
            return Err(invalid("start requires a nonblank prompt".into()));
        }
        if start.kind == contracts::project::StartKind::Mode
            && start.prompt.chars().count() > contracts::workstream::OPENING_PROMPT_MAX
        {
            return Err(invalid("the opening prompt is too long".into()));
        }
        let (path, value) = self
            .project_relay(conn, "project.start", &start.path, Some(&start))
            .await?;
        let started: contracts::project::StartedRow =
            serde_json::from_value(value).map_err(RpcError::internal)?;
        if started.path != path || started.kind != start.kind || started.id.is_empty() {
            return Err(RpcError::unknown_outcome(
                "the App answered with a different Project or start kind; inspect the target before retrying",
            ));
        }
        self.ctx(conn.actor.clone())
            .touch(Verb::Wrote, &format!("project:{}", started.path))?;
        Ok(started)
    }

    pub(super) async fn action_serve(&self, conn: &mut Conn) -> Result<(), RpcError> {
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user's App answers actions"));
        }
        self.actions.register(conn.events.clone());
        // UA3: the names the App now holds are checked against the User actions.
        self.extensions.app_registered();
        Ok(())
    }

    pub(super) async fn action_user_list(
        &self,
        conn: &mut Conn,
    ) -> Result<Vec<ActionRow>, RpcError> {
        self.ctx(conn.actor.clone())
            .touch(Verb::Read, "action:userList")?;
        Ok(self.extensions.rows())
    }

    pub(super) async fn action_list(&self, conn: &mut Conn) -> Result<Vec<ActionRow>, RpcError> {
        let mut rows = self.app_rows().await?;
        self.ctx(conn.actor.clone())
            .touch(Verb::Read, "action:list")?;
        // UA1: the User actions follow the App's rows.
        self.extensions
            .built_in(self, rows.iter().map(|row| row.name.clone()).collect());
        rows.extend(self.extensions.rows());
        Ok(rows)
    }

    pub(super) async fn action_run(
        &self,
        conn: &mut Conn,
        run: RunParams,
    ) -> Result<contracts::action::RunResult, RpcError> {
        let ctx = self.ctx(conn.actor.clone());
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user runs an action; typing and keys stay the user's",
            ));
        }
        // UA5: a User action runs in the host and does not need the App.
        if let Some(result) = self.extensions.run(self, &run).await {
            return serde_json::from_value(result?).map_err(RpcError::internal);
        }
        let rows = self.app_rows().await?;
        let row = rows
            .iter()
            .find(|row| row.name == run.name)
            .ok_or_else(|| {
                invalid(format!(
                    "unknown action \"{}\"; run \"rup actions\"",
                    run.name
                ))
            })?;
        if let Some(pair) = run
            .args
            .iter()
            .find(|pair| !row.args.iter().any(|arg| arg.key == pair.key))
        {
            let known: Vec<_> = row.args.iter().map(|arg| arg.key.as_str()).collect();
            return Err(invalid(format!(
                "unknown argument \"{}\" for {}; its arguments: {}",
                pair.key,
                run.name,
                if known.is_empty() {
                    "none".into()
                } else {
                    known.join(", ")
                }
            )));
        }
        ctx.touch(Verb::Wrote, &format!("action:{}", run.name))?;
        for pair in &run.args {
            ctx.touch(Verb::Wrote, &format!("action:{}:{}", run.name, pair.key))?;
        }
        match self.actions.relay("action.run", json!(run)).await {
            Relay::NoApp => Err(app_closed()),
            Relay::Lost => Err(RpcError::new(
                code::UNKNOWN_OUTCOME,
                format!("the App did not answer; \"{}\" may have run", run.name),
            )),
            Relay::Answer(answer) => serde_json::from_value(answer?).map_err(RpcError::internal),
        }
    }

    /// The App's own list, as it answered.
    pub(crate) async fn app_rows(&self) -> Result<Vec<ActionRow>, RpcError> {
        match self.actions.relay("action.list", Value::Null).await {
            Relay::NoApp | Relay::Lost => Err(app_closed()),
            Relay::Answer(answer) => serde_json::from_value(answer?).map_err(RpcError::internal),
        }
    }
}
