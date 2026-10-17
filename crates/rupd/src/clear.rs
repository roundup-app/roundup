//! A32: clearing a Workstream. The Door writes a Handoff, the Todos and Pads it does not keep are
//! archived, the Subagents leave the Rail with their files, and the Door starts its next
//! Iteration from the Handoff.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use contracts::agent::{NodeKind, RailNode};
use contracts::pad::Pad;
use contracts::todo::Todo;
use contracts::workstream::{
    ClearParams, ClearResult, HandoffParams, REASON_MAX, WorkstreamClearFailedEvent,
    WorkstreamClearedEvent,
};
use contracts::{Actor, ActorKind, EventData};
use rpc::{RpcError, code};
use serde_json::{Value, json};
use tokio::sync::oneshot;
use tokio::time::Instant;

use super::Daemon;

/// How long the Door has to write its Handoff.
const HANDOFF_BOUND: Duration = Duration::from_secs(120);

/// What `ROUNDUP_HANDOFF_BOUND_MS` and `ROUNDUP_RESTART_BOUND_MS` hold, for tests that cannot inject a
/// clock.
fn bound_from_env(name: &str, default: Duration) -> Duration {
    std::env::var(name)
        .ok()
        .and_then(|ms| ms.parse().ok())
        .map_or(default, Duration::from_millis)
}

/// What the Door chose to keep.
struct Kept {
    summary: String,
    todos: Vec<u32>,
    pads: Vec<String>,
}

/// A Subagent a clear removed; its files stay.
#[derive(Clone)]
struct Removed {
    id: String,
    name: String,
    worktree: Option<(String, String)>,
}

/// Where a clear stands once the Handoff exists, kept across a failed call so a retry goes on.
#[derive(Clone)]
struct Saved {
    handoff: String,
    kept: Arc<Kept>,
    archive: String,
    iteration: u32,
    removed: Vec<Removed>,
}

/// How a clear begins.
enum Start {
    /// The Door was asked; its Handoff arrives on `rx`.
    Ask {
        text: String,
        rx: oneshot::Receiver<Kept>,
    },
    /// `without_handoff`: the Daemon writes the Handoff.
    Without,
    /// A retry after a failed step.
    Saved(Saved),
}

enum Stage {
    /// The Door has been asked; the Handoff is sent through `tx`.
    Asking(Option<oneshot::Sender<Kept>>),
    Working,
    /// A step failed after the Handoff existed.
    Interrupted(Box<Saved>),
}

pub(crate) struct Clears {
    /// The Daemon itself, set once it serves, so a clear can go on after its call has returned.
    pub(crate) me: OnceLock<Weak<Daemon>>,
    bound: Duration,
    /// How long the restarted Door has to send its `SessionStart`.
    restart_bound: Duration,
    agents: OnceLock<Arc<agents::Agents>>,
    stages: Mutex<HashMap<String, Stage>>,
}

impl Default for Clears {
    fn default() -> Self {
        Self {
            me: OnceLock::new(),
            bound: HANDOFF_BOUND,
            restart_bound: agents::START_DOOR_ACK_BOUND,
            agents: OnceLock::new(),
            stages: Mutex::new(HashMap::new()),
        }
    }
}

impl Clears {
    /// `ROUNDUP_HANDOFF_BOUND_MS` replaces the Handoff bound and `ROUNDUP_RESTART_BOUND_MS` the
    /// restart's.
    pub(crate) fn new(agents: Arc<agents::Agents>) -> Self {
        Self {
            me: OnceLock::new(),
            bound: bound_from_env("ROUNDUP_HANDOFF_BOUND_MS", HANDOFF_BOUND),
            restart_bound: bound_from_env("ROUNDUP_RESTART_BOUND_MS", agents::START_DOOR_ACK_BOUND),
            agents: OnceLock::from(agents),
            stages: Mutex::new(HashMap::new()),
        }
    }

    fn stages(&self) -> std::sync::MutexGuard<'_, HashMap<String, Stage>> {
        self.stages
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// A failed clear and, once the Handoff existed, where a retry goes on.
struct Failure {
    err: RpcError,
    saved: Option<Saved>,
}

impl From<RpcError> for Failure {
    fn from(err: RpcError) -> Self {
        Self { err, saved: None }
    }
}

fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, message)
}

