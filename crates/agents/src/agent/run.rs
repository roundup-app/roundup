#![deny(clippy::struct_excessive_bools)]

use std::collections::VecDeque;

use contracts::agent::{Ordinal, StatusEvent};
use contracts::{Actor, EventData, Status};
use rpc::{Bus, RpcError};
use serde_json::Value;
use tokio::sync::{oneshot, watch};

use crate::claude_code;
use crate::{AgentAdapter, Observation, View};
use crate::{Clock, FirstSteerCompletion, SteerWait};

/// A node's place in `Shared::runs`.
// Slots live in one map and are matched in place; boxing `Run` would add an indirection at every site.
#[allow(clippy::large_enum_variant)]
pub(crate) enum Slot {
    /// Its Terminal is starting; `since` is when, on `clock`, it was marked.
    Starting {
        attempt: Ordinal,
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
        attempt: Ordinal,
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
        attempt: Ordinal,
        terminal_id: String,
        pending: bool,
        error: RpcError,
    },
    Closing,
}

impl Slot {
    pub(crate) fn attempt(&self) -> &str {
        match self {
            Self::Starting { attempt, .. }
            | Self::Resuming { attempt, .. }
            | Self::ResumeCleanup { attempt, .. } => attempt.as_str(),
            Self::Running(run) => run.attempt(),
            Self::Closing => "",
        }
    }

    pub(crate) fn closing(&self) -> bool {
        matches!(self, Self::Closing | Self::ResumeCleanup { .. })
            || matches!(self, Self::Running(run) if run.life.closing())
    }

    /// The node's name is final: no prompt renames it.
    pub(crate) fn settle_name(&mut self) {
        match self {
            Self::Running(run) => run.named = true,
            Self::Starting { named, .. } => *named = true,
            Self::Resuming { .. } | Self::ResumeCleanup { .. } | Self::Closing => {}
        }
    }
}

/// How far a Run is from its Terminal's end. A Run can be closing and exited at once: a stop
/// is under way and the program has already gone.
#[derive(Clone, Copy)]
enum Life {
    Live,
    Closing { exited: bool },
    Ended,
}

impl Life {
    fn closing(self) -> bool {
        matches!(self, Self::Closing { .. })
    }

    fn ended(self) -> bool {
        matches!(self, Self::Ended | Self::Closing { exited: true })
    }

    /// The program is gone, whether or not a stop is under way.
    fn exit(self) -> Self {
        match self {
            Self::Closing { .. } => Self::Closing { exited: true },
            Self::Live | Self::Ended => Self::Ended,
        }
    }

    /// A stop is no longer under way; `ended` says the program is gone as well.
    fn release(self, ended: bool) -> Self {
        if ended || self.ended() {
            Self::Ended
        } else {
            Self::Live
        }
    }
}

/// How far a first Steer has come (H12).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Progress {
    Reserved,
    Written,
    Acknowledged,
}

/// B6, H12: an Agent's first Steer, from the prompt it is spawned with to its accounted result.
pub(crate) struct FirstSteer {
    /// Sent as a Steer at the first `SessionStart`, then gone.
    prompt: Option<String>,
    /// No Message overtakes the first Steer before its completion or refusal.
    pending: bool,
    /// Retained first Steer result; only its physical writer may settle an active effect.
    completion: Option<watch::Sender<Option<FirstSteerCompletion>>>,
    /// Retained after the acknowledgement so a dropped coordinator can retry.
    progress: Option<Progress>,
}

impl FirstSteer {
    /// A fresh start: `prompt`, when there is one, is owed and tracked.
    fn spawned(prompt: Option<String>) -> Self {
        Self {
            pending: prompt.is_some(),
            completion: prompt.as_ref().map(|_| watch::channel(None).0),
            progress: None,
            prompt,
        }
    }

    /// A resume: as `spawned`, with the write reserved.
    fn resumed(prompt: Option<String>) -> Self {
        Self {
            progress: prompt.as_ref().map(|_| Progress::Reserved),
            ..Self::spawned(prompt)
        }
    }

    /// An Agent reattached after a Daemon restart: nothing is owed.
    fn reattached() -> Self {
        Self {
            prompt: None,
            pending: false,
            completion: None,
            progress: Some(Progress::Acknowledged),
        }
    }

