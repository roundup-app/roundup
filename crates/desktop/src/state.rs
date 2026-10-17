use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use contracts::Event;
use rpc::{Client, OutputFrame, RpcError, code};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::async_runtime::JoinHandle;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::process::ChildStdin;
use tokio::time::timeout;

use crate::config::Config;
use crate::daemon::{self, OwnedSocket};
use crate::store::Store;

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

#[derive(Clone, Serialize)]
struct DaemonExited {
    path: String,
    code: Option<i32>,
}

/// The longest name `rename_project` stores (S10).
const NAME_LIMIT: usize = 40;

struct Open {
    client: Arc<Client>,
    /// Closing it is how the Daemon learns the App is gone (D1).
    _stdin: ChildStdin,
    /// The proof this Daemon holds (H18); a reopen's Daemon gets its own.
    proof: String,
    /// This run's socket path (S5): `subscribe` reconnects here, not through `Config`, since a
    /// reopen's Daemon runs on its own path.
    socket: OwnedSocket,
    /// Which start made this Daemon, so an earlier Daemon's exit never marks a later one exited.
    run: u64,
    /// One at a time: a reloaded webview subscribes again and must not receive every Event twice.
    subscription: Option<JoinHandle<()>>,
    /// X14: one connection and pump per selected Terminal; dropping one releases that selection.
    outputs: HashMap<String, JoinHandle<()>>,
}

impl Drop for Open {
    fn drop(&mut self) {
        if let Some(subscription) = self.subscription.take() {
            subscription.abort();
        }
        for (_, output) in self.outputs.drain() {
            output.abort();
        }
    }
}

enum Phase {
    Open(Open),
    /// The Daemon exited or failed to start; the Project stays listed so it can reopen (S5).
    Exited,
}

struct Entry {
    path: String,
    phase: Phase,
}

