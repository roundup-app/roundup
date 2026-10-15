//! Agents, the Rail tree and the Claude Code adapter. Owner: agents Builder.

mod schema;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use contracts::agent::{
    Channel, ChannelEvent, CreateWorkstreamParams, KeptItem, KeptReason, Landed, MoveParams,
    NodeId, NodeKind, Order, PromptParams, RailNode, Removal, RemovalKind, RemovedItem,
    RenameParams, RunParams, SetModelParams, SetOrderParams, SignalParams, SpawnParams,
    StartDoorParams, StatusEvent, Stray, StrayEvent, WorktreeState,
};
use contracts::decision::{AnswerParams, AskParams, CaptureParams, Outcome, PermissionParams};
use contracts::project::{ProjectModels, ProjectSettings, Worktrees};
use contracts::terminal::{OpenParams, Opened, SpawnParams as TerminalSpawn};
use contracts::{Actor, ActorKind, EventData, Kind, Status};
use rpc::{Bus, Ctx, Module, OpenError, RpcError, code, params, reply};
use serde_json::Value;
use terminal::Terminals;
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::oneshot;
use tokio::time::{Instant, sleep_until};

pub mod claude_code;
mod decision;
pub mod marks;
mod models;
pub use models::labelled as model_choices;
mod name;
mod order;
mod peer;
mod rail;
mod scan;
pub mod worktree;

use claude_code::{ClaudeCode, Launcher, Pair, Role};

/// One input an adapter reads about its Agent.
pub enum Observation {
    /// A structured event the Agent's own tooling pushed; for Claude Code, a hook payload.
    Signal(Value),
    /// The window title the Agent's program set.
    Title(String),
    /// The clock reached the time the adapter asked for (see `ClaudeCode::tick_at`).
    Tick,
    /// Roundup stopped the Agent's program on purpose.
    Stopped,
    /// The Agent's program ended. `None` when it was killed by a signal.
    Exit { code: Option<i32> },
    /// The user's `decision.answer` reached the hook (`scenarios/decisions.md` H9).
    Answered,
    /// The hook's own side closed its connection with no later Signal (H7(b), H9).
    Dismissed,
}

impl Observation {
    /// The word a log line names this Observation by; a Signal by its vendor event.
    fn name(&self) -> &str {
        match self {
            Self::Signal(payload) => claude_code::event_name(payload),
            Self::Title(_) => "title",
            Self::Tick => "tick",
            Self::Stopped => "stop",
            Self::Exit { .. } => "exit",
            Self::Answered => "answer",
            Self::Dismissed => "dismissal",
        }
    }
}

/// Turns one vendor's program into an Agent's Status. It emits `error`, `needs-you`, `working`,
/// `idle` and `done`, never `blocked`: that Kind is the Daemon's, from Todos and Routes.
pub trait AgentAdapter {
    /// Fold one Observation into the Status. `None` means no change.
    fn observe(&mut self, observation: Observation) -> Option<Status>;
}

/// Whether an Agent's Terminal is under Takeover, asked before the Daemon writes into it.
type TakeoverProbe = Arc<dyn Fn(&str) -> bool + Send + Sync>;
type SteerEffect = Arc<dyn Fn(&str) -> Result<(), RpcError> + Send + Sync>;

/// H19: told, under the Agents' locks, each gate decision as `(agent id, released)`.
type GateObserver = Arc<dyn Fn(&str, bool) + Send + Sync>;

/// State the Terminal watchers and the RPC calls share.
/// A33: an `idle` Status of an Agent that waits on blocker `wait` reads `blocked`; every other
/// Kind keeps its own.
fn waiting_on(status: &Status, wait: Option<u32>) -> Status {
    match (status.kind, wait) {
        (Kind::Idle, Some(blocker)) => Status {
            kind: Kind::Blocked,
            label: format!("waits on #{blocker}"),
            since: status.since,
        },
        _ => status.clone(),
    }
}

