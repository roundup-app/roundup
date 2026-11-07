//! One task per open Project owns that Project's Daemon: its start, retry with backoff, exit,
//! reopen and exit for an update (S6505a). The App reaches it only by sending a `Command`.

use std::collections::HashMap;
use std::future::Future;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use rpc::{Client, RpcError, code};
use serde::Serialize;
use serde_json::Value;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::process::ChildStdin;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::{Duration, Instant, sleep_until, timeout, timeout_at};

use crate::config::Config;
use crate::daemon::{self, OwnedSocket, Started};
use crate::projects::{Project, named_after};
use crate::reopen::GIVE_UP;
use crate::store::Store;

/// How long `exit_for_update` waits for each Daemon to answer and then to be gone.
pub(crate) const UPDATE_BOUND: Duration = Duration::from_secs(3);

/// Who asked for an open: a webview's `open_project`, or the launch's saved list (S10).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenCause {
    /// A first open that fails is `INTERNAL` and leaves the path unlisted.
    User,
    /// A first open that fails leaves the Project listed as not running.
    Restore,
}

pub(crate) type Reply<T> = oneshot::Sender<Result<T, RpcError>>;
pub(crate) type Commands = mpsc::UnboundedSender<Command>;

/// What a caller needs to talk to a running Daemon itself.
pub(crate) struct Access {
    pub client: Arc<Client>,
    /// This run's socket path (S5): `subscribe` reconnects here, not through `Config`, since a
    /// reopen's Daemon runs on its own path.
    pub socket: PathBuf,
    pub run: u64,
}

/// A pump task that ends when dropped, wherever its owner last kept it.
pub(crate) struct Pump(pub JoinHandle<()>);

impl Drop for Pump {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(crate) enum Attachment {
    /// One at a time: a reloaded webview subscribes again and must not receive every Event twice.
    Subscription(Pump),
    /// X14: one connection and pump per selected Terminal; dropping one releases that selection.
    Output(String, Pump),
    /// NA6: the connection the Daemon relays the App's `action.list` and `action.run` to, and its pump.
    Actions(Arc<Client>, Pump, String),
}

pub(crate) enum Command {
    Open {
        cause: OpenCause,
        reply: Reply<Project>,
    },
    Access {
        reply: Reply<Access>,
    },
    /// Answers whether the Attachment was kept; `run` names the Daemon it was made for.
    Attach {
        run: Option<u64>,
        what: Attachment,
        reply: oneshot::Sender<bool>,
    },
    StopOutput {
        id: String,
    },
    Answerer {
        registration: String,
        reply: Reply<Option<Arc<Client>>>,
    },
    /// The webview's subscription to run `run` answered or failed (U3791a).
    Connection {
        run: u64,
        result: Result<(), RpcError>,
    },
    /// Answers once the Daemon has saved what `exit_for_update` must not lose (S5981a).
    Confirm {
        reply: Reply<()>,
    },
    /// Ends the Daemon without the stdin-close shutdown, answers once it is gone, and ends the task.
    Leave {
        reply: oneshot::Sender<()>,
    },
    Exited {
        run: u64,
        code: Option<i32>,
    },
    /// Ends the task and with it the Daemon; `done` is dropped once nothing is left running.
    Close {
        done: std::sync::mpsc::Sender<()>,
    },
}

/// What every task shares: the App's configuration, its store and the run counter.
pub(crate) struct Shared {
    pub config: Config,
    pub store: Store,
    /// Counts successful Daemon starts so each gets its own socket path (S5): a reopen must never
    /// land on the exited run's path, and a failed attempt leaves this unchanged so a retry still
    /// gets the same chance under the socket limit. Locked across a start, so Daemons start one at
    /// a time and two never take the same run number.
    runs: tokio::sync::Mutex<u64>,
}

impl Shared {
    pub fn new(config: Config) -> Self {
        let store = Store::new(config.data_dir.clone());
        Self {
            config,
            store,
            runs: tokio::sync::Mutex::new(0),
        }
    }

    pub fn name_of(&self, path: &str) -> Result<String, RpcError> {
        Ok(self
            .store
            .name(path)?
            .unwrap_or_else(|| named_after(Path::new(path))))
    }

