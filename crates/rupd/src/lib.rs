//! The Daemon: every other part of roundup is a client of it.
//! It owns the connection loop, the module router, the event bus and the Provenance log.

#![cfg_attr(test, allow(clippy::disallowed_methods, clippy::disallowed_types))]
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::indexing_slicing
    )
)]

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
#[cfg(test)]
mod dcl5_tests;
mod deliverables;
#[cfg(test)]
mod describe_tests;
mod digest;
mod event_log;
mod evidence;
mod extensions;
mod facts;
mod feedback;
mod field;
mod fork;
#[cfg(test)]
mod fork_tests;
mod github;
#[cfg(test)]
mod group_tests;
mod link;
mod machines;
#[cfg(test)]
mod naming_tests;
mod observers;
mod open;
mod output;
mod owner_told;
mod pr_checks;
mod program_status;
mod queue;
mod rail_index;
mod removal;
mod resources;
mod restart;
mod resume;
mod route;
mod selectors;
mod settlement;
pub mod skill;
mod specialist;
#[cfg(test)]
mod storage_tests;
#[cfg(test)]
mod u6243_tests;

mod resume_turn;
mod rewind;
mod todo_refs;
mod waits;
mod wake;
mod workstream_state;

use connection::{Frame, failure};
pub use connection::{accept, serve};
pub use observers::Observers;
use observers::{
    messages_env, overview_read_observer, resume_effect_observer, steer_effect_observer,
    terminal_exit_observer, terminal_input_observer,
};
pub use open::Watchers;
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
    naming: Arc<parking_lot::Mutex<rusqlite::Connection>>,
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
    /// FK5977: this Project's data folder, `<data>/projects/<key>`.
    data_dir: std::path::PathBuf,
    /// U6044a: the colour `fork.json` names, read once at open.
    fork_colour: Option<contracts::data::ForkColour>,
    touches: Arc<Touches>,
    /// B19: which Pads each Door's earlier digests already named.
    digests: Arc<messages::digest::Seen>,
    /// B21, B22: where a push is sent from, once `open` has made it.
    sender: Arc<std::sync::OnceLock<Arc<messages::Messages>>>,
    restarting: tokio::sync::Mutex<()>,
    /// A3196: what the Workstream Queue remembers between passes.
    queue: Arc<queue::Memory>,
    auto: auto::Auto,
    /// U6243a: the derived Rail values last told, shared with the watcher that tells them.
    rail_told: Arc<workstream_state::Tell>,
    observers: Observers,
    /// B41: serialises the decisions on Wake requests.
    wake_gate: Arc<tokio::sync::Mutex<wake::Gate>>,
    /// H21: knows the Agent behind a calling process.
    agents: Arc<agents::Agents>,
    /// Where the Daemon reads the Rail; the Agents, except in the Messages reply tests.
    rail: Arc<dyn agents::RailRead>,
    /// X14: where a connection's selected output streams come from.
    terminals: Arc<terminal::Terminals>,
    /// PS8: each Terminal's program status.
    program_statuses: Arc<program_status::Statuses>,
    /// D8: samples only inside `project.resources`.
    resources: resources::Sampler,
    publications: deliverables::Publications,
    /// An isolated observer pauses a guarded call before its effect; absent in production.
    prompt_effect_gate: Option<std::path::PathBuf>,
    /// NA6: the App that answers `action.list` and `action.run`.
    actions: actions::Answerer,
    /// UA1: the owner's Extensions, started once the socket is served.
    extensions: extensions::Host,
    /// MC1: how a call reaches herdr-core; a connection opens only when a Machine method asks.
    machine_core: machines::Core,
}

/// What `rail.remove` left dangling.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Orphan {
    /// T13: a Todo whose Home left the Rail.
    TodoHome(u32),
    /// T17: a Todo whose owner Agent left the Rail.
    TodoOwner(u32),
    /// P12: a Pad whose Home left the Rail.
    PadHome(String),
}