struct Shared {
    git: worktree::Git,
    project_dir: PathBuf,
    rail: Mutex<rail::Rail>,
    /// A node is marked `Starting`, and unmarked on failure, in the same Rail critical section
    /// that creates or reserves it, so `agent.stop` never finds a starting node unmarked.
    runs: Mutex<HashMap<String, Slot>>,
    bus: Bus,
    terminals: Arc<Terminals>,
    /// The same Terminals, behind the seam `stop` and `remove` kill through: real in production,
    /// a fake in the one test that proves a failed kill deletes nothing (A16), since `Terminals`
    /// is a concrete type a test cannot otherwise make fail on demand.
    kill: Arc<dyn KillsTerminals>,
    /// Milliseconds since the Unix epoch. Adapters stamp Statuses with it and the watchers time
    /// Ticks by it, so the two never disagree about when a hold ends.
    clock: Clock,
    /// Since when an Agent without a Terminal has been `done`.
    opened: i64,
    /// H2 to H7: the open permission Decisions, in memory only.
    decisions: decision::Decisions,
    /// Itself, so a Signal's fold can start H12's first Steer on a task of its own.
    me: Weak<Shared>,
    /// H11: how long a Steer waits for its `UserPromptSubmit` Signal.
    steer_bound: Duration,
    before_steer: Option<SteerEffect>,
    /// H19: a test's observer of each gate decision; absent in production.
    gate_observer: Option<GateObserver>,
    /// H13: how long an Interrupt waits for the title to change.
    interrupt_bound: Duration,
    /// E6: the Channel of each Agent's current Attempt that has left `pending`, as
    /// `(attempt, channel)`; an entry of an earlier Attempt reads as `pending`.
    channels: Mutex<HashMap<String, (String, Channel)>>,
    /// O4: whether a Takeover of the Agent is active, which keeps a changed order from being
    /// sent to it. Without one, none is.
    takeover: Option<TakeoverProbe>,
    /// A33: the lowest open blocker of the Todos each Agent created that wait; an idle Agent in
    /// it reads `blocked`.
    waits: Mutex<HashMap<String, u32>>,
    /// E6: how long after a start `agent.channelUp` may take before the Channel is `missing`.
    channel_deadline: Duration,
    /// F5: the scan of the Doors' process trees.
    scan: Scan,
}

/// What kills a Terminal's program; real `Terminals` in production, a fake where a test needs a
/// kill that fails without a real process refusing to die.
#[async_trait]
trait KillsTerminals: Send + Sync {
    async fn kill(&self, id: &str) -> Result<(), RpcError>;
}

#[async_trait]
impl KillsTerminals for Terminals {
    async fn kill(&self, id: &str) -> Result<(), RpcError> {
        Terminals::kill(self, id).await
    }
}

/// How long `kill_or_already_gone` waits for the Terminal's own exit event once the program is
/// reaped, before giving up on it. `kill` sends SIGHUP then, after a ~250ms grace period
/// (`portable_pty`'s own `Child::kill`), SIGKILL to the program's single pid, never to its
/// process group; a descendant the program backgrounded before dying inherits the slave end of
/// the PTY and, if it also inherited SIGHUP ignored, outlives the signal that was meant to end
/// it, which would otherwise keep this wait from ever ending. Comfortably above that grace period
/// and the reader thread's scheduling delay under load (`a16_a_running_terminal_is_killed_and_removed`'s
/// stress run).
pub const KILL_WAIT_BOUND: Duration = Duration::from_secs(2);

/// A22: how long `agent.resume` waits, on the injected clock, for the new Attempt's
/// acknowledging `SessionStart` before it fails with `CONFLICT` and rolls back.
pub const RESUME_ACK_BOUND: Duration = Duration::from_secs(10);

/// A24: how long `rail.startDoor` waits for that acknowledgement. Below A24's 10 000 ms bound on
/// the whole call, which also covers the rollback that follows the wait.
pub const START_DOOR_ACK_BOUND: Duration = Duration::from_secs(8);

/// A guarded effect keeps Agent locks until its IO finishes. A contending async
/// worker yields its reactor duties before waiting, so Signals and effect completion
/// remain schedulable. The uncontended path and non-reactor callers need no handoff.
fn agent_lock<T>(mutex: &Mutex<T>) -> std::sync::LockResult<MutexGuard<'_, T>> {
    match mutex.try_lock() {
        Ok(guard) => Ok(guard),
        Err(std::sync::TryLockError::Poisoned(err)) => Err(err),
        Err(std::sync::TryLockError::WouldBlock) => {
            if tokio::runtime::Handle::try_current().is_ok_and(|handle| {
                handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread
            }) {
                tokio::task::block_in_place(|| mutex.lock())
            } else {
                mutex.lock()
            }
        }
    }
}

