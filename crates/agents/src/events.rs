#![deny(clippy::too_many_lines)]

use super::*;
use crate::agent::{self, fold};

impl Observation {
    /// The word a log line names this Observation by; a Signal by its vendor event.
    fn name(&self) -> &str {
        match self {
            Self::Signal(payload) => claude_code::see(payload).name,
            Self::Title(_) => "title",
            Self::Tick => "tick",
            Self::Processes { .. } => "processes",
            Self::Stopped => "stop",
            Self::Exit { .. } => "exit",
            Self::Program(_) => "program status",
            Self::Finished(_) => "finished",
            Self::Failed(_) => "failed",
            Self::Resumed(_) => "resumed",
        }
    }
}

pub(super) struct State {
    /// Wake lifecycle observers even when an acknowledgement leaves Status unchanged.
    pub(super) observed: Arc<tokio::sync::Notify>,
    /// E6: how long after a start `agent.channelUp` may take before the Channel is `missing`.
    pub(super) channel_deadline: Duration,
    /// B39: told each submitted prompt; its answer says whether the hook must drop the prompt.
    /// B50, B51: what the Claude inbox of each Agent is and what its transcript has recorded.
    pub(super) inbox: Arc<InboxState>,
}

impl Drop for State {
    fn drop(&mut self) {
        // Receiver shutdown holds only the notification, so Project teardown must wake it.
        self.observed.notify_waiters();
    }
}

/// B50, B51: told the Message ids an Agent's transcript records as received from another session.
pub type InboxObserver = Arc<dyn Fn(&str, &[u32]) + Send + Sync>;

type ReadCursor = (PathBuf, Arc<Mutex<u64>>);

#[derive(Default)]
pub(super) struct InboxState {
    /// B51: the latest check of each Agent's inbox, the Rail fact `inbox`.
    pub(super) facts: Mutex<HashMap<String, contracts::agent::Inbox>>,
    /// B50(c): the transcript file of each Agent and how far it has been read.
    pub(super) transcripts: Mutex<HashMap<String, ReadCursor>>,
    /// B50(c): a watch on the folder of each Agent's transcript; the file system says when the file
    /// grew, so no timer decides `delivered`.
    watches: Mutex<HashMap<String, notify::RecommendedWatcher>>,
    pub(super) observer: std::sync::OnceLock<InboxObserver>,
}

impl InboxState {
    pub(super) fn fact(&self, agent: &str) -> Option<contracts::agent::Inbox> {
        let facts = self.facts.lock().unwrap_or_else(|e| e.into_inner());
        facts.get(agent).copied()
    }

    pub(super) fn set(&self, agent: &str, state: contracts::agent::Inbox) {
        let mut facts = self.facts.lock().unwrap_or_else(|e| e.into_inner());
        let before = facts.insert(agent.to_owned(), state);
        if state == contracts::agent::Inbox::Mismatch && before != Some(state) {
            eprintln!(
                "agents: Agent {agent}: its Claude Code speaks a messaging protocol this build does not; notes to it stay pending"
            );
        }
    }

    /// B50(c): read the transcript again from its start, for an entry that Claude Code took up
    /// before the Message it carries was in flight.
    pub(super) fn rescan(self: &Arc<Self>, agent: &str) {
        let file = self
            .transcripts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(agent)
            .map(|(_, offset)| Arc::clone(offset));
        if let Some(file) = file {
            let mut file = file.lock().unwrap_or_else(|e| e.into_inner());
            *file = 0;
        }
        self.scan(agent, &serde_json::Value::Null);
    }

