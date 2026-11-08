#![deny(clippy::too_many_lines)]

use super::*;
use crate::claude_code::Permission;
use crate::id::AgentId;

/// How one A22 resume runs: how long it waits for the ack and what it continues.
pub(super) struct Resumption<'a> {
    pub ack_bound: Duration,
    /// A conversation (id, cwd) that is not the one the Rail saved.
    pub conversation: Option<(&'a str, &'a str)>,
    pub prompt: Option<String>,
    pub publication: RailPublication,
    pub mode: Option<contracts::agent::ResumeMode>,
    pub permission_mode: Option<contracts::agent::PermissionMode>,
    pub size: (u16, u16),
}

/// What a failed resume gives back: the run it replaced, its Terminal and the waiting caller.
pub(super) struct Abandoned {
    pub old: Option<Box<Run>>,
    pub terminal_id: Option<String>,
    pub done: oneshot::Sender<Result<(), RpcError>>,
}

impl Agents {
    /// A22: continue a saved conversation. A2693a's explicit mode also accepts a live Agent
    /// or Door, keeping the serialization slot across stop and launch. Returns only once the
    /// new Attempt's `SessionStart` has acknowledged it (`finish_resuming`) or the attempt is
    /// given up on. Cleanup completes before a failure result; an unconfirmed cleanup keeps
    /// its Terminal identified and `can_resume` false until explicitly stopped. A20's pending
    /// Attempt prevents `agent.stop` and `rail.remove` from crossing cleanup in flight.
    pub(super) async fn resume(
        &self,
        ctx: &Ctx,
        id: &str,
        mode: Option<contracts::agent::ResumeMode>,
        permission_mode: Option<contracts::agent::PermissionMode>,
    ) -> Result<RailNode, RpcError> {
        if self.shared.rail().node(id)?.kind == NodeKind::Group {
            return Err(RpcError::conflict("a Group has no program to resume"));
        }
        models::check_permissions(&ctx.actor, permission_mode)?;
        // A5335b, DCR1: a child with no run in this Daemon finished before it opened (a restart
        // ends every Attempt) unless the quit cut it off mid-turn, so only the user starts a
        // finished one again; an Agent's resume would spend tokens.
        if ctx.actor.kind == contracts::ActorKind::Agent
            && mode.is_none()
            && self.shared.rail().node(id)?.kind == NodeKind::Agent
            && !self.shared.rail().is_cut_off(crate::rail::agent_id(id)?)?
            && !self.shared.runs().agent(id).is_some()
        {
            return Err(RpcError::conflict(format!(
                "{id} finished before the Daemon restarted: only the user resumes it"
            )));
        }
        // A5213: a Workstream resumes its Door's conversation in the mode it last ran in.
        let mode = {
            let rail = self.shared.rail();
            let node = rail.node(id)?;
            match (node.kind, mode) {
                (_, Some(mode)) => Some(mode),
                (NodeKind::Group, _) => return Err(RpcError::conflict("a Group has no program")),
                (NodeKind::Agent, None) => None,
                (NodeKind::Workstream, None) => {
                    if matches!(self.shared.runs().slot(id), Some(Slot::Running(run)) if !run.ended())
                    {
                        return Err(RpcError::conflict(format!(
                            "{id} is a Workstream whose Door is running"
                        )));
                    }
                    Some(if rail.conversation_yolo(crate::rail::agent_id(id)?)? {
                        contracts::agent::ResumeMode::Yolo
                    } else {
                        contracts::agent::ResumeMode::Normal
                    })
                }
            }
        };
        self.resume_conversation(
            ctx,
            id,
            Resumption {
                ack_bound: RESUME_ACK_BOUND,
                conversation: None,
                prompt: None,
                publication: RailPublication::Immediate,
                mode,
                permission_mode,
                size: (80, 24),
            },
        )
        .await
    }