impl Daemon {
    async fn read<T: serde::de::DeserializeOwned>(
        &self,
        namespace: &str,
        method: &str,
    ) -> Result<T, RpcError> {
        let module = self
            .modules
            .get(namespace)
            .ok_or_else(|| RpcError::internal(format!("{namespace} module is not registered")))?;
        let read = module
            .call(&self.ctx(Actor::daemon()), method, Value::Null)
            .await?;
        serde_json::from_value(read).map_err(RpcError::internal)
    }

    /// The user's act: a call on `namespace`'s module as the user, so its Touch and event are the usual ones.
    async fn as_user(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let namespace = method.split('.').next().unwrap_or_default();
        let module = self
            .modules
            .get(namespace)
            .ok_or_else(|| RpcError::internal(format!("{namespace} module is not registered")))?;
        module.call(&self.ctx(Actor::user()), method, params).await
    }

    /// `workstream.clear`: validates, asks the Door and returns `{pending: true}` at once, so no
    /// connection is held while the Door writes. A spawned task waits for the Handoff, applies it
    /// and ends with `workstream.cleared`, or with `workstream.clearFailed` and the state as far
    /// as it got. A second call after a failure that came after the Handoff goes on from there.
    pub(crate) async fn clear(&self, actor: &Actor, params: Value) -> Result<Value, RpcError> {
        let p: ClearParams = rpc::params(params)?;
        if actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user may clear a Workstream"));
        }
        if p.reason.trim().is_empty() || p.reason.chars().count() > REASON_MAX {
            return Err(invalid(format!(
                "reason must be 1 to {REASON_MAX} characters after trimming"
            )));
        }
        let node = self
            .rail()
            .await?
            .into_iter()
            .find(|node| node.id == p.id)
            .ok_or_else(|| RpcError::not_found(format!("rail node {}", p.id)))?;
        if node.kind != NodeKind::Workstream {
            return Err(invalid(format!("rail node {} is not a Workstream", p.id)));
        }
        let me = self
            .clears
            .me
            .get()
            .and_then(Weak::upgrade)
            .ok_or_else(|| RpcError::internal("the Daemon is not serving"))?;
        let saved = {
            let mut stages = self.clears.stages();
            match stages.insert(p.id.clone(), Stage::Working) {
                None => None,
                Some(Stage::Interrupted(saved)) => Some(*saved),
                Some(other) => {
                    stages.insert(p.id.clone(), other);
                    return Err(RpcError::conflict(format!(
                        "a clear of {} is pending",
                        p.id
                    )));
                }
            }
        };
        let start = match saved {
            Some(saved) => Start::Saved(saved),
            None if p.without_handoff == Some(true) => Start::Without,
            None => match self.ask(&p, &node).await {
                Ok(ask) => ask,
                Err(err) => {
                    self.clears.stages().remove(&p.id);
                    return Err(err);
                }
            },
        };
        tokio::spawn(async move { me.finish(p, node, start).await });
        rpc::reply(&ClearResult { pending: true })
    }

    /// The end of a clear: its outcome is the stage kept and the event pushed.
    async fn finish(&self, p: ClearParams, node: RailNode, start: Start) {
        let outcome = self.run_clear(&p, &node, start).await;
        let mut stages = self.clears.stages();
        match outcome {
            Ok(()) => {
                stages.remove(&p.id);
            }
            Err(Failure { err, saved }) => {
                match saved {
                    Some(saved) => stages.insert(p.id.clone(), Stage::Interrupted(Box::new(saved))),
                    None => stages.remove(&p.id),
                };
                drop(stages);
                self.bus.emit(
                    Actor::user(),
                    EventData::WorkstreamClearFailed(WorkstreamClearFailedEvent {
                        id: p.id,
                        code: err.code as i32,
                        message: err.message,
                    }),
                );
            }
        }
    }

    async fn run_clear(
        &self,
        p: &ClearParams,
        node: &RailNode,
        start: Start,
    ) -> Result<(), Failure> {
        let iteration = node.iteration.unwrap_or(1);
        let mut saved = match start {
            Start::Saved(saved) => saved,
            start => {
                let kept = match start {
                    Start::Ask { text, rx } => self.wait(p, &text, rx).await?,
                    _ => Kept {
                        summary: format!(
                            "The user cleared this Workstream: {}\nNo Handoff was written, so every Todo and Pad was archived.",
                            p.reason.trim()
                        ),
                        todos: Vec::new(),
                        pads: Vec::new(),
                    },
                };
                Saved {
                    handoff: String::new(),
                    kept: Arc::new(kept),
                    archive: format!("archive-{iteration}"),
                    iteration,
                    removed: Vec::new(),
                }
            }
        };
        match self.apply(p, &mut saved).await {
            Ok(()) => Ok(()),
            Err(err) => Err(Failure {
                err,
                saved: Some(saved),
            }),
        }
    }

    /// Build the ask and arm the stage for the Handoff.
    async fn ask(&self, p: &ClearParams, node: &RailNode) -> Result<Start, RpcError> {
        if node.terminal_id.is_none() {
            return Err(RpcError::conflict(format!(
                "the Door of {} is not running",
                p.id
            )));
        }
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("messages module is not registered"))?;
        let iteration = node.iteration.unwrap_or(1);
        let own: Vec<String> = messages
            .thread(&p.id)?
            .into_iter()
            .filter(|m| m.from.kind == ActorKind::User && m.iteration == Some(iteration))
            .map(|m| m.body)
            .collect();
        let todos: Vec<Todo> = self.read("todo", "todo.list").await?;
        let pads: Vec<Pad> = self.read("pad", "pad.list").await?;
        let text = ask_text(
            node,
            p.reason.trim(),
            &own,
            todos.iter().filter(|t| t.home.as_deref() == Some(&p.id)),
            pads.iter().filter(|pad| pad.home.as_deref() == Some(&p.id)),
        );
        let (tx, rx) = oneshot::channel();
        self.clears
            .stages()
            .insert(p.id.clone(), Stage::Asking(Some(tx)));
        Ok(Start::Ask { text, rx })
    }

    /// Steer the Door with the ask and wait for its Handoff, within the bound.
    async fn wait(
        &self,
        p: &ClearParams,
        text: &str,
        rx: oneshot::Receiver<Kept>,
    ) -> Result<Kept, Failure> {
        let agents = self
            .clears
            .agents
            .get()
            .ok_or_else(|| RpcError::internal("agents module is not registered"))?;
        let deadline = Instant::now() + self.clears.bound;
        let timeout =
            || RpcError::new(code::NOT_ACKED, format!("no Handoff from {} in time", p.id));
        tokio::time::timeout_at(deadline, agents.prompt(&p.id, text))
            .await
            .map_err(|_| timeout())?
            .map_err(RpcError::from)?;
        match tokio::time::timeout_at(deadline, rx).await {
            Err(_) => Err(timeout().into()),
            Ok(Err(_)) => Err(RpcError::internal("the Handoff was lost").into()),
            Ok(Ok(kept)) => Ok(kept),
        }
    }

    /// Everything after the Handoff exists, in the order of A32.
    async fn apply(&self, p: &ClearParams, saved: &mut Saved) -> Result<(), RpcError> {
        let id = &p.id;
        self.archive(id, saved).await?;
        let nodes = self.rail().await?;
        let mut subagents: Vec<(usize, &RailNode)> = nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Agent)
            .filter_map(|n| depth_under(&nodes, n, id).map(|depth| (depth, n)))
            .collect();
        subagents.sort_by_key(|(depth, _)| std::cmp::Reverse(*depth));
        let agents = self
            .clears
            .agents
            .get()
            .ok_or_else(|| RpcError::internal("agents module is not registered"))?;
        for (_, sub) in subagents {
            agents.retire(Actor::user(), &sub.id).await?;
            saved.removed.push(Removed {
                id: sub.id.clone(),
                name: sub.name.clone(),
                worktree: sub
                    .worktree
                    .as_ref()
                    .map(|tree| (tree.path.clone(), tree.branch.clone())),
            });
        }
        self.hand_pads_to_the_user(id, saved).await?;
        let pads: Vec<Pad> = self.read("pad", "pad.list").await?;
        saved.handoff = handoff_text(
            &saved.kept.summary,
            &saved.removed,
            pads.iter()
                .any(|pad| pad.name == saved.archive)
                .then_some(saved.archive.as_str()),
        );
        agents.stop_door(Actor::user(), id).await?;
        let next = saved.iteration + 1;
        let ctx = self.ctx(Actor::user());
        agents
            .restart_door(
                &ctx,
                id,
                saved.handoff.clone(),
                next,
                self.clears.restart_bound,
            )
            .await?;
        if let Some(messages) = self.sender.get() {
            messages.end_iteration(id)?;
        }
        self.bus.emit(
            Actor::user(),
            EventData::WorkstreamCleared(WorkstreamClearedEvent {
                id: id.clone(),
                iteration: next,
            }),
        );
        self.bus.emit(Actor::user(), EventData::RailChanged);
        Ok(())
    }

    /// Step 1: each Todo and Pad of the Workstream that is not kept goes into the archive Pad,
    /// then is deleted. An item gone is not archived again, so a retry goes on from where it failed.
    async fn archive(&self, id: &str, saved: &Saved) -> Result<(), RpcError> {
        let todos: Vec<Todo> = self.read("todo", "todo.list").await?;
        let pads: Vec<Pad> = self.read("pad", "pad.list").await?;
        let todos: Vec<Todo> = todos
            .into_iter()
            .filter(|t| t.home.as_deref() == Some(id) && !saved.kept.todos.contains(&t.id))
            .collect();
        let pads: Vec<Pad> = pads
            .into_iter()
            .filter(|pad| {
                pad.home.as_deref() == Some(id)
                    && pad.name != saved.archive
                    && !saved.kept.pads.contains(&pad.name)
            })
            .collect();
        if todos.is_empty() && pads.is_empty() {
            return Ok(());
        }
        let name = &saved.archive;
        let listed: Vec<Pad> = self.read("pad", "pad.list").await?;
        if !listed.iter().any(|pad| &pad.name == name) {
            self.as_user("pad.create", json!({"name": name, "text": ""}))
                .await?;
            self.as_user("pad.move", json!({"name": name, "home": id}))
                .await?;
        }
        for todo in todos {
            let section = format!(
                "## {} (todo {}, owner {})\n\n{}\n\n",
                todo.title, todo.id, todo.creator.id, todo.body
            );
            self.as_user("pad.append", json!({"name": name, "text": section}))
                .await?;
            self.as_user("todo.delete", json!({"id": todo.id})).await?;
        }
        for pad in pads {
            let section = format!(
                "## {} (pad, owner {})\n\n{}\n\n",
                pad.name, pad.owner.id, pad.text
            );
            self.as_user("pad.append", json!({"name": name, "text": section}))
                .await?;
            self.as_user("pad.delete", json!({"name": pad.name}))
                .await?;
        }
        Ok(())
    }

    /// A kept Pad owned by a removed Subagent becomes the user's, as `pad.setOwner` does.
    async fn hand_pads_to_the_user(&self, id: &str, saved: &Saved) -> Result<(), RpcError> {
        let gone: HashSet<&str> = saved.removed.iter().map(|r| r.id.as_str()).collect();
        let pads: Vec<Pad> = self.read("pad", "pad.list").await?;
        for pad in pads {
            if pad.home.as_deref() == Some(id) && gone.contains(pad.owner.id.as_str()) {
                self.as_user(
                    "pad.setOwner",
                    json!({"name": pad.name, "owner": Actor::user()}),
                )
                .await?;
            }
        }
        Ok(())
    }

    /// `workstream.handoff`: the Door of a Workstream with a pending clear says what to keep.
    pub(crate) async fn handoff(&self, actor: &Actor, params: Value) -> Result<Value, RpcError> {
        let p: HandoffParams = rpc::params(params)?;
        if actor.kind != ActorKind::Agent || actor.id != p.id {
            return Err(RpcError::forbidden(
                "only the Door of the Workstream may hand off",
            ));
        }
        if !matches!(
            self.clears.stages().get(&p.id),
            Some(Stage::Asking(Some(_)))
        ) {
            return Err(RpcError::conflict(format!(
                "no clear of {} is pending",
                p.id
            )));
        }
        if p.summary.trim().is_empty() {
            return Err(invalid("summary must not be empty"));
        }
        let todos: Vec<Todo> = self.read("todo", "todo.list").await?;
        let pads: Vec<Pad> = self.read("pad", "pad.list").await?;
        let home = Some(p.id.as_str());
        if let Some(bad) = p.keep_todos.iter().find(|id| {
            !todos
                .iter()
                .any(|t| t.id == **id && t.home.as_deref() == home)
        }) {
            return Err(invalid(format!("todo {bad} is not in Workstream {}", p.id)));
        }
        if let Some(bad) = p.keep_pads.iter().find(|name| {
            !pads
                .iter()
                .any(|pad| &pad.name == *name && pad.home.as_deref() == home)
        }) {
            return Err(invalid(format!("pad {bad} is not in Workstream {}", p.id)));
        }
        let sender = match self.clears.stages().get_mut(&p.id) {
            Some(Stage::Asking(tx)) => tx.take(),
            _ => None,
        };
        let sender =
            sender.ok_or_else(|| RpcError::conflict(format!("no clear of {} is pending", p.id)))?;
        sender
            .send(Kept {
                summary: p.summary,
                todos: p.keep_todos,
                pads: p.keep_pads,
            })
            .map_err(|_| RpcError::conflict(format!("the clear of {} ended", p.id)))?;
        Ok(Value::Null)
    }
}