    /// B50(c): scan again whenever the transcript at `path` changes. Claude Code records a taken-up
    /// message after the hook that follows its turn, so a Signal alone can come too early. The
    /// file is made after `SessionStart`, so the watch starts at the first scan that finds it.
    fn watch(self: &Arc<Self>, agent: &str, path: &Path) {
        use notify::Watcher;
        let watching = self
            .watches
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(agent);
        // Events name the real path, and a temp folder is a link on macOS.
        let Ok(file) = path.canonicalize() else {
            return;
        };
        if watching {
            return;
        }
        let folder = file.parent().unwrap_or(&file).to_owned();
        let (state, name) = (Arc::downgrade(self), agent.to_owned());
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.is_ok_and(|event| {
                (event.kind.is_modify() || event.kind.is_create()) && event.paths.contains(&file)
            }) && let Some(state) = state.upgrade()
            {
                state.scan(&name, &serde_json::Value::Null);
            }
        })
        .and_then(|mut watcher| {
            watcher.watch(&folder, notify::RecursiveMode::NonRecursive)?;
            Ok(watcher)
        });
        match watcher {
            Ok(watcher) => {
                let mut watches = self.watches.lock().unwrap_or_else(|e| e.into_inner());
                watches.insert(agent.to_owned(), watcher);
            }
            Err(err) => eprintln!("inbox: cannot watch {}: {err}", folder.display()),
        }
    }

    /// B50(c): on an Agent's Signal, tell the observer the ids its transcript newly records.
    pub(super) fn scan(self: &Arc<Self>, agent: &str, payload: &serde_json::Value) {
        self.scan_using(agent, payload, claude_code::inbox::recorded);
    }

    fn scan_using(
        self: &Arc<Self>,
        agent: &str,
        payload: &serde_json::Value,
        read: impl FnOnce(&Path, u64) -> (Vec<u32>, u64),
    ) {
        let Some(observer) = self.observer.get() else {
            return;
        };
        let file = {
            let mut files = self.transcripts.lock().unwrap_or_else(|e| e.into_inner());
            // Each transcript owns its I/O lock; the registry never waits for a scan.
            if let Some(path) = claude_code::see(payload).transcript {
                let same = files.get(agent).is_some_and(|(known, _)| *known == path);
                if !same {
                    self.watches
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .remove(agent);
                    files.insert(agent.to_owned(), (path, Arc::new(Mutex::new(0))));
                }
            }
            files.get(agent).cloned()
        };
        let Some((path, offset)) = file else { return };
        let mut offset = offset.lock().unwrap_or_else(|e| e.into_inner());
        self.watch(agent, &path);
        let (ids, next) = read(&path, *offset);
        *offset = next;
        drop(offset);
        if !ids.is_empty() {
            observer(agent, &ids);
        }
    }
}

impl Shared {
    /// PS9.2: Terminal `terminal`'s program status reaches the Agent that runs in it, if its
    /// adapter has no hook Signal; any other Agent keeps the Kind its Signals give (PS9.1).
    pub(super) fn observe_program(&self, terminal: &str, status: Status) {
        let found = self
            .runs()
            .iter()
            .find_map(|(id, agent)| match &agent.slot {
                Slot::Running(run)
                    if run.terminal_id() == terminal && !run.ended() && !run.view().hooked =>
                {
                    Some((id.to_string(), run.attempt().to_string()))
                }
                _ => None,
            });
        if let Some((id, attempt)) = found {
            let _ = self.observe(Actor::daemon(), &id, &attempt, Observation::Program(status));
        }
    }

    /// E6: `agent.channelUp` from Agent `id`. Nothing to report when no program of the Agent
    /// runs, and a second call while the Channel is `up` emits nothing.
    pub(super) fn channel_up(&self, actor: &Actor, id: &str) -> Result<(), RpcError> {
        self.rail().node(crate::rail::agent_id(id)?)?;
        if actor.kind != ActorKind::Agent || actor.id != id {
            return Err(RpcError::forbidden(format!(
                "only {} may report its Channel",
                self.rail().name(crate::rail::agent_id(id)?)?
            )));
        }
        let attempt = self.runs().slot(id).map(|slot| slot.attempt().to_owned());
        if let Some(attempt) = attempt {
            self.set_channel(actor.clone(), id, &attempt, Channel::Up);
        }
        Ok(())
    }

    /// E6: whether the live Attempt of `id` has not yet reported its Channel or missed the deadline.
    pub(super) fn channel_pending(&self, id: &str) -> bool {
        channel_in(self.runs().agent(id)) == Some(Channel::Pending)
    }

    /// E6: move the Channel of `attempt` to `channel` and say so, unless it is there already or
    /// the Attempt is no longer the live one.
    pub(super) fn set_channel(&self, by: Actor, id: &str, attempt: &str, channel: Channel) {
        let changed = {
            let mut runs = self.runs();
            let agent = runs
                .agent_mut(id)
                .filter(|agent| agent.slot.attempt() == attempt);
            let current = channel_in(agent.as_deref());
            // `up` is final for an Attempt; `missing` never replaces it.
            let moves = match (current, channel) {
                (None, _) | (Some(Channel::Up), _) => false,
                (Some(now), next) => now != next,
            };
            if let (true, Some(agent)) = (moves, agent) {
                agent.facts.channel = Some((attempt.to_owned(), channel));
            }
            moves
        };
        if changed {
            self.bus.emit(
                by,
                EventData::AgentChannel(ChannelEvent {
                    id: id.to_owned(),
                    channel,
                }),
            );
        }
    }