    /// LC8: give child `id` more extras. A name that does not exist fails the call and the child
    /// keeps running; otherwise a live child is stopped and resumed with its conversation, its
    /// Brief re-read (`--system-prompt-snapshot off`).
    pub(super) async fn add_extras(
        &self,
        ctx: &Ctx,
        ExtrasAddParams { id, extras }: ExtrasAddParams,
    ) -> Result<RailNode, RpcError> {
        self.shared.guard_reach(&ctx.actor, &id, false)?;
        self.shared.rail().node(&id)?;
        let Some(mut lean) = Launcher::load_lean(&self.dir, &id)? else {
            return Err(RpcError::conflict(format!(
                "{id} keeps the user's full setup: it was not started by an Agent"
            )));
        };
        claude_code::extras::resolve(&self.launcher.extras_sources(self.project_dir()), &extras)?;
        let live = match self.shared.runs().slot(&id) {
            Some(Slot::Running(run)) => !run.ended(),
            Some(_) => return Err(RpcError::conflict(format!("{id} is starting or stopping"))),
            None => false,
        };
        if live
            && !self
                .shared
                .rail()
                .has_conversation(crate::rail::agent_id(&id)?)?
        {
            return Err(RpcError::conflict(format!(
                "{id} has no saved conversation yet to resume with the extras"
            )));
        }
        lean.extras = claude_code::extras::merged(&lean.extras, &extras);
        lean.fresh_brief = true;
        if live {
            self.shared.stop(ctx.actor.clone(), &id).await?;
        }
        Launcher::save_lean(&self.dir, &id, &lean)?;
        if live {
            self.resume_saved(
                ctx,
                &id,
                RESUME_ACK_BOUND,
                self.launcher.selected_permission_mode(&id),
                (80, 24),
            )
            .await?;
        }
        ctx.emit(EventData::RailChanged);
        self.shared.node(&id)
    }

    /// A22's launch, acknowledgement, rollback and serialization for an Agent (`agent.resume`) or
    /// a Door (A23's `rail.startDoor`) whose kind the caller has checked. A failure completes
    /// only after Terminal cleanup settles. Unconfirmed cleanup returns UNKNOWN_OUTCOME with
    /// the original error and remaining Terminal id, and refuses Resume until explicit stop.
    pub(super) async fn resume_saved(
        &self,
        ctx: &Ctx,
        id: &str,
        ack_bound: Duration,
        permission_mode: Option<contracts::agent::PermissionMode>,
        size: (u16, u16),
    ) -> Result<RailNode, RpcError> {
        self.resume_conversation(
            ctx,
            id,
            Resumption {
                ack_bound,
                conversation: None,
                prompt: None,
                publication: RailPublication::Immediate,
                mode: None,
                permission_mode,
                size,
            },
        )
        .await
    }

    pub(super) async fn resume_conversation(
        &self,
        ctx: &Ctx,
        id: &str,
        resumption: Resumption<'_>,
    ) -> Result<RailNode, RpcError> {
        let publication = resumption.publication;
        let mut reserved = self.reserve_resume(id, &resumption)?;
        if publication == RailPublication::Immediate {
            ctx.emit(EventData::RailChanged);
        }
        let lost =
            || RpcError::unknown_outcome(format!("{id}: resume completion lost; do not retry"));
        let outcome = match self.resume_steps(ctx, id, &mut reserved, resumption).await {
            Ended::Acked(result) => result,
            Ended::Unclaimed(err) => return Err(err),
            // The one rollback. If a promotion won, its completion channel owns cleanup, so the
            // caller waits for it even after the acknowledgement timer.
            Ended::Failed(err) => {
                self.shared.rollback_resume(id, &reserved.attempt, err);
                reserved.done_rx.await.unwrap_or_else(|_| Err(lost()))
            }
        };
        if publication == RailPublication::Immediate {
            ctx.emit(EventData::RailChanged);
        }
        outcome?;
        self.shared.node(id)
    }

