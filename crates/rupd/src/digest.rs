//! B19 to B21: the Daemon reads the Rail, the Todos, the Pads and the Messages together, which no
//! module does alone, to answer `agent.digest` and to push a child's change to its Door.

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;

use crate::facts::{Facts, STALL_MS};
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

    pub(crate) fn agents(&self) -> Option<&Arc<agents::Agents>> {
        self.agents.as_ref()
    }

    /// B21's isolated observer acknowledges the snapshot only after every push was judged.
    fn observed(&self, world: &World) {
        if let Some(path) = &self.observer {
            let written = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .and_then(|mut file| {
                    writeln!(file, "{}", json!({"nodes":world.nodes,"todos":world.todos}))
                });
            match written {
                Ok(()) => eprintln!("rupd: digest comparison complete"),
                Err(err) => eprintln!("rupd: digest comparison was not acknowledged: {err}"),
            }
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
            stalled: self
                .agents
                .as_ref()
                .map_or_else(Default::default, |agents| agents.stalled(STALL_MS)),
            compactions: self
                .agents
                .as_ref()
                .map_or_else(HashMap::new, |agents| agents.compactions()),
            // The user sees every Message; `message.list` shows the Daemon only its own.
            messages: self
                .call("message", "message.list", json!({}), Actor::user())
                .await?,
            project_key: self.project_key.clone(),
        })
    }
}

pub struct World {
    compactions: HashMap<String, u64>,
    stalled: std::collections::HashSet<String>,
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

    pub(crate) fn messages(&self) -> &[Message] {
        &self.messages
    }

    pub(crate) fn compactions(&self) -> &HashMap<String, u64> {
        &self.compactions
    }