    #[cfg(test)]
    fn none() -> Self {
        Self {
            prompt: None,
            pending: false,
            completion: None,
            progress: None,
        }
    }

    /// Whether no Message may yet overtake the first Steer.
    pub(crate) fn pending(&self) -> bool {
        self.pending
    }

    /// The writer is done, whatever came of it.
    pub(crate) fn settle(&mut self) {
        self.pending = false;
    }

    /// Test seam: hold or release the Messages behind the first Steer.
    #[cfg(test)]
    pub(crate) fn set_pending(&mut self, pending: bool) {
        self.pending = pending;
    }

    /// The result sender, for the task that writes the first Steer.
    pub(crate) fn completion(&self) -> Option<watch::Sender<Option<FirstSteerCompletion>>> {
        self.completion.clone()
    }

    /// A receiver of the result, when the first Steer is tracked.
    pub(crate) fn subscribe(&self) -> Option<watch::Receiver<Option<FirstSteerCompletion>>> {
        self.completion.as_ref().map(watch::Sender::subscribe)
    }

    /// Whether the first Steer's physical write was acknowledged.
    pub(crate) fn acknowledged(&self) -> bool {
        self.progress == Some(Progress::Acknowledged)
    }

    /// The first Steer's bytes are about to be written.
    pub(crate) fn begin_write(&mut self) {
        if self.progress == Some(Progress::Reserved) {
            self.progress = Some(Progress::Written);
        }
    }

    /// H12: a late UserPromptSubmit after a refusal still acknowledges a written Steer.
    fn acknowledge(&mut self) {
        if self.progress == Some(Progress::Written) {
            self.progress = Some(Progress::Acknowledged);
        }
    }

    /// No writer owns a prompt still waiting for H19: drop it and refuse.
    fn refuse_unwritten(&mut self) {
        if self.prompt.take().is_some() {
            self.pending = false;
            if let Some(completion) = &self.completion {
                completion.send_replace(Some(FirstSteerCompletion::Refused));
            }
        }
    }
}

/// What the program was started with.
struct Launch {
    /// A42 keeps a new Ask's first Steer byte for byte; other starts include E3 Context.
    startup_context: bool,
    yolo: bool,
}

/// An Adapter and the state its last fold left.
pub(crate) struct Fold {
    adapter: Box<dyn AgentAdapter + Send>,
    view: View,
}

impl Fold {
    pub(crate) fn new((adapter, view): (Box<dyn AgentAdapter + Send>, View)) -> Self {
        Self { adapter, view }
    }

    pub(crate) fn observe(&mut self, observation: Observation) -> (Option<Status>, bool) {
        let folded = self.adapter.observe(observation);
        self.view = folded.view;
        (folded.changed, folded.completion_changed)
    }
}

/// An Agent's program and what is left to tell it.
pub(crate) struct Run {
    launch: Launch,
    input_started: bool,
    attempt: Ordinal,
    status_revision: Ordinal,
    life: Life,
    fold: Fold,
    first: FirstSteer,
    /// H19: when the first `SessionStart` arrived; repeats cannot extend the Ask wait.
    session_started: Option<tokio::time::Instant>,
    /// H19: the first title with the star glyph has arrived.
    starred: bool,
    /// H11: the Steer awaiting submission or local-command acceptance.
    steer: Option<SteerWait>,
    /// H13: the Interrupt written and awaiting the title that acknowledges it.
    interrupt: Option<oneshot::Sender<()>>,
    /// The first prompt has been submitted, or a `rail.rename` came first: either way the name
    /// is settled and no prompt renames the node.
    named: bool,
    terminal_id: String,
    /// A21: the effective working directory this launch runs in, after Worktree mapping; saved
    /// to `agents.db` alongside the conversation id the first Signal to name one carries.
    cwd: String,
}

impl Run {
    #[allow(clippy::too_many_arguments)]
    fn new(
        fold: Fold,
        attempt: Ordinal,
        terminal_id: String,
        cwd: String,
        first: FirstSteer,
        input_started: bool,
        startup_context: bool,
        named: bool,
    ) -> Self {
        Self {
            launch: Launch {
                startup_context,
                yolo: false,
            },
            input_started,
            attempt,
            status_revision: Ordinal::first(),
            life: Life::Live,
            fold,
            first,
            session_started: None,
            starred: false,
            steer: None,
            interrupt: None,
            named,
            terminal_id,
            cwd,
        }
    }