type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// What `Shared::apply` leaves to do once its locks are let go: the first prompt to Steer at the
/// first `SessionStart` (H12), and when, on `clock`, the adapter wants its next
/// `Observation::Tick`.
type Applied = (Option<String>, Option<i64>);

/// H11: how long a Steer waits for its `UserPromptSubmit` Signal before `NOT_ACCEPTED`.
pub const STEER_BOUND: Duration = Duration::from_secs(10);

/// H13: how long an Interrupt waits for the title to change before `NOT_ACKED`.
pub const INTERRUPT_BOUND: Duration = Duration::from_secs(5);

/// E6: how long after a start the Channel may stay `pending`. `ROUNDUP_CHANNEL_DEADLINE_MS`
/// shortens it for a test.
pub const CHANNEL_DEADLINE: Duration = Duration::from_secs(15);

/// Why a Steer (`Agents::prompt`) did not land (H11).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PromptError {
    /// The Agent is not `idle`, or its last Steer is still waiting to be submitted.
    Busy { id: String, kind: Kind },
    /// The text was written (or could not be) and no `UserPromptSubmit` Signal followed; the
    /// Terminal's input line keeps it and nothing is sent again.
    NotAccepted { id: String },
    /// No Agent `id` is running.
    NotFound { id: String },
}

impl std::fmt::Display for PromptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy { id, kind } => write!(f, "agent {id} is {kind:?}, not idle"),
            Self::NotAccepted { id } => write!(f, "agent {id} did not accept the prompt"),
            Self::NotFound { id } => write!(f, "agent {id} is not running"),
        }
    }
}

impl std::error::Error for PromptError {}

impl From<PromptError> for RpcError {
    fn from(error: PromptError) -> Self {
        let message = error.to_string();
        match error {
            PromptError::Busy { .. } => Self::busy(message),
            PromptError::NotAccepted { .. } => Self::not_accepted(message),
            PromptError::NotFound { .. } => Self::not_found(message),
        }
    }
}

/// B6: keep a refusal before bytes distinct from an effect without completion evidence.
/// F5: how long between two reads of the process table. `ROUNDUP_SCAN_MS` shortens it for a test.
pub const SCAN_INTERVAL: Duration = Duration::from_millis(2000);

/// A node's place in `Shared::runs`.
enum Slot {
    /// Its Terminal is starting; `since` is when, on `clock`, it was marked.
    Starting {
        attempt: String,
        since: i64,
        /// A `rail.rename` came while it started; its first prompt must not undo it.
        named: bool,
        /// Signals that reached `agent.signal` in this window, in arrival order, applied once
        /// the Agent is registered (A14).
        held: VecDeque<(Actor, Value)>,
    },
    /// A22: a resume's launch is pending acknowledgement; `since` is when, on `clock`, it began.
    Resuming {
        attempt: String,
        since: i64,
        /// The stashed exited Run, presented and restored on rollback; `None` when there was
        /// nothing to restore (a reopened Agent with no live Run, A12).
        old: Option<Box<Run>>,
        /// The saved conversation id the ack must name.
        conversation_id: String,
        /// The directory the new Attempt runs in, saved alongside the conversation id (A21)
        /// once the ack confirms it.
        cwd: String,
        /// A35 reserves this prompt before the acknowledging Status can admit Messages.
        prompt: Option<String>,
        /// H19: retain a ready title arriving before the ack, so the first prompt can enter.
        starred: bool,
        /// The Terminal this launch started, once `agent.resume` has spawned it; `None` until
        /// then, so a Signal cannot arrive for it any earlier.
        terminal_id: Option<String>,
        /// Signals held exactly as `Starting`'s, awaiting the ack among them (A14).
        held: VecDeque<(Actor, Value)>,
        /// Signalled once by whichever of the ack or the 10 s timeout resolves this resume
        /// first; the loser finds the slot already gone and does nothing (A22's serialization).
        done: tokio::sync::oneshot::Sender<Result<(), RpcError>>,
    },
    Running(Run),
    Closing,
}

impl Slot {
    fn attempt(&self) -> &str {
        match self {
            Self::Starting { attempt, .. } | Self::Resuming { attempt, .. } => attempt,
            Self::Running(run) => &run.attempt,
            Self::Closing => "",
        }
    }
    fn closing(&self) -> bool {
        matches!(self, Self::Closing) || matches!(self, Self::Running(run) if run.closing)
    }

