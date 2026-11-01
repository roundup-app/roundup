//! NA6–NA9: `action.list` and `action.run` are relayed live to the App that registered with
//! `action.serve`. The Daemon holds no action list of its own.

use std::collections::HashMap;
use std::sync::Mutex;
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
        *self.app.lock().expect("action answerer poisoned") = Some(App {
            frames,
            pending: Pending::new(),
        });
    }

    /// The App's connection closed: its registration ends and its pending calls are lost.
    pub(crate) fn closed(&self, frames: &mpsc::UnboundedSender<Frame>) {
        let mut app = self.app.lock().expect("action answerer poisoned");
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
        let mut app = self.app.lock().expect("action answerer poisoned");
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
            let mut app = self.app.lock().expect("action answerer poisoned");
            let Some(app) = app.as_mut() else {
                return Relay::NoApp;
            };
            let request = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
            if app.frames.send(request.into()).is_err() {
                return Relay::NoApp;
            }
            app.pending.insert(id, tx);
        }
        match tokio::time::timeout(self.timeout.unwrap_or(CALL_TIMEOUT), rx).await {
            Ok(Ok(answer)) => Relay::Answer(answer),
            _ => {
                if let Some(app) = self.app.lock().expect("action answerer poisoned").as_mut() {
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
    pub(super) async fn rpc_action(
        &self,
        conn: &mut Conn,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let ctx = self.ctx(conn.actor.clone());
        if method == "action.serve" {
            if conn.actor.kind != ActorKind::User {
                return Err(RpcError::forbidden("only the user's App answers actions"));
            }
            self.actions.register(conn.events.clone());
            // UA3: the names the App now holds are checked against the User actions.
            self.extensions.app_registered();
            return Ok(Value::Null);
        }
        if method == "action.userList" {
            ctx.touch(Verb::Read, "action:userList")?;
            return rpc::reply(&self.extensions.rows());
        }
        if method == "action.list" {
            let mut rows = self.app_list().await?;
            ctx.touch(Verb::Read, "action:list")?;
            // UA1: the User actions follow the App's rows.
            if let Some(app) = rows.as_array_mut() {
                let names = app
                    .iter()
                    .filter_map(|row| row["name"].as_str().map(str::to_owned));
                self.extensions.built_in(self, names.collect());
                app.extend(self.extensions.rows().iter().map(|row| json!(row)));
            }
            return Ok(rows);
        }
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user runs an action; typing and keys stay the user's",
            ));
        }
        let run: RunParams = rpc::params(params)?;
        // UA5: a User action runs in the host and does not need the App.
        if let Some(result) = self.extensions.run(self, &run).await {
            return result;
        }
        let rows: Vec<ActionRow> =
            serde_json::from_value(self.app_list().await?).map_err(RpcError::internal)?;
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
            Relay::Answer(answer) => answer,
        }
    }

    /// The App's own list, as it answered.
    pub(crate) async fn app_list(&self) -> Result<Value, RpcError> {
        match self.actions.relay("action.list", Value::Null).await {
            Relay::NoApp | Relay::Lost => Err(app_closed()),
            Relay::Answer(answer) => answer,
        }
    }
}

pub(crate) fn is_action(method: &str) -> bool {
    method.starts_with("action.")
}
