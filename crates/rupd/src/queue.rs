//! A3194 to A3197: a Workstream that owns a Todo, the Start choice, and the Queue that starts
//! Doors under the Project's cap. Only the user's own `now` and this Queue start a Door.
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use agents::Agents;
use contracts::agent::{NodeKind, Order, RailNode};
use contracts::workstream::{
    CapParams, QueueMoveParams, QueueState, QueuedWorkstream, StartChoice, StartWorkstreamParams,
};
use contracts::{Actor, ActorKind, EventData, Kind};
use rpc::{Bus, Ctx, Module, RpcError, code};
use serde_json::{Value, json};

use super::Daemon;

type Starting<'a> = Pin<Box<dyn Future<Output = Result<(), RpcError>> + Send + 'a>>;

/// What the Queue remembers in memory: the Workstreams it started whose Door has not yet
/// reported a Status, and the running set the last count was taken from.
#[derive(Default)]
pub(crate) struct Memory {
    pub(super) launching: Mutex<HashSet<String>>,
    running: Mutex<HashSet<String>>,
    watching: std::sync::atomic::AtomicBool,
    pub(super) pass: tokio::sync::Mutex<()>,
}

/// A3196: the Workstreams running now. A Workstream runs while its Door or any Agent under it is
/// `working`; one the Queue just started runs until its Door reports a Status.
pub(super) fn running(nodes: &[RailNode], launching: &HashSet<String>) -> HashSet<String> {
    let by_id: HashMap<&str, &RailNode> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut out: HashSet<String> = launching
        .iter()
        .filter(|id| by_id.contains_key(id.as_str()))
        .cloned()
        .collect();
    for node in nodes {
        if node.status.as_ref().map(|s| s.kind) != Some(Kind::Working) {
            continue;
        }
        let mut at = Some(node);
        while let Some(found) = at {
            if found.kind == NodeKind::Workstream {
                out.insert(found.id.clone());
                break;
            }
            at = found.parent.as_deref().and_then(|p| by_id.get(p).copied());
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
        let tree = self
            .agents
            .call(&self.ctx(Actor::daemon()), "rail.tree", Value::Null)
            .await?;
        serde_json::from_value(tree).map_err(RpcError::internal)
    }

    /// Every Todo's id with whether it is done.
    async fn todo_states(&self) -> Result<HashMap<u32, bool>, RpcError> {
        let list = self
            .todos
            .call(&self.ctx(Actor::daemon()), "todo.list", Value::Null)
            .await?;
        let list: Vec<contracts::todo::Todo> =
            serde_json::from_value(list).map_err(RpcError::internal)?;
        Ok(list.into_iter().map(|t| (t.id, t.done)).collect())
    }

    fn changed(&self) {
        self.bus
            .emit(Actor::daemon(), EventData::WorkstreamQueueChanged);
    }

    async fn start_door(&self, actor: &Actor, id: &str) -> Result<RailNode, RpcError> {
        let node = self
            .agents
            .call(
                &self.ctx(actor.clone()),
                "rail.startDoor",
                json!({ "id": id }),
            )
            .await?;
        serde_json::from_value(node).map_err(RpcError::internal)
    }

    /// A3194: one call makes the Workstream, gives it the Todo and applies the Start choice.
    pub async fn start_workstream(&self, actor: &Actor, params: Value) -> Result<Value, RpcError> {
        let StartWorkstreamParams { id, name, start } = rpc::params(params)?;
        let name = name.trim().to_owned();
        if name.is_empty() {
            return Err(refuse("name must not be empty"));
        }
        let ctx = self.ctx(actor.clone());
        let todo: contracts::todo::Todo = serde_json::from_value(
            self.todos
                .call(&ctx, "todo.get", json!({ "id": id }))
                .await?,
        )
        .map_err(RpcError::internal)?;
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
        let node: RailNode = serde_json::from_value(
            self.agents
                .call(
                    &ctx,
                    "rail.createWorkstream",
                    json!({ "name": name, "parent": null, "order": order }),
                )
                .await?,
        )
        .map_err(RpcError::internal)?;
        let owned = async {
            self.todos
                .call(&ctx, "todo.move", json!({ "id": id, "home": node.id }))
                .await?;
            let door = Actor {
                kind: ActorKind::Agent,
                id: node.id.clone(),
                parent: None,
            };
            self.todos
                .call(&ctx, "todo.assign", json!({ "id": id, "owner": door }))
                .await
        }
        .await;
        if let Err(err) = owned {
            let _ = self
                .agents
                .call(&ctx, "rail.remove", json!({ "id": node.id }))
                .await;
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
            "workstream.dequeue" => {
                let QueuedWorkstream { workstream } = rpc::params(params)?;
                if !self.agents.queue_remove(&workstream)? {
                    return Err(RpcError::not_found(format!(
                        "queued workstream {workstream}"
                    )));
                }
                self.changed();
                rpc::reply(&())
            }
            "workstream.queueMove" => {
                let QueueMoveParams { workstream, index } = rpc::params(params)?;
                if !self.agents.queue_place(&workstream, index as usize)? {
                    return Err(RpcError::not_found(format!(
                        "queued workstream {workstream}"
                    )));
                }
                self.changed();
                rpc::reply(&())
            }
            "workstream.startNow" => {
                let QueuedWorkstream { workstream } = rpc::params(params)?;
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
            "project.setWorkstreamCap" => {
                let CapParams { cap } = rpc::params(params)?;
                let cap = match cap {
                    None | Some(Value::Null) => None,
                    Some(Value::Number(n)) => match n.as_u64() {
                        Some(n) if (1..=u64::from(u32::MAX)).contains(&n) => Some(n as u32),
                        _ => {
                            return Err(refuse("cap must be a whole number of 1 or more, or null"));
                        }
                    },
                    Some(_) => {
                        return Err(refuse("cap must be a whole number of 1 or more, or null"));
                    }
                };
                self.agents.set_workstream_cap(cap)?;
                self.changed();
                rpc::reply(&())
            }
            _ => Err(RpcError::method_not_found(method)),
        }
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

    /// Start watching the Bus for the Queue, once, at the first request.
    pub(crate) fn start_queue(&self) {
        if tokio::runtime::Handle::try_current().is_err()
            || self
                .queue
                .watching
                .swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            return;
        }
        tokio::spawn(self.queuer().watch(self.bus.subscribe()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    fn node(id: &str, kind: &str, parent: Option<&str>, status: Option<&str>) -> RailNode {
        serde_json::from_value(json!({
            "id": id, "kind": kind, "name": id, "parent": parent, "order": 0,
            "status": status.map(|k| json!({"kind": k, "label": k, "since": 0,"finished":"0"})),
            "attempt": null, "status_revision": null, "terminal_id": null, "worktree": null,
            "can_resume": false, "channel": null, "work": null, "stray": [],
            "model": null, "effort": null,
        }))
        .unwrap()
    }

    fn launcher(project: &Path) -> agents::claude_code::Launcher {
        let fake = project.join("fake-claude");
        std::fs::write(
            &fake,
            "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nwhile read line; do :; done\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let rup = project.join("rup");
        std::fs::write(&rup, "").unwrap();
        agents::claude_code::Launcher::new(
            fake.to_str().unwrap(),
            project.join("claude.json"),
            rup,
            None,
        )
    }

    /// A Daemon whose Queue watcher is off, so a test drives each pass itself.
    fn daemon(project: &Path) -> Daemon {
        let daemon = watched(project);
        daemon
            .queue
            .watching
            .store(true, std::sync::atomic::Ordering::SeqCst);
        daemon
    }

    fn watched(project: &Path) -> Daemon {
        let data = project.join(".roundup");
        Daemon::open_stores(project, &data, None, |_| {
            let bus = Bus::new();
            let terminals = Arc::new(terminal::Terminals::open(&data, bus.clone()).unwrap());
            Agents::open_in(
                project,
                &data,
                bus,
                terminals,
                launcher(project),
                agents::worktree::Git::from_env(),
            )
            .unwrap()
        })
        .unwrap()
    }

    async fn call(daemon: &Daemon, method: &str, params: Value) -> Result<Value, RpcError> {
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = super::super::Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        daemon.route(&mut conn, method, params).await
    }

    async fn todo(daemon: &Daemon, title: &str, body: &str) -> u32 {
        let made = call(daemon, "todo.create", json!({"title": title, "body": body}))
            .await
            .unwrap();
        made["id"].as_u64().unwrap() as u32
    }

    async fn start(daemon: &Daemon, id: u32, start: Value) -> Result<Value, RpcError> {
        call(
            daemon,
            "todo.startWorkstream",
            json!({"id": id, "name": "Ship it", "start": start}),
        )
        .await
    }

    async fn queue(daemon: &Daemon) -> QueueState {
        serde_json::from_value(call(daemon, "workstream.queue", Value::Null).await.unwrap())
            .unwrap()
    }

    fn changes(daemon: &Daemon) -> impl FnMut() -> usize + use<> {
        let mut events = daemon.bus.subscribe();
        move || {
            let mut seen = 0;
            while let Ok(event) = events.try_recv() {
                if matches!(event.data, EventData::WorkstreamQueueChanged) {
                    seen += 1;
                }
            }
            seen
        }
    }

    #[tokio::test]
    async fn a3194_the_todo_moves_to_the_new_workstream_and_is_owned_by_its_door() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let id = todo(&daemon, "Ship it", "").await;
        let made = start(&daemon, id, json!({"kind": "queued"})).await.unwrap();
        let ws = made["id"].as_str().unwrap();
        assert_eq!(
            (made["kind"].as_str(), made["name"].as_str()),
            (Some("workstream"), Some("Ship it"))
        );
        assert!(made["attempt"].is_null(), "the Door stays stopped");
        let got = call(&daemon, "todo.get", json!({"id": id})).await.unwrap();
        assert_eq!(got["home"], ws);
        assert_eq!(
            got["owner"],
            json!({"kind": "agent", "id": ws, "parent": null})
        );
        let history = call(&daemon, "todo.getHistory", json!({"id": id}))
            .await
            .unwrap();
        assert!(history["changes"].as_array().unwrap().len() >= 2);
    }

    #[tokio::test]
    async fn a3194_a_refused_call_changes_nothing() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let open = todo(&daemon, "open", "").await;
        let done = todo(&daemon, "done", "").await;
        call(&daemon, "todo.complete", json!({"id": done}))
            .await
            .unwrap();
        let before = call(&daemon, "todo.list", Value::Null).await.unwrap();
        let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        let refused = [
            (done, "w", json!({"kind": "queued"}), code::INVALID_PARAMS),
            (99, "w", json!({"kind": "queued"}), code::NOT_FOUND),
            (open, "  ", json!({"kind": "queued"}), code::INVALID_PARAMS),
            (
                open,
                "w",
                json!({"kind": "afterTodo", "todo": open}),
                code::INVALID_PARAMS,
            ),
            (
                open,
                "w",
                json!({"kind": "afterTodo", "todo": 99}),
                code::NOT_FOUND,
            ),
        ];
        for (id, name, choice, expected) in refused {
            let err = call(
                &daemon,
                "todo.startWorkstream",
                json!({"id": id, "name": name, "start": choice}),
            )
            .await
            .unwrap_err();
            assert_eq!(err.code, expected, "{id} {name} {choice}");
        }
        assert_eq!(
            call(&daemon, "todo.list", Value::Null).await.unwrap(),
            before
        );
        assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), tree);
        assert!(queue(&daemon).await.entries.is_empty());
    }

    #[tokio::test]
    async fn a3194_the_orders_seed_comes_from_the_todo() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let id = todo(&daemon, "Fix the login flow now", "Users get logged out").await;
        let made = start(&daemon, id, json!({"kind": "queued"})).await.unwrap();
        assert_eq!(made["work"]["kind"], "work");
        assert_eq!(made["work"]["title"], "Fix the login flow now");
        assert!(
            made["work"]["ask"]
                .as_str()
                .unwrap()
                .contains("Users get logged out")
        );
    }

    #[tokio::test]
    async fn a3195_now_starts_the_door_over_the_cap() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        call(&daemon, "project.setWorkstreamCap", json!({"cap": 1}))
            .await
            .unwrap();
        let first = todo(&daemon, "one", "").await;
        let second = todo(&daemon, "two", "").await;
        for id in [first, second] {
            let made = start(&daemon, id, json!({"kind": "now"})).await.unwrap();
            assert!(made["terminal_id"].is_string(), "the Door started: {made}");
        }
        assert!(queue(&daemon).await.entries.is_empty());
        daemon.stop_terminals().await.unwrap();
    }

    #[tokio::test]
    async fn a3195_queued_and_after_todo_start_nothing_by_themselves() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let first = todo(&daemon, "one", "").await;
        let second = todo(&daemon, "two", "").await;
        let a = start(&daemon, first, json!({"kind": "queued"}))
            .await
            .unwrap();
        let b = start(&daemon, second, json!({"kind": "afterTodo", "todo": first}))
            .await
            .unwrap();
        assert!(a["terminal_id"].is_null() && b["terminal_id"].is_null());
        let state = queue(&daemon).await;
        assert_eq!(
            state
                .entries
                .iter()
                .map(|e| (e.workstream.as_str(), e.start.clone()))
                .collect::<Vec<_>>(),
            [
                (a["id"].as_str().unwrap(), StartChoice::Queued),
                (
                    b["id"].as_str().unwrap(),
                    StartChoice::AfterTodo { todo: first }
                ),
            ]
        );
        assert_eq!((state.running, state.cap), (0, None));
    }

    #[test]
    fn a3195_running_counts_a_workstream_while_any_agent_is_working() {
        let nodes = [
            node("1", "workstream", None, Some("idle")),
            node("2", "agent", Some("1"), Some("working")),
            node("3", "workstream", None, Some("working")),
            node("4", "workstream", None, Some("needs-you")),
            node("5", "agent", Some("4"), Some("blocked")),
            node("6", "workstream", None, Some("error")),
            node("7", "workstream", None, Some("done")),
        ];
        let mut now: Vec<_> = running(&nodes, &HashSet::new()).into_iter().collect();
        now.sort();
        assert_eq!(now, ["1", "3"]);
    }

    #[test]
    fn a3195_a_just_started_workstream_counts_before_its_first_status() {
        let nodes = [
            node("1", "workstream", None, None),
            node("2", "workstream", None, Some("idle")),
        ];
        let launching: HashSet<String> = ["1".to_owned(), "9".to_owned()].into();
        let now = running(&nodes, &launching);
        assert_eq!(now, ["1".to_owned()].into());
        assert!(running(&nodes, &HashSet::new()).is_empty());
    }

    #[tokio::test]
    async fn a3195_an_invalid_cap_changes_nothing() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        call(&daemon, "project.setWorkstreamCap", json!({"cap": 2}))
            .await
            .unwrap();
        let mut seen = changes(&daemon);
        for bad in [json!(0), json!(-1), json!(1.5), json!("2")] {
            let err = call(&daemon, "project.setWorkstreamCap", json!({"cap": bad}))
                .await
                .unwrap_err();
            assert_eq!(err.code, code::INVALID_PARAMS, "{bad}");
        }
        assert_eq!((queue(&daemon).await.cap, seen()), (Some(2), 0));
        let get = call(&daemon, "project.get", Value::Null).await.unwrap();
        assert_eq!(get["workstreamCap"], 2);
        call(&daemon, "project.setWorkstreamCap", json!({"cap": null}))
            .await
            .unwrap();
        let get = call(&daemon, "project.get", Value::Null).await.unwrap();
        assert!(get["workstreamCap"].is_null());
    }

    #[tokio::test]
    async fn a3195_dequeue_move_and_start_now_change_the_queue_once_each() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let mut ids = Vec::new();
        for title in ["a", "b", "c"] {
            let t = todo(&daemon, title, "").await;
            ids.push(
                start(&daemon, t, json!({"kind": "queued"})).await.unwrap()["id"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
            );
        }
        let mut seen = changes(&daemon);
        let order = |state: QueueState| {
            state
                .entries
                .into_iter()
                .map(|e| e.workstream)
                .collect::<Vec<_>>()
        };
        call(
            &daemon,
            "workstream.queueMove",
            json!({"workstream": ids[2], "index": 0}),
        )
        .await
        .unwrap();
        assert_eq!(
            (order(queue(&daemon).await), seen()),
            ([&ids[2], &ids[0], &ids[1]].map(String::clone).to_vec(), 1)
        );
        call(&daemon, "workstream.dequeue", json!({"workstream": ids[0]}))
            .await
            .unwrap();
        assert_eq!(
            (order(queue(&daemon).await), seen()),
            ([&ids[2], &ids[1]].map(String::clone).to_vec(), 1)
        );
        let started = call(
            &daemon,
            "workstream.startNow",
            json!({"workstream": ids[1]}),
        )
        .await
        .unwrap();
        assert!(started["terminal_id"].is_string());
        assert_eq!(
            (order(queue(&daemon).await), seen()),
            (vec![ids[2].clone()], 1)
        );
        let err = call(&daemon, "workstream.dequeue", json!({"workstream": ids[0]}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND);
        daemon.stop_terminals().await.unwrap();
    }

    /// A pass over `nodes` and `todos` with a fake start; returns the ids it started in order.
    async fn pass(
        daemon: &Daemon,
        nodes: &[RailNode],
        todos: &[(u32, bool)],
        failing: &[&str],
    ) -> Vec<String> {
        let started = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&started);
        let failing: Vec<String> = failing.iter().map(|s| (*s).to_owned()).collect();
        let mut fake = move |id: String| -> Starting<'static> {
            let log = Arc::clone(&log);
            let fail = failing.contains(&id);
            Box::pin(async move {
                if fail {
                    return Err(RpcError::conflict("no claude"));
                }
                log.lock().unwrap().push(id);
                Ok(())
            })
        };
        daemon
            .queuer()
            .pass(nodes, &todos.iter().copied().collect(), &mut fake)
            .await
            .unwrap();
        started.lock().unwrap().clone()
    }

    /// Queue `n` Workstreams (Rail ids), each from its own Todo; `after[i]` is the Todo it waits for.
    async fn queued(daemon: &Daemon, after: &[Option<u32>]) -> Vec<String> {
        let mut ids = Vec::new();
        for (i, wait) in after.iter().enumerate() {
            let t = todo(daemon, &format!("t{i}"), "").await;
            let choice = wait.map_or(
                json!({"kind": "queued"}),
                |todo| json!({"kind": "afterTodo", "todo": todo}),
            );
            ids.push(
                start(daemon, t, choice).await.unwrap()["id"]
                    .as_str()
                    .unwrap()
                    .to_owned(),
            );
        }
        ids
    }

    #[tokio::test]
    async fn a3196_a_freed_slot_starts_the_head_in_order() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let ids = queued(&daemon, &[None, None, None]).await;
        call(&daemon, "project.setWorkstreamCap", json!({"cap": 2}))
            .await
            .unwrap();
        let busy = [node("90", "workstream", None, Some("working"))];
        assert_eq!(pass(&daemon, &busy, &[], &[]).await, [ids[0].clone()]);
        // The started one counts as launching, so one count change never starts two over the cap.
        let launched = [busy[0].clone(), node(&ids[0], "workstream", None, None)];
        assert!(pass(&daemon, &launched, &[], &[]).await.is_empty());
        daemon.queue.launching.lock().unwrap().clear();
        let idle = [node("90", "workstream", None, Some("idle"))];
        assert_eq!(
            pass(&daemon, &idle, &[], &[]).await,
            [ids[1].clone(), ids[2].clone()]
        );
        assert!(queue(&daemon).await.entries.is_empty());
    }

    #[tokio::test]
    async fn a3196_an_after_todo_entry_waits_for_its_todo_and_blocks_none_behind_it() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let gate = todo(&daemon, "gate", "").await;
        let ids = queued(&daemon, &[Some(gate), None]).await;
        assert_eq!(
            pass(&daemon, &[], &[(gate, false)], &[]).await,
            [ids[1].clone()]
        );
        let left = queue(&daemon).await.entries;
        assert_eq!(left.len(), 1);
        assert_eq!(
            (left[0].workstream.as_str(), &left[0].start),
            (ids[0].as_str(), &StartChoice::AfterTodo { todo: gate })
        );
        assert_eq!(
            pass(&daemon, &[], &[(gate, true)], &[]).await,
            [ids[0].clone()]
        );
    }

    #[tokio::test]
    async fn a3196_a_deleted_todo_frees_its_entry_as_queued() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let gate = todo(&daemon, "gate", "").await;
        let ids = queued(&daemon, &[Some(gate)]).await;
        assert_eq!(pass(&daemon, &[], &[], &["x"]).await, [ids[0].clone()]);
    }

    #[tokio::test]
    async fn a3196_no_cap_starts_every_eligible_entry() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let gate = todo(&daemon, "gate", "").await;
        let ids = queued(&daemon, &[None, Some(gate), None]).await;
        let busy = [node("90", "workstream", None, Some("working"))];
        assert_eq!(
            pass(&daemon, &busy, &[(gate, false)], &[]).await,
            [ids[0].clone(), ids[2].clone()]
        );
    }

    #[tokio::test]
    async fn a3196_a_failed_start_keeps_its_place_and_does_not_stop_the_pass() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let ids = queued(&daemon, &[None, None]).await;
        let mut seen = changes(&daemon);
        assert_eq!(
            pass(&daemon, &[], &[], &[ids[0].as_str()]).await,
            [ids[1].clone()]
        );
        assert_eq!(seen(), 1);
        let left = queue(&daemon).await.entries;
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].workstream, ids[0]);
        assert_eq!(
            left[0].failure.as_ref().map(|f| f.code),
            Some(code::CONFLICT)
        );
    }

    #[tokio::test]
    async fn a3196_a_removed_workstream_leaves_the_queue() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let ids = queued(&daemon, &[None, None]).await;
        call(&daemon, "rail.remove", json!({"id": ids[0]}))
            .await
            .unwrap();
        let left: Vec<_> = queue(&daemon)
            .await
            .entries
            .into_iter()
            .map(|e| e.workstream)
            .collect();
        assert_eq!(left, [ids[1].clone()]);
    }

    #[tokio::test]
    async fn a3197_the_queue_and_cap_survive_a_restart_and_start_nothing() {
        let project = tempfile::tempdir().unwrap();
        let ids = {
            let daemon = daemon(project.path());
            call(&daemon, "project.setWorkstreamCap", json!({"cap": 3}))
                .await
                .unwrap();
            let gate = todo(&daemon, "gate", "").await;
            queued(&daemon, &[None, Some(gate), None]).await
        };
        let daemon = daemon(project.path());
        let state = queue(&daemon).await;
        assert_eq!(state.cap, Some(3));
        assert_eq!(
            state
                .entries
                .iter()
                .map(|e| e.workstream.clone())
                .collect::<Vec<_>>(),
            ids
        );
        let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        assert!(
            tree.as_array()
                .unwrap()
                .iter()
                .all(|n| n["terminal_id"].is_null())
        );
    }

    #[tokio::test]
    async fn a3197_changing_the_cap_starts_and_stops_nothing_by_itself() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let ids = queued(&daemon, &[None, None]).await;
        for step in [
            ("project.setWorkstreamCap", json!({"cap": 5})),
            ("project.setWorkstreamCap", json!({"cap": null})),
            (
                "workstream.queueMove",
                json!({"workstream": ids[1], "index": 0}),
            ),
            ("workstream.dequeue", json!({"workstream": ids[0]})),
        ] {
            call(&daemon, step.0, step.1).await.unwrap();
        }
        let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        assert!(
            tree.as_array()
                .unwrap()
                .iter()
                .all(|n| n["terminal_id"].is_null())
        );
        assert_eq!(queue(&daemon).await.entries.len(), 1);
    }

    #[tokio::test]
    async fn a3197_the_next_count_change_uses_the_new_cap() {
        let project = tempfile::tempdir().unwrap();
        let daemon = daemon(project.path());
        let ids = queued(&daemon, &[None, None]).await;
        call(&daemon, "project.setWorkstreamCap", json!({"cap": 1}))
            .await
            .unwrap();
        let busy = [node("90", "workstream", None, Some("working"))];
        assert!(pass(&daemon, &busy, &[], &[]).await.is_empty());
        call(&daemon, "project.setWorkstreamCap", json!({"cap": 2}))
            .await
            .unwrap();
        assert_eq!(pass(&daemon, &busy, &[], &[]).await, [ids[0].clone()]);
    }

    #[tokio::test]
    async fn a3196_a_done_todo_wakes_the_watcher_and_its_entry_starts() {
        let project = tempfile::tempdir().unwrap();
        let daemon = watched(project.path());
        let gate = todo(&daemon, "gate", "").await;
        let ids = queued(&daemon, &[Some(gate)]).await;
        call(&daemon, "todo.complete", json!({"id": gate}))
            .await
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            loop {
                let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
                let started = tree
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|n| n["id"] == ids[0] && n["terminal_id"].is_string());
                if started {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert!(queue(&daemon).await.entries.is_empty());
        daemon.stop_terminals().await.unwrap();
    }
}
