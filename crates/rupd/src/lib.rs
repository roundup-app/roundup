//! The Daemon: every other part of roundup is a client of it.
//! It owns the connection loop, the module router, the event bus and the Provenance log.

mod builtin;
mod context;
pub mod data;
mod digest;
mod handshake;
mod scribe;
mod waits;

pub use handshake::{HANDSHAKE_BOUND, Handshake, HandshakeError, read_handshake};

use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::Arc;

use contracts::agent::NodeId;
use contracts::terminal::TerminalInfo;
use contracts::{Actor, ActorKind};
use provenance::Touches;
use rpc::{Bus, Ctx, Module, OpenError, RpcError, code};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

/// How many list-and-kill rounds shutdown makes before it gives up on a stream of new Terminals.
const STOP_ROUNDS: usize = 5;

pub struct Daemon {
    modules: HashMap<&'static str, Arc<dyn Module>>,
    bus: Bus,
    /// A31: the Project folder, where the Skills of an Agent with no Worktree are read.
    project: std::path::PathBuf,
    touches: Arc<Touches>,
    /// B19: which Pads each Door's earlier digests already named.
    digests: Arc<messages::digest::Seen>,
    /// B21, B22: where a push is sent from, once `open` has made it.
    sender: Arc<std::sync::OnceLock<Arc<messages::Messages>>>,
    /// B21: subscribed at `open`, so no change is missed before the pusher runs; taken once, when
    /// a Tokio runtime is there to run it.
    pushes: std::sync::Mutex<Option<tokio::sync::broadcast::Receiver<contracts::Event>>>,
    /// P11: what `pad.ask` reaches.
    scribing: scribe::Scribing,
    /// A33: like `pushes`, with what keeps the Agents' waits current.
    waits: std::sync::Mutex<Option<Waiter>>,
}

type Waiter = (
    tokio::sync::broadcast::Receiver<contracts::Event>,
    Arc<agents::Agents>,
    Arc<todos::Todos>,
);

/// A34: the Todos and Pads a Workstream is Home to, read before it is removed.
struct Held {
    todos: Vec<contracts::todo::Todo>,
    pads: Vec<contracts::pad::Pad>,
}

/// Per-connection state.
pub struct Conn {
    actor: Actor,
    events: mpsc::UnboundedSender<Value>,
}

impl Daemon {
    /// `dir` is the Project's data folder (N1); it is created if missing. The Project folder is
    /// taken as its parent.
    pub fn open(dir: &Path) -> Result<Self, OpenError> {
        Self::open_with_proof(dir, None)
    }

    /// Open `project`, keeping its data in `data` (N1) after moving an older Project's files
    /// there (N3).
    pub fn open_project(
        project: &Path,
        data: &Path,
        proof: Option<String>,
    ) -> Result<Self, OpenError> {
        let dir = data::project_data(data, project)?;
        data::migrate(project, &dir).map_err(OpenError::from)?;
        Self::open_in(project, &dir, proof)
    }

    /// Like `open`, with the `proof` an attached App handed over (H4, H18); without one every
    /// `decision.answer` is `FORBIDDEN`.
    pub fn open_with_proof(dir: &Path, proof: Option<String>) -> Result<Self, OpenError> {
        Self::open_in(dir.parent().unwrap_or(dir), dir, proof)
    }