    /// Check the slot, allocate the Attempt and park the old run in `Slot::Resuming`.
    fn reserve_resume(&self, id: &str, resumption: &Resumption<'_>) -> Result<Reserved, RpcError> {
        let Resumption {
            conversation,
            prompt,
            mode,
            ..
        } = resumption;
        let mut rail = self.shared.rail();
        rail.node(id)?;
        let mut runs = self.shared.runs();
        Self::check_slot(&runs, id, mode.is_some())?;
        let saved = match conversation {
            Some((id, cwd)) => Some(((*id).to_owned(), (*cwd).to_owned())),
            None => rail.conversation(crate::rail::agent_id(id)?)?,
        };
        let Some((conversation_id, saved_cwd)) = saved else {
            return Err(RpcError::conflict(format!(
                "{id} has no saved conversation"
            )));
        };
        let attempt = rail.allocate_attempt(crate::rail::agent_id(id)?)?;
        self.shared.events.observed.notify_waiters();
        let old = match runs.take(id) {
            Some(Slot::Running(run)) => Some(Box::new(run)),
            _ => None,
        };
        let (done_tx, done_rx) = oneshot::channel();
        runs.put(
            id,
            Slot::Resuming {
                mode: mode.unwrap_or_default(),
                attempt: attempt.clone(),
                since: (self.shared.clock)(),
                old,
                conversation_id: conversation_id.clone(),
                cwd: saved_cwd.clone(),
                prompt: prompt.clone(),
                starred: false,
                terminal_id: None,
                parked: VecDeque::new(),
                done: done_tx,
            },
        );
        Ok(Reserved {
            attempt,
            conversation_id,
            saved_cwd,
            done_rx,
        })
    }

    /// A resume refuses a slot that is starting, stopping, resuming or (without an explicit
    /// mode) running.
    fn check_slot(
        runs: &HashMap<AgentId, Agent>,
        id: &str,
        explicit: bool,
    ) -> Result<(), RpcError> {
        match runs.slot(id) {
            Some(Slot::Starting { .. }) => {
                return Err(RpcError::conflict(format!("{id} is still starting")));
            }
            Some(Slot::Resuming { .. }) => {
                return Err(RpcError::conflict(format!("{id} is already resuming")));
            }
            Some(Slot::Closing) => {
                return Err(RpcError::conflict(format!("{id} is stopping")));
            }
            Some(Slot::ResumeCleanup { error, .. }) => return Err(error.clone()),
            Some(Slot::Running(run)) if run.closing() => {
                return Err(RpcError::conflict(format!("{id} is stopping")));
            }
            Some(Slot::Running(run)) if !run.ended() && !explicit => {
                return Err(RpcError::conflict(format!("{id} is running")));
            }
            None | Some(Slot::Running(_) | Slot::Gone) => {}
        }
        Ok(())
    }

