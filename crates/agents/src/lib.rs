//! Agents, the Rail tree and the Claude Code adapter. Owner: agents Builder.

#[doc(hidden)]
pub mod schema;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::Duration;

use async_trait::async_trait;
use contracts::agent::{
    ChangedFiles, Channel, ChannelEvent, CreateWorkstreamParams, ExtrasAddParams, KeptItem,
    KeptReason, Landed, MoveParams, NodeId, NodeKind, Order, PromptParams, RailNode, Removal,
    RemovalKind, RemoveScope, RemovedItem, RenameParams, RunParams, SetModelParams, SetOrderParams,
    SignalOutcome, SignalParams, SpawnParams, StartDoorParams, StatusEvent, Stray, StrayEvent,
    WorktreeState,
};
use contracts::project::{Mcp, PrepareParams, ProjectModels, ProjectSettings, Worktrees};
use contracts::terminal::{OpenParams, Opened, SpawnParams as TerminalSpawn};
use contracts::{Actor, ActorKind, EventData, Kind, Status};
use rpc::{Bus, Ctx, Module, OpenError, Reply, RpcError, code, params, reply};
use serde_json::Value;
use terminal::Terminals;
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::oneshot;
use tokio::time::{Instant, sleep_until};

mod asks;
mod auto;
pub mod claude_code;
mod convert;
mod models;
pub mod placement;
mod pr_checks;
mod reach;
pub use asks::Asks;
pub use models::mcp_on;
mod name;
mod order;
mod peer;
#[cfg(feature = "test-support")]
pub use peer::{classifications, parent_lookups};
mod prepared;
mod queue;
mod rail;
pub mod rewind;
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
    /// PS9.2: the Status its Terminal's program reports (PS7); read only by an adapter with no
    /// hook Signal.
    Program(Status),
}

/// Turns one vendor's program into an Agent's Status. It emits `error`, `needs-you`, `working`,
/// `idle` and `done`, never `blocked`: that Kind is the Daemon's, from Todos and Routes.
pub trait AgentAdapter {
    /// Fold one Observation into the Status. `None` means no change.
    fn observe(&mut self, observation: Observation) -> Option<Status>;
    /// PS9.1: whether the Agent's tooling pushes Signals; if so they alone give its Kind.
    fn has_hook_signal(&self) -> bool;
}

type ResumeEffect = Arc<dyn Fn(&str, &str) -> Result<(), RpcError> + Send + Sync>;

type SteerEffect = Arc<dyn Fn(&str) -> Result<(), RpcError> + Send + Sync>;

struct Shared {
    naming_guide: Option<Arc<dyn Fn() -> Result<String, RpcError> + Send + Sync>>,
    automatic_renaming: Option<Arc<dyn Fn() -> Result<bool, RpcError> + Send + Sync>>,
    git: worktree::Git,
    worktrunk: worktrunk::Collector,
    project_dir: PathBuf,
    rail: Mutex<rail::Rail>,
    /// A node is marked `Starting`, and unmarked on failure, in the same Rail critical section
    /// that creates or reserves it, so `agent.stop` never finds a starting node unmarked.
    runs: Mutex<HashMap<String, Slot>>,
    /// A41: removal excludes Door starts until its Rail transaction has committed.
    door_lifecycle: tokio::sync::RwLock<()>,
    bus: Bus,
    terminals: Arc<Terminals>,
    /// Milliseconds since the Unix epoch. Adapters stamp Statuses with it and the watchers time
    /// Ticks by it, so the two never disagree about when a hold ends.
    clock: Clock,
    /// Itself, so a Signal's fold can start H12's first Steer on a task of its own.
    me: Weak<Shared>,
    /// E6: the Channel of each Agent's current Attempt that has left `pending`, as
    /// `(attempt, channel)`; an entry of an earlier Attempt reads as `pending`.
    channels: Mutex<HashMap<String, (String, Channel)>>,
    /// E3: the Daemon supplies mutable Context before the one first Steer.
    context: Option<ContextText>,
    /// A4452d: where roundup's own text goes instead of the Terminal.
    coordination: Option<CoordinationSink>,
    /// A33: the lowest open blocker of the Todos each Agent created that wait; an idle Agent in
    /// it reads `blocked`.
    waits: Mutex<HashMap<String, u32>>,
    /// F5: the scan of the Doors' process trees.
    scan: Scan,
    /// Each Door's strays as last announced; a Door with none has no entry.
    strays: Mutex<HashMap<String, Vec<Stray>>>,
    /// H11: how long a Steer waits for its `UserPromptSubmit` Signal.
    steer_bound: Duration,
    steer: SteerSettings,
    events: events::State,
    rail_view: rail_view::State,
    ending: ending::State,
    resume_effect: Option<ResumeEffect>,
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

/// How long a Terminal's Claude Code gets to end through its own exit (`claude_code::EXIT_KEY`)
/// before `kill_or_already_gone` kills it. Three presses ended a session in 0.6 to 2.1 s in every
/// state tried; a hung or dialog-blocked Claude Code waits the whole bound, then dies as it did
/// before.
pub const CLEAN_EXIT_BOUND: Duration = Duration::from_secs(5);

/// A22: how long `agent.resume` waits, on the injected clock, for the new Attempt's
/// acknowledging `SessionStart` before it fails with `CONFLICT` and rolls back.
pub const RESUME_ACK_BOUND: Duration = Duration::from_secs(10);

/// A24: how long `rail.startDoor` waits for that acknowledgement. Below A24's 10 000 ms bound on
/// the whole call, which also covers the rollback that follows the wait.
pub const START_DOOR_ACK_BOUND: Duration = Duration::from_secs(8);

type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// A4452a: sends roundup's own text to an Agent's Claude inbox as a Message, `(agent id, text)`.
type CoordinationSink = Arc<
    dyn Fn(
            String,
            String,
        )
            -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), RpcError>> + Send>>
        + Send
        + Sync,