    fn project_at(&self, path: &str) -> Result<Project, RpcError> {
        Ok(Project {
            name: self.name_of(path)?,
            path: path.to_owned(),
        })
    }

    async fn start(&self, path: &Path) -> Result<(Started, u64), RpcError> {
        let mut runs = self.runs.lock().await;
        if !path.is_absolute() || !path.is_dir() {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("not an absolute path to a directory: {}", path.display()),
            ));
        }
        let run = *runs;
        let socket = self
            .config
            .socket_for_run(run)
            .map_err(RpcError::internal)?;
        let started = daemon::start(&self.config, path, &socket, self.store.dir()).await?;
        *runs = run + 1;
        Ok((started, run))
    }
}

#[derive(Clone, Serialize)]
struct DaemonExited {
    path: String,
    code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cause: Option<String>,
}

struct Open {
    client: Arc<Client>,
    /// Closing it is how the Daemon learns the App is gone (D1).
    _stdin: ChildStdin,
    /// Ends the Daemon without closing its stdin, for `exit_for_update` (S5981a).
    leave: Option<daemon::Leave>,
    socket: OwnedSocket,
    /// Which start made this Daemon, so an earlier Daemon's exit never marks a later one exited.
    run: u64,
    subscription: Option<Pump>,
    outputs: HashMap<String, Pump>,
    actions: Option<(Arc<Client>, Pump, String)>,
    connected: Option<oneshot::Sender<Result<(), RpcError>>>,
}

enum Phase {
    Open(Open),
    /// Not started yet, or the Daemon exited or failed to start; the Project stays listed so it
    /// can reopen (S5).
    Exited,
}

type Starting = Pin<Box<dyn Future<Output = Result<(Started, u64), RpcError>> + Send>>;

/// A started Daemon whose webview connection has not yet answered (U3791a).
struct Connecting {
    run: u64,
    answer: oneshot::Receiver<Result<(), RpcError>>,
    deadline: Instant,
}

pub(crate) struct Supervisor<R: Runtime> {
    app: AppHandle<R>,
    shared: Arc<Shared>,
    path: String,
    /// What the Daemon's exit watcher sends through; weak, so it never keeps a closed Project's task alive.
    me: mpsc::WeakUnboundedSender<Command>,
    running: watch::Sender<bool>,
    phase: Phase,
    /// Exits and failed starts since a connected Daemon or an explicit open (U6249b).
    failures: u8,
    /// No start has finished yet: a failure then is the open's own, not a recovery.
    first: bool,
    cause: OpenCause,
    /// Opens waiting for the current start or backoff to settle.
    waiters: Vec<Reply<Project>>,
    starting: Option<Starting>,
    retry: Option<Instant>,
    connecting: Option<Connecting>,
}

impl<R: Runtime> Supervisor<R> {
    pub fn new(
        app: AppHandle<R>,
        shared: Arc<Shared>,
        path: String,
        me: mpsc::WeakUnboundedSender<Command>,
        running: watch::Sender<bool>,
    ) -> Self {
        Self {
            app,
            shared,
            path,
            me,
            running,
            phase: Phase::Exited,
            failures: 0,
            first: true,
            cause: OpenCause::User,
            waiters: Vec::new(),
            starting: None,
            retry: None,
            connecting: None,
        }
    }

