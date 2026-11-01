//! UA1–UA8: the Extension host. Each Extension of the owner's folder runs in its own child
//! process (`child.rs`); the host lists the actions its `register` declared, runs them by name,
//! enforces `permissions` on the child's `$` calls and keeps a bad Extension from the Daemon.

mod child;
mod manifest;
#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use contracts::action::{ActionArg, ActionRow, ArgType, ExtensionProblem, RunParams};
use contracts::{Actor, ActorKind, EventData};
use rpc::{RpcError, code};
use serde_json::{Map, Value, json};
use tokio::sync::mpsc;

use crate::{Conn, Daemon};
use child::{Child, Started};
use manifest::Manifest;

/// UA6, UA8: how long a `register` or a hook may take.
const CALL_TIMEOUT: Duration = Duration::from_secs(10);
/// How long saves are gathered into one rescan.
const SETTLE: Duration = Duration::from_millis(150);

const NODE_MISSING: &str =
    "node was not found on the PATH; install Node.js (https://nodejs.org) and restart roundup";

/// The Extensions folder's state, shared by the loader, the runs and the `$` calls.
pub(crate) struct Host {
    dir: PathBuf,
    node: OsString,
    timeout: Duration,
    started: AtomicBool,
    state: Mutex<State>,
    /// `$.store`: kept across a reload, per Extension name.
    store: Mutex<HashMap<String, Map<String, Value>>>,
    daemon: Mutex<Weak<Daemon>>,
    /// One scan at a time.
    scanning: tokio::sync::Mutex<()>,
}

#[derive(Default)]
struct State {
    /// By folder name, so the order of the list is the folders' own.
    loaded: BTreeMap<String, Loaded>,
    /// The App's own names, once it has answered a list.
    built_in: Option<HashSet<String>>,
    /// Problems already raised for a (Extension, action, rule), so a recheck raises none twice.
    reported: HashSet<(String, String, &'static str)>,
    /// The User actions now listed, with the folder that owns each.
    listed: Vec<(ActionRow, String)>,
}

struct Loaded {
    fingerprint: String,
    name: String,
    declared: Vec<ActionRow>,
    live: Option<Arc<Child>>,
}

impl Host {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            node: "node".into(),
            timeout: CALL_TIMEOUT,
            started: AtomicBool::new(false),
            state: Mutex::default(),
            store: Mutex::default(),
            daemon: Mutex::new(Weak::new()),
            scanning: tokio::sync::Mutex::new(()),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(dir: PathBuf, node: &str, timeout: Duration) -> Self {
        Self {
            node: node.into(),
            timeout,
            ..Self::new(dir)
        }
    }

    /// Starts the loader once, after the Daemon serves its socket (UA1).
    pub(crate) fn start(&self, daemon: &Arc<Daemon>) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        *self.daemon.lock().expect("host poisoned") = Arc::downgrade(daemon);
        let daemon = Arc::clone(daemon);
        tokio::spawn(async move {
            let host = &daemon.extensions;
            let (changes, mut changed) = mpsc::unbounded_channel();
            // Kept alive for as long as this task runs.
            let _watcher = host.watch(changes);
            host.scan(&daemon).await;
            while changed.recv().await.is_some() {
                tokio::time::sleep(SETTLE).await;
                while changed.try_recv().is_ok() {}
                host.scan(&daemon).await;
            }
        });
    }