    fn open_in(project: &Path, dir: &Path, proof: Option<String>) -> Result<Self, OpenError> {
        std::fs::create_dir_all(dir)?;
        let bus = Bus::new();
        let terminals = Arc::new(terminal::Terminals::open_with(
            dir,
            bus.clone(),
            &agents::claude_code::MARKERS,
        )?);
        // O4: the Agents ask whether a Takeover is active before they Steer a changed order; the
        // Messages that know are made after them.
        let messages = Arc::new(std::sync::OnceLock::<Arc<messages::Messages>>::new());
        let probe = Arc::clone(&messages);
        let pad_probe = Arc::new(std::sync::OnceLock::<Arc<pads::Pads>>::new());
        let scribes = Arc::clone(&pad_probe);
        let agents = Arc::new(
            agents::Agents::open(project, dir, bus.clone(), Arc::clone(&terminals))?
                .with_proof(proof)
                .with_scribes(move |agent| {
                    scribes
                        .get()
                        .and_then(|pads| pads.scribed_by(agent).ok().flatten())
                })
                .with_takeover(move |agent| {
                    probe
                        .get()
                        .is_some_and(|messages| messages.takeover_active(agent))
                }),
        );
        let agents_module: Arc<dyn Module> = agents.clone();
        let todos = Arc::new(todos::Todos::open(dir, bus.clone())?);
        let mut daemon = Self {
            modules: HashMap::new(),
            touches: Arc::new(Touches::open(&dir.join("provenance.db"))?),
            bus: bus.clone(),
            project: project.to_path_buf(),
            digests: Arc::new(messages::digest::Seen::open(&dir.join("digest.db"))?),
            sender: Arc::clone(&messages),
            scribing: Default::default(),
            pushes: std::sync::Mutex::new(Some(bus.subscribe())),
            waits: std::sync::Mutex::new(Some((
                bus.subscribe(),
                Arc::clone(&agents),
                Arc::clone(&todos),
            ))),
        };
        daemon.register(todos);
        let pads = Arc::new(pads::Pads::open(dir, bus.clone())?);
        let _ = pad_probe.set(Arc::clone(&pads));
        daemon.scribing.set(Arc::clone(&pads), Arc::clone(&agents));
        daemon.register(pads);
        daemon.register(Arc::new(checkpoints::Checkpoints::open(dir)?));
        // B2: the one function that types a Message is `Agents::prompt` (H11).
        let typist = Arc::clone(&agents);
        let deliver: messages::Deliver = Arc::new(move |id, text| {
            let typist = Arc::clone(&typist);
            Box::pin(async move {
                typist
                    .prompt(&id, &text)
                    .await
                    .map_err(|refused| match refused {
                        agents::PromptError::Busy { .. } => messages::Refusal::Busy,
                        agents::PromptError::NotAccepted { .. } => messages::Refusal::NotAccepted,
                        agents::PromptError::NotFound { .. } => messages::Refusal::NotFound,
                    })
            })
        });
        let opened = Arc::new(messages::Messages::open_with(
            dir,
            bus,
            agents_module,
            deliver,
            messages_env(Arc::clone(&daemon.touches)),
        )?);
        let _ = messages.set(Arc::clone(&opened));
        daemon.register(opened);
        daemon.register(agents);
        daemon.register(terminals);
        daemon.start_pushes();
        Ok(daemon)
    }

    /// B21: start sending children's changes to their Doors, at most once.
    fn start_pushes(&self) {
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        let waiter = self
            .waits
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some((events, agents, todos)) = waiter {
            let (touches, bus) = (Arc::clone(&self.touches), self.bus.clone());
            tokio::spawn(waits::keep(events, agents, move || {
                let ctx = Ctx {
                    actor: Actor::daemon(),
                    bus: bus.clone(),
                    touches: Arc::clone(&touches),
                };
                let todos = Arc::clone(&todos);
                async move {
                    let list = todos.call(&ctx, "todo.list", Value::Null).await.ok()?;
                    serde_json::from_value(list).ok()
                }
            }));
        }
        let events = self
            .pushes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let (Some(events), Some(sender)) = (events, self.sender.get()) {
            tokio::spawn(digest::push_changes(
                self.reader(),
                Arc::clone(sender),
                Arc::clone(&self.digests),
                events,
            ));
        }
    }

    fn reader(&self) -> digest::Reader {
        digest::Reader::new(&self.modules, self.bus.clone(), Arc::clone(&self.touches))
    }

    fn register(&mut self, module: Arc<dyn Module>) {
        for namespace in module.namespaces() {
            self.modules.insert(namespace, Arc::clone(&module));
        }
    }

    /// Answer one request line. Notifications (no `id`) get no answer.
    async fn dispatch(&self, conn: &mut Conn, line: &str) -> Option<Value> {
        let Ok(request) = serde_json::from_str::<Value>(line) else {
            return Some(failure(
                &Value::Null,
                &RpcError::new(code::PARSE_ERROR, "parse error"),
            ));
        };
        let id = request.get("id").cloned();
        let method = request["method"].as_str().unwrap_or_default();
        let params = request.get("params").cloned().unwrap_or(Value::Null);
        let outcome = self.route(conn, method, params).await;
        let id = id?;
        Some(match outcome {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err(err) => failure(&id, &err),
        })
    }