    /// E6: after `channel_deadline`, an Attempt still `pending` is `missing`.
    pub(super) fn watch_channel(self: &Arc<Self>, id: &str, attempt: &str) {
        let (shared, id, attempt) = (Arc::clone(self), id.to_owned(), attempt.to_owned());
        tokio::spawn(async move {
            tokio::time::sleep(shared.events.channel_deadline).await;
            shared.set_channel(Actor::daemon(), &id, &attempt, Channel::Missing);
        });
    }

    /// A21: a failed save fails the call, settles the Status to `error` and stops the Terminal,
    /// since `agent.spawn` has already returned by the time a Running Agent can reach here (the
    /// parked window's own save is `finish_starting`'s; A22's resuming is `finish_resuming`'s).
    fn fail_conversation_save(
        &self,
        actor: &Actor,
        id: &str,
        run: &mut Run,
        err: RpcError,
    ) -> RpcError {
        self.events.observed.notify_waiters();
        if let (Some(status), _) = run.observe(Observation::Failed(format!(
            "cannot save conversation: {err}"
        ))) && let Err(publish) = run.publish(&self.bus, actor.clone(), id, status)
        {
            eprintln!("agents: could not announce {id}'s failed save: {publish}");
        }
        self.spawn_kill(run.terminal_id().to_owned());
        err
    }

    /// Fold `observation` into Agent `id`'s Status. A change is announced as `agent.status`, and
    /// the first `SessionStart` Steers the prompt the Agent was spawned with. Returns when, on `clock`, the
    /// adapter wants its next `Observation::Tick`.
    pub(super) fn observe(
        &self,
        actor: Actor,
        id: &str,
        attempt: &str,
        observation: Observation,
    ) -> Result<Option<i64>, RpcError> {
        let name = self.rail().name(crate::rail::agent_id(id)?)?;
        let first_prompt = fold::first_prompt(&observation);
        // Taken before `runs`, as every other path does, so a rename and a prompt cannot deadlock.
        // U3566c: any Observation may end a turn, and the finish count is saved with its Status.
        let mut rail = Some(self.rail());
        let (prompt, tick_at) = {
            let mut runs = self.runs();
            // A20: an Observation from an earlier Attempt is ignored, never an error to its sender.
            if runs.slot(id).is_some_and(|slot| slot.attempt() != attempt) {
                eprintln!(
                    "agents: {id}: ignored {} from earlier Attempt {attempt}",
                    observation.name()
                );
                return Ok(None);
            }
            if runs.slot(id).is_some_and(Slot::closing) {
                return Err(RpcError::conflict(format!("{name} is stopping")));
            }
            match runs
                .agent_mut(id)
                .map(|agent| (&mut agent.slot, &mut agent.facts))
            {
                Some((Slot::Running(run), agent_facts)) => {
                    if run.ended() {
                        return Err(RpcError::not_found(format!("{name} has ended")));
                    }
                    // A21: a Signal naming a conversation of the current Attempt saves it
                    // before being applied (see `fail_conversation_save`).
                    if let Observation::Signal(payload) = &observation
                        && let Some(rail) = rail.as_deref_mut()
                        && let Err(err) = save_signal_conversation(rail, run, id, payload)
                    {
                        return Err(self.fail_conversation_save(&actor, id, run, err));
                    }
                    self.apply(
                        rail.as_deref_mut(),
                        run,
                        agent_facts,
                        id,
                        &actor,
                        observation,
                        first_prompt,
                    )?
                }
                // A14: a Signal here is parked, in arrival order, for when the Agent is
                // registered, instead of `NOT_FOUND`; anything else cannot arrive this early
                // (`watch` only starts once the Agent is `Running`).
                Some((Slot::Starting { parked, .. }, _)) => {
                    let Observation::Signal(payload) = observation else {
                        return Err(RpcError::not_found(&name));
                    };
                    hold(id, parked, actor, payload);
                    return Ok(None);
                }
                // A22: a non-ack Signal is parked exactly as `Starting`'s; the ack promotes to
                // `Running` and wakes the pending `agent.resume` (`finish_resuming`).
                Some((Slot::Resuming { starred, .. }, _)) => {
                    if let Observation::Title(title) = &observation {
                        *starred |= title.starts_with('✳');
                        return Ok(None);
                    }
                    let Observation::Signal(payload) = observation else {
                        return Err(RpcError::not_found(&name));
                    };
                    self.finish_resuming(rail.as_deref_mut(), &mut runs, id, actor, payload)?
                }
                None | Some((Slot::Gone, _)) => return Err(RpcError::not_found(&name)),
                Some((Slot::Closing | Slot::ResumeCleanup { .. }, _)) => {
                    return Err(RpcError::conflict(format!("{name} is stopping")));
                }
            }
        };
        if let Some(prompt) = prompt {
            self.steer_first_prompt(id, attempt, prompt);
        }
        Ok(tick_at)
    }

