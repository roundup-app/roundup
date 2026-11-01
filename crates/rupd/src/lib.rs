//! The Daemon: every other part of roundup is a client of it.
//! It owns the connection loop, the module router, the event bus and the Provenance log.

mod actions;
mod auto;
#[cfg(test)]
mod auto_tests;
mod builtin;
mod connection;
mod context;
mod contract_handlers;
#[cfg(test)]
mod contract_tests;
pub mod data;
mod deliverables;
#[cfg(test)]
mod describe_tests;
mod digest;
mod event_log;
mod evidence;
mod extensions;
mod github;
mod guards;
mod link;
#[cfg(test)]
mod naming_tests;
mod observers;
mod open;
mod output;
mod owner_told;
mod program_status;
mod queue;
mod reaction;
mod reaction_checks;
mod reaction_time;
mod removal;
mod resources;
mod restart;
mod resume;
mod route;
mod selectors;
pub mod skill;
mod specialist;
mod storage;

mod rewind;
mod todo_refs;
mod waits;
mod wake;

pub use connection::serve;
use connection::{Frame, failure};
use observers::{
    messages_env, overview_read_observer, resume_effect_observer, steer_effect_observer,
    terminal_exit_observer, terminal_input_observer,
};
use route::{HomeOnly, OwnerOnly};
use specialist::Specialist;
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
    naming: Arc<std::sync::Mutex<rusqlite::Connection>>,
    modules: HashMap<&'static str, Arc<dyn Module>>,
    bus: Bus,
    todos: Arc<todos::Todos>,
    pads: Arc<pads::Pads>,
    /// LC12–LC13: lookup and replacement share one claim, including while a summary is pending.
    specialists: tokio::sync::Mutex<HashMap<(String, String), Specialist>>,
    /// A31: the Project folder, where the Skills of an Agent with no Worktree are read.
    project: std::path::PathBuf,
    /// LK1: the Project's key, the name of its data folder (`data::project_data`).
    project_key: String,
    touches: Arc<Touches>,
    /// B19: which Pads each Door's earlier digests already named.
    digests: Arc<messages::digest::Seen>,
    /// B21, B22: where a push is sent from, once `open` has made it.
    sender: Arc<std::sync::OnceLock<Arc<messages::Messages>>>,
    restarting: tokio::sync::Mutex<()>,
    /// A3196: what the Workstream Queue remembers between passes.
    queue: Arc<queue::Memory>,
    auto: auto::Auto,
    /// B21: subscribed at `open`, so no change is missed before the pusher runs; taken once, when
    /// a Tokio runtime is there to run it.
    pushes: std::sync::Mutex<Option<tokio::sync::broadcast::Receiver<contracts::Event>>>,
    /// B2704a: retain committed names even when the live event ring lags.
    renames: std::sync::Mutex<Option<rpc::Subscription>>,
    owner_events: std::sync::Mutex<Option<rpc::Subscription>>,
    /// B41: subscribed at `open`, taken once with `pushes`.
    wake_events: std::sync::Mutex<Option<tokio::sync::broadcast::Receiver<contracts::Event>>>,
    /// B41: serialises the decisions on Wake requests.
    wake_gate: Arc<tokio::sync::Mutex<wake::Gate>>,
    /// H21: knows the Agent behind a calling process.
    agents: Arc<agents::Agents>,
    /// X14: where a connection's selected output streams come from.
    terminals: Arc<terminal::Terminals>,
    /// PS8: each Terminal's program status; the changes are subscribed at `open`, taken once.
    program_statuses: Arc<program_status::Statuses>,
    program_changes:
        std::sync::Mutex<Option<tokio::sync::broadcast::Receiver<Arc<terminal::Change>>>>,
    /// A33: like `pushes`, with what keeps the Agents' waits current.
    waits: std::sync::Mutex<Option<Waiter>>,
    /// D8: samples only inside `project.resources`.
    resources: resources::Sampler,
    publications: deliverables::Publications,
    reactions: Arc<reaction::Reactions>,
    /// An isolated observer pauses a guarded call before its effect; absent in production.
    prompt_effect_gate: Option<std::path::PathBuf>,
    /// NA6: the App that answers `action.list` and `action.run`.
    actions: actions::Answerer,
    /// UA1: the owner's Extensions, started once the socket is served.
    extensions: extensions::Host,
}

type Waiter = (
    tokio::sync::broadcast::Receiver<contracts::Event>,
    Arc<agents::Agents>,
    Arc<todos::Todos>,
);

