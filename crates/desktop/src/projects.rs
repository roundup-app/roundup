//! Which Projects are open, in the order they were opened (S8), and the task that owns each
//! one's Daemon (S6505a).

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use contracts::Event;
use indexmap::IndexMap;
use rpc::{Client, OutputFrame, RpcError, code};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Runtime};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Duration, timeout};

use crate::config::Config;
use crate::daemon;
use crate::project_task::{
    Access, Attachment, Command, Commands, OpenCause, Pump, Reply, Shared, Supervisor,
    UPDATE_BOUND, supervise,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Project {
    pub name: String,
    pub path: String,
}

/// One entry of `projects` (S8): `running` is false once that Project's Daemon exited.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Listed {
    pub name: String,
    pub path: String,
    pub running: bool,
}

/// The longest name `rename_project` stores (S10).
const NAME_LIMIT: usize = 40;

struct Slot {
    commands: Commands,
    running: watch::Receiver<bool>,
}

/// The senders of the Projects' tasks, in open order; the one list of Projects the App keeps.
/// A task that ended (its Project closed, the App leaving, a failed `User` open) has a closed
/// sender, which is left out of every read.
#[derive(Default)]
struct Projects {
    slots: Mutex<IndexMap<String, Slot>>,
}

impl Projects {
    fn slots(&self) -> MutexGuard<'_, IndexMap<String, Slot>> {
        self.slots
            .lock()
            .expect("the projects lock is never kept across a panic")
    }

    /// Path and whether its Daemon runs, in open order.
    fn listed(&self) -> Vec<(String, bool)> {
        self.slots()
            .iter()
            .filter(|(_, slot)| !slot.commands.is_closed())
            .map(|(path, slot)| (path.clone(), *slot.running.borrow()))
            .collect()
    }

    fn commands(&self) -> Vec<(String, Commands)> {
        self.slots()
            .iter()
            .filter(|(_, slot)| !slot.commands.is_closed())
            .map(|(path, slot)| (path.clone(), slot.commands.clone()))
            .collect()
    }

    /// `CONFLICT` at once when no task serves `path`.
    fn send(&self, path: &str, command: Command) -> Result<(), RpcError> {
        match self.slots().get(path) {
            Some(slot) => slot.commands.send(command).map_err(|_| not_open(path)),
            None => Err(not_open(path)),
        }
    }

    /// Sends `open` to the task serving `path`, or to a new one that `spawn` starts and that
    /// joins the end of the order (S8).
    fn open(
        &self,
        path: &str,
        open: Command,
        spawn: impl FnOnce(
            mpsc::UnboundedReceiver<Command>,
            watch::Sender<bool>,
            mpsc::WeakUnboundedSender<Command>,
        ),
    ) -> Result<(), RpcError> {
        let mut slots = self.slots();
        if let Some(slot) = slots.get(path)
            && !slot.commands.is_closed()
        {
            return slot.commands.send(open).map_err(|_| not_open(path));
        }
        slots.shift_remove(path);
        let (commands, receiver) = mpsc::unbounded_channel();
        let (running_tx, running) = watch::channel(false);
        commands.send(open).map_err(|_| not_open(path))?;
        spawn(receiver, running_tx, commands.downgrade());
        slots.insert(path.to_owned(), Slot { commands, running });
        Ok(())
    }

    fn remove(&self, path: &str) -> Option<Commands> {
        let slot = self.slots().shift_remove(path)?;
        (!slot.commands.is_closed()).then_some(slot.commands)
    }

    fn take_all(&self) -> Vec<Commands> {
        std::mem::take(&mut *self.slots())
            .into_values()
            .map(|slot| slot.commands)
            .collect()
    }
}