    /// Fold `observation` into `run`, which `observe` has already found `Running`; `rail`, when
    /// given, is locked by the caller, never here, so a caller draining several Signals under
    /// one `rail`-then-`runs` lock section (`finish_starting`) is never asked to lock it twice.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn apply(
        &self,
        mut rail: Option<&mut rail::Rail>,
        run: &mut Run,
        agent_facts: &mut agent::Facts,
        id: &str,
        actor: &Actor,
        observation: Observation,
        first_prompt: Option<Option<String>>,
    ) -> Result<Applied, RpcError> {
        // The caller holds `runs`: a woken observer reads the completed fold after unlock.
        self.events.observed.notify_waiters();
        let facts = fold::Facts::of(&observation);
        if facts.session_start {
            run.note_session_start();
        }
        if facts.star {
            run.note_star();
        }
        if facts.starts_input(run) {
            self.save_input_started(id, run.attempt())?;
            run.start_input();
        }
        // The payload is borrowed here, before `decide` consumes it, so no Signal is copied.
        if let Observation::Signal(payload) = &observation {
            self.announce_tool_call(agent_facts, actor, id, run.cwd(), payload);
        }
        let now = (self.clock)();
        for effect in fold::decide(run, id, observation, &facts, now, first_prompt) {
            self.perform(rail.as_deref_mut(), run, agent_facts, id, actor, effect)?;
        }
        let prompt = run.release_prompt();
        Ok((prompt, run.view().next_due))
    }

    /// Announced while `runs` is parked, as the Status is, so calls leave in arrival order.
    fn announce_tool_call(
        &self,
        agent_facts: &mut agent::Facts,
        actor: &Actor,
        id: &str,
        cwd: &str,
        payload: &serde_json::Value,
    ) {
        if claude_code::toolcall::fold(&mut agent_facts.tool_call, payload, cwd, (self.clock)())
            && let Some(tracked) = &agent_facts.tool_call
        {
            self.bus.emit(
                actor.clone(),
                EventData::AgentToolCall(Box::new(contracts::agent::ToolCallEvent {
                    id: id.to_owned(),
                    call: tracked.call.clone(),
                })),
            );
        }
    }

    /// Do one `Effect` of `fold::decide` under the locks `apply` holds.
    fn perform(
        &self,
        rail: Option<&mut rail::Rail>,
        run: &mut Run,
        agent_facts: &mut agent::Facts,
        id: &str,
        actor: &Actor,
        effect: fold::Effect,
    ) -> Result<(), RpcError> {
        use fold::Effect;
        match effect {
            Effect::SubmitSteer => {
                let written = match run.steer().and_then(|steer| steer.slash_written.as_ref()) {
                    None => true,
                    Some(gate) => slash_gate(gate)?,
                };
                if written {
                    // H12 permits a late submission after refusal. Keep that acknowledgement even
                    // after the Steer's timeout so a coordinator retry need not Resume again.
                    run.submit_steer();
                }
            }
            Effect::ShowOnRail => {
                if let Some(rail) = rail
                    && rail.set_visibility(
                        crate::rail::agent_id(id)?,
                        contracts::agent::RailVisibility::Shown,
                    )?
                {
                    self.bus.emit(actor.clone(), EventData::RailChanged);
                }
            }
            Effect::RailChanged => self.bus.emit(actor.clone(), EventData::RailChanged),
            Effect::Completed(completion) => self
                .bus
                .emit(actor.clone(), EventData::AgentCompleted(completion)),
            Effect::SettleSteer => {
                let written = match run.steer().and_then(|steer| steer.slash_written.as_ref()) {
                    None => false,
                    Some(gate) => slash_gate(gate)?,
                };
                if written && let Some(steer) = run.take_steer() {
                    let _ = steer.submitted.send(());
                }
            }
            Effect::AckInterrupt => {
                if let Some(waiting) = run.take_interrupt() {
                    let _ = waiting.send(());
                }
            }
            Effect::Exit => {
                run.exit();
                if let Some(rail) = rail {
                    rail.detach_terminal(crate::rail::agent_id(id)?)?;
                }
            }
            Effect::SaveBackground(background) => {
                self.save_background(id, run.attempt(), background)?;
            }
            Effect::SaveFinished(finished) => {
                if let Some(rail) = rail
                    && let Some(id) = crate::id::AgentId::parse(id)
                {
                    rail.set_finished(id, finished)?;
                }
            }
            Effect::Publish(status) => self.publish_status(run, agent_facts, id, actor, status)?,
            Effect::Name(name) => {
                if let Some(rail) = rail {
                    self.name_from_prompt(rail, run, id, actor, name)?;
                }
            }
            Effect::Title => {
                if let Some(rail) = rail {
                    self.name_from_title(rail, run, id, actor)?;
                }
            }
        }
        Ok(())
    }

    /// Announced while `runs` is parked, so announcements leave in the order the Status
    /// changed; `emit` never blocks.
    fn publish_status(
        &self,
        run: &mut Run,
        agent_facts: &mut agent::Facts,
        id: &str,
        actor: &Actor,
        status: Status,
    ) -> Result<(), RpcError> {
        // U6248b: the raw Status moves the resume table before it is announced.
        let resume_moved = resume_wait::fold(&mut agent_facts.resume, &status, (self.clock)());
        let status = waiting_on(&status, agent_facts.wait);
        let status = resume_wait::resuming(&status, agent_facts.resume.as_ref());
        run.publish(&self.bus, actor.clone(), id, status)?;
        if resume_moved {
            self.bus.emit(Actor::daemon(), EventData::RailChanged);
        }
        Ok(())
    }

    /// A9: Claude Code's first `ai-title` renames the row Automatic naming named, once.
    fn name_from_title(
        &self,
        rail: &mut rail::Rail,
        run: &mut Run,
        id: &str,
        actor: &Actor,
    ) -> Result<(), RpcError> {
        if !self.wiring.naming()?.automatic_renaming
            || rail.user_named(crate::rail::agent_id(id)?)?
        {
            run.set_title_pending(false);
            return Ok(());
        }
        let Some((conversation, cwd)) = rail.conversation(crate::rail::agent_id(id)?)? else {
            return Ok(());
        };
        let launcher = &self.rail_view.launcher;
        if let Some(title) = launcher.first_title(std::path::Path::new(&cwd), &conversation) {
            run.set_title_pending(false);
            if let Some(name) = name::from_title(&title) {
                self.rename_automatically(rail, id, actor, name)?;
            }
        }
        Ok(())
    }

    /// Rename `id` to `name`, made unique among its siblings, and announce it.
    fn rename_automatically(
        &self,
        rail: &mut rail::Rail,
        id: &str,
        actor: &Actor,
        name: String,
    ) -> Result<(), RpcError> {
        let parent = rail.node(crate::rail::agent_id(id)?)?.parent;
        let siblings = rail.tree()?;
        let taken = siblings
            .iter()
            .filter(|node| node.id != id && node.parent == parent)
            .map(|node| node.name.as_str());
        let before = rail.node(crate::rail::agent_id(id)?)?.name;
        let node = rail.rename(crate::rail::agent_id(id)?, &name::unique(&name, taken))?;
        // The Rail lock also orders publication against RPC renames.
        if node.name != before {
            self.bus.emit(
                actor.clone(),
                EventData::RailRenamed {
                    id: node.id,
                    name: node.name,
                },
            );
        }
        self.bus.emit(actor.clone(), EventData::RailChanged);
        Ok(())
    }

    /// The first prompt names the Agent, unless a name is settled or automatic naming is off.
    fn name_from_prompt(
        &self,
        rail: &mut rail::Rail,
        run: &mut Run,
        id: &str,
        actor: &Actor,
        name: Option<String>,
    ) -> Result<(), RpcError> {
        if run.claim_name()
            && self.wiring.naming()?.automatic_renaming
            && let node = rail.node(crate::rail::agent_id(id)?)?
            && (node.kind == NodeKind::Agent
                || (node.kind == NodeKind::Workstream
                    && name::is_workstream_placeholder(&node.name)))
            && !rail.user_named(crate::rail::agent_id(id)?)?
        {
            // A9: whether or not the prompt had words, Claude Code's title may still name the row.
            run.set_title_pending(true);
            if let Some(name) = name {
                self.rename_automatically(rail, id, actor, name)?;
            }
        }
        Ok(())
    }
}

