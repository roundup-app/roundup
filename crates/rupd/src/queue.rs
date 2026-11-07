//! A3194 to A3197: a Workstream that owns a Todo, the Start choice, and the Queue that starts
//! Doors under the Project's cap. Only the user's own `now` and this Queue start a Door.
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use agents::Agents;
use contracts::agent::{CreateWorkstreamParams, Order, RailNode, RemoveParams, StartDoorParams};
use contracts::workstream::{
    CapParams, QueueMoveParams, QueueState, QueuedWorkstream, StartChoice, StartWorkstreamParams,
};
use contracts::{Actor, ActorKind, EventData, Kind};
use rpc::{Bus, Ctx, RpcError, code};
use serde_json::Value;

use super::Daemon;
use crate::rail_index::RailIndex;

type Starting<'a> = Pin<Box<dyn Future<Output = Result<(), RpcError>> + Send + 'a>>;

/// What the Queue remembers in memory: the Workstreams it started whose Door has not yet
/// reported a Status, and the running set the last count was taken from.
#[derive(Default)]
pub(crate) struct Memory {
    pub(super) launching: Mutex<HashSet<String>>,
    running: Mutex<HashSet<String>>,
    pub(super) pass: tokio::sync::Mutex<()>,
}

/// A3196: the Workstreams running now. A Workstream runs while its Door or any Agent under it is
/// `working`; one the Queue just started runs until its Door reports a Status.
pub(super) fn running(nodes: &[RailNode], launching: &HashSet<String>) -> HashSet<String> {
    let index = RailIndex::new(nodes);
    let mut out: HashSet<String> = launching
        .iter()
        .filter(|id| index.contains(id))
        .cloned()
        .collect();
    for node in nodes {
        if node.status.as_ref().map(|s| s.kind) != Some(Kind::Working) {
            continue;
        }
        if let Some(door) = index.workstream_of(&node.id) {
            out.insert(door.id.clone());
        }
    }
    out
}

/// A3194: O3's order, seeded from the Todo.
fn seeded_order(title: &str, body: &str) -> Order {
    let title: String = title
        .split_whitespace()
        .take(contracts::agent::TITLE_CAP)
        .collect::<Vec<_>>()
        .join(" ");
    let full = if body.trim().is_empty() {
        title.clone()
    } else {
        format!("{title}: {}", body.trim())
    };
    let ask: String = full.chars().take(contracts::agent::ASK_CAP).collect();
    Order::Work {
        title: Some(title),
        ask: ask.trim().to_owned(),
        done: None,
        limits: Vec::new(),
    }
}

fn refuse(message: impl Into<String>) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, message)
}

/// The pieces a pass needs, cloned out of the Daemon so the watcher can own them.
#[derive(Clone)]
pub(crate) struct Queuer {
    pub agents: Arc<Agents>,
    pub todos: Arc<todos::Todos>,
    pub bus: Bus,
    pub touches: Arc<provenance::Touches>,
    pub memory: Arc<Memory>,
}

impl Queuer {
    fn ctx(&self, actor: Actor) -> Ctx {
        Ctx {
            actor,
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        }
    }

    async fn nodes(&self) -> Result<Vec<RailNode>, RpcError> {
        self.agents.tree()
    }

    /// Every Todo's id with whether it is done.
    async fn todo_states(&self) -> Result<HashMap<u32, bool>, RpcError> {
        Ok(self
            .todos
            .list_all()?
            .into_iter()
            .map(|t| (t.id, t.done))
            .collect())
    }

    fn changed(&self) {
        self.bus
            .emit(Actor::daemon(), EventData::WorkstreamQueueChanged);
    }

    async fn start_door(&self, actor: &Actor, id: &str) -> Result<RailNode, RpcError> {
        let start = StartDoorParams {
            prompt: None,
            cols: None,
            rows: None,
            permission_mode: None,
            engine: None,
            id: id.to_owned(),
            model: None,
            effort: None,
        };
        self.agents
            .start_door_node(&self.ctx(actor.clone()), start)
            .await
    }