/// Which Projects are open, and the task serving each; the only state the App holds besides what
/// `Store` keeps.
pub struct AppState {
    shared: Arc<Shared>,
    closed: AtomicBool,
    projects: Projects,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        Self {
            shared: Arc::new(Shared::new(config)),
            closed: AtomicBool::new(false),
            projects: Projects::default(),
        }
    }

    /// The folder the App keeps names and the open list in, unless `Config` already named one.
    pub fn use_data_dir(&self, dir: PathBuf) -> Result<(), RpcError> {
        self.shared.store.use_dir(dir);
        self.shared.store.load()
    }

    pub fn recent_projects(&self) -> Result<Vec<String>, RpcError> {
        self.shared.store.recent_projects()
    }

    pub async fn claude_binary(&self) -> Option<crate::facts::ClaudeBinary> {
        crate::facts::claude_binary(&self.shared.config).await
    }

    pub fn projects(&self) -> Result<Vec<Listed>, RpcError> {
        self.shared.store.load()?;
        self.projects
            .listed()
            .into_iter()
            .map(|(path, running)| {
                Ok(Listed {
                    name: self.shared.name_of(&path)?,
                    path,
                    running,
                })
            })
            .collect()
    }

    /// A Project whose Daemon runs is returned as it is and nothing starts; one whose Daemon
    /// exited reopens (S5); any other path starts a Daemon and joins the end of `projects` (S8).
    pub async fn open_project<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        path: &Path,
    ) -> Result<Project, RpcError> {
        let answer = self.begin_open(app, path, OpenCause::User)?;
        self.finish_open(path, OpenCause::User, answer).await
    }

    /// The launch's reopening of the stored list (S10): a Daemon that fails to start leaves its
    /// Project listed as not running instead of dropping it.
    pub async fn restore<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), RpcError> {
        self.restore_with_feedback(app, |message| {
            crate::diagnostics::message(app, message, None)
        })
        .await
    }

    pub(crate) async fn restore_with_feedback<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        mut feedback: impl FnMut(String),
    ) -> Result<(), RpcError> {
        // Every open is sent before any is awaited, so the first ready Project does not wait for
        // the others (S6505a, cold start).
        let begun: Vec<_> = self
            .shared
            .store
            .open_paths()?
            .into_iter()
            .map(PathBuf::from)
            .filter(|path| path.is_dir())
            .map(|path| {
                let answer = self.begin_open(app, &path, OpenCause::Restore);
                (path, answer)
            })
            .collect();
        for (path, answer) in begun {
            let opened = match answer {
                Ok(answer) => self.finish_open(&path, OpenCause::Restore, answer).await,
                Err(err) => Err(err),
            };
            if let Err(err) = opened {
                feedback(self.report_project_failure("restore Project", &path, &err)?);
            }
        }
        self.save_open()
    }

    pub(crate) fn report_project_failure(
        &self,
        operation: &str,
        path: &Path,
        error: &RpcError,
    ) -> Result<String, RpcError> {
        let name = self.shared.name_of(&path.display().to_string())?;
        Ok(crate::diagnostics::report(
            &format!("{operation} \"{name}\""),
            &error.message,
        ))
    }

    fn begin_open<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        path: &Path,
        cause: OpenCause,
    ) -> Result<oneshot::Receiver<Result<Project, RpcError>>, RpcError> {
        self.shared.store.load()?;
        let key = path.display().to_string();
        if self.closed.load(Ordering::SeqCst) {
            return Err(not_open(&key));
        }
        let (reply, answer) = oneshot::channel();
        let (app, shared, task_path) = (app.clone(), Arc::clone(&self.shared), key.clone());
        self.projects.open(
            &key,
            Command::Open { cause, reply },
            move |commands, running, me| {
                let task = Supervisor::new(app, shared, task_path, me, running);
                tauri::async_runtime::spawn(supervise(task, commands));
            },
        )?;
        Ok(answer)
    }

    async fn finish_open(
        &self,
        path: &Path,
        cause: OpenCause,
        answer: oneshot::Receiver<Result<Project, RpcError>>,
    ) -> Result<Project, RpcError> {
        let key = path.display().to_string();
        match answer.await.unwrap_or_else(|_| Err(not_open(&key))) {
            Ok(project) => {
                self.save_open()?;
                if cause == OpenCause::User {
                    self.shared.store.record_recent(&project.path)?;
                }
                Ok(project)
            }
            Err(err) => {
                if cause == OpenCause::Restore {
                    self.save_open()?;
                }
                Err(err)
            }
        }
    }

    /// Sends `command` to the task serving `path` and waits for its answer; a task that has
    /// ended answers `CONFLICT` at once.
    async fn ask<T>(
        &self,
        path: &str,
        command: impl FnOnce(Reply<T>) -> Command,
    ) -> Result<T, RpcError> {
        let (reply, answer) = oneshot::channel();
        self.projects.send(path, command(reply))?;
        answer.await.unwrap_or_else(|_| Err(not_open(path)))
    }

    async fn access(&self, path: &str) -> Result<Access, RpcError> {
        self.ask(path, |reply| Command::Access { reply }).await
    }

    /// Whether the task kept `what`; one that did not (the Daemon went away) drops and so ends it.
    async fn attach(&self, path: &str, run: Option<u64>, what: Attachment) -> bool {
        let (reply, answer) = oneshot::channel();
        let command = Command::Attach { run, what, reply };
        self.projects.send(path, command).is_ok() && answer.await.unwrap_or(false)
    }

    pub async fn rpc(&self, path: &str, method: &str, params: Value) -> Result<Value, RpcError> {
        if matches!(method, "daemon.getNaming" | "daemon.setNaming") {
            let root = self.shared.store.dir().ok_or_else(|| {
                RpcError::internal("App data folder is unavailable; reopen Settings to retry.")
            })?;
            return daemon::naming_settings(root, method, params);
        }
        let client = self.access(path).await?.client;
        self.bounded(method, client.request(method, params)).await
    }

    /// Sends every Event of the Project's Daemon to `channel`, in the Daemon's order, until the Daemon or the webview goes away.
    /// With `after`, it replays above that number; with `kept`, it replays every retained Event (D11). Answers the Daemon's `head`: the highest Event number saved when it accepted.
    pub async fn subscribe(
        &self,
        path: &str,
        channel: Channel<Event>,
        params: Option<contracts::SubscribeParams>,
    ) -> Result<u64, RpcError> {
        let Access { socket, run, .. } = self.access(path).await?;
        let result = self.subscribe_run(path, channel, params, socket, run).await;
        let connection = Command::Connection {
            run,
            result: result.clone().map(|_| ()),
        };
        let _ = self.projects.send(path, connection);
        result
    }

    async fn subscribe_run(
        &self,
        path: &str,
        channel: Channel<Event>,
        params: Option<contracts::SubscribeParams>,
        socket: PathBuf,
        run: u64,
    ) -> Result<u64, RpcError> {
        let mut events = Client::connect(&socket).await.map_err(RpcError::internal)?;
        let answer = self
            .bounded(
                "events.subscribe",
                events.request("events.subscribe", params),
            )
            .await?;
        let head = answer.get("head").and_then(Value::as_u64).unwrap_or(0);
        let pump = Pump(tauri::async_runtime::spawn(async move {
            while let Some(event) = events.next_event().await {
                if channel.send(event).is_err() {
                    return;
                }
            }
        }));
        if self
            .attach(path, Some(run), Attachment::Subscription(pump))
            .await
        {
            Ok(head)
        } else {
            Err(RpcError::internal("the Daemon went away while subscribing"))
        }
    }

    /// X14: selects one Terminal's output on its own connection to the Project's Daemon and sends
    /// its bytes to `channel` as raw bodies: bytes are never JSON, base64 or text. A gap, whether
    /// the Daemon reported it or this App's intake lagged, goes as the JSON body `{"gap":{"from","to"}}`
    /// in the same order. Answers the offset of the first byte. A later call for the same Terminal
    /// replaces the earlier subscription.
    pub async fn terminal_output(
        &self,
        path: &str,
        id: &str,
        channel: Channel<InvokeResponseBody>,
    ) -> Result<u64, RpcError> {
        let socket = self.access(path).await?.socket;
        let mut client = Client::connect(&socket).await.map_err(RpcError::internal)?;
        let mut frames = client
            .take_output()
            .ok_or_else(|| RpcError::internal("the output intake was already taken"))?;
        let started = self
            .bounded(
                "terminal.output",
                client.request("terminal.output", json!({ "id": id })),
            )
            .await?;
        let first = started["offset"]
            .as_u64()
            .ok_or_else(|| RpcError::internal("terminal.output answered no offset"))?;
        let pump = Pump(tauri::async_runtime::spawn(async move {
            // Dropping the client at the end closes the socket, which releases the selection.
            let _client = client;
            let mut next = first;
            loop {
                let (from, to, bytes) = match frames.recv().await {
                    Ok(OutputFrame::Bytes(event)) => {
                        let Ok(bytes) = STANDARD.decode(&event.data) else {
                            return;
                        };
                        (next, event.offset, Some(bytes))
                    }
                    Ok(OutputFrame::Gap(gap)) => (next, gap.to, None),
                    // Skipped frames show as an offset jump at the next byte frame.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                };
                if to != from {
                    let gap = json!({ "gap": { "from": from, "to": to } }).to_string();
                    if channel.send(InvokeResponseBody::Json(gap)).is_err() {
                        return;
                    }
                    next = to;
                }
                if let Some(bytes) = bytes {
                    next += bytes.len() as u64;
                    if channel.send(InvokeResponseBody::Raw(bytes)).is_err() {
                        return;
                    }
                }
            }
        }));
        if self
            .attach(path, None, Attachment::Output(id.to_owned(), pump))
            .await
        {
            Ok(first)
        } else {
            Err(RpcError::internal("the Daemon went away while subscribing"))
        }
    }

    /// NA6: registers the webview as the Project's action answerer (`action.serve`) and sends each
    /// request line the Daemon relays to `channel`; `action_answer` writes the answer. A second call replaces the first.
    pub async fn action_serve(
        &self,
        path: &str,
        channel: Channel<Value>,
        registration: String,
    ) -> Result<(), RpcError> {
        let socket = self.access(path).await?.socket;
        let mut client = Client::connect(&socket).await.map_err(RpcError::internal)?;
        let mut requests = client
            .take_requests()
            .ok_or_else(|| RpcError::internal("the request intake was already taken"))?;
        self.bounded("action.serve", client.request("action.serve", Value::Null))
            .await?;
        let client = Arc::new(client);
        let pump = Pump(tauri::async_runtime::spawn(async move {
            while let Some(request) = requests.recv().await {
                if channel.send(request).is_err() {
                    return;
                }
            }
            // A closed webview channel has no live confirmation to invalidate.
            let _ = channel.send(serde_json::json!({"method":"action.closed"}));
        }));
        if self
            .attach(path, None, Attachment::Actions(client, pump, registration))
            .await
        {
            Ok(())
        } else {
            Err(not_open(path))
        }
    }

    /// NA6: the webview's answer to a request `action_serve` delivered.
    pub async fn action_answer(
        &self,
        path: &str,
        registration: &str,
        line: Value,
    ) -> Result<(), RpcError> {
        let client = self
            .ask(path, |reply| Command::Answerer {
                registration: registration.to_owned(),
                reply,
            })
            .await?;
        client
            .ok_or_else(|| RpcError::internal("no action answerer is registered"))?
            .reply(&line)
            .await
    }

    /// X14: releases the App's selection of one Terminal; the other Terminals' streams go on.
    pub fn terminal_output_stop(&self, path: &str, id: &str) -> Result<(), RpcError> {
        self.projects
            .send(path, Command::StopOutput { id: id.to_owned() })
    }

    /// Ends the Project's task, and with it its Daemon by closing its stdin, so a Daemon started
    /// with `--attached` stops its Agents and Terminals and exits (S3); the other Projects go on.
    pub fn close_project(&self, path: &str) -> Result<(), RpcError> {
        let commands = self.projects.remove(path).ok_or_else(|| not_open(path))?;
        let (done, _) = std::sync::mpsc::channel();
        let _ = commands.send(Command::Close { done });
        self.save_open()
    }

    /// Stores `name` for the open Project, trimmed; an empty name removes it (S10).
    pub fn rename_project(
        &self,
        path: &str,
        name: &str,
        base: Option<&str>,
    ) -> Result<Project, RpcError> {
        if !self.projects.listed().iter().any(|(open, _)| open == path) {
            return Err(not_open(path));
        }
        let trimmed = name.trim();
        if name.contains(['\n', '\r']) || trimmed.chars().count() > NAME_LIMIT {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("a name is 1 to {NAME_LIMIT} characters on one line"),
            ));
        }
        let name = self.shared.store.set_name(
            path,
            (!trimmed.is_empty()).then(|| trimmed.to_owned()),
            base,
            &named_after(Path::new(path)),
        )?;
        Ok(Project {
            path: path.to_owned(),
            name,
        })
    }

    /// Ends every Daemon without the stdin-close shutdown, so no Agent or Terminal owner is
    /// stopped (S5981a). The Daemon writes each Rail and owner record as it changes (D6), so a
    /// `rail.tree` answered within `UPDATE_BOUND` after every earlier call shows them saved; if one
    /// Daemon does not answer, nothing is ended and the call fails naming its Project.
    pub async fn exit_for_update(&self) -> Result<(), RpcError> {
        let open = self.projects.commands();
        for (path, commands) in &open {
            let (reply, answer) = oneshot::channel();
            if commands.send(Command::Confirm { reply }).is_err() {
                continue;
            }
            match timeout(UPDATE_BOUND, answer).await {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(err))) => {
                    return Err(RpcError::internal(format!(
                        "the Daemon of {path} could not be left safely: {}",
                        err.message
                    )));
                }
                // The task ended since: nothing of it is left to save.
                Ok(Err(_)) => {}
                Err(_) => {
                    return Err(RpcError::internal(format!(
                        "the Daemon of {path} did not answer within {UPDATE_BOUND:?}"
                    )));
                }
            }
        }
        self.closed.store(true, Ordering::SeqCst);
        let mut left = Vec::new();
        for (_, commands) in &open {
            let (reply, done) = oneshot::channel();
            if commands.send(Command::Leave { reply }).is_ok() {
                left.push(done);
            }
        }
        for done in left {
            let _ = done.await;
        }
        Ok(())
    }

    /// Ends every task, which closes every Daemon's stdin (S3), and waits a moment for them to.
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        let (done, ended) = std::sync::mpsc::channel::<()>();
        for commands in self.projects.take_all() {
            let _ = commands.send(Command::Close { done: done.clone() });
        }
        drop(done);
        // Nothing is ever sent: this returns when every task dropped its sender, or at the bound.
        let _ = ended.recv_timeout(Duration::from_secs(1));
    }

    fn save_open(&self) -> Result<(), RpcError> {
        let paths = self
            .projects
            .listed()
            .into_iter()
            .map(|(path, _)| path)
            .collect();
        self.shared.store.set_open(paths)
    }

    async fn bounded<T>(
        &self,
        method: &str,
        call: impl Future<Output = Result<T, RpcError>>,
    ) -> Result<T, RpcError> {
        let bound = self.shared.config.call_bound;
        timeout(bound, call)
            .await
            .map_err(|_| unanswered(method, bound))?
    }
}