/// E6: the Channel of the live Attempt of `agent`; `None` when no program runs (a Workstream whose
/// Door never started, an Agent with no live Terminal). An entry of an earlier Attempt reads `pending`.
pub(super) fn channel_in(agent: Option<&Agent>) -> Option<Channel> {
    let Agent { slot, facts } = agent?;
    let live = match slot {
        Slot::Running(run) => !run.ended() && !run.closing(),
        Slot::Starting { .. } | Slot::Resuming { .. } => true,
        Slot::Closing | Slot::ResumeCleanup { .. } | Slot::Gone => false,
    };
    live.then(|| match &facts.channel {
        Some((attempt, channel)) if attempt == slot.attempt() => *channel,
        _ => Channel::Pending,
    })
}

/// `name` when it is a whole number of milliseconds, else `default`.
pub(super) fn bound_from_env(name: &str, default: Duration) -> Duration {
    match std::env::var(name) {
        Ok(ms) => ms.parse().map(Duration::from_millis).unwrap_or_else(|_| {
            eprintln!("agents: {name}={ms:?} is not milliseconds; ignored");
            default
        }),
        Err(_) => default,
    }
}

/// E6: `ROUNDUP_CHANNEL_DEADLINE_MS`, else `CHANNEL_DEADLINE`.
pub(super) fn channel_deadline_from_env() -> Duration {
    bound_from_env("ROUNDUP_CHANNEL_DEADLINE_MS", CHANNEL_DEADLINE)
}