    async fn command(&mut self, command: Command) -> ControlFlow<()> {
        match command {
            Command::Open { cause, reply } => self.open(cause, reply),
            Command::Access { reply } => {
                let _ = reply.send(match &self.phase {
                    Phase::Open(open) => Ok(Access {
                        client: Arc::clone(&open.client),
                        socket: open.socket.path().to_path_buf(),
                        run: open.run,
                    }),
                    Phase::Exited => Err(exited()),
                });
            }
            Command::Attach { run, what, reply } => {
                let kept = match &mut self.phase {
                    Phase::Open(open) if run.is_none_or(|run| run == open.run) => {
                        open.attach(what);
                        true
                    }
                    _ => false,
                };
                let _ = reply.send(kept);
            }
            Command::StopOutput { id } => {
                if let Phase::Open(open) = &mut self.phase {
                    open.outputs.remove(&id);
                }
            }
            Command::Answerer {
                registration,
                reply,
            } => {
                let _ = reply.send(match &self.phase {
                    Phase::Open(open) => Ok(open
                        .actions
                        .as_ref()
                        .filter(|(_, _, token)| *token == registration)
                        .map(|(client, _, _)| Arc::clone(client))),
                    Phase::Exited => Err(exited()),
                });
            }
            Command::Connection { run, result } => {
                if let Phase::Open(open) = &mut self.phase
                    && open.run == run
                {
                    if result.is_ok() {
                        self.failures = 0;
                    }
                    if let Some(connected) = open.connected.take() {
                        let _ = connected.send(result);
                    }
                }
            }
            Command::Confirm { reply } => match &self.phase {
                Phase::Open(open) => {
                    let client = Arc::clone(&open.client);
                    tauri::async_runtime::spawn(async move {
                        let _ =
                            reply.send(client.request("rail.tree", Value::Null).await.map(drop));
                    });
                }
                Phase::Exited => {
                    let _ = reply.send(Ok(()));
                }
            },
            Command::Leave { reply } => {
                if let Phase::Open(open) = &mut self.phase
                    && let Some(leave) = open.leave.take()
                {
                    let (ack, done) = oneshot::channel();
                    if leave.send(ack).is_ok() {
                        let _ = timeout(UPDATE_BOUND, done).await;
                        // Signalled, so no code; the App is leaving, so no recovery follows.
                        self.notify(None, None, None);
                    }
                }
                let _ = reply.send(());
                return ControlFlow::Break(());
            }
            Command::Exited { run, code } => self.fail_run(run, code, None),
            Command::Close { done } => {
                self.phase = Phase::Exited;
                self.starting = None;
                drop(done);
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    }

    /// A Project whose Daemon runs is returned as it is and nothing starts; one whose Daemon
    /// exited reopens now, resets its failure count and retires any delayed retry (S5).
    fn open(&mut self, cause: OpenCause, reply: Reply<Project>) {
        if matches!(self.phase, Phase::Open(_)) {
            let _ = reply.send(self.shared.project_at(&self.path));
            return;
        }
        let settling = self.starting.is_some() || !self.waiters.is_empty();
        self.waiters.push(reply);
        if settling {
            return;
        }
        if self.first {
            self.cause = cause;
        }
        self.failures = 0;
        self.retry = None;
        self.begin_attempt();
    }

    fn begin_attempt(&mut self) {
        let shared = Arc::clone(&self.shared);
        let path = PathBuf::from(&self.path);
        self.starting = Some(Box::pin(async move { shared.start(&path).await }));
    }

    fn started(&mut self, result: Result<(Started, u64), RpcError>) -> ControlFlow<()> {
        let first = std::mem::replace(&mut self.first, false);
        match result {
            Ok((started, run)) => {
                let recovering = self.waiters.is_empty();
                let (connected, answer) = oneshot::channel();
                let me = self.me.clone();
                let leave = daemon::watch_exit(started.child, move |code| {
                    if let Some(me) = me.upgrade() {
                        let _ = me.send(Command::Exited { run, code });
                    }
                });
                self.phase = Phase::Open(Open {
                    client: Arc::new(started.client),
                    _stdin: started.stdin,
                    leave: Some(leave),
                    socket: started.socket,
                    run,
                    subscription: None,
                    outputs: HashMap::new(),
                    actions: None,
                    connected: (!first).then_some(connected),
                });
                self.running.send_replace(true);
                if !first {
                    self.connecting = Some(Connecting {
                        run,
                        answer,
                        deadline: Instant::now() + self.shared.config.call_bound,
                    });
                    if recovering {
                        self.notify(None, Some("connecting"), None);
                    }
                }
                let project = self.shared.project_at(&self.path);
                for waiter in self.waiters.drain(..) {
                    let _ = waiter.send(project.clone());
                }
            }
            Err(err) => {
                if first {
                    self.settle(Err(err));
                    return if self.cause == OpenCause::User {
                        ControlFlow::Break(())
                    } else {
                        ControlFlow::Continue(())
                    };
                }
                self.failures = (self.failures + 1).min(GIVE_UP);
                if self.waiters.is_empty() {
                    let recovery = (self.failures < GIVE_UP).then_some("waiting");
                    self.notify(None, recovery, Some(err.message.clone()));
                }
                match self.shared.config.reopen_wait(self.failures) {
                    Some(wait) => self.retry = Some(Instant::now() + wait),
                    None => self.settle(Err(err)),
                }
            }
        }
        ControlFlow::Continue(())
    }

    fn settle(&mut self, result: Result<Project, RpcError>) {
        for waiter in self.waiters.drain(..) {
            let _ = waiter.send(result.clone());
        }
    }

    fn connection(
        &mut self,
        run: u64,
        result: Result<
            Result<Result<(), RpcError>, oneshot::error::RecvError>,
            tokio::time::error::Elapsed,
        >,
    ) {
        match result {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(err))) => self.fail_run(run, None, Some(err.message)),
            // The process exit already scheduled recovery.
            Ok(Err(_)) => {}
            Err(_) => self.fail_run(
                run,
                None,
                Some("Daemon connection did not become ready".to_owned()),
            ),
        }
    }

