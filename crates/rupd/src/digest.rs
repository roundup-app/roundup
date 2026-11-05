//! B19 to B21: the Daemon reads the Rail, the Todos, the Pads and the Messages together, which no
//! module does alone, to answer `agent.digest` and to push a child's change to its Door.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

use contracts::message::Message;
use contracts::{Actor, EventData};
use rpc::{Bus, Ctx, Module, RpcError};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;

/// The modules a digest is composed from, read as the Daemon or the user, so reading changes
/// nothing and logs no Touch.
#[derive(Clone)]
pub struct Reader {
    agents: Option<Arc<agents::Agents>>,
    modules: HashMap<&'static str, Arc<dyn Module>>,
    bus: Bus,
    touches: Arc<provenance::Touches>,
    observer: Option<PathBuf>,
    project_key: String,
}

impl Reader {
    pub fn new(
        modules: &HashMap<&'static str, Arc<dyn Module>>,
        bus: Bus,
        touches: Arc<provenance::Touches>,
        observer: Option<PathBuf>,
        project_key: String,
    ) -> Self {
        let modules = ["rail", "todo", "pad", "message"]
            .iter()
            .filter_map(|name| modules.get(name).map(|module| (*name, Arc::clone(module))))
            .collect();
        Self {
            agents: None,
            modules,
            bus,
            touches,
            observer,
            project_key,
        }
    }

    pub(crate) fn with_agents(mut self, agents: Arc<agents::Agents>) -> Self {
        self.agents = Some(agents);
        self
    }

    /// B21's isolated observer acknowledges the snapshot only after every push was judged.
    fn observed(&self, world: &World) {
        if let Some(path) = &self.observer {
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .expect("open Digest observer");
            writeln!(file, "{}", json!({"nodes":world.nodes,"todos":world.todos}))
                .expect("write Digest comparison acknowledgement");
            eprintln!("rupd: digest comparison complete");
        }
    }

    pub async fn call<T: DeserializeOwned>(
        &self,
        namespace: &'static str,
        method: &'static str,
        params: Value,
        actor: Actor,
    ) -> Result<T, RpcError> {
        let module = self
            .modules
            .get(namespace)
            .ok_or_else(|| RpcError::internal(format!("{namespace} module is not registered")))?;
        let ctx = Ctx {
            actor,
            bus: self.bus.clone(),
            touches: Arc::clone(&self.touches),
        };
        let value = module.call(&ctx, method, params).await?;
        serde_json::from_value(value).map_err(RpcError::internal)
    }

    /// Agent-state decisions need no other snapshot sources.
    pub(crate) async fn rail(&self) -> Result<Vec<contracts::agent::RailNode>, RpcError> {
        self.call("rail", "rail.tree", Value::Null, Actor::daemon())
            .await
    }

    /// The Rail, the Todos, the Pads and every Message.
    pub async fn world(&self) -> Result<World, RpcError> {
        let daemon = Actor::daemon;
        let pads: Vec<contracts::pad::Pad> =
            self.call("pad", "pad.list", Value::Null, daemon()).await?;
        let mut touches = Vec::new();
        for pad in &pads {
            touches.extend(
                self.touches
                    .history(&format!("pad:{}", pad.name))
                    .map_err(RpcError::internal)?,
            );
        }
        Ok(World {
            nodes: self.rail().await?,
            todos: self
                .call("todo", "todo.list", Value::Null, daemon())
                .await?,
            pads,
            touches,
            completed: self
                .agents
                .as_ref()
                .map_or_else(HashMap::new, |agents| agents.completed_text()),
            // The user sees every Message; `message.list` shows the Daemon only its own.
            messages: self
                .call("message", "message.list", json!({}), Actor::user())
                .await?,
            project_key: self.project_key.clone(),
        })
    }
}

pub struct World {
    completed: HashMap<String, (String, i64, i64, String)>,
    nodes: Vec<contracts::agent::RailNode>,
    todos: Vec<contracts::todo::Todo>,
    pads: Vec<contracts::pad::Pad>,
    touches: Vec<contracts::Touch>,
    messages: Vec<Message>,
    project_key: String,
}

impl World {
    pub fn nodes(&self) -> &[contracts::agent::RailNode] {
        &self.nodes
    }

    pub fn todos(&self) -> Vec<contracts::todo::Todo> {
        self.todos.clone()
    }

    pub fn sources(&self) -> messages::digest::Sources<'_> {
        messages::digest::Sources {
            completed: self.completed.clone(),
            nodes: &self.nodes,
            todos: &self.todos,
            pads: &self.pads,
            touches: self.touches.clone(),
            messages: &self.messages,
            project_key: &self.project_key,
        }
    }
}

/// DCL4: how often a pass compares the Rail with what was told, whether or not an event came.
const REPAIR_PERIOD: std::time::Duration = std::time::Duration::from_secs(30);

/// B21: whether `data` can change an entry of a digest.
fn moves_an_entry(data: &EventData) -> bool {
    matches!(
        data,
        EventData::AgentStatus(_)
            | EventData::TodoCreated(_)
            | EventData::TodoUpdated(_)
            | EventData::TodoDeleted(_)
            | EventData::PadChanged(_)
            | EventData::PadDeleted(_)
            | EventData::RailChanged
    )
}