    async fn route(&self, conn: &mut Conn, method: &str, params: Value) -> Result<Value, RpcError> {
        self.start_pushes();
        let namespace = method.split('.').next().unwrap_or_default();
        if matches!(method, "agent.context" | "agent.brief") {
            return self.awareness(conn, method, params).await;
        }
        if method == "pad.ask" {
            return self.pad_ask(&conn.actor, params).await;
        }
        if method == "agent.skills" {
            return self.skills(params).await;
        }
        if method == "checkpoint.write" {
            self.require_door(&conn.actor).await?;
        }
        if method == "agent.digest" {
            return self.digest(conn, params).await;
        }
        if let Some(outcome) = builtin::call(self, conn, namespace, method, &params) {
            return outcome;
        }
        let module = self
            .modules
            .get(namespace)
            .ok_or_else(|| RpcError::method_not_found(method))?;
        if matches!(method, "todo.move" | "pad.move") {
            if method == "pad.move" && conn.actor.kind == ActorKind::Agent {
                return Err(RpcError::forbidden("an Agent may not move a pad"));
            }
            self.require_workstream(&params).await?;
        }
        if method == "terminal.write" && conn.actor.kind == ActorKind::User {
            self.note_user_input(&params).await;
        }
        let held = if method == "rail.remove" {
            self.hold_workstream(&params).await?
        } else {
            None
        };
        let outcome = module
            .call(&self.ctx(conn.actor.clone()), method, params)
            .await;
        if matches!(method, "todo.create" | "pad.create") && conn.actor.kind == ActorKind::Agent {
            return self.home_in_workstream(method, &conn.actor, outcome?).await;
        }
        let mut settled = None;
        if method == "rail.remove" && outcome.is_ok() {
            if let Some(held) = held {
                let mut removal: contracts::agent::Removal =
                    serde_json::from_value(outcome.clone()?).map_err(RpcError::internal)?;
                self.settle_workstream(held, &mut removal).await?;
                settled = Some(removal);
            }
            self.reset_orphaned_homes().await?;
            self.reset_orphaned_pad_homes().await?;
            self.end_orphaned_scribes().await?;
        }
        match settled {
            Some(removal) => rpc::reply(&removal),
            None => outcome,
        }
    }