    /// FOP5978d and A21: the Worktree or folder the saved conversation continues in is usable.
    async fn verify_resume_cwd(&self, id: &str, saved_cwd: &str) -> Result<(), RpcError> {
        let worktree = self.shared.rail().node(id)?.worktree;
        match &worktree {
            // FOP5978d: continuing in a Worktree of the live Project folder is not a Fork's to do.
            Some(_) if self.forked => Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "This Fork cannot resume an Agent that had a Worktree of the live Project folder.",
            )),
            Some(worktree) => {
                let (git, project, worktree) = (
                    self.shared.git.bounded(),
                    self.project_dir().to_owned(),
                    worktree::Worktree::from(worktree),
                );
                tokio::task::spawn_blocking(move || git.verify_resumable(&project, &worktree))
                    .await
                    .unwrap_or_else(|err| Err(RpcError::internal(err)))
            }
            None if Path::new(saved_cwd).is_dir() => Ok(()),
            None => Err(RpcError::from(worktree::WorktreeError::Missing(
                saved_cwd.to_string(),
            ))),
        }
    }

    /// Stop the run being replaced, if it still lives, and wait for its Terminal to exit.
    async fn stop_replaced_run(&self, ctx: &Ctx, id: &str) -> Result<(), RpcError> {
        let stop_terminal = {
            let mut runs = self.shared.runs();
            match runs.agent_mut(id) {
                Some(Agent {
                    slot: Slot::Resuming { old: Some(old), .. },
                    facts,
                }) if !old.ended() => {
                    self.shared.apply(
                        None,
                        old,
                        facts,
                        id,
                        &ctx.actor,
                        Observation::Stopped,
                        None,
                    )?;
                    Some(old.terminal_id().to_owned())
                }
                _ => None,
            }
        };
        if let Some(terminal) = stop_terminal {
            self.shared.stop_and_confirm(&terminal).await?;
            if let Some(Slot::Resuming { old: Some(old), .. }) = self.shared.runs().slot_mut(id) {
                old.exit();
            }
        }
        Ok(())
    }

    /// Every step of a resume after the slot is reserved. A step's failure is returned as
    /// `Ended::Failed` and rolled back once by the caller.
    async fn resume_steps(
        &self,
        ctx: &Ctx,
        id: &str,
        reserved: &mut Reserved,
        resumption: Resumption<'_>,
    ) -> Ended {
        let Resumption {
            ack_bound,
            conversation: _,
            prompt: _,
            publication: _,
            mode,
            permission_mode,
            size,
        } = resumption;
        let attempt = &reserved.attempt;
        if let Err(err) = self.verify_resume_cwd(id, &reserved.saved_cwd).await {
            return Ended::Failed(err);
        }
        if let Err(err) = self.stop_replaced_run(ctx, id).await {
            return Ended::Failed(err);
        }
        let spawned = match self
            .launch_resumed(id, reserved, mode, permission_mode, size)
            .await
        {
            Ok(spawned) => spawned,
            Err(err) => return Ended::Failed(err),
        };
        let terminal_id = spawned.id.clone();
        let observed = self.shared.resume_effect("claim", &terminal_id).await;
        if !self.claim_terminal(id, attempt, &terminal_id) {
            return Ended::Unclaimed(self.unclaimed_cleanup(id, &terminal_id).await);
        }
        let effect = match observed {
            Ok(()) => self.shared.resume_effect("claimed", &terminal_id).await,
            err => err,
        };
        if effect.is_ok() {
            // An ack that raced ahead of this very claim (parked because the Terminal id was not
            // yet recorded) is acted on now, rather than left parked until the 10 s timeout.
            self.shared.promote_parked_resume_ack(id);
        }
        tokio::spawn(watch(
            Arc::clone(&self.shared),
            id.to_owned(),
            attempt.clone(),
            spawned.events,
        ));
        if let Err(err) = effect {
            return Ended::Failed(err);
        }
        tokio::select! {
            ack = &mut reserved.done_rx => Ended::Acked(ack.unwrap_or_else(|_| {
                Err(RpcError::unknown_outcome(format!("{id}: resume completion lost; do not retry")))
            })),
            () = tokio::time::sleep(ack_bound) => Ended::Failed(RpcError::conflict(format!(
                "{id}: no acknowledgement within {}s", ack_bound.as_secs()
            ))),
        }
    }

    /// Start the resumed program in the saved cwd, discarding its settings file if it fails.
    async fn launch_resumed(
        &self,
        id: &str,
        reserved: &Reserved,
        mode: Option<contracts::agent::ResumeMode>,
        permission_mode: Option<contracts::agent::PermissionMode>,
        size: (u16, u16),
    ) -> Result<terminal::Spawned, RpcError> {
        // A21 already saved the effective cwd the original run launched in: when a Worktree is
        // retained, that is some path under it (A21's own cwd is captured after Worktree
        // mapping, any subdirectory kept), never the Worktree's root by itself. The Worktree is
        // only for `verify_resumable`'s Git check; the directory to launch into is always
        // `saved_cwd` as recorded.
        let effective_cwd = PathBuf::from(&reserved.saved_cwd);
        let launch = Launch {
            id,
            attempt: &reserved.attempt,
            cwd: &effective_cwd,
            origin: Origin::Resume(&reserved.conversation_id),
            attach: Attach::AfterAck,
            permission: if mode == Some(contracts::agent::ResumeMode::Yolo) {
                Permission::Bypass
            } else {
                permission_mode.into()
            },
            size,
        };
        let spawned = self.start(launch).await;
        if spawned.is_err() {
            report_undo(
                "delete the Agent's settings file",
                Launcher::discard(&self.dir, id),
            );
        }
        spawned
    }

    /// Record the new Terminal in the Attempt's slot; false when the slot is no longer ours.
    fn claim_terminal(&self, id: &str, attempt: &Ordinal, terminal_id: &str) -> bool {
        let mut runs = self.shared.runs();
        match runs.slot_mut(id) {
            Some(Slot::Resuming {
                attempt: active,
                terminal_id: slot,
                ..
            }) if active == attempt => {
                *slot = Some(terminal_id.to_owned());
                true
            }
            _ => false,
        }
    }

    /// A14's attempt check already keeps a stop/remove from claiming a Resuming id; nothing else
    /// can have. Kept so this can never leave a Terminal unaccounted for if that ever changes.
    async fn unclaimed_cleanup(&self, id: &str, terminal_id: &str) -> RpcError {
        match self.shared.stop_and_confirm(terminal_id).await {
            Ok(()) => RpcError::conflict(format!("{id}: resume no longer pending")),
            Err(cleanup) => RpcError::unknown_outcome(format!(
                "{id}: resume no longer pending; Terminal {terminal_id} cleanup failed or outcome uncertain: {}; do not retry Resume",
                cleanup.message
            )),
        }
    }
}