/// Per-connection state.
#[derive(Clone)]
pub struct Conn {
    actor: Actor,
    /// H21: the pid of the process on the other end, as the OS reports it.
    peer: Option<u32>,
    events: mpsc::UnboundedSender<Frame>,
    /// X14: where this connection's selected Terminal output goes; `None` for a call with no socket.
    output: Option<output::Port>,
}

impl Daemon {
    /// T17: after `rail.remove`, each Todo whose owner Agent left the Rail is Unassigned, in id order.
    async fn reset_orphaned_owners(&self) -> Result<(), RpcError> {
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
        let mut orphaned: Vec<u32> = listed
            .into_iter()
            .filter(|todo| {
                todo.owner.as_ref().is_some_and(|owner| {
                    owner.kind == ActorKind::Agent && !rail.contains(&owner.id)
                })
            })
            .map(|todo| todo.id)
            .collect();
        orphaned.sort_unstable();
        for id in orphaned {
            todos
                .call(&ctx, "todo.assign", json!({ "id": id, "owner": null }))
                .await?;
        }
        Ok(())
    }

    /// D8: the Resource use of every running Agent and the Project's total. The Rail is read as
    /// the Daemon, so the call changes nothing and logs no Touch.
    async fn project_resources(&self) -> Result<Value, RpcError> {
        let worktrees = self
            .rail()
            .await?
            .into_iter()
            .filter_map(|node| Some((node.id, std::path::PathBuf::from(node.worktree?.path))))
            .collect();
        let running = self.agents.running_programs();
        rpc::reply(&self.resources.sample(&running, &worktrees).await)
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
                "{} may not read the Context of {}",
                if conn.actor.kind == ActorKind::Agent {
                    self.agents.rail_name(&conn.actor.id)?
                } else {
                    conn.actor.id.clone()
                },
                self.agents.rail_name(&id)?
            )));
        }
        match method {
            "agent.context" => rpc::reply(&context),
            _ => {
                let settings =
                    data::read_naming(&self.naming.lock().expect("naming preferences poisoned"))
                        .map_err(RpcError::internal)?;
                let text = context::naming(
                    context::text(&nodes, &context),
                    &settings,
                    self.agents.naming_settled(&id),
                );
                rpc::reply(&contracts::agent::Brief {
                    stdout: agents::claude_code::session_start_context(&text),
                })
            }
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
            .find(|node| node.id == id)
            .ok_or_else(|| RpcError::not_found("an Agent that is gone"))?;
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

    /// Loads Extensions from `dir` instead of the Daemon's own default (UA1).
    #[must_use]
    pub fn with_extensions(mut self, dir: &Path) -> Self {
        self.extensions = extensions::Host::new(dir.to_path_buf());
        self
    }

    /// Observe future events directly on this Daemon's global Bus, with its retained-event
    /// capacity. The caller controls reads: falling behind returns Tokio's structured
    /// `RecvError::Lagged`, without pausing producers or other subscribers. No forwarding
    /// queue is created. Dropping the receiver detaches only this observer.
    pub fn subscribe(&self) -> (tokio::sync::broadcast::Receiver<contracts::Event>, usize) {
        (self.bus.subscribe(), self.bus.capacity())
    }

    /// Stop every running Terminal's program, Agents' included, and return once none is running.
    /// Each Agent's Claude Code is first asked to end itself, so Claude Code counts the end as a
    /// clean one. A program that ignores SIGHUP is killed by the Terminal module's own kill step. A
    /// Terminal spawned while this runs is caught by the next round, up to [`STOP_ROUNDS`]; past
    /// that the caller gets an error rather than a loop that never ends.
    pub async fn stop_terminals(&self) -> Result<(), RpcError> {
        if let Err(err) = self.agents.exit_running().await {
            eprintln!(
                "rupd: could not end Agents through their own exit: {}",
                err.message
            );
        }
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

#[cfg(test)]
mod actions_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod import_tests;

#[cfg(test)]
mod vendor_list_tests;

#[cfg(test)]
mod workstream_door;

#[cfg(test)]
mod concurrent_tests;
#[cfg(test)]
mod todo_deletion_tests;

// N7: keep in-process test launches at the audited composition root. Callers own
// the temporary data directory and must never fall back to the user's data.
#[cfg(test)]
fn test_daemon(dir: &Path) -> Result<Daemon, OpenError> {
    assert!(dir.is_absolute(), "test data directory must be absolute");
    Daemon::open(dir)
}

#[cfg(test)]
fn test_daemon_with_agents(
    dir: &Path,
    configure: impl FnOnce(agents::Agents) -> agents::Agents,
) -> Result<Daemon, OpenError> {
    assert!(dir.is_absolute(), "test data directory must be absolute");
    Daemon::open_stores(dir, dir, configure)
}

/// Process-free domain fixture, using the existing lifecycle and inbox traits.
#[cfg(feature = "test-support")]
pub mod test_support {
    use super::*;
    use async_trait::async_trait;
    use contracts::agent::{Inbox, RailNode};
    use contracts::{Kind, Status};
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct ReplyState {
        bus: Bus,
        pub nodes: Mutex<Vec<RailNode>>,
        pub entries: Mutex<Vec<(String, u32, String, String)>>,
        pub written: tokio::sync::Notify,
        pub terminal_writes: Mutex<usize>,
    }

    #[async_trait]
    impl Module for ReplyState {
        fn namespaces(&self) -> &'static [&'static str] {
            &["rail", "agent", "terminal"]
        }
        async fn call(&self, _: &Ctx, method: &str, _: Value) -> Result<Value, RpcError> {
            match method {
                "rail.tree" => rpc::reply(&*self.nodes.lock().unwrap()),
                "agent.channelUp" => Ok(Value::Null),
                "terminal.write" => {
                    *self.terminal_writes.lock().unwrap() += 1;
                    Ok(Value::Null)
                }
                _ => Err(RpcError::method_not_found(method)),
            }
        }
    }
    #[async_trait]
    impl messages::NoteInbox for ReplyState {
        async fn check(&self, _: &str) -> Inbox {
            Inbox::Ok
        }
        fn write(
            &self,
            id: &str,
            notes: &[agents::claude_code::inbox::Entry],
        ) -> Result<(), Inbox> {
            self.entries.lock().unwrap().extend(
                notes
                    .iter()
                    .map(|n| (id.into(), n.id, n.from.clone(), n.text.clone())),
            );
            self.written.notify_one();
            Ok(())
        }
    }
    impl ReplyState {
        pub fn status(&self, id: &str, kind: Kind) {
            let mut nodes = self.nodes.lock().unwrap();
            let node = nodes.iter_mut().find(|n| n.id == id).unwrap();
            node.status = Some(Status {
                kind,
                label: String::new(),
                since: 0,
                finished: "0".into(),
            });
            node.status_revision = Some(
                (node
                    .status_revision
                    .as_ref()
                    .unwrap()
                    .parse::<u64>()
                    .unwrap()
                    + 1)
                .to_string(),
            );
            let event = contracts::agent::StatusEvent {
                ended: false,
                id: id.into(),
                attempt: node.attempt.clone().unwrap(),
                status_revision: node.status_revision.clone().unwrap(),
                status: node.status.clone().unwrap(),
            };
            drop(nodes);
            self.bus.emit(
                Actor::daemon(),
                contracts::EventData::AgentStatus(Box::new(event)),
            );
        }
    }

    /// Open stores before entering Tokio so background readers see the configured modules.
    pub fn reply_daemon(dir: &Path, door: bool) -> (Daemon, Arc<ReplyState>) {
        let dir = dir.to_path_buf();
        let mut daemon = std::thread::spawn(move || Daemon::open_in(&dir, &dir).unwrap())
            .join()
            .unwrap();
        let state = Arc::new(ReplyState {
            bus: daemon.bus.clone(),
            ..Default::default()
        });
        for id in ["1", "2"] {
            let node: RailNode = serde_json::from_value(json!({
            "id":id,"kind":if door && id == "1" {"workstream"} else {"agent"},"name":id,"parent":null,"order":0,
            "status":{"kind":"working","label":"","since":0,"finished":"0"},"attempt":"1","status_revision":"1",
            "terminal_id":format!("t-{id}"),"worktree":null,"can_resume":false,"yolo":false,
            "channel":null,"stray":[],"model":null,"effort":null,"work":null,"auto":false
        })).unwrap();
            // Publication authorization reads maker identity from the authoritative Project store.
            let db = rusqlite::Connection::open(daemon.project.join("project.db")).unwrap();
            db.execute(
                "INSERT INTO nodes(id,kind,name,ord) VALUES(?1,?2,?1,0)",
                rusqlite::params![
                    id,
                    if door && id == "1" {
                        "workstream"
                    } else {
                        "agent"
                    }
                ],
            )
            .unwrap();
            state.nodes.lock().unwrap().push(node);
        }
        let messages = Arc::new(
            messages::Messages::open_with(
                &daemon.project,
                daemon.bus.clone(),
                state.clone(),
                messages::Env {
                    touches: daemon.touches.clone(),
                    clock: Arc::new(|| 1000),
                    fault: Arc::new(|_| Ok(())),
                },
            )
            .unwrap(),
        );
        messages.set_inbox(state.clone());
        daemon.register(messages);
        daemon.register(state.clone());
        daemon.start_pushes();
        (daemon, state)
    }
}