/// Which Projects are open, in the order they were opened, and the Daemon serving each; the only
/// state the App holds besides what `Store` keeps.
pub struct AppState {
    config: Config,
    store: Store,
    entries: Mutex<Vec<Entry>>,
    /// Counts successful Daemon starts so each gets its own socket path (S5): a reopen must never
    /// land on the exited run's path, and a failed attempt leaves this unchanged so a retry still
    /// gets the same chance under the socket limit.
    runs: Mutex<u64>,
    /// Daemons start one at a time, so two starts never take the same run number.
    starting: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let store = Store::new(config.data_dir.clone());
        Self {
            config,
            store,
            entries: Mutex::new(Vec::new()),
            runs: Mutex::new(0),
            starting: tokio::sync::Mutex::new(()),
        }
    }

    /// The folder the App keeps names and the open list in, unless `Config` already named one.
    pub fn use_data_dir(&self, dir: PathBuf) {
        self.store.use_dir(dir);
    }

    pub fn projects(&self) -> Vec<Listed> {
        self.entries()
            .iter()
            .map(|entry| Listed {
                name: self.name_of(&entry.path),
                path: entry.path.clone(),
                running: matches!(entry.phase, Phase::Open(_)),
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
        self.open(app, path, false).await
    }

    /// The launch's reopening of the stored list (S10): a Daemon that fails to start leaves its
    /// Project listed as not running instead of dropping it.
    pub async fn restore<R: Runtime>(&self, app: &AppHandle<R>) {
        for path in self.store.open_paths() {
            let path = PathBuf::from(path);
            if !path.is_dir() {
                continue;
            }
            if let Err(err) = self.open(app, &path, true).await {
                eprintln!(
                    "desktop: could not reopen {}: {}",
                    path.display(),
                    err.message
                );
            }
        }
        self.save_open();
    }

    async fn open<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        path: &Path,
        keep_on_failure: bool,
    ) -> Result<Project, RpcError> {
        let key = path.display().to_string();
        let _starting = self.starting.lock().await;
        if self.is_running(&key) {
            return Ok(self.project_at(&key));
        }
        let run = *self
            .runs
            .lock()
            .expect("the runs lock is never held across a panic");
        match self.start_daemon(app, path, run).await {
            Ok(project) => {
                self.save_open();
                Ok(project)
            }
            Err(err) => {
                if keep_on_failure {
                    self.keep_exited(&key);
                }
                Err(err)
            }
        }
    }

    /// The live Daemon's proof (H18): never an earlier Daemon's, so it fails once the Daemon exits.
    pub fn daemon_proof(&self, path: &str) -> Result<String, RpcError> {
        self.open_ref(path, |open| open.proof.clone())
    }

    pub async fn rpc(&self, path: &str, method: &str, params: Value) -> Result<Value, RpcError> {
        let client = self.open_ref(path, |open| Arc::clone(&open.client))?;
        self.bounded(method, client.request(method, params)).await
    }

    /// Sends every Event of the Project's Daemon to `channel`, in the Daemon's order, until the Daemon or the webview goes away.
    pub async fn subscribe(&self, path: &str, channel: Channel<Event>) -> Result<(), RpcError> {
        let socket = self.open_ref(path, |open| open.socket.path().to_path_buf())?;
        let mut events = Client::connect(&socket).await.map_err(RpcError::internal)?;
        self.bounded(
            "events.subscribe",
            events.request("events.subscribe", Value::Null),
        )
        .await?;
        let pump = tauri::async_runtime::spawn(async move {
            while let Some(event) = events.next_event().await {
                if channel.send(event).is_err() {
                    return;
                }
            }
        });
        let mut entries = self.entries();
        match entries.iter_mut().find(|entry| entry.path == path) {
            Some(Entry {
                phase: Phase::Open(open),
                ..
            }) => {
                if let Some(previous) = open.subscription.replace(pump) {
                    previous.abort();
                }
                Ok(())
            }
            _ => {
                pump.abort();
                Err(RpcError::internal("the Daemon went away while subscribing"))
            }
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
        let socket = self.open_ref(path, |open| open.socket.path().to_path_buf())?;
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
        let pump = tauri::async_runtime::spawn(async move {
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
        });
        let mut entries = self.entries();
        match entries.iter_mut().find(|entry| entry.path == path) {
            Some(Entry {
                phase: Phase::Open(open),
                ..
            }) => {
                if let Some(previous) = open.outputs.insert(id.to_owned(), pump) {
                    previous.abort();
                }
                Ok(first)
            }
            _ => {
                pump.abort();
                Err(RpcError::internal("the Daemon went away while subscribing"))
            }
        }
    }

    /// X14: releases the App's selection of one Terminal; the other Terminals' streams go on.
    pub fn terminal_output_stop(&self, path: &str, id: &str) -> Result<(), RpcError> {
        let mut entries = self.entries();
        match entries.iter_mut().find(|entry| entry.path == path) {
            Some(Entry {
                phase: Phase::Open(open),
                ..
            }) => {
                if let Some(pump) = open.outputs.remove(id) {
                    pump.abort();
                }
                Ok(())
            }
            _ => Err(not_open(path)),
        }
    }

    /// Ends the Project's Daemon by closing its stdin, so a Daemon started with `--attached` stops
    /// its Agents and Terminals and exits (S3); the other Projects go on.
    pub fn close_project(&self, path: &str) -> Result<(), RpcError> {
        let mut entries = self.entries();
        let Some(index) = entries.iter().position(|entry| entry.path == path) else {
            return Err(not_open(path));
        };
        let closed = entries.remove(index);
        drop(entries);
        drop(closed);
        self.save_open();
        Ok(())
    }

    /// Stores `name` for the open Project, trimmed; an empty name removes it (S10).
    pub fn rename_project(&self, path: &str, name: &str) -> Result<Project, RpcError> {
        if !self.entries().iter().any(|entry| entry.path == path) {
            return Err(not_open(path));
        }
        let trimmed = name.trim();
        if name.contains(['\n', '\r']) || trimmed.chars().count() > NAME_LIMIT {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("a name is 1 to {NAME_LIMIT} characters on one line"),
            ));
        }
        self.store
            .set_name(path, (!trimmed.is_empty()).then(|| trimmed.to_owned()));
        Ok(self.project_at(path))
    }

    /// Closes every Daemon's stdin (S3).
    pub fn close(&self) {
        self.entries().clear();
    }

    fn entries(&self) -> MutexGuard<'_, Vec<Entry>> {
        self.entries
            .lock()
            .expect("the entries lock is never held across a panic")
    }

    fn is_running(&self, path: &str) -> bool {
        self.entries()
            .iter()
            .any(|entry| entry.path == path && matches!(entry.phase, Phase::Open(_)))
    }

    fn name_of(&self, path: &str) -> String {
        self.store
            .name(path)
            .unwrap_or_else(|| named_after(Path::new(path)))
    }

    fn project_at(&self, path: &str) -> Project {
        Project {
            name: self.name_of(path),
            path: path.to_owned(),
        }
    }

    fn save_open(&self) {
        let paths = self
            .entries()
            .iter()
            .map(|entry| entry.path.clone())
            .collect();
        self.store.set_open(paths);
    }

    fn keep_exited(&self, path: &str) {
        let mut entries = self.entries();
        if !entries.iter().any(|entry| entry.path == path) {
            entries.push(Entry {
                path: path.to_owned(),
                phase: Phase::Exited,
            });
        }
    }

    /// Commits the run number a successful open used, so the next one gets a fresh socket path (S5).
    fn commit_run(&self, run: u64) {
        let mut runs = self
            .runs
            .lock()
            .expect("the runs lock is never held across a panic");
        *runs = run + 1;
    }

    async fn start_daemon<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        path: &Path,
        run: u64,
    ) -> Result<Project, RpcError> {
        if !path.is_absolute() || !path.is_dir() {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("not an absolute path to a directory: {}", path.display()),
            ));
        }
        let key = path.display().to_string();
        let socket = self
            .config
            .socket_for_run(run)
            .map_err(RpcError::internal)?;
        let reopening = self.entries().iter().any(|entry| entry.path == key);
        let started = daemon::start(&self.config, path, &socket, self.store.dir()).await?;
        let open = Open {
            client: Arc::new(started.client),
            _stdin: started.stdin,
            proof: started.proof,
            socket: started.socket,
            run,
            subscription: None,
            outputs: HashMap::new(),
        };
        let mut entries = self.entries();
        match entries.iter_mut().find(|entry| entry.path == key) {
            Some(entry) => entry.phase = Phase::Open(open),
            // A reopen whose tab was closed while the Daemon started: the Daemon goes with it.
            None if reopening => return Err(not_open(&key)),
            None => entries.push(Entry {
                path: key.clone(),
                phase: Phase::Open(open),
            }),
        }
        drop(entries);
        self.commit_run(run);
        let app = app.clone();
        let exited_path = key.clone();
        daemon::watch_exit(started.child, move |code| {
            if app.state::<AppState>().mark_exited(&exited_path, run)
                && let Err(err) = app.emit(
                    "daemon-exited",
                    DaemonExited {
                        path: exited_path,
                        code,
                    },
                )
            {
                eprintln!("desktop: could not tell the webview the Daemon exited: {err}");
            }
        });
        Ok(self.project_at(&key))
    }

    /// False when the App closed the Daemon itself, so the webview is not told about an exit it asked for.
    fn mark_exited(&self, path: &str, run: u64) -> bool {
        let mut entries = self.entries();
        let Some(entry) = entries.iter_mut().find(|entry| entry.path == path) else {
            return false;
        };
        match &entry.phase {
            Phase::Open(open) if open.run == run => {
                entry.phase = Phase::Exited;
                true
            }
            Phase::Open(_) | Phase::Exited => false,
        }
    }

    /// The guard every read of a Project's Daemon shares: `INTERNAL` once it has exited,
    /// `CONFLICT` when no such Project is open.
    fn open_ref<T>(&self, path: &str, read: impl FnOnce(&Open) -> T) -> Result<T, RpcError> {
        match self.entries().iter().find(|entry| entry.path == path) {
            Some(Entry {
                phase: Phase::Open(open),
                ..
            }) => Ok(read(open)),
            Some(Entry {
                phase: Phase::Exited,
                ..
            }) => Err(RpcError::internal("the Daemon has exited")),
            None => Err(not_open(path)),
        }
    }

    async fn bounded<T>(
        &self,
        method: &str,
        call: impl Future<Output = Result<T, RpcError>>,
    ) -> Result<T, RpcError> {
        timeout(self.config.call_bound, call).await.map_err(|_| {
            RpcError::internal(format!(
                "no reply to {method} within {:?}; whether the Daemon applied it is unknown",
                self.config.call_bound
            ))
        })?
    }
}

fn not_open(path: &str) -> RpcError {
    RpcError::conflict(format!("no Project is open at {path}"))
}

/// Resolves `.` and `..` first: the last component of `/a/b/..` is not the Project's name.
fn named_after(path: &Path) -> String {
    let reached = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    reached.file_name().map_or_else(
        || reached.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}