>;

type ContextText = Arc<
    dyn Fn(
            Vec<RailNode>,
            String,
        )
            -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, RpcError>> + Send>>
        + Send
        + Sync,
>;

/// What `Shared::apply` leaves to do once its locks are let go: the first prompt to Steer at the
/// first `SessionStart` (H12), and when, on `clock`, the adapter wants its next
/// `Observation::Tick`.
type Applied = (Option<String>, Option<i64>);

/// H11: how long a Steer waits for its `UserPromptSubmit` Signal before `NOT_ACCEPTED`.
pub const STEER_BOUND: Duration = Duration::from_secs(10);

/// H13: how long an Interrupt waits for the title to change before `NOT_ACKED`.
/// `ROUNDUP_INTERRUPT_BOUND_MS` lengthens it for a test on a loaded machine.
pub const INTERRUPT_BOUND: Duration = Duration::from_secs(5);

/// E6: how long after a start the Channel may stay `pending`. `ROUNDUP_CHANNEL_DEADLINE_MS`
/// shortens it for a test.
pub const CHANNEL_DEADLINE: Duration = Duration::from_secs(15);

/// Why a Steer (`Agents::prompt`) did not land (H11).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PromptError {
    /// The Agent is not `idle`, or its last Steer is still waiting to be submitted.
    Busy {
        id: String,
        name: String,
        kind: Kind,
    },
    /// The text was written (or could not be) and no `UserPromptSubmit` Signal followed; the
    /// Terminal's input line keeps it and nothing is sent again.
    NotAccepted { id: String, name: String },
    /// No Agent `id` is running.
    NotFound { id: String, name: String },
    /// Resolving a Rail name failed; this is not evidence that the Agent is gone.
    Rail(RpcError),
}

impl std::fmt::Display for PromptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy { name, kind, .. } => write!(f, "{name} is {kind:?}, not idle"),
            Self::NotAccepted { name, .. } => write!(f, "{name} did not accept the prompt"),
            Self::NotFound { name, .. } => write!(f, "{name} is not running"),
            Self::Rail(error) => error.fmt(f),
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
            PromptError::Rail(error) => error,
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
        parked: VecDeque<(Actor, Value)>,
    },
    /// A22: a resume's launch is pending acknowledgement; `since` is when, on `clock`, it began.
    Resuming {
        mode: contracts::agent::ResumeMode,
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
        /// Signals parked exactly as `Starting`'s, awaiting the ack among them (A14).
        parked: VecDeque<(Actor, Value)>,
        /// Promotion or timeout claims this sender under the runs lock. Failure sends only
        /// after cleanup finishes; a timer that loses the claim still awaits this sender.
        done: tokio::sync::oneshot::Sender<Result<(), RpcError>>,
    },
    Running(Run),
    /// A failed Resume retains its Terminal until cleanup is confirmed or explicitly stopped.
    ResumeCleanup {
        /// Keep the last acknowledged Run until cleanup or explicit Stop restores it.
        old: Option<Box<Run>>,
        attempt: String,
        terminal_id: String,
        pending: bool,
        error: RpcError,
    },
    Closing,
}