    fn watch(&self, changes: mpsc::UnboundedSender<()>) -> Option<notify::RecommendedWatcher> {
        use notify::Watcher;
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if event.is_ok() {
                    let _ = changes.send(());
                }
            })
            .ok()?;
        watcher
            .watch(&self.dir, notify::RecursiveMode::Recursive)
            .ok()?;
        Some(watcher)
    }

    /// Loads what changed since the last scan: a new or saved Extension, a removed one.
    async fn scan(&self, daemon: &Arc<Daemon>) {
        let _one = self.scanning.lock().await;
        let mut folders = BTreeMap::new();
        for entry in std::fs::read_dir(&self.dir).into_iter().flatten().flatten() {
            let folder = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.')
                && folder.is_dir()
                && let Some(print) = manifest::fingerprint(&folder)
            {
                folders.insert(name, (folder, print));
            }
        }
        let gone: Vec<String> = {
            let state = self.state.lock().expect("host poisoned");
            state
                .loaded
                .keys()
                .filter(|folder| !folders.contains_key(*folder))
                .cloned()
                .collect()
        };
        let mut removed = false;
        for folder in gone {
            let old = self
                .state
                .lock()
                .expect("host poisoned")
                .loaded
                .remove(&folder);
            if let Some(old) = old {
                if let Some(child) = old.live {
                    child.stop();
                }
                self.state
                    .lock()
                    .expect("host poisoned")
                    .reported
                    .retain(|(name, ..)| *name != old.name);
                removed = true;
            }
        }
        if removed {
            self.reconcile(daemon, true);
        }
        let mut loads = tokio::task::JoinSet::new();
        for (name, (folder, print)) in folders {
            let unchanged = self
                .state
                .lock()
                .expect("host poisoned")
                .loaded
                .get(&name)
                .is_some_and(|loaded| loaded.fingerprint == print);
            if !unchanged {
                let daemon = Arc::clone(daemon);
                loads.spawn(
                    async move { daemon.extensions.load(&daemon, name, folder, print).await },
                );
            }
        }
        while loads.join_next().await.is_some() {}
    }

    fn problem(&self, daemon: &Daemon, extension: &str, cause: String) {
        daemon.bus.emit(
            Actor::daemon(),
            EventData::ExtensionProblem(ExtensionProblem {
                extension: extension.into(),
                cause,
            }),
        );
    }

    /// Loads one folder: a bad one adds nothing, and a reload that fails keeps the last good one.
    async fn load(
        &self,
        daemon: &Arc<Daemon>,
        folder_name: String,
        folder: PathBuf,
        print: String,
    ) {
        let manifest = match manifest::read(&folder) {
            Ok(manifest) => Arc::new(manifest),
            Err(cause) => {
                self.problem(daemon, &folder_name, cause);
                self.remember_failed(&folder_name, print);
                return;
            }
        };
        let name = manifest.name.clone();
        let outcome = self.register(daemon, &folder, &manifest).await;
        let (started, (declared, causes)) = match outcome {
            Ok(registered) => registered,
            Err(cause) => {
                self.problem(daemon, &name, cause);
                self.remember_failed(&folder_name, print);
                return;
            }
        };
        let child = Arc::clone(&started.child);
        let old = {
            let mut state = self.state.lock().expect("host poisoned");
            state.reported.retain(|(ext, ..)| *ext != name);
            state.loaded.insert(
                folder_name.clone(),
                Loaded {
                    fingerprint: print,
                    name: name.clone(),
                    declared: declared.clone(),
                    live: Some(Arc::clone(&child)),
                },
            )
        };
        if let Some(child) = old.and_then(|old| old.live) {
            child.stop();
        }
        self.problems_of_declaring(daemon, &name, causes);
        self.reconcile(daemon, true);
        let Started { calls, ended, .. } = started;
        let calls_host = Arc::clone(daemon);
        let calls_child = Arc::clone(&child);
        tokio::spawn(Self::answer_calls(calls_host, calls_child, manifest, calls));
        let daemon = Arc::clone(daemon);
        tokio::spawn(async move {
            let in_flight = ended.await.unwrap_or(0);
            daemon
                .extensions
                .exited(&daemon, &folder_name, &child, in_flight);
        });
    }

    /// A folder that failed to load stays known, so an unchanged one is not tried again; what was
    /// last good stays too.
    fn remember_failed(&self, folder: &str, print: String) {
        let mut state = self.state.lock().expect("host poisoned");
        match state.loaded.get_mut(folder) {
            Some(loaded) => loaded.fingerprint = print,
            None => {
                state.loaded.insert(
                    folder.into(),
                    Loaded {
                        fingerprint: print,
                        name: folder.into(),
                        declared: Vec::new(),
                        live: None,
                    },
                );
            }
        }
    }

    /// Starts the child and waits for its `register` (UA8: never longer than the timeout).
    async fn register(
        &self,
        daemon: &Arc<Daemon>,
        folder: &std::path::Path,
        manifest: &Manifest,
    ) -> Result<(Started, (Vec<ActionRow>, Vec<String>)), String> {
        let _ = daemon;
        let module = folder.join(&manifest.module);
        let started = match Child::start(&self.node, folder, &module) {
            Ok(started) => started,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(NODE_MISSING.into());
            }
            Err(err) => return Err(format!("{}: could not start: {err}", manifest.module)),
        };
        let mut started = started;
        let registered = tokio::time::timeout(self.timeout, &mut started.registered).await;
        let fail = |started: &Started, cause: String| {
            started.child.stop();
            cause
        };
        match registered {
            Err(_) => Err(fail(
                &started,
                format!(
                    "{}: register did not finish within {} s and was stopped",
                    manifest.module,
                    self.timeout.as_secs_f32()
                ),
            )),
            Ok(Err(_)) => Err(format!(
                "{}: the process exited before register finished",
                manifest.module
            )),
            Ok(Ok(Err(cause))) => Err(format!("{}: register failed: {cause}", manifest.module)),
            Ok(Ok(Ok(actions))) => {
                let declared = declared_rows(&actions);
                Ok((started, declared))
            }
        }
    }

    fn problems_of_declaring(&self, daemon: &Daemon, extension: &str, causes: Vec<String>) {
        for cause in causes {
            self.problem(daemon, extension, cause);
        }
    }

    /// The child ended (UA6): its actions leave the list until it reloads.
    fn exited(&self, daemon: &Arc<Daemon>, folder: &str, child: &Arc<Child>, in_flight: usize) {
        let name = {
            let mut state = self.state.lock().expect("host poisoned");
            let Some(loaded) = state.loaded.get_mut(folder) else {
                return;
            };
            if !loaded.live.as_ref().is_some_and(|live| live.id == child.id) {
                return;
            }
            loaded.live = None;
            loaded.declared.clear();
            loaded.name.clone()
        };
        // A run in flight raises the problem of its own failure.
        if in_flight == 0 {
            self.problem(
                daemon,
                &name,
                "the Extension's process exited; its actions are unlisted until it reloads".into(),
            );
        }
        self.reconcile(daemon, true);
    }

    /// Answers the `$` calls of one child, each in its own task.
    async fn answer_calls(
        daemon: Arc<Daemon>,
        child: Arc<Child>,
        manifest: Arc<Manifest>,
        mut calls: mpsc::UnboundedReceiver<child::Call>,
    ) {
        while let Some(call) = calls.recv().await {
            let (daemon, child, manifest) = (
                Arc::clone(&daemon),
                Arc::clone(&child),
                Arc::clone(&manifest),
            );
            tokio::spawn(async move {
                let answer = daemon
                    .extensions
                    .call(&daemon, &manifest, &call.path, call.params)
                    .await;
                child.answer(call.id, answer).await;
            });
        }
    }

    /// UA4: a `$.<permission>.<fn>` call of an Extension, refused unless the manifest declares it.
    async fn call(
        &self,
        daemon: &Arc<Daemon>,
        manifest: &Manifest,
        path: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let (permission, function) = path.split_once('.').unwrap_or((path, ""));
        if !manifest
            .permissions
            .iter()
            .any(|declared| declared == permission)
        {
            return Err(RpcError::forbidden(format!(
                "permission `{permission}` is not declared in the manifest rup-extension.json of {}; add it to \"permissions\" to use $.{path}",
                manifest.name
            )));
        }
        match permission {
            "clock" if function == "now" => Ok(json!(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |since| since.as_millis() as u64)
            )),
            "store" => self.store_call(&manifest.name, function, params),
            "agents" | "todos" | "pads" => {
                let namespace = permission.trim_end_matches('s');
                let method = format!("{namespace}.{function}");
                let mut conn = Conn {
                    actor: Actor {
                        kind: ActorKind::Ext,
                        id: format!("ext:{}", manifest.name),
                        parent: None,
                    },
                    peer: None,
                    events: mpsc::unbounded_channel().0,
                    output: None,
                };
                let request =
                    json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
                let actor = conn.actor.clone();
                let reply = daemon
                    .dispatch_parsed(&mut conn, request, Some(actor))
                    .await
                    .map(crate::connection::Frame::into_value)
                    .unwrap_or(Value::Null);
                match reply.get("error") {
                    Some(error) => Err(serde_json::from_value(error.clone())
                        .unwrap_or_else(|_| RpcError::internal("the call failed"))),
                    None => Ok(reply.get("result").cloned().unwrap_or(Value::Null)),
                }
            }
            _ => Err(RpcError::method_not_found(path)),
        }
    }

    /// `$.store.get(key)`, `.set({key, value})`, `.delete(key)`.
    fn store_call(
        &self,
        extension: &str,
        function: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let mut store = self.store.lock().expect("store poisoned");
        let values = store.entry(extension.into()).or_default();
        let key = |params: &Value| {
            params["key"]
                .as_str()
                .or_else(|| params.as_str())
                .map(str::to_owned)
                .ok_or_else(|| RpcError::new(code::INVALID_PARAMS, "$.store needs a key"))
        };
        match function {
            "get" => Ok(values.get(&key(&params)?).cloned().unwrap_or(Value::Null)),
            "set" => {
                values.insert(key(&params)?, params["value"].clone());
                Ok(Value::Null)
            }
            "delete" => Ok(values.remove(&key(&params)?).unwrap_or(Value::Null)),
            _ => Err(RpcError::method_not_found(&format!("store.{function}"))),
        }
    }

    /// Derives the listed User actions from what the Extensions declared (UA3), raising one
    /// problem per rule broken, and announces a change (UA7).
    pub(crate) fn reconcile(&self, daemon: &Daemon, announce: bool) {
        let (problems, changed) = {
            let mut state = self.state.lock().expect("host poisoned");
            let built_in = state.built_in.clone().unwrap_or_default();
            let mut taken: HashMap<String, String> = HashMap::new();
            let mut listed = Vec::new();
            let mut broken = Vec::new();
            for (folder, loaded) in &state.loaded {
                if loaded.live.is_none() {
                    continue;
                }
                for row in &loaded.declared {
                    let rule = if built_in.contains(&row.name) {
                        Some("built-in")
                    } else if taken
                        .get(&row.name)
                        .is_some_and(|owner| *owner != loaded.name)
                    {
                        Some("taken")
                    } else {
                        None
                    };
                    match rule {
                        Some(rule) => broken.push((loaded.name.clone(), row.name.clone(), rule)),
                        None => {
                            taken.insert(row.name.clone(), loaded.name.clone());
                            listed.push((row.clone(), folder.clone()));
                        }
                    }
                }
            }
            let problems: Vec<_> = broken
                .into_iter()
                .filter(|(extension, name, rule)| {
                    state
                        .reported
                        .insert((extension.clone(), name.clone(), rule))
                })
                .collect();
            let changed = listed != state.listed;
            state.listed = listed;
            (problems, changed)
        };
        for (extension, name, rule) in problems {
            let cause = match rule {
                "built-in" => {
                    format!("action {name}: the name is a built-in action's (rule built-in)")
                }
                _ => format!("action {name}: another Extension already declared it (rule taken)"),
            };
            self.problem(daemon, &extension, cause);
        }
        if announce || changed {
            daemon
                .bus
                .emit(Actor::daemon(), EventData::ActionUserChanged);
        }
    }

    /// UA3: the App registered; its names are read and the check runs again.
    pub(crate) fn app_registered(&self) {
        let Some(daemon) = self.daemon.lock().expect("host poisoned").upgrade() else {
            return;
        };
        tokio::spawn(async move {
            if let Ok(rows) = daemon.app_list().await
                && let Ok(rows) = serde_json::from_value::<Vec<ActionRow>>(rows)
            {
                daemon
                    .extensions
                    .built_in(&daemon, rows.into_iter().map(|row| row.name).collect());
            }
        });
    }

    /// The App's names, as it last answered a list; the check of UA3 runs again with them.
    pub(crate) fn built_in(&self, daemon: &Daemon, names: HashSet<String>) {
        let differs = {
            let mut state = self.state.lock().expect("host poisoned");
            let differs = state.built_in.as_ref() != Some(&names);
            state.built_in = Some(names);
            differs
        };
        if differs {
            self.reconcile(daemon, false);
        }
    }

    /// The User actions now listed (UA1).
    pub(crate) fn rows(&self) -> Vec<ActionRow> {
        let state = self.state.lock().expect("host poisoned");
        state.listed.iter().map(|(row, _)| row.clone()).collect()
    }

    /// UA5: runs a listed User action. `None` when `name` is not one, so the App's relay goes on.
    pub(crate) async fn run(
        &self,
        daemon: &Daemon,
        run: &RunParams,
    ) -> Option<Result<Value, RpcError>> {
        let (row, child, extension) = {
            let state = self.state.lock().expect("host poisoned");
            let (row, folder) = state.listed.iter().find(|(row, _)| row.name == run.name)?;
            let loaded = state.loaded.get(folder)?;
            (row.clone(), loaded.live.clone()?, loaded.name.clone())
        };
        Some(self.run_listed(daemon, run, &row, &child, &extension).await)
    }

    async fn run_listed(
        &self,
        daemon: &Daemon,
        run: &RunParams,
        row: &ActionRow,
        child: &Arc<Child>,
        extension: &str,
    ) -> Result<Value, RpcError> {
        let args = check_args(row, run)?;
        let ctx = daemon.ctx(Actor::user());
        ctx.touch(contracts::Verb::Wrote, &format!("action:{}", run.name))?;
        for pair in &run.args {
            ctx.touch(
                contracts::Verb::Wrote,
                &format!("action:{}:{}", run.name, pair.key),
            )?;
        }
        let refusal = |why: String| {
            RpcError::conflict(format!("{} of Extension {extension} {why}", run.name))
        };
        match child
            .run(&run.name, Value::Object(args), self.timeout)
            .await
        {
            Some(Ok(ran)) => {
                if let Some(failure) = &ran.failure {
                    self.problem(daemon, extension, format!("action {}: {failure}", run.name));
                }
                match ran.answer {
                    Some(answer) if answer.get("deny").is_some() => Err(RpcError::conflict(
                        answer["deny"].as_str().unwrap_or("denied").to_owned(),
                    )),
                    Some(_) => Ok(json!({ "status": "done" })),
                    None => match ran.failure {
                        Some(failure) => Err(refusal(format!("failed: {failure}"))),
                        None => Ok(json!({ "status": "done" })),
                    },
                }
            }
            Some(Err(())) => {
                self.problem(
                    daemon,
                    extension,
                    format!(
                        "action {}: no answer within {} s",
                        run.name,
                        self.timeout.as_secs_f32()
                    ),
                );
                Err(refusal("did not answer in time".into()))
            }
            None => {
                self.problem(
                    daemon,
                    extension,
                    format!("action {}: the process exited during the run", run.name),
                );
                Err(refusal("failed: its process exited".into()))
            }
        }
    }
}