/// How many Agents lie between `node` and the Workstream `root` (1 for a direct child), or `None`
/// when `node` is not under it.
fn depth_under(nodes: &[RailNode], node: &RailNode, root: &str) -> Option<usize> {
    let mut depth = 0;
    let mut at = node;
    loop {
        depth += 1;
        let parent = at.parent.as_deref()?;
        if parent == root {
            return Some(depth);
        }
        at = nodes.iter().find(|n| n.id == parent)?;
    }
}

fn ask_text<'a>(
    node: &RailNode,
    reason: &str,
    own: &[String],
    todos: impl Iterator<Item = &'a Todo>,
    pads: impl Iterator<Item = &'a Pad>,
) -> String {
    let mut text = format!(
        "The user is clearing Workstream \"{}\". Their reason: {reason}\n\n\
         Write the Handoff by calling the workstream_handoff tool once with a summary of what happened \
         and why the user cleared, keep_todos (Todo ids) and keep_pads (Pad names). Keep only what the \
         user's own words below clearly asked for from the start. Leave out what Agents added on their \
         own: it is archived, not lost.\n\nThe user's own Messages of this Iteration, in order:\n",
        node.name
    );
    for (n, body) in own.iter().enumerate() {
        text.push_str(&format!("{}. {body}\n", n + 1));
    }
    text.push_str("\nTodos:\n");
    for todo in todos {
        text.push_str(&format!(
            "- {} \"{}\" (owner {}{})\n",
            todo.id,
            todo.title,
            todo.creator.id,
            if todo.done { ", done" } else { "" }
        ));
    }
    text.push_str("\nPads:\n");
    for pad in pads {
        text.push_str(&format!("- {} (owner {})\n", pad.name, pad.owner.id));
    }
    text
}

fn handoff_text(summary: &str, removed: &[Removed], archive: Option<&str>) -> String {
    let mut text = summary.trim().to_owned();
    if !removed.is_empty() {
        text.push_str("\n\nRemoved Subagents (their Worktrees and branches are kept):\n");
        for sub in removed {
            match &sub.worktree {
                Some((path, branch)) => {
                    text.push_str(&format!("- {}: {path} (branch {branch})\n", sub.name))
                }
                None => text.push_str(&format!("- {}: no Worktree\n", sub.name)),
            }
        }
    }
    if let Some(archive) = archive {
        text.push_str(&format!(
            "\nThe Todos and Pads this clear removed are archived in the Pad {archive}.\n"
        ));
    }
    text
}