    /// A3194: one call makes the Workstream, gives it the Todo and applies the Start choice.
    pub async fn start_workstream(&self, actor: &Actor, params: Value) -> Result<Value, RpcError> {
        let StartWorkstreamParams { id, name, start } = rpc::params(params)?;
        let name = name.trim().to_owned();
        if name.is_empty() {
            return Err(refuse("name must not be empty"));
        }
        let ctx = self.ctx(actor.clone());
        let todo = self.todos.read(&ctx, id).await?;
        if todo.done {
            return Err(refuse(format!("todo {id} is done")));
        }
        if let StartChoice::AfterTodo { todo: after } = &start {
            if *after == id {
                return Err(refuse("a Todo cannot wait for itself"));
            }
            if !self.todo_states().await?.contains_key(after) {
                return Err(RpcError::not_found(format!("todo {after}")));
            }
        }
        let order = seeded_order(&todo.title, &todo.body);
        let node = self.agents.create_workstream(
            &ctx,
            CreateWorkstreamParams {
                start_attribution: None,
                name,
                parent: None,
                order: Some(order),
            },
        )?;
        let owned = async {
            self.todos
                .set_home(&ctx, id, Some(node.id.clone()))
                .await?;
            let door = Actor {
                kind: ActorKind::Agent,
                id: node.id.clone(),
                parent: None,
            };
            self.todos.set_owner(&ctx, id, Some(door)).await.map(|_| ())
        }
        .await;
        if let Err(err) = owned {
            let remove = RemoveParams {
                id: node.id.clone(),
                scope: None,
                operation: None,
            };
            let _ = self.agents.remove_node(&ctx, remove).await;
            return Err(err);
        }
        match start {
            StartChoice::Now => return rpc::reply(&self.start_door(actor, &node.id).await?),
            StartChoice::Queued => self.agents.queue_push(&node.id, None)?,
            StartChoice::AfterTodo { todo } => self.agents.queue_push(&node.id, Some(todo))?,
        }
        self.changed();
        rpc::reply(&node)
    }

    pub async fn state(&self) -> Result<QueueState, RpcError> {
        let nodes = self.nodes().await?;
        let launching = self.memory.launching.lock().unwrap().clone();
        Ok(QueueState {
            running: running(&nodes, &launching).len() as u32,
            cap: self.agents.workstream_cap()?,
            entries: self.agents.queue_entries()?,
        })
    }

    pub async fn call(
        &self,
        actor: &Actor,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        match method {
            "todo.startWorkstream" => self.start_workstream(actor, params).await,
            "workstream.queue" => rpc::reply(&self.state().await?),
            "workstream.dequeue" => self.dequeue(rpc::params(params)?),
            "workstream.queueMove" => self.queue_move(rpc::params(params)?),
            "workstream.startNow" => self.start_now(actor, rpc::params(params)?).await,
            "project.setWorkstreamCap" => self.set_cap(rpc::params(params)?),
            _ => Err(RpcError::method_not_found(method)),
        }
    }

    fn dequeue(
        &self,
        QueuedWorkstream { workstream }: QueuedWorkstream,
    ) -> Result<Value, RpcError> {
        if !self.agents.queue_remove(&workstream)? {
            return Err(RpcError::not_found(format!(
                "queued workstream {workstream}"
            )));
        }
        self.changed();
        rpc::reply(&())
    }

    fn queue_move(
        &self,
        QueueMoveParams { workstream, index }: QueueMoveParams,
    ) -> Result<Value, RpcError> {
        if !self.agents.queue_place(&workstream, index as usize)? {
            return Err(RpcError::not_found(format!(
                "queued workstream {workstream}"
            )));
        }
        self.changed();
        rpc::reply(&())
    }

    async fn start_now(
        &self,
        actor: &Actor,
        QueuedWorkstream { workstream }: QueuedWorkstream,
    ) -> Result<Value, RpcError> {
        if !self
            .agents
            .queue_entries()?
            .iter()
            .any(|entry| entry.workstream == workstream)
        {
            return Err(RpcError::not_found(format!(
                "queued workstream {workstream}"
            )));
        }
        let node = self.start_door(actor, &workstream).await?;
        self.agents.queue_remove(&workstream)?;
        self.changed();
        rpc::reply(&node)
    }

    fn set_cap(&self, CapParams { cap }: CapParams) -> Result<Value, RpcError> {
        let cap = match cap {
            None | Some(Value::Null) => None,
            Some(Value::Number(n)) => match n.as_u64() {
                Some(n) if (1..=u64::from(u32::MAX)).contains(&n) => Some(n as u32),
                _ => return Err(refuse("cap must be a whole number of 1 or more, or null")),
            },
            Some(_) => return Err(refuse("cap must be a whole number of 1 or more, or null")),
        };
        self.agents.set_workstream_cap(cap)?;
        self.changed();
        rpc::reply(&())
    }

