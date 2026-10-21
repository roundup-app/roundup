//! The Daemon: every other part of roundup is a client of it.
//! It owns the connection loop, the module router, the event bus and the Provenance log.

mod attachment;
mod builtin;
mod clear;
mod connection;
mod context;
pub mod data;
mod decision_notes;
mod deliverables;
mod digest;
mod event_log;
mod evidence;
mod guards;
mod handshake;
mod link;
mod observers;
mod open;
mod output;
mod owner_told;
mod reaction;
mod reaction_checks;
mod reaction_time;
mod removal;
mod resize;
mod resources;
mod rewind;
mod route;
mod specialist;
mod storage;
mod terminal_question;
mod waits;
mod wake;

pub use handshake::{HANDSHAKE_BOUND, Handshake, HandshakeError, read_handshake};

use connection::failure;
pub use connection::serve;
use guards::is_child_read;
use observers::{
    messages_env, prompt_effect_observer, resume_effect_observer, steer_effect_observer,
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
    modules: HashMap<&'static str, Arc<dyn Module>>,
    bus: Bus,
    todos: Arc<todos::Todos>,
    pads: Arc<pads::Pads>,
    /// B6: spawn publication and its Door-owned first Steer are registered together.
    door_first_steers: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    held_actions: resize::HeldActions,
    /// LC12–LC13: lookup and replacement share one claim, including while a summary is pending.
    specialists: tokio::sync::Mutex<HashMap<(String, String), Specialist>>,
    /// B6: Takeover acquisition excludes in-flight Door effects on this child.
    child_effects: std::sync::Mutex<HashMap<String, std::sync::Weak<tokio::sync::RwLock<()>>>>,
    /// A31: the Project folder, where the Skills of an Agent with no Worktree are read.
    project: std::path::PathBuf,
    /// LK1: the Project's key, the name of its data folder (`data::project_data`).
    project_key: String,
    touches: Arc<Touches>,
    /// B19: which Pads each Door's earlier digests already named.
    digests: Arc<messages::digest::Seen>,
    /// B21, B22: where a push is sent from, once `open` has made it.
    sender: Arc<std::sync::OnceLock<Arc<messages::Messages>>>,
    /// A32: the clears under way, and what they act through.
    clears: clear::Clears,
    /// A35: the Marks a rewind reads, and the rewinds under way.
    checkpoints: Arc<checkpoints::Checkpoints>,
    rewinding: rewind::Rewinding,
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
    /// H21: subscribed at `open`, taken once with `pushes`.
    notes: std::sync::Mutex<Option<tokio::sync::broadcast::Receiver<contracts::Event>>>,
    /// H21: knows the Agent behind a calling process.
    agents: Arc<agents::Agents>,
    /// X14: where a connection's selected output streams come from.
    terminals: Arc<terminal::Terminals>,
    /// A33: like `pushes`, with what keeps the Agents' waits current.
    waits: std::sync::Mutex<Option<Waiter>>,
    /// U419: where `attachment.save` keeps a pasted image.
    attachments: attachment::Attachments,
    /// D8: samples only inside `project.resources`.
    resources: resources::Sampler,
    publications: deliverables::Publications,
    reactions: Arc<reaction::Reactions>,
    /// B6's isolated observer pauses a Door action or guarded call before its effect; absent in production.
    prompt_effect_gate: Option<std::path::PathBuf>,
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
    events: mpsc::UnboundedSender<Value>,
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

    /// Observe future events directly on this Daemon's global Bus, with its retained-event
    /// capacity. The caller controls reads: falling behind returns Tokio's structured
    /// `RecvError::Lagged`, without pausing producers or other subscribers. No forwarding
    /// queue is created. Dropping the receiver detaches only this observer.
    pub fn subscribe(&self) -> (tokio::sync::broadcast::Receiver<contracts::Event>, usize) {
        (self.bus.subscribe(), self.bus.capacity())
    }

    /// Stop every running Terminal's program, Agents' included, and return once none is running.
    /// Each Agent's Claude Code is first asked to end itself, so Claude Code counts the end as a
    /// clean one. A program that ignores SIGHUP is killed by the Terminal module's own escalation. A
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
mod tests;

#[cfg(test)]
mod import_tests;

#[cfg(test)]
mod workstream_door;

#[cfg(test)]
mod concurrent_tests;

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
    Daemon::open_stores(dir, dir, None, configure)
}