/// H13: `ROUNDUP_INTERRUPT_BOUND_MS`, else `INTERRUPT_BOUND`.
pub(super) fn interrupt_bound_from_env() -> Duration {
    bound_from_env("ROUNDUP_INTERRUPT_BOUND_MS", INTERRUPT_BOUND)
}

/// Feed one Terminal's titles and its exit to the Agent behind it, and a Tick at the time its
/// adapter asks for one. Only a parked star asks, so the watcher of an idle Agent never wakes.
pub(super) async fn watch(
    shared: Arc<Shared>,
    id: String,
    attempt: Ordinal,
    mut events: Receiver<Arc<EventData>>,
) {
    // DCL3c: an Agent reattached after a Daemon reopen may hold work the first Stop left running.
    let mut tick = match shared.poll_processes(&id, &attempt, None).await {
        Ok(tick_at) => tick_after(&shared, tick_at),
        Err(err) if matches!(err.code, code::NOT_FOUND | code::CONFLICT) => return,
        Err(err) => return eprintln!("agents: {REGISTERED}: {err}"),
    };
    loop {
        let observation = tokio::select! {
            event = events.recv() => match event.map(Arc::unwrap_or_clone) {
                Ok(EventData::TerminalTitle(title)) => Observation::Title(title.title),
                Ok(EventData::TerminalExited(exited)) => Observation::Exit { code: exited.code },
                // A lag loses the oldest events, never the exit: it is the last one sent.
                Ok(_) | Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => return,
            },
            () = sleep_until(tick.unwrap_or_else(Instant::now)), if tick.is_some() => Observation::Tick,
        };
        let exited = matches!(observation, Observation::Exit { .. });
        let tick_at = match shared.observe(Actor::daemon(), &id, &attempt, observation) {
            Ok(tick_at) => tick_at,
            // `rail.remove` evicts `id` from `runs` once it deletes the node (A16); an Exit
            // already in flight when that happened has nothing left to watch.
            Err(err) if matches!(err.code, code::NOT_FOUND | code::CONFLICT) => return,
            Err(err) => return eprintln!("agents: {REGISTERED}: {err}"),
        };
        if exited {
            return;
        }
        let tick_at = match shared.poll_processes(&id, &attempt, tick_at).await {
            Ok(tick_at) => tick_at,
            Err(err) if matches!(err.code, code::NOT_FOUND | code::CONFLICT) => return,
            Err(err) => return eprintln!("agents: {REGISTERED}: {err}"),
        };
        tick = tick_after(&shared, tick_at);
    }
}

