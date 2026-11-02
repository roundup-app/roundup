use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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
use tokio::sync::{oneshot, watch};
use tokio::time::{Duration, sleep, timeout};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cause: Option<String>,
}

/// The longest name `rename_project` stores (S10).
const NAME_LIMIT: usize = 40;

struct Open {
    client: Arc<Client>,
    /// Closing it is how the Daemon learns the App is gone (D1).
    _stdin: ChildStdin,
    /// This run's socket path (S5): `subscribe` reconnects here, not through `Config`, since a
    /// reopen's Daemon runs on its own path.
    socket: OwnedSocket,
    /// Which start made this Daemon, so an earlier Daemon's exit never marks a later one exited.
    run: u64,
    /// One at a time: a reloaded webview subscribes again and must not receive every Event twice.
    subscription: Option<JoinHandle<()>>,
    /// X14: one connection and pump per selected Terminal; dropping one releases that selection.
    outputs: HashMap<String, JoinHandle<()>>,
    /// NA6: the connection the Daemon relays the App's `action.list` and `action.run` to, and its pump.
    actions: Option<(Arc<Client>, JoinHandle<()>)>,
    connected: Option<oneshot::Sender<Result<(), RpcError>>>,
}

impl Drop for Open {
    fn drop(&mut self) {
        if let Some(subscription) = self.subscription.take() {
            subscription.abort();
        }
        for (_, output) in self.outputs.drain() {
            output.abort();
        }
        if let Some((_, pump)) = self.actions.take() {
            pump.abort();
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
    failures: u8,
    lifetime: Arc<()>,
    // Dropping the entry cancels both its delayed restart and startup future.
    cancel: watch::Sender<()>,
}

/// Which Projects are open, in the order they were opened, and the Daemon serving each; the only
/// state the App holds besides what `Store` keeps.
pub struct AppState {
    config: Config,
    closed: AtomicBool,
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
            closed: AtomicBool::new(false),
            store,
            entries: Mutex::new(Vec::new()),
            runs: Mutex::new(0),
            starting: tokio::sync::Mutex::new(()),
        }
    }

    /// The folder the App keeps names and the open list in, unless `Config` already named one.
    pub fn use_data_dir(&self, dir: PathBuf) -> Result<(), RpcError> {
        self.store.use_dir(dir);
        self.store.load()
    }

    pub fn recent_projects(&self) -> Result<Vec<String>, RpcError> {
        self.store.recent_projects()
    }

    pub async fn claude_binary(&self) -> Option<crate::facts::ClaudeBinary> {
        crate::facts::claude_binary(&self.config).await
    }