    /// A3196: start Doors from the head of the Queue until `cap` Workstreams run. `start` is
    /// `rail.startDoor`; an entry that is not eligible keeps its place and blocks none behind it.
    pub async fn pass(
        &self,
        nodes: &[RailNode],
        todos: &HashMap<u32, bool>,
        start: &mut (dyn FnMut(String) -> Starting<'static> + Send),
    ) -> Result<(), RpcError> {
        let _pass = self.memory.pass.lock().await;
        let mut count = running(nodes, &self.memory.launching.lock().unwrap()).len() as u32;
        let cap = self.agents.workstream_cap()?;
        let mut changed = false;
        for entry in self.agents.queue_entries()? {
            if cap.is_some_and(|cap| count >= cap) {
                break;
            }
            if let StartChoice::AfterTodo { todo } = entry.start {
                match todos.get(&todo) {
                    Some(false) => continue,
                    Some(true) => {}
                    None => {
                        self.agents.queue_free(&entry.workstream)?;
                    }
                }
            }
            match start(entry.workstream.clone()).await {
                Ok(()) => {
                    self.agents.queue_remove(&entry.workstream)?;
                    self.memory
                        .launching
                        .lock()
                        .unwrap()
                        .insert(entry.workstream);
                    count += 1;
                }
                Err(err) => {
                    self.agents
                        .queue_fail(&entry.workstream, Some((err.code, &err.message)))?;
                }
            }
            changed = true;
        }
        if changed {
            self.changed();
        }
        Ok(())
    }

    async fn pass_now(&self) {
        let (Ok(nodes), Ok(todos)) = (self.nodes().await, self.todo_states().await) else {
            return;
        };
        let user = Actor::user();
        let this = self.clone();
        let mut start = move |id: String| -> Starting<'static> {
            let this = this.clone();
            let user = user.clone();
            Box::pin(async move { this.start_door(&user, &id).await.map(|_| ()) })
        };
        if let Err(err) = self.pass(&nodes, &todos, &mut start).await {
            eprintln!("rupd: workstream queue: {}", err.message);
        }
    }

    /// Follow the Bus: a count change or a done or deleted Todo that an entry waits for runs a pass.
    pub async fn watch(self, mut events: tokio::sync::broadcast::Receiver<contracts::Event>) {
        use tokio::sync::broadcast::error::RecvError;
        loop {
            let lagged = match events.recv().await {
                Ok(event) => {
                    let mut pass = false;
                    match &event.data {
                        EventData::AgentStatus(status) => {
                            self.memory.launching.lock().unwrap().remove(&status.id);
                            pass = self.count_changed().await;
                        }
                        EventData::RailChanged => pass = self.count_changed().await,
                        EventData::TodoUpdated(todo) if todo.done => {
                            pass = self.waited_for(todo.id);
                        }
                        EventData::TodoDeleted(todo) => pass = self.waited_for(todo.id),
                        _ => {}
                    }
                    if pass {
                        self.pass_now().await;
                    }
                    false
                }
                Err(RecvError::Lagged(_)) => true,
                Err(RecvError::Closed) => return,
            };
            if lagged && self.count_changed().await {
                self.pass_now().await;
            }
        }
    }

    fn waited_for(&self, todo: u32) -> bool {
        self.agents.queue_entries().is_ok_and(|entries| {
            entries
                .iter()
                .any(|e| e.start == StartChoice::AfterTodo { todo })
        })
    }

    /// Whether the running set differs from the one the last pass counted.
    async fn count_changed(&self) -> bool {
        let Ok(nodes) = self.nodes().await else {
            return false;
        };
        let now = running(&nodes, &self.memory.launching.lock().unwrap());
        let mut last = self.memory.running.lock().unwrap();
        if *last == now {
            return false;
        }
        *last = now;
        true
    }
}

impl Daemon {
    pub(crate) fn queuer(&self) -> Queuer {
        Queuer {
            agents: Arc::clone(&self.agents),
            todos: Arc::clone(&self.todos),
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
            memory: Arc::clone(&self.queue),
        }
    }
}

#[cfg(test)]
mod tests;