/// B21: on each change that may alter a child's entry, send its Door one Message from the
/// Daemon, kind `note`, with that entry. Runs until the Bus closes.
pub async fn push_changes(
    reader: Reader,
    messages: Arc<messages::Messages>,
    seen: Arc<messages::digest::Seen>,
    mut events: tokio::sync::broadcast::Receiver<contracts::Event>,
) {
    // DCL10: a stored told book is compared with the Rail, so a fact told before the stop stays
    // told and one changed while stopped is queued once. With none, what is there is not news:
    // record it as told before the first event is judged.
    if seen.has_told() {
        if let Err(err) = push_once(&reader, &messages, &seen).await {
            eprintln!("rupd: digest push failed: {err}");
        }
    } else if let Ok(world) = reader.world().await {
        seen.baseline(&world.sources());
        reader.observed(&world);
    }
    // DCL4: no event stream is authoritative, so a pass also runs every `REPAIR_PERIOD`.
    let mut timer =
        tokio::time::interval_at(tokio::time::Instant::now() + REPAIR_PERIOD, REPAIR_PERIOD);
    loop {
        tokio::select! {
            _ = timer.tick() => {}
            received = events.recv() => match received {
                Ok(event) if moves_an_entry(&event.data) => {}
                Ok(_) => continue,
                // Events were missed: the next comparison with what was told finds their effect.
                Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => return,
            },
        }
        if let Err(err) = push_once(&reader, &messages, &seen).await {
            eprintln!("rupd: digest push failed: {err}");
        }
    }
}

async fn push_once(
    reader: &Reader,
    messages: &messages::Messages,
    seen: &messages::digest::Seen,
) -> Result<(), RpcError> {
    let world = reader.world().await?;
    for push in seen.changed(&world.sources()) {
        // Messages owns waiting and retry weights; releasing Seen here would count a refusal
        // again as a new change when the next comparison runs.
        messages
            .push_digest(&push.meta, push.subagent(), &push.entry)
            .await;
    }
    reader.observed(&world);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::Duration;

    use async_trait::async_trait;
    use tokio::sync::mpsc;

    use super::*;

    struct Pads {
        listed: Mutex<Vec<contracts::pad::Pad>>,
        reads: mpsc::UnboundedSender<Vec<contracts::pad::Pad>>,
    }

    #[async_trait]
    impl Module for Pads {
        fn namespaces(&self) -> &'static [&'static str] {
            &["pad"]
        }

        async fn call(&self, _: &Ctx, method: &str, _: Value) -> Result<Value, RpcError> {
            assert_eq!(method, "pad.list");
            let listed = self.listed.lock().unwrap().clone();
            self.reads.send(listed.clone()).unwrap();
            rpc::reply(&listed)
        }
    }

    #[tokio::test]
    async fn a34_pad_deleted_refreshes_the_digests_pad_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::Daemon::open(&dir.path().join("data")).unwrap();
        let (reads, mut snapshots) = mpsc::unbounded_channel();
        let pads = Arc::new(Pads {
            listed: Mutex::new(vec![contracts::pad::Pad {
                incarnation: "1".into(),
                name: "plan".into(),
                text: "keep this".into(),
                updated_at: 0,
                revision: 1,
                home: None,
            }]),
            reads,
        });
        let mut modules = daemon.modules.clone();
        modules.insert("pad", pads.clone());
        let bus = Bus::new();
        let reader = Reader::new(
            &modules,
            bus.clone(),
            daemon.touches.clone(),
            None,
            String::new(),
        );
        let task = tokio::spawn(push_changes(
            reader,
            daemon.sender.get().unwrap().clone(),
            Arc::new(messages::digest::Seen::default()),
            bus.subscribe(),
        ));
        let initial = tokio::time::timeout(Duration::from_secs(5), snapshots.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(initial[0].name, "plan");
        pads.listed.lock().unwrap().clear();
        bus.emit(
            Actor::daemon(),
            EventData::PadDeleted(contracts::pad::PadName {
                name: "plan".into(),
            }),
        );
        let refreshed = tokio::time::timeout(Duration::from_secs(5), snapshots.recv()).await;
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(refreshed.unwrap().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn dcl4_timer_repairs_a_lost_notification() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::Daemon::open(&dir.path().join("data")).unwrap();
        let (reads, mut snapshots) = mpsc::unbounded_channel();
        let pads = Arc::new(Pads {
            listed: Mutex::new(Vec::new()),
            reads,
        });
        let mut modules = daemon.modules.clone();
        modules.insert("pad", pads.clone());
        let bus = Bus::new();
        let reader = Reader::new(
            &modules,
            bus.clone(),
            daemon.touches.clone(),
            None,
            String::new(),
        );
        let task = tokio::spawn(push_changes(
            reader,
            daemon.sender.get().unwrap().clone(),
            Arc::new(messages::digest::Seen::default()),
            bus.subscribe(),
        ));
        snapshots.recv().await.unwrap();
        // No event is emitted: only the timer can make the next comparison read the world.
        tokio::time::advance(REPAIR_PERIOD + Duration::from_secs(1)).await;
        let repaired = snapshots.recv().await;
        task.abort();
        assert!(repaired.is_some());
    }
}