    /// The Daemon of `run` is gone or unusable; an earlier run's exit changes nothing.
    fn fail_run(&mut self, run: u64, code: Option<i32>, cause: Option<String>) {
        if !matches!(&self.phase, Phase::Open(open) if open.run == run) {
            return;
        }
        self.phase = Phase::Exited;
        self.running.send_replace(false);
        self.connecting = None;
        self.failures = (self.failures + 1).min(GIVE_UP);
        let recovery = (self.failures < GIVE_UP).then_some("waiting");
        self.notify(code, recovery, cause);
        if let Some(wait) = self.shared.config.reopen_wait(self.failures) {
            self.retry = Some(Instant::now() + wait);
        }
    }

    fn notify(&self, code: Option<i32>, recovery: Option<&'static str>, cause: Option<String>) {
        if let Err(err) = self.app.emit(
            "daemon-exited",
            DaemonExited {
                path: self.path.clone(),
                code,
                recovery,
                cause,
            },
        ) {
            crate::diagnostics::failure("report Daemon recovery", &err);
        }
    }
}

impl Open {
    fn attach(&mut self, what: Attachment) {
        match what {
            Attachment::Subscription(pump) => self.subscription = Some(pump),
            Attachment::Output(id, pump) => {
                self.outputs.insert(id, pump);
            }
            Attachment::Actions(client, pump, registration) => {
                self.actions = Some((client, pump, registration));
            }
        }
    }
}

fn exited() -> RpcError {
    RpcError::internal("the Daemon has exited")
}

async fn started(starting: &mut Option<Starting>) -> Result<(Started, u64), RpcError> {
    starting.as_mut().expect("guarded by is_some").await
}

async fn retry_due(at: Option<Instant>) {
    sleep_until(at.expect("guarded by is_some")).await;
}

type Answered =
    Result<Result<Result<(), RpcError>, oneshot::error::RecvError>, tokio::time::error::Elapsed>;

async fn answered(connecting: &mut Option<Connecting>) -> (u64, Answered) {
    let connecting = connecting.as_mut().expect("guarded by is_some");
    (
        connecting.run,
        timeout_at(connecting.deadline, &mut connecting.answer).await,
    )
}

/// Runs until the Project closes, the App leaves for an update, or a `User` open fails. Ending
/// drops the Daemon's handles, which closes its stdin and cancels any start or delayed retry.
pub(crate) async fn supervise<R: Runtime>(
    mut task: Supervisor<R>,
    mut commands: mpsc::UnboundedReceiver<Command>,
) {
    loop {
        tokio::select! {
            biased;
            command = commands.recv() => match command {
                None => return,
                Some(command) => {
                    if task.command(command).await.is_break() {
                        return;
                    }
                }
            },
            result = started(&mut task.starting), if task.starting.is_some() => {
                task.starting = None;
                if task.started(result).is_break() {
                    return;
                }
            }
            () = retry_due(task.retry), if task.retry.is_some() => {
                task.retry = None;
                task.begin_attempt();
            }
            (run, result) = answered(&mut task.connecting), if task.connecting.is_some() => {
                task.connecting = None;
                task.connection(run, result);
            }
        }
    }
}