/// A reserved Attempt: its slot is `Slot::Resuming`, with the conversation it continues.
struct Reserved {
    attempt: Ordinal,
    conversation_id: String,
    saved_cwd: String,
    done_rx: oneshot::Receiver<Result<(), RpcError>>,
}

/// How `resume_steps` ended.
enum Ended {
    /// The ack settled the resume, success or the promotion's own failure.
    Acked(Result<(), RpcError>),
    /// The claim was lost: this error is final and nothing is rolled back.
    Unclaimed(RpcError),
    /// A step failed; the caller rolls back once.
    Failed(RpcError),
}

impl Shared {
    pub(super) async fn resume_effect(
        &self,
        phase: &'static str,
        terminal: &str,
    ) -> Result<(), RpcError> {
        let Some(observer) = self.resume_effect.clone() else {
            return Ok(());
        };
        let terminal = terminal.to_owned();
        tokio::task::spawn_blocking(move || observer(phase, &terminal))
            .await
            .map_err(RpcError::internal)?
    }

    pub(super) async fn confirm_terminal_exit(&self, terminal_id: &str) -> Result<(), RpcError> {
        if self
            .terminals
            .list()
            .await
            .iter()
            .any(|t| t.id == terminal_id && t.running)
        {
            return Err(RpcError::unknown_outcome(format!(
                "Terminal {terminal_id} exit not confirmed"
            )));
        }
        Ok(())
    }

    /// Claim rollback under the same lock as promotion. If promotion won, its completion
    /// channel owns cleanup; the caller must await it even after the acknowledgement timer.
    pub(super) fn rollback_resume(&self, id: &str, attempt: &Ordinal, error: RpcError) {
        let mut runs = self.runs();
        if !matches!(runs.slot(id), Some(Slot::Resuming { attempt: active, .. }) if active == attempt)
        {
            return;
        }
        let Some(Slot::Resuming {
            old,
            terminal_id,
            done,
            ..
        }) = runs.take(id)
        else {
            unreachable!("matched under the same lock")
        };
        self.fail_resume(
            &mut runs,
            id,
            attempt.clone(),
            Abandoned {
                old,
                terminal_id,
                done,
            },
            error,
        );
    }

    /// Keep the Attempt reserved until its only cleanup effect finishes. The task owns the
    /// sender, so dropping an RPC receiver cannot detach cleanup from its ownership record.
    pub(super) fn fail_resume(
        &self,
        runs: &mut HashMap<AgentId, Agent>,
        id: &str,
        attempt: Ordinal,
        abandoned: Abandoned,
        error: RpcError,
    ) {
        let Abandoned {
            old,
            terminal_id,
            done,
        } = abandoned;
        let Some(terminal_id) = terminal_id else {
            if let Some(old) = old {
                runs.put(id, Slot::Running(*old));
            }
            let _ = done.send(Err(error));
            return;
        };
        runs.put(
            id,
            Slot::ResumeCleanup {
                old,
                attempt,
                terminal_id: terminal_id.clone(),
                pending: true,
                error: RpcError::unknown_outcome(format!(
                    "{error}; Terminal {terminal_id} cleanup pending; do not retry Resume"
                )),
            },
        );
        let Some(shared) = self.me.upgrade() else {
            // The Agents are gone: the cleanup stays pending in its slot; tell the caller so.
            let _ = done.send(Err(RpcError::unknown_outcome(format!(
                "{error}; Terminal {terminal_id} cleanup pending; do not retry Resume"
            ))));
            return;
        };
        tokio::spawn(Self::finish_cleanup(
            shared,
            id.to_owned(),
            terminal_id,
            error,
            done,
        ));
    }