/// B6: an accounted first Steer. None of these outcomes authorizes another initial prompt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FirstSteerCompletion {
    /// The physical write finished and UserPromptSubmit acknowledged it.
    Submitted,
    /// The prompt was dropped or refused without writing bytes.
    Refused,
    /// The physical effect ended, but submission (or a partial write) is unknown.
    Uncertain,
}

/// An Agent's program and what is left to tell it.
enum FirstPrompt {
    Reserved,
    Written,
    Acknowledged,
}

struct Run {
    yolo: bool,
    /// A42 keeps a new Ask's first Steer byte for byte; other starts include E3 Context.
    startup_context: bool,
    attempt: String,
    status_revision: i64,
    closing: bool,
    ended: bool,
    adapter: ClaudeCode,
    /// H12: sent as a Steer at the first `SessionStart`, then gone.
    prompt: Option<String>,
    /// H12: no Message overtakes the first Steer before its completion or refusal.
    first_pending: bool,
    /// B6: retained first Steer result; only its physical writer may settle an active effect.
    first_completion: Option<tokio::sync::watch::Sender<Option<FirstSteerCompletion>>>,
    /// Retained after the first Steer acknowledgement so a dropped coordinator can retry.
    first_prompt: Option<FirstPrompt>,
    /// H19: when the first `SessionStart` arrived; repeats cannot extend the Ask wait.
    session_started: Option<tokio::time::Instant>,
    /// H19: the first title with the star glyph has arrived.
    starred: bool,
    /// H11: the Steer awaiting submission or local-command acceptance.
    steer: Option<SteerWait>,
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

/// The user's exact Ask preserves command position; ordinary instructions keep H20's lead.
pub enum Steer<'a> {
    Instruction(&'a str),
    User(&'a str),
}
impl<'a, T: AsRef<str> + ?Sized> From<&'a T> for Steer<'a> {
    fn from(text: &'a T) -> Self {
        Self::Instruction(text.as_ref())
    }
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
mod import_work;
mod model_wiring;
mod owners;
mod rail_view;
mod registration;
mod removal;
mod resume;
mod spawn;
mod steer;
mod store;
mod worktree_wiring;
mod worktrunk;

use door::{Scan, scan_interval_from_env};
use ending::{Ending, RailPublication};
pub use events::InboxObserver;
use events::{channel_deadline_from_env, channel_in, interrupt_bound_from_env, watch};
use rail_view::{agent_lock, valid_explicit_order, valid_order, waiting_on};
use registration::{hold, save_signal_conversation};
use worktree_wiring::report_undo;

/// G6: a legacy Worktree record from before ownership proofs; nothing may clean it up.
const UNPROVEN: &str = "unfinished legacy provisioning has no ownership proof";

struct SteerWait {
    submitted: tokio::sync::oneshot::Sender<()>,
    /// A2698a: the final submit write must finish before local-command Signals count.
    slash_written: Option<Arc<Mutex<bool>>>,
}

struct PromptRecord {
    /// H4612a: fence the new Door's typed Ask and admit it only after H19 readiness.
    attempt: Option<String>,
    revision: Option<String>,
    written: Option<SteerEffect>,
}

struct SteerSettings {
    before_steer: Option<SteerEffect>,
    /// H13: how long an Interrupt waits for the title to change.
    interrupt_bound: Duration,
}

#[cfg(test)]
use store::tests;

impl Agents {
    /// PS9.2: Terminal `terminal` now reports `status`; the Agent running in it takes it as an
    /// Observation when its adapter has no hook Signal, and no other Agent changes.
    pub fn observe_program_status(&self, terminal: &str, status: Status) {
        self.shared.observe_program(terminal, status);
    }
}

#[cfg(feature = "test-support")]
impl Agents {
    /// PS9.2: make Agent `id`'s adapter one with no hook Signal, as a vendor without hooks has.
    pub fn drop_hooks_for_test(&self, id: &str) {
        if let Some(Slot::Running(run)) = self.shared.runs().get_mut(id) {
            let clock = Arc::clone(&self.shared.clock);
            run.adapter = ClaudeCode::starting(move || clock()).without_hooks();
        }
    }

    /// U4593 controls observed Status without a vendor, Terminal or wall clock.
    pub fn set_status_for_test(&self, id: &str, status: Status) {
        self.shared
            .rail_view
            .statuses
            .lock()
            .unwrap()
            .insert(id.to_owned(), status.clone());
        self.shared.bus.emit(
            Actor::daemon(),
            EventData::AgentStatus(Box::new(contracts::agent::StatusEvent {
                ended: false,
                id: id.to_owned(),
                attempt: "1".into(),
                status_revision: "1".into(),
                status,
            })),
        );
    }
}
