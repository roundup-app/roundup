use super::*;

impl Agents {
    /// A22: resume an exited Agent's saved conversation in a new Attempt. Returns only once the
    /// new Attempt's `SessionStart` has acknowledged it (`finish_resuming`) or the attempt is
    /// given up on: `rollback_resume` stops its Terminal, if one started, and restores the old
    /// node. `can_resume` reads false for the whole pending window (A20's Starting/Resuming
    /// mechanism already keeps `agent.stop` and `rail.remove` from claiming the id meanwhile).
    pub(super) async fn resume(&self, ctx: &Ctx, id: &str) -> Result<RailNode, RpcError> {
        {
            let rail = self.shared.rail();
            let node = rail.node(id)?;
            if node.kind != NodeKind::Agent {
                return Err(RpcError::conflict(format!("{id} is not an Agent")));
            }
        }
        self.resume_saved(ctx, id, RESUME_ACK_BOUND).await
    }

    /// A22's launch, acknowledgement, rollback and serialization for an Agent (`agent.resume`) or
    /// a Door (A23's `rail.startDoor`) whose kind the caller has checked.
    pub(super) async fn resume_saved(
        &self,
        ctx: &Ctx,
        id: &str,
        ack_bound: Duration,
    ) -> Result<RailNode, RpcError> {
        self.resume_conversation(ctx, id, ack_bound, None, None, RailPublication::Immediate)
            .await
    }

    pub(super) async fn resume_conversation(
        &self,
        ctx: &Ctx,
        id: &str,
        ack_bound: Duration,
        conversation: Option<(&str, &str)>,
        prompt: Option<String>,
        publication: RailPublication,
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
                Some(Slot::Running(run)) if !run.ended => {
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
            let old = match runs.remove(id) {
                Some(Slot::Running(run)) => Some(Box::new(run)),
                _ => None,
            };
            let (done_tx, done_rx) = oneshot::channel();
            runs.insert(
                id.to_owned(),
                Slot::Resuming {
                    attempt: attempt.clone(),
                    since: (self.shared.clock)(),
                    old,
                    conversation_id: conversation_id.clone(),
                    cwd: saved_cwd.clone(),
                    prompt,
                    starred: false,
                    terminal_id: None,
                    held: VecDeque::new(),
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
                    .map_err(RpcError::internal)?
            }
            None if Path::new(&saved_cwd).is_dir() => Ok(()),
            None => Err(RpcError::conflict(format!("worktree_missing: {saved_cwd}"))),
        };
        if let Err(err) = verified {
            self.shared.rollback_resume(id, &attempt, publication).await;
            return Err(err);
        }

        // A21 already saved the effective cwd the original run launched in: when a Worktree is
        // retained, that is some path under it (A21's own cwd is captured after Worktree
        // mapping, any subdirectory kept), never the Worktree's root by itself. `worktree` above
        // is only for `verify_resumable`'s Git check; the directory to launch into is always
        // `saved_cwd` as recorded.
        let effective_cwd = PathBuf::from(&saved_cwd);
        let spawned = match self
            .start(id, &attempt, &effective_cwd, Some(&conversation_id), false)
            .await
        {
            Ok(spawned) => spawned,
            Err(err) => {
                report_undo(
                    "delete the Agent's settings file",
                    Launcher::discard(&self.dir, id),
                );
                self.shared.rollback_resume(id, &attempt, publication).await;
                return Err(err);
            }
        };
        let terminal_id = spawned.id.clone();
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
            report_undo(
                "kill a resume Terminal that lost its race",
                self.shared.terminals.kill(&terminal_id).await,
            );
            return Err(RpcError::conflict(format!(
                "{id}: resume no longer pending"
            )));
        }
        // An ack that raced ahead of this very claim (held because the Terminal id was not yet
        // recorded) is acted on now, rather than left held until the 10 s timeout.
        self.shared.promote_held_resume_ack(id);
        tokio::spawn(watch(
            Arc::clone(&self.shared),
            id.to_owned(),
            attempt.clone(),
            spawned.events,
        ));

        let outcome = tokio::select! {
            ack = done_rx => ack.unwrap_or_else(|_| {
                Err(RpcError::internal(format!("{id}: resume ack channel dropped")))
            }),
            () = tokio::time::sleep(ack_bound) => {
                self.shared.rollback_resume(id, &attempt, publication).await;
                Err(RpcError::conflict(format!(
                    "{id}: no acknowledgement within {}s",
                    ack_bound.as_secs()
                )))
            }
        };
        outcome?;
        if publication == RailPublication::Immediate {
            ctx.emit(EventData::RailChanged);
        }
        self.shared.node(id)
    }
}