    /// B32: the user's bytes are counted before they reach the Terminal, so a Message checked
    /// after they arrive finds them. A call that is not well formed is left to the Terminal's own error.
    async fn note_user_input(&self, params: &Value) {
        use base64::Engine as _;
        let (Some(messages), Some(id), Some(data)) = (
            self.sender.get(),
            params["id"].as_str(),
            params["data"].as_str(),
        ) else {
            return;
        };
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) {
            messages.user_wrote(id, &bytes).await;
        }
    }

    /// T14, P12: a Todo or Pad an Agent just created gets the nearest Workstream at or above that Agent as its Home.
    async fn home_in_workstream(
        &self,
        method: &str,
        actor: &Actor,
        created: Value,
    ) -> Result<Value, RpcError> {
        let (namespace, move_method, key) = match method {
            "pad.create" => ("pad", "pad.move", "name"),
            _ => ("todo", "todo.move", "id"),
        };
        let nodes = self.rail().await?;
        let mut at = nodes.iter().find(|node| node.id == actor.id);
        while let Some(node) = at {
            if node.kind == contracts::agent::NodeKind::Workstream {
                let module = self.modules.get(namespace).ok_or_else(|| {
                    RpcError::internal(format!("{namespace} module is not registered"))
                })?;
                let ctx = self.ctx(Actor::daemon());
                return module
                    .call(
                        &ctx,
                        move_method,
                        json!({ key: created[key].clone(), "home": node.id }),
                    )
                    .await;
            }
            at = node
                .parent
                .as_ref()
                .and_then(|parent| nodes.iter().find(|n| &n.id == parent));
        }
        Ok(created)
    }

    /// M10: only a Door writes a Checkpoint; a Door is the Agent whose id is a Workstream's.
    async fn require_door(&self, actor: &Actor) -> Result<(), RpcError> {
        let is_door = actor.kind == ActorKind::Agent
            && self.rail().await?.iter().any(|node| {
                node.id == actor.id && node.kind == contracts::agent::NodeKind::Workstream
            });
        if is_door {
            return Ok(());
        }
        Err(RpcError::forbidden(format!(
            "{} is not a Door, so it may not write a Checkpoint",
            actor.id
        )))
    }

    /// T13, P12: a `todo.move` or `pad.move` names a Workstream on the Rail, or the Project root.
    async fn require_workstream(&self, params: &Value) -> Result<(), RpcError> {
        let home: Option<String> = rpc::params::<HomeOnly>(params.clone())?.home;
        let Some(home) = home else { return Ok(()) };
        let nodes = self.rail().await?;
        match nodes.iter().find(|node| node.id == home) {
            None => Err(RpcError::not_found(format!("rail node {home}"))),
            Some(node) if node.kind != contracts::agent::NodeKind::Workstream => {
                Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("rail node {home} is not a Workstream"),
                ))
            }
            Some(_) => Ok(()),
        }
    }

    /// A34: before a Workstream is removed, the Todos and Pads it is Home to are read, so a failed
    /// read changes nothing. `None` when `params` name no Workstream.
    async fn hold_workstream(&self, params: &Value) -> Result<Option<Held>, RpcError> {
        let NodeId { id } = rpc::params(params.clone())?;
        let nodes = self.rail().await?;
        if !nodes
            .iter()
            .any(|node| node.id == id && node.kind == contracts::agent::NodeKind::Workstream)
        {
            return Ok(None);
        }
        let ctx = self.ctx(Actor::daemon());
        let todos = self.modules.get("todo");
        let pads = self.modules.get("pad");
        let (Some(todos), Some(pads)) = (todos, pads) else {
            return Err(RpcError::internal("todo or pad module is not registered"));
        };
        let todos: Vec<contracts::todo::Todo> =
            serde_json::from_value(todos.call(&ctx, "todo.list", Value::Null).await?)
                .map_err(RpcError::internal)?;
        let pads: Vec<contracts::pad::Pad> =
            serde_json::from_value(pads.call(&ctx, "pad.list", Value::Null).await?)
                .map_err(RpcError::internal)?;
        Ok(Some(Held {
            todos: todos
                .into_iter()
                .filter(|todo| todo.home.as_deref() == Some(id.as_str()))
                .collect(),
            pads: pads
                .into_iter()
                .filter(|pad| pad.home.as_deref() == Some(id.as_str()))
                .collect(),
        }))
    }

    /// A34: once the Workstream is gone, its done Todos and the Pads no kept Agent owns are
    /// deleted; its open Todos and the Pads of kept Agents go to the Project root.
    async fn settle_workstream(
        &self,
        held: Held,
        removal: &mut contracts::agent::Removal,
    ) -> Result<(), RpcError> {
        use contracts::agent::{Held as Thing, Kept, Reason, Removed};
        let user = self.ctx(Actor::user());
        let todos = self
            .modules
            .get("todo")
            .ok_or_else(|| RpcError::internal("todo module is not registered"))?;
        let pads = self
            .modules
            .get("pad")
            .ok_or_else(|| RpcError::internal("pad module is not registered"))?;
        for todo in held.todos {
            if todo.done {
                todos
                    .call(&user, "todo.delete", json!({ "id": todo.id }))
                    .await?;
                removal.removed.push(Removed {
                    id: todo.id.to_string(),
                    kind: Thing::Todo,
                    name: todo.title,
                });
            } else {
                todos
                    .call(&user, "todo.move", json!({ "id": todo.id, "home": null }))
                    .await?;
                removal.kept.push(Kept {
                    id: todo.id.to_string(),
                    kind: Thing::Todo,
                    name: todo.title,
                    reason: Reason::Open,
                });
            }
        }
        for pad in held.pads {
            let owner = removal.kept.iter().find(|kept| {
                kept.kind == Thing::Agent
                    && pad.owner.kind == ActorKind::Agent
                    && pad.owner.id == kept.id
            });
            if let Some(owner) = owner {
                let reason = owner.reason;
                pads.call(&user, "pad.move", json!({ "name": pad.name, "home": null }))
                    .await?;
                removal.kept.push(Kept {
                    id: pad.name.clone(),
                    kind: Thing::Pad,
                    name: pad.name,
                    reason,
                });
            } else {
                pads.call(&user, "pad.delete", json!({ "name": pad.name }))
                    .await?;
                removal.removed.push(Removed {
                    id: pad.name.clone(),
                    kind: Thing::Pad,
                    name: pad.name,
                });
            }
        }
        Ok(())
    }

    /// T13: after `rail.remove`, each Todo whose Home left the Rail goes to the Project root, in id order.
    async fn reset_orphaned_homes(&self) -> Result<(), RpcError> {
        let rail: std::collections::HashSet<String> =
            self.rail().await?.into_iter().map(|node| node.id).collect();
        let todos = self
            .modules
            .get("todo")
            .ok_or_else(|| RpcError::internal("todo module is not registered"))?;
        let ctx = self.ctx(Actor::daemon());
        let listed: Vec<contracts::todo::Todo> =
            serde_json::from_value(todos.call(&ctx, "todo.list", Value::Null).await?)
                .map_err(RpcError::internal)?;
        for todo in listed {
            if todo.home.is_some_and(|home| !rail.contains(&home)) {
                todos
                    .call(&ctx, "todo.move", json!({ "id": todo.id, "home": null }))
                    .await?;
            }
        }
        Ok(())
    }

    /// P12: after `rail.remove`, each Pad whose Home left the Rail goes to the Project root, in name order.
    async fn reset_orphaned_pad_homes(&self) -> Result<(), RpcError> {
        let rail: std::collections::HashSet<String> =
            self.rail().await?.into_iter().map(|node| node.id).collect();
        let pads = self
            .modules
            .get("pad")
            .ok_or_else(|| RpcError::internal("pad module is not registered"))?;
        let ctx = self.ctx(Actor::daemon());
        let listed: Vec<contracts::pad::Pad> =
            serde_json::from_value(pads.call(&ctx, "pad.list", Value::Null).await?)
                .map_err(RpcError::internal)?;
        for pad in listed {
            if pad.home.is_some_and(|home| !rail.contains(&home)) {
                pads.call(&ctx, "pad.move", json!({ "name": pad.name, "home": null }))
                    .await?;
            }
        }
        Ok(())
    }

    async fn rail(&self) -> Result<Vec<contracts::agent::RailNode>, RpcError> {
        let rail = self
            .modules
            .get("rail")
            .ok_or_else(|| RpcError::internal("rail module is not registered"))?;
        let tree = rail
            .call(&self.ctx(Actor::daemon()), "rail.tree", Value::Null)
            .await?;
        serde_json::from_value(tree).map_err(RpcError::internal)
    }

    /// E2, E3: the Context of an Agent, or its Brief. The Rail and the Todos are read as the
    /// Daemon, so the call changes nothing and logs no Touch.
    async fn awareness(&self, conn: &Conn, method: &str, params: Value) -> Result<Value, RpcError> {
        let NodeId { id } = rpc::params(params)?;
        let read = |namespace: &'static str, method: &'static str| {
            let module = self
                .modules
                .get(namespace)
                .ok_or_else(|| RpcError::internal(format!("{namespace} module is not registered")));
            let ctx = self.ctx(Actor::daemon());
            async move { module?.call(&ctx, method, Value::Null).await }
        };
        let nodes: Vec<contracts::agent::RailNode> =
            serde_json::from_value(read("rail", "rail.tree").await?).map_err(RpcError::internal)?;
        let todos: Vec<contracts::todo::Todo> =
            serde_json::from_value(read("todo", "todo.list").await?).map_err(RpcError::internal)?;
        let context = context::compose(&nodes, &todos, &id)?;
        let allowed = match conn.actor.kind {
            ActorKind::User => true,
            ActorKind::Agent => conn.actor.id == id,
            ActorKind::Ext => false,
        };
        if !allowed {
            return Err(RpcError::forbidden(format!(
                "{} may not read the Context of agent {id}",
                conn.actor.id
            )));
        }
        match method {
            "agent.context" => rpc::reply(&context),
            _ => rpc::reply(&context::brief(&nodes, &context)),
        }
    }

    /// A31: the Skills of an Agent, or of a Workstream's Door, read from the vendor's folders at
    /// each call. The Rail is read as the Daemon, so the call changes nothing and logs no Touch.
    async fn skills(&self, params: Value) -> Result<Value, RpcError> {
        let NodeId { id } = rpc::params(params)?;
        let node = self
            .rail()
            .await?
            .into_iter()
            .find(|node| node.id == id && node.kind != contracts::agent::NodeKind::Terminal)
            .ok_or_else(|| RpcError::not_found(format!("agent {id}")))?;
        let cwd = node
            .worktree
            .map_or_else(|| self.project.clone(), |tree| tree.path.into());
        let home = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_default();
        let skills = agents::claude_code::skills(&home, &cwd, &self.project);
        rpc::reply(&contracts::agent::Skills { skills })
    }

    /// B19, B20: the digest of a Door's children. Everything is read as the user or the
    /// Daemon, so the call changes nothing and logs no Touch.
    async fn digest(&self, conn: &Conn, params: Value) -> Result<Value, RpcError> {
        let NodeId { id } = rpc::params(params)?;
        let world = self.reader().world().await?;
        rpc::reply(&self.digests.ask(&conn.actor, &id, &world.sources())?)
    }

    fn ctx(&self, actor: Actor) -> Ctx {
        Ctx {
            actor,
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        }
    }

    /// Stop every running Terminal's program, Agents' included, and return once none is running.
    /// A program that ignores SIGHUP is killed by the Terminal module's own escalation. A
    /// Terminal spawned while this runs is caught by the next round, up to [`STOP_ROUNDS`]; past
    /// that the caller gets an error rather than a loop that never ends.
    pub async fn stop_terminals(&self) -> Result<(), RpcError> {
        for _ in 0..STOP_ROUNDS {
            if self.stop_running_terminals().await? == 0 {
                return Ok(());
            }
        }
        Err(RpcError::internal(format!(
            "terminals were still being spawned after {STOP_ROUNDS} rounds of stopping"
        )))
    }

    /// One round: kill every Terminal listed as running, concurrently. Returns how many kills stopped a program; one that had already ended does not count.
    async fn stop_running_terminals(&self) -> Result<usize, RpcError> {
        let terminals = self
            .modules
            .get("terminal")
            .ok_or_else(|| RpcError::internal("terminal module is not registered"))?;
        let listed = terminals
            .call(&self.ctx(Actor::daemon()), "terminal.list", Value::Null)
            .await?;
        let infos: Vec<TerminalInfo> =
            serde_json::from_value(listed).map_err(RpcError::internal)?;
        let mut set = tokio::task::JoinSet::new();
        for info in infos.into_iter().filter(|info| info.running) {
            let terminals = Arc::clone(terminals);
            let ctx = self.ctx(Actor::daemon());
            set.spawn(async move {
                terminals
                    .call(&ctx, "terminal.kill", json!({ "id": info.id }))
                    .await
            });
        }
        let mut stopped = 0;
        while let Some(joined) = set.join_next().await {
            // A program that ended on its own between the list and the kill is already stopped.
            match joined.map_err(RpcError::internal)? {
                Ok(_) => stopped += 1,
                Err(err) if err.code != code::NOT_FOUND => return Err(err),
                Err(_) => {}
            }
        }
        Ok(stopped)
    }
}