/// Methods that write nothing: a timeout on one leaves no outcome unknown (U5301b).
fn writes_nothing(method: &str) -> bool {
    const READS: [&str; 20] = [
        "list",
        "get",
        "read",
        "tree",
        "describe",
        "digest",
        "context",
        "extras",
        "instructions",
        "skills",
        "snapshot",
        "screen",
        "search",
        "history",
        "touched",
        "worktreeState",
        "comments",
        "getHistory",
        "listHanded",
        "preview",
    ];
    method
        .split_once('.')
        .is_some_and(|(_, name)| READS.contains(&name))
}

fn unanswered(method: &str, bound: Duration) -> RpcError {
    if writes_nothing(method) {
        RpcError::internal(format!("no reply to {method} within {bound:?}"))
    } else {
        RpcError::internal(format!(
            "no reply to {method} within {bound:?}; whether the Daemon applied it is unknown"
        ))
    }
}

pub(crate) fn not_open(path: &str) -> RpcError {
    RpcError::conflict(format!("no Project is open at {path}"))
}

/// Resolves `.` and `..` first: the last component of `/a/b/..` is not the Project's name.
pub(crate) fn named_after(path: &Path) -> String {
    let reached = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    reached.file_name().map_or_else(
        || reached.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOUND: Duration = Duration::from_secs(5);

    #[test]
    fn u5301b_a_timed_out_read_says_the_daemon_did_not_answer() {
        for method in ["todo.list", "pad.list", "rail.tree"] {
            let message = unanswered(method, BOUND).message;
            assert!(message.starts_with(&format!("no reply to {method} within")));
            assert!(!message.contains("unknown"), "{message}");
        }
    }

    #[test]
    fn u5301b_a_timed_out_mutation_stays_unknown() {
        for method in ["rail.remove", "todo.create"] {
            assert!(
                unanswered(method, BOUND)
                    .message
                    .contains("whether the Daemon applied it is unknown")
            );
        }
    }
}