    pub fn projects(&self) -> Result<Vec<Listed>, RpcError> {
        self.store.load()?;
        self.entries()
            .iter()
            .map(|entry| {
                Ok(Listed {
                    name: self.name_of(&entry.path)?,
                    path: entry.path.clone(),
                    running: matches!(entry.phase, Phase::Open(_)),
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
        self.open(app, path, false).await
    }

    /// The launch's reopening of the stored list (S10): a Daemon that fails to start leaves its
    /// Project listed as not running instead of dropping it.
    pub async fn restore<R: Runtime>(&self, app: &AppHandle<R>) -> Result<(), RpcError> {
        for path in self.store.open_paths()? {
            let path = PathBuf::from(path);
            if !path.is_dir() {
                continue;
            }
            if let Err(err) = self.open(app, &path, true).await {
                log::warn!(target: "roundup::shell", "restore Project: RPC failure code {}; saved Project remains listed", err.code);
            }
        }
        self.save_open()
    }

    async fn open<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        path: &Path,
        keep_on_failure: bool,
    ) -> Result<Project, RpcError> {
        self.store.load()?;
        let key = path.display().to_string();
        let mut pending = self
            .entries()
            .iter()
            .find(|entry| entry.path == key)
            .map(|entry| (entry.lifetime.clone(), entry.cancel.subscribe()));
        let _starting = if let Some((_, cancel)) = &mut pending {
            tokio::select! {
                biased;
                _ = cancel.changed() => return Err(not_open(&key)),
                starting = self.starting.lock() => starting,
            }
        } else {
            self.starting.lock().await
        };
        if self.closed.load(Ordering::SeqCst) {
            return Err(not_open(&key));
        }
        if self.is_running(&key) {
            if !keep_on_failure {
                self.store.record_recent(&key)?;
            }
            return self.project_at(&key);
        }
        let (lifetime, mut cancel, reopening) = {
            let mut entries = self.entries();
            if self.closed.load(Ordering::SeqCst)
                || pending.as_ref().is_some_and(|(lifetime, _)| {
                    !entries
                        .iter()
                        .any(|entry| Arc::ptr_eq(&entry.lifetime, lifetime))
                })
            {
                return Err(not_open(&key));
            }
            let reopening = entries.iter().any(|entry| entry.path == key);
            if !reopening {
                let (cancel, _) = watch::channel(());
                entries.push(Entry {
                    path: key.clone(),
                    phase: Phase::Exited,
                    failures: 0,
                    lifetime: Arc::new(()),
                    cancel,
                });
            }
            let entry = entries
                .iter_mut()
                .find(|entry| entry.path == key)
                .expect("inserted above");
            entry.failures = 0;
            // Explicit Reopen retires any delayed attempt from the previous recovery.
            entry.lifetime = Arc::new(());
            entry.cancel = watch::channel(()).0;
            (entry.lifetime.clone(), entry.cancel.subscribe(), reopening)
        };
        loop {
            let (connected, answer) = oneshot::channel();
            let run = *self.runs.lock().expect("runs lock");
            let result = tokio::select! {
                biased;
                _ = cancel.changed() => return Err(not_open(&key)),
                result = self.start_daemon(app, path, run, &lifetime, reopening.then_some(connected)) => result,
            };
            match result {
                Ok(project) => {
                    if reopening {
                        Self::await_connection(app.clone(), key.clone(), run, cancel, answer);
                    }
                    self.save_open()?;
                    if !keep_on_failure {
                        self.store.record_recent(&project.path)?;
                    }
                    return Ok(project);
                }
                Err(err) => {
                    if !reopening {
                        if keep_on_failure {
                            self.save_open()?;
                        } else {
                            self.entries()
                                .retain(|entry| !Arc::ptr_eq(&entry.lifetime, &lifetime));
                        }
                        return Err(err);
                    }
                    let Some(failure) = self.record_failure(&key, &lifetime) else {
                        return Err(not_open(&key));
                    };
                    if failure == 3 {
                        return Err(err);
                    }
                    tokio::select! {
                        biased;
                        _ = cancel.changed() => return Err(not_open(&key)),
                        _ = sleep(Duration::from_millis(250 * u64::from(failure))) => {}
                    }
                }
            }
        }
    }

    pub async fn rpc(&self, path: &str, method: &str, params: Value) -> Result<Value, RpcError> {
        if matches!(method, "daemon.getNaming" | "daemon.setNaming") {
            let root = self.store.dir().ok_or_else(|| {
                RpcError::internal("App data folder is unavailable; reopen Settings to retry.")
            })?;
            return daemon::naming_settings(root, method, params);
        }
        let client = self.open_ref(path, |open| Arc::clone(&open.client))?;
        self.bounded(method, client.request(method, params)).await
    }

    /// Sends every Event of the Project's Daemon to `channel`, in the Daemon's order, until the Daemon or the webview goes away.
    /// With `after`, it first replays every saved Event numbered above it (D11). Answers the Daemon's `head`: the highest Event number saved when it accepted.
    pub async fn subscribe(
        &self,
        path: &str,
        channel: Channel<Event>,
        after: Option<u64>,
    ) -> Result<u64, RpcError> {
        let (socket, run) =
            self.open_ref(path, |open| (open.socket.path().to_path_buf(), open.run))?;
        let result = self.subscribe_run(path, channel, after, socket, run).await;
        let mut entries = self.entries();
        if let Some(entry) = entries.iter_mut().find(|entry| entry.path == path)
            && let Phase::Open(open) = &mut entry.phase
            && open.run == run
        {
            if result.is_ok() {
                entry.failures = 0;
            }
            // D11 retries an expired cursor on this same connection; it is not a failed startup.
            if !matches!(&result, Err(err) if err.code == code::EVENTS_EXPIRED)
                && let Some(connected) = open.connected.take()
            {
                let _ = connected.send(result.clone().map(|_| ()));
            }
        }
        result
    }

    async fn subscribe_run(
        &self,
        path: &str,
        channel: Channel<Event>,
        after: Option<u64>,
        socket: PathBuf,
        run: u64,
    ) -> Result<u64, RpcError> {
        let mut events = Client::connect(&socket).await.map_err(RpcError::internal)?;
        let params = after.map_or(Value::Null, |after| serde_json::json!({ "after": after }));
        let answer = self
            .bounded(
                "events.subscribe",
                events.request("events.subscribe", params),
            )
            .await?;
        let head = answer.get("head").and_then(Value::as_u64).unwrap_or(0);
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
            }) if open.run == run => {
                if let Some(previous) = open.subscription.replace(pump) {
                    previous.abort();
                }
                Ok(head)
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

    /// NA6: registers the webview as the Project's action answerer (`action.serve`) and sends each
    /// request line the Daemon relays to `channel`; `action_answer` writes the answer. A second call replaces the first.
    pub async fn action_serve(&self, path: &str, channel: Channel<Value>) -> Result<(), RpcError> {
        let socket = self.open_ref(path, |open| open.socket.path().to_path_buf())?;
        let mut client = Client::connect(&socket).await.map_err(RpcError::internal)?;
        let mut requests = client
            .take_requests()
            .ok_or_else(|| RpcError::internal("the request intake was already taken"))?;
        self.bounded("action.serve", client.request("action.serve", Value::Null))
            .await?;
        let client = Arc::new(client);
        let pump = tauri::async_runtime::spawn(async move {
            while let Some(request) = requests.recv().await {
                if channel.send(request).is_err() {
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
                if let Some((_, previous)) = open.actions.replace((client, pump)) {
                    previous.abort();
                }
                Ok(())
            }
            _ => {
                pump.abort();
                Err(not_open(path))
            }
        }
    }

    /// NA6: the webview's answer to a request `action_serve` delivered.
    pub async fn action_answer(&self, path: &str, line: Value) -> Result<(), RpcError> {
        let client = self.open_ref(path, |open| {
            open.actions.as_ref().map(|(client, _)| Arc::clone(client))
        })?;
        client
            .ok_or_else(|| RpcError::internal("no action answerer is registered"))?
            .reply(&line)
            .await
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
        self.save_open()?;
        Ok(())
    }

    /// Stores `name` for the open Project, trimmed; an empty name removes it (S10).
    pub fn rename_project(
        &self,
        path: &str,
        name: &str,
        base: Option<&str>,
    ) -> Result<Project, RpcError> {
        let entries = self.entries();
        if !entries.iter().any(|entry| entry.path == path) {
            return Err(not_open(path));
        }
        let trimmed = name.trim();
        if name.contains(['\n', '\r']) || trimmed.chars().count() > NAME_LIMIT {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("a name is 1 to {NAME_LIMIT} characters on one line"),
            ));
        }
        let name = self.store.set_name(
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

    /// Closes every Daemon's stdin (S3).
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.entries().clear();
    }

    fn entries(&self) -> MutexGuard<'_, Vec<Entry>> {
        self.entries
            .lock()
            .expect("the entries lock is never kept across a panic")
    }

    fn is_running(&self, path: &str) -> bool {
        self.entries()
            .iter()
            .any(|entry| entry.path == path && matches!(entry.phase, Phase::Open(_)))
    }

    fn name_of(&self, path: &str) -> Result<String, RpcError> {
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

    fn save_open(&self) -> Result<(), RpcError> {
        let paths = self
            .entries()
            .iter()
            .map(|entry| entry.path.clone())
            .collect();
        self.store.set_open(paths)
    }

    /// Commits the run number a successful open used, so the next one gets a fresh socket path (S5).
    fn commit_run(&self, run: u64) {
        let mut runs = self
            .runs
            .lock()
            .expect("the runs lock is never kept across a panic");
        *runs = run + 1;
    }

    async fn start_daemon<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        path: &Path,
        run: u64,
        lifetime: &Arc<()>,
        connected: Option<oneshot::Sender<Result<(), RpcError>>>,
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
        let started = daemon::start(&self.config, path, &socket, self.store.dir()).await?;
        let open = Open {
            client: Arc::new(started.client),
            _stdin: started.stdin,
            socket: started.socket,
            run,
            subscription: None,
            outputs: HashMap::new(),
            actions: None,
            connected,
        };
        let mut entries = self.entries();
        match entries.iter_mut().find(|entry| entry.path == key) {
            Some(entry) if Arc::ptr_eq(&entry.lifetime, lifetime) => {
                entry.phase = Phase::Open(open)
            }
            _ => return Err(not_open(&key)),
        }
        drop(entries);
        self.commit_run(run);
        let app = app.clone();
        let exited_path = key.clone();
        daemon::watch_exit(started.child, move |code| {
            Self::failed(&app, &exited_path, run, code, None);
        });
        self.project_at(&key)
    }

    fn record_failure(&self, path: &str, lifetime: &Arc<()>) -> Option<u8> {
        let mut entries = self.entries();
        let entry = entries
            .iter_mut()
            .find(|entry| entry.path == path && Arc::ptr_eq(&entry.lifetime, lifetime))?;
        entry.failures = (entry.failures + 1).min(3);
        Some(entry.failures)
    }

    fn failed<R: Runtime>(
        app: &AppHandle<R>,
        path: &str,
        run: u64,
        code: Option<i32>,
        cause: Option<String>,
    ) {
        let state = app.state::<AppState>();
        let mut entries = state.entries();
        let Some(entry) = entries.iter_mut().find(|entry| entry.path == path) else {
            return;
        };
        if !matches!(&entry.phase, Phase::Open(open) if open.run == run) {
            return;
        }
        entry.phase = Phase::Exited;
        entry.failures = (entry.failures + 1).min(3);
        let failures = entry.failures;
        let lifetime = entry.lifetime.clone();
        let cancel = entry.cancel.subscribe();
        // Emit while holding the entry: close/reopen cannot overtake its exit notification.
        Self::notify(app, path, code, (failures < 3).then_some("waiting"), cause);
        drop(entries);
        if failures < 3 {
            Self::recover(app.clone(), path.to_owned(), lifetime, cancel, failures);
        }
    }

    fn notify<R: Runtime>(
        app: &AppHandle<R>,
        path: &str,
        code: Option<i32>,
        recovery: Option<&'static str>,
        cause: Option<String>,
    ) {
        if let Err(err) = app.emit(
            "daemon-exited",
            DaemonExited {
                path: path.to_owned(),
                code,
                recovery,
                cause,
            },
        ) {
            crate::diagnostics::failure("report Daemon recovery", &err);
        }
    }

    fn recover<R: Runtime>(
        app: AppHandle<R>,
        path: String,
        lifetime: Arc<()>,
        mut cancel: watch::Receiver<()>,
        mut failures: u8,
    ) {
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    _ = cancel.changed() => return,
                    _ = sleep(Duration::from_millis(250 * u64::from(failures))) => {}
                }
                let state = app.state::<AppState>();
                let starting = tokio::select! {
                    biased;
                    _ = cancel.changed() => return,
                    starting = state.starting.lock() => starting,
                };
                let run = *state.runs.lock().expect("runs lock");
                let (connected, answer) = oneshot::channel();
                let result = tokio::select! {
                    biased;
                    _ = cancel.changed() => return,
                    result = state.start_daemon(&app, Path::new(&path), run, &lifetime, Some(connected)) => result,
                };
                drop(starting);
                match result {
                    Ok(_) => {
                        {
                            let entries = state.entries();
                            if !entries.iter().any(|entry| {
                                entry.path == path
                                    && matches!(&entry.phase, Phase::Open(open) if open.run == run)
                            }) {
                                return;
                            }
                            Self::notify(&app, &path, None, Some("connecting"), None);
                        }
                        Self::await_connection(app.clone(), path, run, cancel, answer);
                        return;
                    }
                    Err(err) => {
                        let Some(count) = state.record_failure(&path, &lifetime) else {
                            return;
                        };
                        failures = count;
                        let entries = state.entries();
                        if !entries
                            .iter()
                            .any(|entry| Arc::ptr_eq(&entry.lifetime, &lifetime))
                        {
                            return;
                        }
                        Self::notify(
                            &app,
                            &path,
                            None,
                            (failures < 3).then_some("waiting"),
                            Some(err.message),
                        );
                        if failures == 3 {
                            return;
                        }
                    }
                }
            }
        });
    }

    fn await_connection<R: Runtime>(
        app: AppHandle<R>,
        path: String,
        run: u64,
        mut cancel: watch::Receiver<()>,
        answer: oneshot::Receiver<Result<(), RpcError>>,
    ) {
        tauri::async_runtime::spawn(async move {
            let bound = app.state::<AppState>().config.call_bound;
            let result = tokio::select! {
                biased;
                _ = cancel.changed() => return,
                result = timeout(bound, answer) => result,
            };
            match result {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(err))) => Self::failed(&app, &path, run, None, Some(err.message)),
                Ok(Err(_)) => {} // The process exit already scheduled recovery.
                Err(_) => Self::failed(
                    &app,
                    &path,
                    run,
                    None,
                    Some("Daemon connection did not become ready".to_owned()),
                ),
            }
        });
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
        timeout(self.config.call_bound, call)
            .await
            .map_err(|_| unanswered(method, self.config.call_bound))?
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