    async fn finish_cleanup(
        shared: Arc<Shared>,
        id: String,
        terminal_id: String,
        error: RpcError,
        done: oneshot::Sender<Result<(), RpcError>>,
    ) {
        let cleanup = async {
            shared.resume_effect("cleanup", &terminal_id).await?;
            shared.stop_and_confirm(&terminal_id).await
        }
        .await;
        let result = {
            let mut runs = shared.runs();
            match cleanup {
                Ok(()) => {
                    if let Some(Slot::ResumeCleanup { old: Some(old), .. }) = runs.take(&id) {
                        runs.put(&id, Slot::Running(*old));
                    }
                    error
                }
                Err(cleanup) => {
                    let error = RpcError::unknown_outcome(format!(
                        "{error}; Terminal {terminal_id} cleanup failed or outcome uncertain: {cleanup}; do not retry Resume until the Terminal is stopped"
                    ));
                    if let Some(Slot::ResumeCleanup {
                        pending,
                        error: stored,
                        ..
                    }) = runs.slot_mut(&id)
                    {
                        *pending = false;
                        *stored = error.clone();
                    }
                    error
                }
            }
        };
        let _ = done.send(Err(result));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::*;

    fn ctx(bus: Bus) -> Ctx {
        Ctx {
            actor: Actor::user(),
            bus,
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
        }
    }

    #[tokio::test]
    async fn a2693a_stop_failure_launches_nothing() {
        let (dir, bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let id = running_agent(&shared, None);
        shared
            .rail()
            .allocate_attempt(crate::rail::agent_id(&id).unwrap())
            .unwrap();
        shared
            .rail()
            .save_conversation(
                crate::rail::agent_id(&id).unwrap(),
                "11111111-1111-1111-1111-111111111111",
                &dir.path().to_string_lossy(),
            )
            .unwrap();
        let launches = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let launched = launches.clone();
        let agents = owner_agents(shared, dir.path())
            .with_terminal_kills(|_| async { Err(RpcError::internal("kill failed")) })
            .with_resume_effect(move |_, _| {
                launched.fetch_add(1, Ordering::SeqCst);
                Ok(())
            });
        let error = agents
            .resume(
                &ctx(bus),
                &id,
                Some(contracts::agent::ResumeMode::Yolo),
                None,
            )
            .await
            .unwrap_err();
        assert!(error.message.contains("kill failed"), "{error}");
        assert_eq!(launches.load(Ordering::SeqCst), 0);
        assert!(agents.shared.terminals.list().await.is_empty());
        let runs = agents.shared.runs();
        assert!(matches!(runs.slot(&id), Some(Slot::Running(run)) if !run.yolo()));
    }

    #[tokio::test]
    async fn a2693a_a_stop_or_removal_claim_refuses_an_explicit_resume() {
        for remove in [false, true] {
            let (dir, bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
            let id = running_agent(&shared, None);
            shared
                .rail()
                .allocate_attempt(crate::rail::agent_id(&id).unwrap())
                .unwrap();
            shared
                .rail()
                .save_conversation(
                    crate::rail::agent_id(&id).unwrap(),
                    "11111111-1111-1111-1111-111111111111",
                    &dir.path().to_string_lossy(),
                )
                .unwrap();
            let (entered, mut entries) = tokio::sync::mpsc::unbounded_channel();
            let release = Arc::new(tokio::sync::Notify::new());
            let released = release.clone();
            let agents = owner_agents(shared, dir.path()).with_terminal_kills(move |_| {
                let entered = entered.clone();
                let release = released.clone();
                async move {
                    entered.send(()).unwrap();
                    release.notified().await;
                    Ok(())
                }
            });
            let shared = agents.shared.clone();
            let ending = async {
                if remove {
                    shared.remove(Actor::user(), &id).await
                } else {
                    shared.stop(Actor::user(), &id).await
                }
            };
            tokio::pin!(ending);
            tokio::select! {
                entry = entries.recv() => entry.unwrap(),
                result = &mut ending => panic!("ending completed before release: {result:?}"),
            }
            let error = agents
                .resume(
                    &ctx(bus),
                    &id,
                    Some(contracts::agent::ResumeMode::Yolo),
                    None,
                )
                .await
                .unwrap_err();
            assert_eq!(error.code, code::CONFLICT);
            assert!(error.message.contains("stopping"), "{error}");
            assert_eq!(
                agents.shared.rail().node(&id).unwrap().attempt.as_deref(),
                Some("1")
            );
            assert!(agents.shared.terminals.list().await.is_empty());
            release.notify_one();
            ending.await.unwrap();
            assert_eq!(agents.shared.rail().node(&id).is_err(), remove);
        }
    }
}