    /// The node's name is final: no prompt renames it.
    fn settle_name(&mut self) {
        match self {
            Self::Running(run) => run.named = true,
            Self::Starting { named, .. } => *named = true,
            Self::Resuming { .. } | Self::Closing => {}
        }
    }
}

enum FirstPrompt {
    Reserved,
    Written,
    Acknowledged,
}

struct Run {
    attempt: String,
    status_revision: i64,
    closing: bool,
    ended: bool,
    adapter: ClaudeCode,
    /// H12: sent as a Steer at the first `SessionStart`, then gone.
    prompt: Option<String>,
    /// H12: the first Steer has not yet been written, or dropped; no Message is typed before it.
    first_pending: bool,
    /// Retained after the first Steer acknowledgement so a dropped coordinator can retry.
    first_prompt: Option<FirstPrompt>,
    /// H19: the first `SessionStart` Signal has arrived.
    session_started: bool,
    /// H19: the first title with the star glyph has arrived.
    starred: bool,
    /// H11: the Steer written and awaiting its `UserPromptSubmit` Signal.
    steer: Option<tokio::sync::oneshot::Sender<()>>,
    /// H13: the Interrupt written and awaiting the title that acknowledges it.
    interrupt: Option<tokio::sync::oneshot::Sender<()>>,
    /// The first prompt has been submitted, or a `rail.rename` came first: either way the name
    /// is settled and no prompt renames the node.
    named: bool,
    terminal_id: String,
    /// A21: the effective working directory this launch runs in, after Worktree mapping; saved
    /// to `agents.db` alongside the conversation id the first Signal to name one carries.
    cwd: String,
}

/// `spawn` registers an Agent before its watcher starts, so the watcher always finds it.
const REGISTERED: &str = "a watched Agent is registered";
/// G6: a legacy Worktree record from before ownership proofs; nothing may clean it up.
/// Facts for binding Messages to the receiver of a Terminal at the lifecycle cut.
/// These are not a Rail presentation or permission to Steer the receiver.
#[derive(Debug, PartialEq, Eq)]
pub struct TerminalOwner {
    pub id: String,
    /// Persisted Attempt, matching `RailNode.attempt`, including during pending resume.
    pub attempt: Option<String>,
    /// Active Status revision; absence permanently ends this attached receiver (B36).
    pub status_revision: Option<String>,
    /// B9: no Status, or a done/error Status, ends this receiver.
    pub ended: bool,
}

pub struct Agents {
    shared: Arc<Shared>,
    dir: PathBuf,
    launcher: Launcher,
}

mod dispatch;
mod door;
mod ending;
mod events;
mod model_wiring;
mod rail_view;
mod registration;
mod removal;
mod resume;
mod spawn;
mod steer;
mod store;
mod worktree_wiring;