    /// A fresh start of `terminal_id`; a `prompt` is owed as the first Steer.
    pub(crate) fn starting(
        clock: Clock,
        attempt: Ordinal,
        terminal_id: String,
        cwd: String,
        prompt: Option<String>,
        startup_context: bool,
        named: bool,
    ) -> Self {
        let input_started = prompt.is_some();
        Self::new(
            Fold::new(claude_code::starting(move || clock())),
            attempt,
            terminal_id,
            cwd,
            FirstSteer::spawned(prompt),
            input_started,
            startup_context,
            named,
        )
    }

    /// A resume's acknowledged launch. `continued` says input already reached the conversation.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn resumed(
        clock: Clock,
        yolo: bool,
        attempt: Ordinal,
        terminal_id: String,
        cwd: String,
        prompt: Option<String>,
        continued: bool,
    ) -> Self {
        let input_started = prompt.is_some() || continued;
        let mut run = Self::new(
            Fold::new(claude_code::starting(move || clock())),
            attempt,
            terminal_id,
            cwd,
            FirstSteer::resumed(prompt),
            input_started,
            true,
            true,
        );
        run.launch.yolo = yolo;
        run
    }

    /// A Run reattached to its still-running Terminal after a Daemon restart.
    pub(crate) fn reattached(
        fold: Fold,
        attempt: Ordinal,
        terminal_id: String,
        cwd: String,
        input_started: bool,
    ) -> Self {
        Self::new(
            fold,
            attempt,
            terminal_id,
            cwd,
            FirstSteer::reattached(),
            input_started,
            false,
            true,
        )
    }

    /// A settled Run of Terminal "1", owing nothing.
    #[cfg(test)]
    pub(crate) fn fixture(clock: Clock, named: bool) -> Self {
        Self::new(
            Fold::new(claude_code::starting(move || clock())),
            Ordinal::parse("1").unwrap(),
            "1".into(),
            "/".into(),
            FirstSteer::none(),
            true,
            true,
            named,
        )
    }

    pub(crate) fn attempt(&self) -> &str {
        self.attempt.as_str()
    }

    pub(crate) fn ordinal(&self) -> &Ordinal {
        &self.attempt
    }

    /// Test seam: the Run now belongs to another Attempt and Terminal.
    #[cfg(test)]
    pub(crate) fn relaunch(&mut self, attempt: Ordinal, terminal_id: String) {
        self.attempt = attempt;
        self.terminal_id = terminal_id;
    }

    pub(crate) fn terminal_id(&self) -> &str {
        &self.terminal_id
    }

    /// Test seam: the Terminal now running this Attempt's program.
    #[cfg(test)]
    pub(crate) fn set_terminal_id(&mut self, terminal_id: String) {
        self.terminal_id = terminal_id;
    }

    pub(crate) fn cwd(&self) -> &str {
        &self.cwd
    }

    pub(crate) fn yolo(&self) -> bool {
        self.launch.yolo
    }

    pub(crate) fn startup_context(&self) -> bool {
        self.launch.startup_context
    }

    /// The Agent's state as the last fold left it.
    pub(crate) fn view(&self) -> &View {
        &self.fold.view
    }

    /// Fold `observation` into the Agent's Status; the second is whether its completion moved.
    pub(crate) fn observe(&mut self, observation: Observation) -> (Option<Status>, bool) {
        self.fold.observe(observation)
    }

    /// The Agent's program was replaced by one the spawn seam made.
    #[cfg(any(test, feature = "test-support"))]
    pub(crate) fn replace_fold(&mut self, spawned: (Box<dyn AgentAdapter + Send>, View)) {
        self.fold = Fold::new(spawned);
    }

    pub(crate) fn first(&self) -> &FirstSteer {
        &self.first
    }

    pub(crate) fn first_mut(&mut self) -> &mut FirstSteer {
        &mut self.first
    }

    /// A stop is under way.
    pub(crate) fn closing(&self) -> bool {
        self.life.closing()
    }

    /// The program is gone.
    pub(crate) fn ended(&self) -> bool {
        self.life.ended()
    }

    /// A stop begins; `false` when one is already under way.
    pub(crate) fn begin_closing(&mut self) -> bool {
        if self.life.closing() {
            return false;
        }
        self.life = Life::Closing {
            exited: self.life.ended(),
        };
        true
    }

    /// The stop is over; `ended` says the program is gone, as an earlier exit may have said.
    pub(crate) fn release_closing(&mut self, ended: bool) {
        self.life = self.life.release(ended);
    }

    /// The stop was confirmed: the program is gone and no stop remains.
    pub(crate) fn finish_closing(&mut self) {
        self.life = Life::Ended;
    }

    /// The program exited; a stop under way stays so until it is released.
    pub(crate) fn exit(&mut self) {
        self.life = self.life.exit();
    }

    /// A5556: whether this Attempt has received explicit input.
    pub(crate) fn input_started(&self) -> bool {
        self.input_started
    }

    pub(crate) fn start_input(&mut self) {
        self.input_started = true;
    }

    pub(crate) fn session_started(&self) -> Option<tokio::time::Instant> {
        self.session_started
    }

    /// H19: the first `SessionStart` arrived; later ones keep the first instant.
    pub(crate) fn note_session_start(&mut self) {
        self.session_started
            .get_or_insert_with(tokio::time::Instant::now);
    }

    pub(crate) fn starred(&self) -> bool {
        self.starred
    }

    pub(crate) fn note_star(&mut self) {
        self.starred = true;
    }

    pub(crate) fn named(&self) -> bool {
        self.named
    }

    /// Settles the name; `true` when it was not yet settled.
    pub(crate) fn claim_name(&mut self) -> bool {
        !std::mem::replace(&mut self.named, true)
    }

    pub(crate) fn steer(&self) -> Option<&SteerWait> {
        self.steer.as_ref()
    }

    pub(crate) fn wait_for_steer(&mut self, wait: SteerWait) {
        self.steer = Some(wait);
    }

    pub(crate) fn take_steer(&mut self) -> Option<SteerWait> {
        self.steer.take()
    }

    pub(crate) fn wait_for_interrupt(&mut self, acked: oneshot::Sender<()>) {
        self.interrupt = Some(acked);
    }

    /// An Interrupt is written and its title has not come.
    pub(crate) fn interrupt_waiting(&self) -> bool {
        self.interrupt
            .as_ref()
            .is_some_and(|waiting| !waiting.is_closed())
    }

    pub(crate) fn take_interrupt(&mut self) -> Option<oneshot::Sender<()>> {
        self.interrupt.take()
    }

    /// H11, H12: a submitted prompt ends the Steer's wait and acknowledges a written first Steer.
    pub(crate) fn submit_steer(&mut self) {
        self.first.acknowledge();
        if let Some(steer) = self.steer.take() {
            let _ = steer.submitted.send(());
        }
    }

    /// The Agent is over (exit or stop): no Steer or Interrupt waits on it, and a first prompt
    /// nobody has written is refused.
    pub(crate) fn finish_waits(&mut self) {
        self.steer = None;
        self.first.refuse_unwritten();
        self.interrupt = None;
    }

    /// The first prompt, once the first `SessionStart` has released it.
    pub(crate) fn release_prompt(&mut self) -> Option<String> {
        let started = self.session_started.is_some();
        self.first.prompt.take_if(|_| started)
    }

    /// Announce `status` as this Run's next Status revision. The caller holds `runs`, so
    /// announcements leave in the order the Status changed; `emit` never blocks.
    pub(crate) fn publish(&mut self, bus: &Bus, actor: Actor, id: &str, status: Status) {
        self.status_revision = self
            .status_revision
            .next()
            .expect("Status revision exhausted");
        bus.emit(
            actor,
            EventData::AgentStatus(Box::new(StatusEvent {
                ended: self.ended(),
                id: id.to_owned(),
                attempt: self.attempt.clone(),
                status_revision: self.status_revision.clone(),
                status,
            })),
        );
    }

    pub(crate) fn status_revision(&self) -> &Ordinal {
        &self.status_revision
    }
}
