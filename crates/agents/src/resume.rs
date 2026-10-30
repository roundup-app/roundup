use super::*;
use crate::ending::kill_or_already_gone;

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
        models::check_permissions(&ctx.actor, permission_mode)?;
        {
            let rail = self.shared.rail();
            let node = rail.node(id)?;
            if node.kind != NodeKind::Agent
                && !(mode.is_some() && node.kind == NodeKind::Workstream)
            {
                return Err(RpcError::conflict(format!("{id} is not an Agent")));
            }
        }
        self.resume_conversation(
            ctx,
            id,
            RESUME_ACK_BOUND,
            None,
            None,
            RailPublication::Immediate,
            mode,
            permission_mode,
            (80, 24),
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
        let Some(mut lean) = Launcher::load_lean(&self.dir, &id) else {
            return Err(RpcError::conflict(format!(
                "{id} keeps the user's full setup: it was not started by an Agent"
            )));
        };
        claude_code::extras::resolve(&self.launcher.extras_sources(self.project_dir()), &extras)?;
        let live = match self.shared.runs().get(&id) {
            Some(Slot::Running(run)) => !run.ended,
            Some(_) => return Err(RpcError::conflict(format!("{id} is starting or stopping"))),
            None => false,
        };
        if live && !self.shared.rail().has_conversation(&id)? {
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
            ack_bound,
            None,
            None,
            RailPublication::Immediate,
            None,
            permission_mode,
            size,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn resume_conversation(
        &self,
        ctx: &Ctx,
        id: &str,
        ack_bound: Duration,
        conversation: Option<(&str, &str)>,
        prompt: Option<String>,
        publication: RailPublication,
        mode: Option<contracts::agent::ResumeMode>,
        permission_mode: Option<contracts::agent::PermissionMode>,
        size: (u16, u16),
    ) -> Result<RailNode, RpcError> {
        let (attempt, conversation_id, worktree, saved_cwd, done_rx) = {
            let mut rail = self.shared.rail();
            let node = rail.node(id)?;
            let mut runs = self.shared.runs();
            match runs.get(id) {
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
                Some(Slot::Running(run)) if run.closing => {
                    return Err(RpcError::conflict(format!("{id} is stopping")));
                }
                Some(Slot::Running(run)) if !run.ended && mode.is_none() => {
                    return Err(RpcError::conflict(format!("{id} is running")));
                }
                None | Some(Slot::Running(_)) => {}
            }
            let saved = match conversation {
                Some((id, cwd)) => Some((id.to_owned(), cwd.to_owned())),
                None => rail.conversation(id)?,
            };
            let Some((conversation_id, saved_cwd)) = saved else {
                return Err(RpcError::conflict(format!(
                    "{id} has no saved conversation"
                )));
            };
            let attempt = rail.allocate_attempt(id)?;
            self.shared.events.observed.notify_waiters();
            let old = match runs.remove(id) {
                Some(Slot::Running(run)) => Some(Box::new(run)),
                _ => None,
            };
            let (done_tx, done_rx) = oneshot::channel();
            runs.insert(
                id.to_owned(),
                Slot::Resuming {
                    mode: mode.unwrap_or_default(),
                    attempt: attempt.clone(),
                    since: (self.shared.clock)(),
                    old,
                    conversation_id: conversation_id.clone(),
                    cwd: saved_cwd.clone(),
                    prompt,
                    starred: false,
                    terminal_id: None,
                    parked: VecDeque::new(),
                    done: done_tx,
                },
            );
            (attempt, conversation_id, node.worktree, saved_cwd, done_rx)
        };
        if publication == RailPublication::Immediate {
            ctx.emit(EventData::RailChanged);
        }

        let verified = match &worktree {
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
            None if Path::new(&saved_cwd).is_dir() => Ok(()),
            None => Err(RpcError::conflict(format!("worktree_missing: {saved_cwd}"))),
        };
        if let Err(err) = verified {
            self.shared.rollback_resume(id, &attempt, err.clone());
            if publication == RailPublication::Immediate {
                ctx.emit(EventData::RailChanged);
            }
            return Err(err);
        }

        let stop_terminal = {
            let mut runs = self.shared.runs();
            match runs.get_mut(id) {
                Some(Slot::Resuming { old: Some(old), .. }) if !old.ended => {
                    self.shared
                        .apply(None, old, id, &ctx.actor, Observation::Stopped, None)?;
                    Some(old.terminal_id.clone())
                }
                _ => None,
            }
        };
        if let Some(terminal) = stop_terminal {
            let stopped =
                kill_or_already_gone(&*self.shared.ending.kill, &self.shared.terminals, &terminal)
                    .await;
            let stopped = match stopped {
                Ok(()) => self.shared.confirm_terminal_exit(&terminal).await,
                Err(err) => Err(err),
            };
            if let Err(err) = stopped {
                self.shared.rollback_resume(id, &attempt, err.clone());
                ctx.emit(EventData::RailChanged);
                return Err(err);
            }
            if let Some(Slot::Resuming { old: Some(old), .. }) = self.shared.runs().get_mut(id) {
                old.ended = true;
            }
        }

        // A21 already saved the effective cwd the original run launched in: when a Worktree is
        // retained, that is some path under it (A21's own cwd is captured after Worktree
        // mapping, any subdirectory kept), never the Worktree's root by itself. `worktree` above
        // is only for `verify_resumable`'s Git check; the directory to launch into is always
        // `saved_cwd` as recorded.
        let effective_cwd = PathBuf::from(&saved_cwd);
        let spawned = match self
            .start(
                id,
                &attempt,
                &effective_cwd,
                Some(&conversation_id),
                false,
                mode == Some(contracts::agent::ResumeMode::Yolo),
                permission_mode,
                size,
            )
            .await
        {
            Ok(spawned) => spawned,
            Err(err) => {
                report_undo(
                    "delete the Agent's settings file",
                    Launcher::discard(&self.dir, id),
                );
                self.shared.rollback_resume(id, &attempt, err.clone());
                if publication == RailPublication::Immediate {
                    ctx.emit(EventData::RailChanged);
                }
                return Err(err);
            }
        };
        let terminal_id = spawned.id.clone();
        let observed = self.shared.resume_effect("claim", &terminal_id).await;
        let claimed = {
            let mut runs = self.shared.runs();
            match runs.get_mut(id) {
                Some(Slot::Resuming {
                    attempt: active,
                    terminal_id: slot,
                    ..
                }) if active == &attempt => {
                    *slot = Some(terminal_id.clone());
                    true
                }
                _ => false,
            }
        };
        if !claimed {
            // A14's attempt check already keeps a stop/remove from claiming a Resuming id;
            // nothing else can have. Kept so this can never leave a Terminal unaccounted for if
            // that ever changes.
            let killed = kill_or_already_gone(
                &*self.shared.ending.kill,
                &self.shared.terminals,
                &terminal_id,
            )
            .await;
            let cleanup = match killed {
                Ok(()) => self.shared.confirm_terminal_exit(&terminal_id).await,
                Err(err) => Err(err),
            };
            return Err(match cleanup {
                Ok(()) => RpcError::conflict(format!("{id}: resume no longer pending")),
                Err(cleanup) => RpcError::unknown_outcome(format!(
                    "{id}: resume no longer pending; Terminal {terminal_id} cleanup failed or outcome uncertain: {}; do not retry Resume",
                    cleanup.message
                )),
            });
        }
        if let Err(err) = observed {
            self.shared.rollback_resume(id, &attempt, err);
        } else if let Err(err) = self.shared.resume_effect("claimed", &terminal_id).await {
            self.shared.rollback_resume(id, &attempt, err);
        }
        // An ack that raced ahead of this very claim (parked because the Terminal id was not yet
        // recorded) is acted on now, rather than left parked until the 10 s timeout.
        self.shared.promote_parked_resume_ack(id);
        tokio::spawn(watch(
            Arc::clone(&self.shared),
            id.to_owned(),
            attempt.clone(),
            spawned.events,
        ));

        let mut done_rx = done_rx;
        let outcome = tokio::select! {
            ack = &mut done_rx => ack.unwrap_or_else(|_| {
                Err(RpcError::unknown_outcome(format!("{id}: resume completion lost; do not retry")))
            }),
            () = tokio::time::sleep(ack_bound) => {
                self.shared.rollback_resume(id, &attempt, RpcError::conflict(format!(
                    "{id}: no acknowledgement within {}s", ack_bound.as_secs()
                )));
                done_rx.await.unwrap_or_else(|_| Err(RpcError::unknown_outcome(
                    format!("{id}: resume completion lost; do not retry"))))
            }
        };
        if publication == RailPublication::Immediate {
            ctx.emit(EventData::RailChanged);
        }
        outcome?;
        self.shared.node(id)
    }
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
    pub(super) fn rollback_resume(&self, id: &str, attempt: &str, error: RpcError) {
        let mut runs = self.runs();
        if !matches!(runs.get(id), Some(Slot::Resuming { attempt: active, .. }) if active == attempt)
        {
            return;
        }
        let Some(Slot::Resuming {
            old,
            terminal_id,
            done,
            ..
        }) = runs.remove(id)
        else {
            unreachable!("matched under the same lock")
        };
        self.fail_resume(
            &mut runs,
            id,
            attempt.to_owned(),
            old,
            terminal_id,
            done,
            error,
        );
    }

    /// Keep the Attempt reserved until its only cleanup effect finishes. The task owns the
    /// sender, so dropping an RPC receiver cannot detach cleanup from its ownership record.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn fail_resume(
        &self,
        runs: &mut HashMap<String, Slot>,
        id: &str,
        attempt: String,
        old: Option<Box<Run>>,
        terminal_id: Option<String>,
        done: oneshot::Sender<Result<(), RpcError>>,
        error: RpcError,
    ) {
        let Some(terminal_id) = terminal_id else {
            if let Some(old) = old {
                runs.insert(id.to_owned(), Slot::Running(*old));
            }
            let _ = done.send(Err(error));
            return;
        };
        runs.insert(
            id.to_owned(),
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
        let shared = self
            .me
            .upgrade()
            .expect("Agents owns Shared while resolving Resume");
        let id = id.to_owned();
        tokio::spawn(async move {
            let cleanup = async {
                shared.resume_effect("cleanup", &terminal_id).await?;
                kill_or_already_gone(&*shared.ending.kill, &shared.terminals, &terminal_id).await?;
                shared.confirm_terminal_exit(&terminal_id).await
            }
            .await;
            let result = {
                let mut runs = shared.runs();
                match cleanup {
                    Ok(()) => {
                        if let Some(Slot::ResumeCleanup { old: Some(old), .. }) = runs.remove(&id) {
                            runs.insert(id.clone(), Slot::Running(*old));
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
                        }) = runs.get_mut(&id)
                        {
                            *pending = false;
                            *stored = error.clone();
                        }
                        error
                    }
                }
            };
            let _ = done.send(Err(result));
        });
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
        shared.rail().allocate_attempt(&id).unwrap();
        shared
            .rail()
            .save_conversation(
                &id,
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
        assert!(matches!(runs.get(&id), Some(Slot::Running(run)) if !run.yolo));
    }

    #[tokio::test]
    async fn a2693a_a_stop_or_removal_claim_refuses_an_explicit_resume() {
        for remove in [false, true] {
            let (dir, bus, shared) = shared_over_temp_dir(Arc::new(|| 0));
            let id = running_agent(&shared, None);
            shared.rail().allocate_attempt(&id).unwrap();
            shared
                .rail()
                .save_conversation(
                    &id,
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