fn slash_gate(gate: &Mutex<bool>) -> Result<bool, RpcError> {
    gate.lock()
        .map(|written| *written)
        .map_err(|_| RpcError::internal("slash-command write gate lock is poisoned"))
}

/// The instant of the adapter's wanted Tick at `tick_at` (Unix milliseconds), if it wants one.
fn tick_after(shared: &Shared, tick_at: Option<i64>) -> Option<Instant> {
    tick_at.map(|at| {
        let wait = u64::try_from(at - (shared.clock)()).unwrap_or(0);
        Instant::now() + Duration::from_millis(wait)
    })
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod u177_tests;

impl Shared {
    /// DCL3: after a Stop, read the process table and fold it in, until no work holds the Agent;
    /// returns when the adapter wants its next Tick.
    async fn poll_processes(
        &self,
        id: &str,
        attempt: &str,
        tick_at: Option<i64>,
    ) -> Result<Option<i64>, RpcError> {
        let root = {
            let runs = self.runs();
            let Some(Slot::Running(run)) = runs.slot(id) else {
                return Ok(tick_at);
            };
            if run.ended() || !run.view().needs_snapshot {
                return Ok(tick_at);
            }
            // A program that is gone has no work; its Exit follows.
            self.terminals.program_pid(run.terminal_id())
        };
        let Some(root) = root else {
            return self.observe(
                Actor::daemon(),
                id,
                attempt,
                Observation::Processes {
                    root: 0,
                    table: Ok(Vec::new()),
                },
            );
        };
        let table = match tokio::task::spawn_blocking(claude_code::background::read_table).await {
            Ok(Ok(table)) => Ok(claude_code::background::snapshot(&table, (self.clock)())),
            Ok(Err(err)) => Err(format!("cannot read the process table: {err}")),
            Err(err) => Err(format!("the process scan stopped: {err}")),
        };
        self.observe(
            Actor::daemon(),
            id,
            attempt,
            Observation::Processes { root, table },
        )
    }
}

impl Agents {
    /// U504: the observed maker turn at publication capture; absence must never be guessed.
    pub fn turn_identity(&self, maker: &str) -> Option<contracts::event::Completion> {
        let runs = self.shared.runs();
        let Slot::Running(run) = runs.slot(maker)? else {
            return None;
        };
        if run.ended() || run.closing() {
            return None;
        }
        Some(contracts::event::Completion {
            maker: maker.to_owned(),
            attempt: run.attempt().to_string(),
            turn: run.view().turn.as_deref()?.to_owned(),
        })
    }

    /// DCL5: the live Agents whose turn has shown no activity for `limit_ms` and has no tool call
    /// or background work running, on each Adapter's own clock.
    pub fn stalled(&self, limit_ms: i64) -> std::collections::HashSet<String> {
        self.shared
            .runs()
            .iter()
            .filter_map(|(id, agent)| match &agent.slot {
                Slot::Running(run)
                    if !run.ended()
                        && run
                            .view()
                            .quiet_since
                            .is_some_and(|at| (self.shared.clock)() - at >= limit_ms) =>
                {
                    Some(id.to_string())
                }
                _ => None,
            })
            .collect()
    }

    /// DCL5: live Rail id to how many compactions its Adapter saw finish.
    pub fn compactions(&self) -> HashMap<String, u64> {
        self.shared
            .runs()
            .iter()
            .filter_map(|(id, agent)| match &agent.slot {
                Slot::Running(run) if !run.ended() && run.view().compactions > 0 => {
                    Some((id.to_string(), run.view().compactions))
                }
                _ => None,
            })
            .collect()
    }

    /// A5482c: live Rail id to (Attempt/turn identity, turn start/end in Unix milliseconds, final text).
    /// The Adapter supplies the text; this reads no Terminal and parses no vendor records.
    pub fn completed_text(&self) -> HashMap<String, (String, i64, i64, String)> {
        self.shared
            .runs()
            .iter()
            .filter_map(|(id, agent)| {
                let Slot::Running(run) = &agent.slot else {
                    return None;
                };
                if run.ended() {
                    return None;
                }
                let (turn, started, ended, text) = run.view().completed.as_deref()?;
                Some((
                    id.to_string(),
                    (
                        format!("{}:{turn}", run.attempt()),
                        *started,
                        *ended,
                        text.clone(),
                    ),
                ))
            })
            .collect()
    }
}