/// Every Todo Home, then every Todo owner in id order, then every Pad Home that names a node
/// not on the Rail.
pub(crate) fn orphans(
    rail: &[contracts::agent::RailNode],
    todos: &[contracts::todo::Todo],
    pads: &[contracts::pad::Pad],
) -> Vec<Orphan> {
    let on_rail: std::collections::HashSet<&str> =
        rail.iter().map(|node| node.id.as_str()).collect();
    let gone = |id: &String| !on_rail.contains(id.as_str());
    let mut out: Vec<Orphan> = todos
        .iter()
        .filter(|todo| todo.home.as_ref().is_some_and(gone))
        .map(|todo| Orphan::TodoHome(todo.id))
        .collect();
    let mut owners: Vec<u32> = todos
        .iter()
        .filter(|todo| {
            todo.owner
                .as_ref()
                .is_some_and(|owner| owner.kind == ActorKind::Agent && gone(&owner.id))
        })
        .map(|todo| todo.id)
        .collect();
    owners.sort_unstable();
    out.extend(owners.into_iter().map(Orphan::TodoOwner));
    out.extend(
        pads.iter()
            .filter(|pad| pad.home.as_ref().is_some_and(gone))
            .map(|pad| Orphan::PadHome(pad.name.clone())),
    );
    out
}

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
    /// T13, T17, P12: after `rail.remove`, the Todos and Pads it orphaned are put right, in the
    /// order `orphans` lists them.
    async fn reset_orphans(&self) -> Result<(), RpcError> {
        let rail = self.rail().await?;
        let todos = self.todos.list_all()?;
        let pads = self.pads.list_all()?;
        let ctx = self.ctx(Actor::daemon());
        for orphan in orphans(&rail, &todos, &pads) {
            match orphan {
                Orphan::TodoHome(id) => {
                    self.todos.set_home(&ctx, id, None).await?;
                }
                Orphan::TodoOwner(id) => {
                    self.todos.set_owner(&ctx, id, None).await?;
                }
                Orphan::PadHome(name) => {
                    self.pads.set_home(&ctx, &name, None).await?;
                }
            }
        }
        Ok(())
    }

    /// D8: the Resource use of every running Agent and the Project's total. The Rail is read as
    /// the Daemon, so the call changes nothing and logs no Touch.
    async fn project_resources(
        &self,
        _conn: &mut Conn,
    ) -> Result<contracts::project::Resources, RpcError> {
        let worktrees = self
            .rail()
            .await?
            .into_iter()
            .filter_map(|node| Some((node.id, std::path::PathBuf::from(node.worktree?.path))))
            .collect();
        let running = self.agents.running_programs();
        Ok(self.resources.sample(&running, &worktrees).await)
    }

    async fn rail(&self) -> Result<Vec<contracts::agent::RailNode>, RpcError> {
        self.rail.tree()
    }

    /// E2, E3: the Context of an Agent, or its Brief. The Rail and the Todos are read as the
    /// Daemon, so the call changes nothing and logs no Touch.
    async fn awareness(
        &self,
        conn: &Conn,
        NodeId { id }: NodeId,
    ) -> Result<(contracts::agent::Context, Vec<contracts::agent::RailNode>), RpcError> {
        let nodes = self.rail().await?;
        let todos = self.todos.list_all()?;
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
        Ok((context, nodes))
    }

    async fn agent_context(
        &self,
        conn: &mut Conn,
        id: NodeId,
    ) -> Result<contracts::agent::Context, RpcError> {
        Ok(self.awareness(conn, id).await?.0)
    }

    async fn agent_brief(
        &self,
        conn: &mut Conn,
        id: NodeId,
    ) -> Result<contracts::agent::Brief, RpcError> {
        let NodeId { id } = id;
        let (context, nodes) = self.awareness(conn, NodeId { id: id.clone() }).await?;
        let settings = data::read_naming(&self.naming.lock()).map_err(RpcError::internal)?;
        let text = context::naming(
            context::text(&nodes, &context),
            &settings,
            self.agents.naming_settled(&id),
            self.agents.user_named(&id),
            nodes
                .iter()
                .any(|node| node.id == id && node.kind == contracts::agent::NodeKind::Workstream),
        );
        Ok(contracts::agent::Brief {
            stdout: agents::claude_code::session_start_context(&text),
        })
    }

    /// A31: the Skills of an Agent, or of a Workstream's Door, read from the vendor's folders at
    /// each call. The Rail is read as the Daemon, so the call changes nothing and logs no Touch.
    async fn agent_skills(
        &self,
        _conn: &mut Conn,
        NodeId { id }: NodeId,
    ) -> Result<contracts::agent::Skills, RpcError> {
        let node = self
            .rail()
            .await?
            .into_iter()
            .find(|node| node.id == id)
            .ok_or_else(|| RpcError::not_found("an Agent that is gone"))?;
        let cwd = node
            .worktree
            .map_or_else(|| self.project.clone(), |tree| tree.path.into());
        let home = self.observers.home.clone().unwrap_or_default();
        let skills = agents::claude_code::skills(&home, &cwd, &self.project);
        Ok(contracts::agent::Skills { skills })
    }

    /// B19, B20: the digest of a Door's children. Everything is read as the user or the
    /// Daemon, so the call changes nothing and logs no Touch.
    async fn agent_digest(
        &self,
        conn: &mut Conn,
        NodeId { id }: NodeId,
    ) -> Result<contracts::agent::Digest, RpcError> {
        let world = self.reader().world().await?;
        Ok(self.digests.ask(&conn.actor, &id, &world.sources())?)
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
mod dcl2_tests;
#[cfg(test)]
mod todo_deletion_tests;

// N7: keep in-process test launches at the audited composition root. Callers own
// the temporary data directory and must never fall back to the user's data.
#[cfg(test)]
fn test_daemon(dir: &Path) -> Result<Daemon, OpenError> {
    assert!(dir.is_absolute(), "test data directory must be absolute");
    Daemon::open(dir).map(|(daemon, _)| daemon)
}

#[cfg(test)]
fn test_daemon_with_agents(
    dir: &Path,
    configure: impl FnOnce(agents::Agents) -> agents::Agents,
) -> Result<Daemon, OpenError> {
    assert!(dir.is_absolute(), "test data directory must be absolute");
    Daemon::open_stores_idle(dir, dir, configure)
}

/// Process-free domain fixture, using the existing lifecycle and inbox traits.
#[cfg(any(test, feature = "test-support"))]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
pub mod test_support {
    use super::*;
    use async_trait::async_trait;
    use contracts::agent::{Inbox, RailNode};
    use contracts::{Kind, Status};
    use parking_lot::Mutex;

    #[derive(Default)]
    pub struct ReplyState {
        bus: Bus,
        pub messages: std::sync::OnceLock<std::sync::Weak<messages::Messages>>,
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
                "rail.tree" => rpc::reply(&*self.nodes.lock()),
                "agent.channelUp" => Ok(Value::Null),
                "terminal.write" => {
                    *self.terminal_writes.lock() += 1;
                    Ok(Value::Null)
                }
                _ => Err(RpcError::method_not_found(method)),
            }
        }
    }
    #[async_trait]
    impl agents::RailRead for ReplyState {
        fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
            Ok(self.nodes.lock().clone())
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
            self.entries.lock().extend(
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
            let mut nodes = self.nodes.lock();
            let node = nodes.iter_mut().find(|n| n.id == id).unwrap();
            node.status = Some(Status {
                kind,
                label: String::new(),
                since: 0,
                finished: "0".into(),
            });
            node.status_revision = node.status_revision.as_ref().unwrap().next();
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

    /// A Daemon over `data` whose Agents launch `launcher` and read `clock` for stall timing.
    pub fn daemon_with_clock(
        project: &Path,
        data: &Path,
        launcher: agents::claude_code::Launcher,
        clock: impl Fn() -> i64 + Send + Sync + 'static,
    ) -> (Daemon, Watchers) {
        assert!(data.is_absolute(), "test data directory must be absolute");
        Daemon::open_stores(project, data, Observers::default(), |_| {
            let bus = Bus::new();
            let terminals = Arc::new(terminal::Terminals::open(data, bus.clone()).unwrap());
            agents::Agents::open_in(
                project,
                data,
                bus,
                terminals,
                launcher,
                agents::worktree::Git::from_env(),
                agents::Quiet::default().shared(),
            )
            .unwrap()
            .with_clock(clock)
        })
        .unwrap()
    }

    /// Open stores before entering Tokio so background readers see the configured modules.
    pub fn reply_daemon(dir: &Path, door: bool) -> (Daemon, Watchers, Arc<ReplyState>) {
        let (daemon, watchers, state, _) =
            reply_daemon_with(dir, door, Arc::new(|| 1000), Arc::new(|_| Ok(())));
        (daemon, watchers, state)
    }

    /// `reply_daemon` on a chosen Messages clock and fault hook, returning its Messages and
    /// starting no watcher (the caller holds them), so a test runs `push_changes` on them itself. A Project reopened on
    /// the same `dir` keeps its stored accounting.
    pub fn reply_daemon_with(
        dir: &Path,
        door: bool,
        clock: messages::Clock,
        fault: messages::Fault,
    ) -> (Daemon, Watchers, Arc<ReplyState>, Arc<messages::Messages>) {
        let dir = dir.to_path_buf();
        let (mut daemon, watchers) =
            std::thread::spawn(move || Daemon::open_in(&dir, &dir).unwrap())
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
                "INSERT OR IGNORE INTO nodes(id,kind,name,ord) VALUES(?1,?2,?1,0)",
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
            state.nodes.lock().push(node);
        }
        let messages = Arc::new(
            messages::Messages::open_with(
                &daemon.project,
                daemon.bus.clone(),
                state.clone(),
                messages::Env {
                    touches: daemon.touches.clone(),
                    clock,
                    fault,
                },
            )
            .unwrap(),
        );
        messages.set_inbox(state.clone());
        assert!(state.messages.set(Arc::downgrade(&messages)).is_ok());
        messages.listen();
        daemon.register(messages.clone());
        daemon.register(state.clone());
        daemon.rail = state.clone();
        (daemon, watchers, state, messages)
    }
}