    pub(crate) fn stalled(&self) -> &std::collections::HashSet<String> {
        &self.stalled
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
    settlements: Arc<crate::settlement::Settlements>,
    tell: Option<Arc<crate::workstream_state::Tell>>,
    mut events: tokio::sync::broadcast::Receiver<contracts::Event>,
) {
    // DCL4: a change told before the Daemon ended and never queued is queued now, once; the
    // ledger's write removes its intent.
    for intent in seen.intents() {
        for _ in 0..intent.weight {
            messages
                .push_digest(&intent.door, &intent.child, &intent.entry, intent.waking)
                .await;
        }
    }
    // DCL10: a stored told book is compared with the Rail, so a fact told before the stop stays
    // told and one changed while stopped is queued once. With none, what is there is not news:
    // record it as told before the first event is judged.
    let mut facts = Facts::default();
    if seen.has_told() {
        if let Err(err) = push_once(&reader, &messages, &seen, &settlements, &mut facts).await {
            eprintln!("rupd: digest push failed: {err}");
        }
    } else if let Ok(world) = reader.world().await {
        seen.baseline(&world.sources());
        reader.observed(&world);
    }
    // DCL4: no event stream is authoritative, so a pass also runs every `REPAIR_PERIOD`.
    let mut timer =
        tokio::time::interval_at(tokio::time::Instant::now() + REPAIR_PERIOD, REPAIR_PERIOD);
    // DCL6: a Door's quiet period ends here, so its settled note does not wait for an event.
    let mut quiet: Option<std::time::Duration> = None;
    loop {
        tokio::select! {
            _ = timer.tick() => {}
            () = async { tokio::time::sleep(quiet.unwrap_or_default()).await }, if quiet.is_some() => {}
            received = events.recv() => match received {
                Ok(event) if moves_an_entry(&event.data) => {}
                Ok(_) => continue,
                // Events were missed: the next comparison with what was told finds their effect.
                Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => return,
            },
        }
        match push_once(&reader, &messages, &seen, &settlements, &mut facts).await {
            Ok(wait) => quiet = wait,
            Err(err) => eprintln!("rupd: digest push failed: {err}"),
        }
        // U6243a: a push moves a waiting count and sends no event, so the pass that read the
        // count before it lands is asked to read again.
        if let Some(tell) = &tell {
            tell.recheck.notify_one();
        }
    }
}

async fn push_once(
    reader: &Reader,
    messages: &messages::Messages,
    seen: &messages::digest::Seen,
    settlements: &crate::settlement::Settlements,
    facts: &mut Facts,
) -> Result<Option<std::time::Duration>, RpcError> {
    let world = reader.world().await?;
    for push in seen.changed(&world.sources()) {
        // Messages owns waiting and retry weights; releasing Seen here would count a refusal
        // again as a new change when the next comparison runs.
        messages
            .push_digest(&push.meta, push.subagent(), &push.entry, push.waking)
            .await;
    }
    // DTC2: a quiet note waits for the Message that settles the Workstream, so it is no wait.
    let waiting = messages.waiting_counts_unquiet().await.unwrap_or_default();
    let deferred = messages.deferred_digests().await.unwrap_or_default();
    let quiet =
        crate::settlement::settle(reader, messages, settlements, &world, &waiting, &deferred).await;
    facts.publish(reader, &world).await;
    reader.observed(&world);
    Ok(quiet)
}

#[cfg(test)]
mod tests {
    use parking_lot::Mutex;
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
            let listed = self.listed.lock().clone();
            self.reads.send(listed.clone()).unwrap();
            rpc::reply(&listed)
        }
    }

    #[tokio::test]
    async fn a34_pad_deleted_refreshes_the_digests_pad_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::Daemon::open(&dir.path().join("data")).unwrap().0;
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
            Arc::new(crate::settlement::Settlements::in_memory().unwrap()),
            None,
            bus.subscribe(),
        ));
        let initial = tokio::time::timeout(Duration::from_secs(5), snapshots.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(initial[0].name, "plan");
        pads.listed.lock().clear();
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
        let daemon = crate::Daemon::open(&dir.path().join("data")).unwrap().0;
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
            Arc::new(crate::settlement::Settlements::in_memory().unwrap()),
            None,
            bus.subscribe(),
        ));
        snapshots.recv().await.unwrap();
        // No event is emitted: only the timer can make the next comparison read the world.
        tokio::time::advance(REPAIR_PERIOD + Duration::from_secs(1)).await;
        let repaired = snapshots.recv().await;
        task.abort();
        assert!(repaired.is_some());
    }

    /// One Daemon life on a runtime of its own: dropping it ends every task at its next await
    /// with nothing flushed, as a kill does, while storage keeps what was committed.
    struct Life {
        rt: tokio::runtime::Runtime,
        daemon: crate::Daemon,
        state: Arc<crate::test_support::ReplyState>,
        killed: Arc<tokio::sync::Notify>,
        messages: Arc<messages::Messages>,
    }

    impl Life {
        /// The Door "1" with `children` children, idle, `kill_at` naming the Messages operation
        /// at which the life ends.
        fn open(
            dir: &std::path::Path,
            clock: &Arc<std::sync::atomic::AtomicI64>,
            kill_at: Option<&'static str>,
            children: usize,
        ) -> Self {
            use std::sync::atomic::{AtomicBool, Ordering};
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            let _entered = rt.enter();
            let killed = Arc::new(tokio::sync::Notify::new());
            let (hook, armed) = (Arc::clone(&killed), AtomicBool::new(true));
            let clock = Arc::clone(clock);
            let (daemon, _watchers, state, messages) = crate::test_support::reply_daemon_with(
                dir,
                true,
                Arc::new(move || clock.load(Ordering::SeqCst)),
                Arc::new(move |op| {
                    if Some(op) == kill_at && armed.swap(false, Ordering::SeqCst) {
                        hook.notify_one();
                        std::panic::resume_unwind(Box::new("killed"));
                    }
                    Ok(())
                }),
            );
            tokio::spawn(push_changes(
                daemon.reader(),
                Arc::clone(&messages),
                Arc::clone(&daemon.digests),
                Arc::new(crate::settlement::Settlements::in_memory().unwrap()),
                None,
                daemon.bus.subscribe(),
            ));
            let life = Self {
                rt,
                daemon,
                state,
                killed,
                messages,
            };
            life.state.status("1", contracts::Kind::Idle);
            life.add_children(0, children);
            life
        }

        fn add_children(&self, from: usize, to: usize) {
            let mut nodes = self.state.nodes.lock();
            for i in from..to {
                let mut node = nodes[1].clone();
                node.id = format!("c{i}");
                node.name = node.id.clone();
                node.parent = Some("1".into());
                node.terminal_id = Some(format!("t-c{i}"));
                // An error is news: a quiet digest would wait in the inbox queue unwritten (B5168f).
                node.status = Some(contracts::Status {
                    kind: contracts::Kind::Error,
                    label: String::new(),
                    since: 0,
                    finished: "0".into(),
                });
                nodes.push(node);
            }
        }

        fn told_rows(&self) -> i64 {
            rusqlite::Connection::open(self.daemon.project.join("project.db"))
                .unwrap()
                .query_row("SELECT count(*) FROM door_told", [], |row| row.get(0))
                .unwrap()
        }

        /// What the Door's digests account for: each kept digest weighs the changes it holds.
        async fn accounted(&self) -> u32 {
            // Not through `dispatch`, which would start the Daemon's own push watcher beside this one.
            let listed = self
                .messages
                .call(
                    &self.daemon.ctx(Actor::user()),
                    "message.list",
                    json!({"to":"1"}),
                )
                .await
                .unwrap();
            // A rollup or merge states its count first; a plain push stands for one; `None`: no digest.
            let weight = |m: &Value| -> Option<u32> {
                let body = m["body"].as_str()?.strip_prefix("[digest] ")?;
                Some(
                    body.strip_prefix('[')
                        .and_then(|head| head.split(' ').next()?.parse().ok())
                        .unwrap_or(1),
                )
            };
            let digests = listed.as_array().unwrap();
            let live: u32 = digests
                .iter()
                .filter(|m| m["status"] != "dropped")
                .filter_map(weight)
                .sum();
            // `waiting_counts` weighs a pending Message that is no digest as one.
            let pending: u32 = digests
                .iter()
                .filter(|m| m["status"] == "pending")
                .map(|m| weight(m).unwrap_or(1))
                .sum();
            // DTC2: a quiet change waits in the ledger for the Door's next turn; it is accounted for.
            let waiting = self
                .messages
                .waiting_counts()
                .await
                .unwrap()
                .get("1")
                .copied()
                .unwrap_or(0);
            live + waiting.saturating_sub(pending)
        }
    }

    /// DCL4: a Daemon killed at each delivery boundary of a burst recovers every child fact once,
    /// with no event after the reopen.
    #[test]
    fn dcl4_burst_crash_at_each_delivery_boundary_replays_all_facts() {
        use std::sync::atomic::{AtomicI64, Ordering};
        const FACTS: usize = 100;
        // (a) told, not queued; (b) queued, not written to the inbox; (c) written, no receipt.
        for kill_at in [Some("push.queue"), Some("push"), None] {
            let dir = tempfile::tempdir().unwrap();
            let clock = Arc::new(AtomicI64::new(1000));
            // The first life records `c0` as told: a later start then compares with it.
            let first = Life::open(dir.path(), &clock, None, 1);
            first.rt.block_on(async {
                while first.told_rows() == 0 {
                    tokio::task::yield_now().await;
                }
            });
            drop(first.rt);
            drop(first.daemon);
            // The stored facts arrive in a life that is killed while it delivers them.
            let second = Life::open(dir.path(), &clock, kill_at, 1);
            second.add_children(1, FACTS + 1);
            second.rt.block_on(async {
                // DTC2: the changes are quiet, so a Message the Door takes carries them out.
                if kill_at != Some("push.queue") {
                    second
                        .messages
                        .call(
                            &second.daemon.ctx(Actor::user()),
                            "message.send",
                            json!({"to":"1","kind":"note","body":"wake"}),
                        )
                        .await
                        .unwrap();
                }
                let reached = tokio::time::timeout(Duration::from_secs(5), async {
                    match kill_at {
                        Some("push.queue") => second.killed.notified().await,
                        // The Door's next idle takes the pending digests to its inbox.
                        _ => loop {
                            second.state.status("1", contracts::Kind::Working);
                            second.state.status("1", contracts::Kind::Idle);
                            let reached = async {
                                match kill_at {
                                    Some(_) => second.killed.notified().await,
                                    None => second.state.written.notified().await,
                                }
                            };
                            if tokio::time::timeout(Duration::from_millis(50), reached)
                                .await
                                .is_ok()
                            {
                                break;
                            }
                        },
                    }
                })
                .await;
                reached.unwrap_or_else(|_| {
                    panic!("the life reaches its delivery boundary at {kill_at:?}")
                });
            });
            drop(second.rt);
            drop(second.daemon);
            // The same Project reopens and no event follows: its start recovers every fact.
            let third = Life::open(dir.path(), &clock, None, FACTS + 1);
            let accounted = third.rt.block_on(async {
                tokio::time::timeout(Duration::from_secs(5), async {
                    loop {
                        clock.fetch_add(60_001, Ordering::SeqCst);
                        let total = third.accounted().await;
                        if total >= u32::try_from(FACTS).unwrap() {
                            break total;
                        }
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap_or(0)
            });
            assert_eq!(accounted, 100, "kill at {kill_at:?}");
            // Further passes duplicate nothing.
            third.rt.block_on(async {
                clock.fetch_add(60_001, Ordering::SeqCst);
                for _ in 0..1000 {
                    tokio::task::yield_now().await;
                }
                assert_eq!(third.accounted().await, 100, "kill at {kill_at:?} repeated");
            });
        }
    }
}