fn failure(id: &Value, err: &RpcError) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": err })
}

/// Accept connections until the listener fails.
pub async fn serve(listener: UnixListener, daemon: Arc<Daemon>) -> io::Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let daemon = Arc::clone(&daemon);
        tokio::spawn(async move {
            if let Err(err) = handle(stream, daemon).await {
                eprintln!("rupd: connection failed: {err}");
            }
        });
    }
}

/// The methods whose call is dropped when the caller hangs up: they wait on a process of the
/// caller's, not on the Daemon.
const WAITS_ON_ITS_CALLER: [&str; 2] = ["agent.permission", "agent.ask"];

fn waits_on_its_caller(line: &str) -> bool {
    serde_json::from_str::<Value>(line)
        .ok()
        .and_then(|request| request["method"].as_str().map(str::to_owned))
        .is_some_and(|method| WAITS_ON_ITS_CALLER.contains(&method.as_str()))
}

async fn handle(stream: UnixStream, daemon: Arc<Daemon>) -> io::Result<()> {
    let (read, mut write) = stream.into_split();
    let (frames, mut outbox) = mpsc::unbounded_channel::<Value>();
    let writer = tokio::spawn(async move {
        while let Some(frame) = outbox.recv().await {
            write.write_all(format!("{frame}\n").as_bytes()).await?;
        }
        io::Result::Ok(())
    });
    let mut conn = Conn {
        actor: Actor::user(),
        events: frames.clone(),
    };
    let mut lines = BufReader::new(read).lines();
    // A request read while a call was being watched for a hang-up; handled next.
    let mut pipelined = None;
    loop {
        let line = match pipelined.take() {
            Some(line) => line,
            None => match lines.next_line().await? {
                Some(line) => line,
                None => break,
            },
        };
        let reply = if waits_on_its_caller(&line) {
            // H7: the call waits on the hook's process, and the peer closing is what a No or an
            // Esc looks like from here, so the call is dropped the moment the peer hangs up.
            let call = daemon.dispatch(&mut conn, &line);
            tokio::pin!(call);
            tokio::select! {
                reply = &mut call => reply,
                next = lines.next_line() => match next? {
                    Some(next) => {
                        pipelined = Some(next);
                        call.await
                    }
                    None => break,
                },
            }
        } else {
            daemon.dispatch(&mut conn, &line).await
        };
        if let Some(reply) = reply {
            let _ = frames.send(reply);
        }
    }
    drop(conn);
    drop(frames);
    writer.await.map_err(io::Error::other)?
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn ask(daemon: &Daemon, line: &str) -> Value {
        let (events, _) = mpsc::unbounded_channel();
        let mut conn = Conn {
            actor: Actor::user(),
            events,
        };
        daemon.dispatch(&mut conn, line).await.unwrap()
    }

    fn daemon() -> (tempfile::TempDir, Daemon) {
        let dir = tempfile::tempdir().unwrap();
        let daemon = Daemon::open(dir.path()).unwrap();
        (dir, daemon)
    }

    #[tokio::test]
    async fn ping_answers_pong() {
        let (_dir, daemon) = daemon();
        let reply = ask(
            &daemon,
            r#"{"jsonrpc":"2.0","id":7,"method":"daemon.ping"}"#,
        )
        .await;
        assert_eq!(reply["id"], 7);
        assert_eq!(reply["result"]["pong"], true);
    }

    #[tokio::test]
    async fn unknown_method_is_an_error() {
        let (_dir, daemon) = daemon();
        let reply = ask(
            &daemon,
            r#"{"jsonrpc":"2.0","id":1,"method":"nope.nothing"}"#,
        )
        .await;
        assert_eq!(reply["error"]["code"], code::METHOD_NOT_FOUND);
    }

    struct Echo;

    #[async_trait::async_trait]
    impl Module for Echo {
        fn namespaces(&self) -> &'static [&'static str] {
            &["echo"]
        }

        async fn call(&self, ctx: &Ctx, method: &str, _params: Value) -> Result<Value, RpcError> {
            Ok(json!({ "method": method, "actor": ctx.actor.id }))
        }
    }

    #[tokio::test]
    async fn module_methods_reach_their_module_with_the_callers_actor() {
        let (_dir, mut daemon) = daemon();
        daemon.register(Arc::new(Echo));

        let reply = ask(&daemon, r#"{"jsonrpc":"2.0","id":1,"method":"echo.hello"}"#).await;

        assert_eq!(reply["result"]["method"], "echo.hello");
        assert_eq!(reply["result"]["actor"], "you");
    }

    #[tokio::test]
    async fn subscribers_receive_events_pushed_on_the_same_connection() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = Arc::new(Daemon::open(dir.path()).unwrap());
        let socket = dir.path().join("rupd.sock");
        tokio::spawn(serve(
            UnixListener::bind(&socket).unwrap(),
            Arc::clone(&daemon),
        ));
        let mut client = rpc::Client::connect(&socket).await.unwrap();
        client
            .request("events.subscribe", Value::Null)
            .await
            .unwrap();

        daemon
            .bus
            .emit(Actor::daemon(), contracts::EventData::RailChanged);

        let event = client.next_event().await.unwrap();
        assert_eq!(event.actor, Actor::daemon());
        assert!(matches!(event.data, contracts::EventData::RailChanged));
    }

    /// Lists one running Terminal whose program has already ended, so every kill is `NOT_FOUND`.
    struct SelfEnded;

    #[async_trait::async_trait]
    impl Module for SelfEnded {
        fn namespaces(&self) -> &'static [&'static str] {
            &["terminal"]
        }

        async fn call(&self, _ctx: &Ctx, method: &str, _params: Value) -> Result<Value, RpcError> {
            match method {
                "terminal.list" => Ok(json!([
                    { "id": "1", "cwd": "/", "title": null, "running": true, "exit_code": null }
                ])),
                _ => Err(RpcError::not_found("running terminal 1")),
            }
        }
    }

    #[tokio::test]
    async fn d1_stopping_programs_that_ended_by_themselves_is_not_a_failure() {
        let (_dir, mut daemon) = daemon();
        daemon.register(Arc::new(SelfEnded));

        daemon.stop_terminals().await.unwrap();
    }

    /// The Daemon wires up every module it owns, including `messages` (`scenarios/messages.md`
    /// B5): a real request through `Daemon::open`, not a fake module, must reach it.
    #[tokio::test]
    async fn the_messages_module_is_reachable_through_the_daemon() {
        let (_dir, daemon) = daemon();
        let reply = ask(&daemon, r#"{"jsonrpc":"2.0","id":1,"method":"route.list"}"#).await;
        assert_eq!(reply["result"], json!([]));
    }

    #[tokio::test]
    async fn garbage_is_a_parse_error() {
        let (_dir, daemon) = daemon();
        let reply = ask(&daemon, "{").await;
        assert_eq!(reply["error"]["code"], code::PARSE_ERROR);
    }
    /// Never answers, and says when its call is dropped.
    struct Hangs(tokio::sync::mpsc::UnboundedSender<&'static str>);

    struct Dropped(tokio::sync::mpsc::UnboundedSender<&'static str>);

    impl Drop for Dropped {
        fn drop(&mut self) {
            let _ = self.0.send("dropped");
        }
    }

    #[async_trait::async_trait]
    impl Module for Hangs {
        fn namespaces(&self) -> &'static [&'static str] {
            &["agent", "decision"]
        }

        async fn call(&self, _ctx: &Ctx, _method: &str, _params: Value) -> Result<Value, RpcError> {
            let _dropped = Dropped(self.0.clone());
            std::future::pending().await
        }
    }

    async fn serving_a_module_that_hangs() -> (
        tempfile::TempDir,
        tokio::sync::mpsc::UnboundedReceiver<&'static str>,
        std::path::PathBuf,
    ) {
        let (dir, mut daemon) = daemon();
        let (dropped, seen) = mpsc::unbounded_channel();
        daemon.register(Arc::new(Hangs(dropped)));
        let socket = dir.path().join("rupd.sock");
        tokio::spawn(serve(
            UnixListener::bind(&socket).unwrap(),
            Arc::new(daemon),
        ));
        (dir, seen, socket)
    }

    /// H7(b): the hook's process dying closes its connection, which drops the waiting call.
    #[tokio::test]
    async fn h7_a_hung_up_permission_call_is_dropped() {
        let (_dir, mut dropped, socket) = serving_a_module_that_hangs().await;
        let mut hook = UnixStream::connect(&socket).await.unwrap();
        hook.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"agent.permission\"}\n")
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(
            dropped.try_recv().is_err(),
            "the call waits while the hook is connected"
        );

        drop(hook);

        let seen = tokio::time::timeout(std::time::Duration::from_secs(5), dropped.recv()).await;
        assert_eq!(seen.unwrap(), Some("dropped"));
    }

    /// Any other call is not dropped by a half-close: a client may write its request, shut down
    /// its write side and wait for the reply.
    #[tokio::test]
    async fn a_half_closed_call_that_is_not_a_permission_call_still_runs() {
        let (_dir, mut dropped, socket) = serving_a_module_that_hangs().await;
        let mut client = UnixStream::connect(&socket).await.unwrap();
        client
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"agent.stop\"}\n")
            .await
            .unwrap();
        client.shutdown().await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        assert!(dropped.try_recv().is_err());
    }
}

#[cfg(test)]
mod workstream_door;

/// `RUPD_MESSAGES_FAULT=<operation>` makes the first such Messages operation fail with an error
/// (B28's observer through a real Daemon).
fn messages_env(touches: Arc<provenance::Touches>) -> messages::Env {
    let mut env = messages::Env::system(touches);
    if let Ok(op) = std::env::var("RUPD_MESSAGES_FAULT") {
        let armed = std::sync::atomic::AtomicBool::new(true);
        env.fault = Arc::new(move |name| {
            if name == op && armed.swap(false, std::sync::atomic::Ordering::SeqCst) {
                Err(format!("injected failure in {name}"))
            } else {
                Ok(())
            }
        });
    }
    env
}

/// The `home` of a `todo.move` or `pad.move`.
#[derive(serde::Deserialize)]
struct HomeOnly {
    home: Option<String>,
}