/// The rows an Extension's `register` declared, with a cause for each declaration that is not one
/// (UA3's `pattern`, a malformed argument).
fn declared_rows(actions: &[Value]) -> (Vec<ActionRow>, Vec<String>) {
    let mut rows: Vec<ActionRow> = Vec::new();
    let mut causes = Vec::new();
    for spec in actions {
        let name = spec["name"].as_str().unwrap_or_default();
        if !valid_name(name) {
            causes.push(format!(
                "action {name}: the name must be lowercase noun.verb (rule pattern)"
            ));
            continue;
        }
        let args: Vec<ActionArg> = match spec.get("args").cloned() {
            None | Some(Value::Null) => Vec::new(),
            Some(args) => match serde_json::from_value(args) {
                Ok(args) => args,
                Err(err) => {
                    causes.push(format!("action {name}: its args are not valid: {err}"));
                    continue;
                }
            },
        };
        if rows.iter().any(|row| row.name == name) {
            continue;
        }
        rows.push(ActionRow {
            name: name.into(),
            label: spec["label"].as_str().unwrap_or(name).into(),
            keys: String::new(),
            args,
            available: true,
            cause: None,
            source: Some("user".into()),
        });
    }
    (rows, causes)
}

/// NA1's pattern: `noun.verb`, each lowercase words joined by `-`.
fn valid_name(name: &str) -> bool {
    let word = |part: &str| {
        !part.is_empty()
            && part
                .split('-')
                .all(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase()))
    };
    name.split_once('.')
        .is_some_and(|(noun, verb)| word(noun) && word(verb))
}