use door::{Scan, scan_interval_from_env};
use ending::{Ending, RailPublication};
use events::{channel_deadline_from_env, channel_in, watch};
use rail_view::valid_order;
use registration::{hold, save_signal_conversation};
use steer::SteerError;
use worktree_wiring::{report_undo, valid_explicit_order};

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use async_trait::async_trait;
    use contracts::agent::NodeKind;
    use contracts::terminal::TitleEvent;
    use contracts::{Actor, Event, EventData, Kind};
    use rpc::Bus;
    use serde_json::json;
    use terminal::Terminals;
    use tokio::sync::broadcast;
    use tokio::task::JoinHandle;
    use tokio::time::Instant;

    use crate::claude_code::ClaudeCode;
    use crate::{Clock, KillsTerminals, Observation, Run, Shared, Slot, rail, watch, worktree};

    pub(crate) const PATIENCE: Duration = Duration::from_secs(60);
    /// Spelled out, not `STAR_HOLD`, so a changed hold fails these tests.
    pub(crate) const HOLD: Duration = Duration::from_millis(200);
    /// Agent `1`, watched over a stand-in for its Terminal's events, on tokio's clock, which these
    /// tests pause.
    pub(crate) struct Watched {
        pub(crate) _dir: tempfile::TempDir,
        pub(crate) shared: Arc<Shared>,
        pub(crate) terminal: broadcast::Sender<EventData>,
        pub(crate) events: broadcast::Receiver<Event>,
        pub(crate) watcher: JoinHandle<()>,
    }

    impl Watched {
        pub(crate) fn start() -> Self {
            let begun = Instant::now();
            let clock: Clock = Arc::new(move || begun.elapsed().as_millis() as i64);
            let adapter_clock = Arc::clone(&clock);
            let (dir, bus, shared) = shared_over_temp_dir(clock);
            let run = Run {
                attempt: "1".into(),
                status_revision: 1,
                closing: false,
                ended: false,
                adapter: ClaudeCode::starting(move || adapter_clock()),
                prompt: None,
                first_pending: false,
                first_prompt: None,
                steer: None,
                session_started: false,
                starred: false,
                interrupt: None,
                named: false,
                terminal_id: "1".into(),
                cwd: "/".into(),
            };
            shared.runs().insert("1".into(), Slot::Running(run));
            let (terminal, terminal_events) = broadcast::channel(16);
            let events = bus.subscribe();
            let watcher = tokio::spawn(watch(
                Arc::clone(&shared),
                "1".into(),
                "1".into(),
                terminal_events,
            ));
            Self {
                _dir: dir,
                shared,
                terminal,
                events,
                watcher,
            }
        }

        pub(crate) fn signal(&self, event: &str) {
            let payload = json!({"hook_event_name": event, "tool_name": "Bash"});
            self.shared
                .observe(Actor::daemon(), "1", "1", Observation::Signal(payload))
                .unwrap();
        }

        pub(crate) fn send(&self, data: EventData) {
            self.terminal.send(data).unwrap();
        }

        pub(crate) fn star(&self) {
            self.send(EventData::TerminalTitle(TitleEvent {
                id: "1".into(),
                title: "\u{2733} Claude Code".into(),
            }));
        }

        /// The Kind of the next `agent.status`.
        pub(crate) async fn next_kind(&mut self) -> Kind {
            loop {
                let event = tokio::time::timeout(PATIENCE, self.events.recv())
                    .await
                    .expect("an agent.status in time")
                    .unwrap();
                if let EventData::AgentStatus(status) = event.data {
                    return status.status.kind;
                }
            }
        }

        /// Whether an `agent.status` is waiting.
        pub(crate) fn has_news(&mut self) -> bool {
            std::iter::from_fn(|| self.events.try_recv().ok())
                .any(|event| matches!(event.data, EventData::AgentStatus(_)))
        }
    }
    pub(crate) struct FailingKill;

    #[async_trait]
    impl KillsTerminals for FailingKill {
        async fn kill(&self, _id: &str) -> Result<(), rpc::RpcError> {
            Err(rpc::RpcError::internal("the kill failed"))
        }
    }

    pub(crate) struct FlakyKill(std::sync::atomic::AtomicBool);

    #[async_trait]
    impl KillsTerminals for FlakyKill {
        async fn kill(&self, _id: &str) -> Result<(), rpc::RpcError> {
            if self.0.swap(true, std::sync::atomic::Ordering::SeqCst) {
                Ok(())
            } else {
                Err(rpc::RpcError::internal("the kill failed"))
            }
        }
    }

    pub(crate) fn owner_agents(shared: Arc<Shared>, dir: &std::path::Path) -> crate::Agents {
        crate::Agents {
            shared,
            dir: dir.to_owned(),
            launcher: crate::Launcher::new(
                "unused",
                dir.join("claude.json"),
                dir.join("rup"),
                None,
            ),
        }
    }

    /// Each transition competes with an input record, then a fresh read observes its result.
    pub(crate) fn owner_transition(
        initially_attached: bool,
        transition: impl FnOnce(&Shared, &str, &std::path::Path) + Send,
        expected: Option<(&str, &str)>,
    ) {
        let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let id = shared
            .rail()
            .insert(
                NodeKind::Agent,
                "receiver",
                None,
                initially_attached.then_some("terminal"),
            )
            .unwrap()
            .id;
        let attempt = shared.rail().allocate_attempt(&id).unwrap();
        shared.mark_starting(&id, attempt);
        let agents = owner_agents(Arc::clone(&shared), dir.path());
        std::thread::scope(|scope| {
            let (start, started) = std::sync::mpsc::sync_channel(0);
            let (done, completed) = std::sync::mpsc::channel();
            let mut change = None;
            agents
                .with_terminal_owner("terminal", |owner| {
                    assert_eq!(owner.is_some(), initially_attached);
                    let shared = Arc::clone(&shared);
                    let id = id.clone();
                    let path = dir.path();
                    change = Some(scope.spawn(move || {
                        // Successful try_lock would mean the ownership cut is not protected.
                        assert!(matches!(
                            shared.rail.try_lock(),
                            Err(std::sync::TryLockError::WouldBlock)
                        ));
                        assert!(matches!(
                            shared.runs.try_lock(),
                            Err(std::sync::TryLockError::WouldBlock)
                        ));
                        start.send(()).unwrap();
                        transition(&shared, &id, path);
                        done.send(()).unwrap();
                    }));
                    started.recv_timeout(PATIENCE).unwrap();
                    assert!(matches!(
                        completed.try_recv(),
                        Err(std::sync::mpsc::TryRecvError::Empty)
                    ));
                    Ok(())
                })
                .unwrap();
            completed.recv_timeout(PATIENCE).unwrap();
            change.unwrap().join().unwrap();
        });
        agents
            .with_terminal_owner("terminal", |owner| {
                assert_eq!(
                    owner.map(|o| (o.id.as_str(), o.attempt.as_deref().unwrap())),
                    expected
                );
                Ok(())
            })
            .unwrap();
    }

    /// A `Shared` wired to a fresh temp-dir Rail and Terminals, paired with the `Bus` it was built
    /// from so a caller can subscribe to the same events.
    pub(crate) fn shared_over_temp_dir(clock: Clock) -> (tempfile::TempDir, Bus, Arc<Shared>) {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::new();
        let terminals = Arc::new(Terminals::open(dir.path(), bus.clone()).unwrap());
        let shared = Arc::new(Shared {
            git: worktree::Git::from_env(),
            project_dir: dir.path().to_owned(),
            rail: Mutex::new(rail::Rail::open(&dir.path().join("agents.db")).unwrap()),
            runs: Mutex::new(HashMap::new()),
            bus: bus.clone(),
            kill: Arc::clone(&terminals) as Arc<dyn crate::KillsTerminals>,
            terminals,
            clock,
            opened: 0,
            decisions: crate::decision::Decisions::new(None, Duration::from_secs(4)),
            me: std::sync::Weak::new(),
            steer_bound: crate::STEER_BOUND,
            before_steer: None,
            gate_observer: None,
            interrupt_bound: crate::INTERRUPT_BOUND,
            channels: Mutex::new(HashMap::new()),
            channel_deadline: crate::CHANNEL_DEADLINE,
            scan: crate::Scan::new(crate::SCAN_INTERVAL),
            takeover: None,
            waits: Mutex::new(HashMap::new()),
        });
        (dir, bus, shared)
    }

    /// A second connection holding a write transaction makes a write through `Rail`'s own
    /// connection fail with a real SQLite error once rusqlite's default 5 s `busy_timeout`
    /// elapses, without reaching into `Rail`'s private `db` field.
    pub(crate) fn lock_db_for_writes(dir: &std::path::Path) -> rusqlite::Connection {
        let lock = rusqlite::Connection::open(dir.join("agents.db")).unwrap();
        lock.execute_batch("BEGIN IMMEDIATE;").unwrap();
        lock
    }

    /// `Shared` wired like `shared_over_temp_dir`, but every kill fails.
    pub(crate) fn shared_with_a_failing_kill() -> Arc<Shared> {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::new();
        Arc::new(Shared {
            git: worktree::Git::from_env(),
            project_dir: dir.path().to_owned(),
            rail: Mutex::new(rail::Rail::open(&dir.path().join("agents.db")).unwrap()),
            runs: Mutex::new(HashMap::new()),
            bus: bus.clone(),
            terminals: Arc::new(Terminals::open(dir.path(), bus).unwrap()),
            kill: Arc::new(FailingKill),
            clock: Arc::new(|| 0),
            opened: 0,
            decisions: crate::decision::Decisions::new(None, Duration::from_secs(4)),
            me: std::sync::Weak::new(),
            steer_bound: crate::STEER_BOUND,
            before_steer: None,
            gate_observer: None,
            interrupt_bound: crate::INTERRUPT_BOUND,
            channels: Mutex::new(HashMap::new()),
            channel_deadline: crate::CHANNEL_DEADLINE,
            scan: crate::Scan::new(crate::SCAN_INTERVAL),
            takeover: None,
            waits: Mutex::new(HashMap::new()),
        })
    }

    /// A Running Agent node, with no watcher: the tests here drive `stop`/`remove` directly, so
    /// nothing reaps its Terminal's events.
    pub(crate) fn running_agent(shared: &Shared, parent: Option<&str>) -> String {
        let id = shared
            .rail()
            .insert(NodeKind::Agent, "a", parent, Some("1"))
            .unwrap()
            .id;
        shared.runs().insert(
            id.clone(),
            Slot::Running(Run {
                attempt: "1".into(),
                status_revision: 1,
                closing: false,
                ended: false,
                adapter: ClaudeCode::starting(|| 0),
                prompt: None,
                first_pending: false,
                first_prompt: None,
                steer: None,
                session_started: false,
                starred: false,
                interrupt: None,
                named: true,
                terminal_id: "1".into(),
                cwd: "/".into(),
            }),
        );
        id
    }

    /// A plain Agent node with a Terminal, with no watcher, for a test that drives `remove` directly.
    pub(crate) fn terminal_node(shared: &Shared, parent: Option<&str>) -> String {
        shared
            .rail()
            .insert(NodeKind::Agent, "t", parent, Some("1"))
            .unwrap()
            .id
    }

    /// `Shared` wired like `shared_with_a_failing_kill`, but its kill succeeds from the second
    /// call on, so a retried `remove` can succeed.
    pub(crate) fn shared_with_a_flaky_kill() -> (tempfile::TempDir, Arc<Shared>) {
        let dir = tempfile::tempdir().unwrap();
        let bus = Bus::new();
        let shared = Arc::new(Shared {
            git: worktree::Git::from_env(),
            project_dir: dir.path().to_owned(),
            rail: Mutex::new(rail::Rail::open(&dir.path().join("agents.db")).unwrap()),
            runs: Mutex::new(HashMap::new()),
            bus: bus.clone(),
            terminals: Arc::new(Terminals::open(dir.path(), bus).unwrap()),
            kill: Arc::new(FlakyKill(std::sync::atomic::AtomicBool::new(false))),
            clock: Arc::new(|| 0),
            opened: 0,
            decisions: crate::decision::Decisions::new(None, Duration::from_secs(4)),
            me: std::sync::Weak::new(),
            steer_bound: crate::STEER_BOUND,
            before_steer: None,
            gate_observer: None,
            interrupt_bound: crate::INTERRUPT_BOUND,
            channels: Mutex::new(HashMap::new()),
            channel_deadline: crate::CHANNEL_DEADLINE,
            scan: crate::Scan::new(crate::SCAN_INTERVAL),
            takeover: None,
            waits: Mutex::new(HashMap::new()),
        });
        (dir, shared)
    }

    /// H7(c): `elapsed_ms` after the hook began, on an injected clock and the 4 s `timeout` the
    /// Decisions are built with, the hook's connection closes. Returns the events and the Kind.
    pub(crate) async fn hook_closes_after(
        elapsed_ms: i64,
    ) -> (Vec<EventData>, Vec<contracts::decision::Decision>, Kind) {
        use std::sync::atomic::{AtomicI64, Ordering};
        let now = Arc::new(AtomicI64::new(1_000));
        let clock = {
            let now = Arc::clone(&now);
            Arc::new(move || now.load(Ordering::SeqCst))
        };
        let (_dir, bus, shared) = shared_over_temp_dir(clock);
        let id = running_agent(&shared, None);
        let mut events = bus.subscribe();
        let payload = json!({"hook_event_name": "PermissionRequest", "tool_name": "Bash",
                             "tool_input": {"command": "ls"}});
        let hook = {
            let (shared, id) = (Arc::clone(&shared), id.clone());
            tokio::spawn(async move { shared.permission(Actor::daemon(), &id, payload).await })
        };
        while shared.decisions.list().is_empty() {
            tokio::task::yield_now().await;
        }

        now.fetch_add(elapsed_ms, Ordering::SeqCst);
        hook.abort();
        let _ = hook.await;

        let seen = std::iter::from_fn(|| events.try_recv().ok())
            .map(|event| event.data)
            .filter(|data| {
                matches!(
                    data,
                    EventData::DecisionOpened(_) | EventData::DecisionCleared(_)
                )
            })
            .collect();
        let kind = match shared.runs().get(&id) {
            Some(Slot::Running(run)) => run.adapter.status().unwrap().kind,
            _ => panic!("the Agent is running"),
        };
        (seen, shared.decisions.list(), kind)
    }
}

/// G6: a legacy Worktree record from before ownership proofs; nothing may clean it up.
const UNPROVEN: &str = "unfinished legacy provisioning has no ownership proof";