/// NA3: the arguments the hook sees, typed, or `INVALID_PARAMS` naming the one that is wrong.
fn check_args(row: &ActionRow, run: &RunParams) -> Result<Map<String, Value>, RpcError> {
    let invalid = |message: String| RpcError::new(code::INVALID_PARAMS, message);
    let mut args = Map::new();
    for pair in &run.args {
        let Some(arg) = row.args.iter().find(|arg| arg.key == pair.key) else {
            let known: Vec<_> = row.args.iter().map(|arg| arg.key.as_str()).collect();
            return Err(invalid(format!(
                "unknown argument \"{}\" for {}; its arguments: {}",
                pair.key,
                row.name,
                if known.is_empty() {
                    "none".into()
                } else {
                    known.join(", ")
                }
            )));
        };
        let value = match arg.kind {
            ArgType::String => json!(pair.value),
            ArgType::Integer => {
                let number: i64 = pair.value.parse().map_err(|_| {
                    invalid(format!(
                        "argument \"{}\" must be an integer, not \"{}\"",
                        arg.key, pair.value
                    ))
                })?;
                if arg.min.is_some_and(|min| number < min)
                    || arg.max.is_some_and(|max| number > max)
                {
                    return Err(invalid(format!(
                        "argument \"{}\" is out of bounds ({}..{})",
                        arg.key,
                        arg.min.map_or("-∞".into(), |n| n.to_string()),
                        arg.max.map_or("∞".into(), |n| n.to_string())
                    )));
                }
                json!(number)
            }
            ArgType::Boolean => match pair.value.as_str() {
                "true" => json!(true),
                "false" => json!(false),
                other => {
                    return Err(invalid(format!(
                        "argument \"{}\" must be true or false, not \"{other}\"",
                        arg.key
                    )));
                }
            },
            ArgType::Choice => {
                let options = arg.options.clone().unwrap_or_default();
                if !options.contains(&pair.value) {
                    return Err(invalid(format!(
                        "argument \"{}\" must be one of {}, not \"{}\"",
                        arg.key,
                        options.join(", "),
                        pair.value
                    )));
                }
                json!(pair.value)
            }
        };
        args.insert(arg.key.clone(), value);
    }
    if let Some(missing) = row
        .args
        .iter()
        .find(|arg| arg.required && !args.contains_key(&arg.key))
    {
        return Err(invalid(format!(
            "argument \"{}\" is required for {}",
            missing.key, row.name
        )));
    }
    Ok(args)
}
