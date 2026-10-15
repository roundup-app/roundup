use super::*;

pub(super) struct State {
    /// The same Terminals, behind the seam `stop` and `remove` kill through: real in production,
    /// a fake in the one test that proves a failed kill deletes nothing (A16), since `Terminals`
    /// is a concrete type a test cannot otherwise make fail on demand.
    pub(super) kill: Arc<dyn KillsTerminals>,
}

impl Shared {
    pub(super) fn release_closing(&self, id: &str, ended: bool) {
        let mut runs = self.runs();
        if let Some(Slot::Running(run)) = runs.get_mut(id) {
            run.closing = false;
            run.ended |= ended;
        } else {
            runs.remove(id);
        }
    }

    /// A21: stop a Terminal in the background, for a failure that must not block the caller
    /// (`observe`'s own `Err` return) and has no actor to attribute a `rail.changed` to.
    pub(super) fn spawn_kill(&self, terminal_id: String) {
        let kill = Arc::clone(&self.ending.kill);
        let terminals = Arc::clone(&self.terminals);
        tokio::spawn(async move {
            if let Err(err) = kill_or_already_gone(&*kill, &terminals, &terminal_id).await {
                eprintln!(
                    "agents: could not stop terminal {terminal_id} after a conversation save \
                     failure: {err}"
                );
            }
        });
    }

    pub(super) async fn stop(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        self.end_with(actor, id, Ending::Stop, RailPublication::Immediate)
            .await
    }

    /// G5: stop the Agent and delete its node, Worktree directory and branch whatever their
    /// state.
    pub(super) async fn discard(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        if self.rail().node(id)?.worktree.is_none() {
            return Err(RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")));
        }
        self.end_with(actor, id, Ending::Discard, RailPublication::Immediate)
            .await
    }

    /// A32: stop the Agent and delete its node, leaving its Worktree directory and branch as they
    /// are, whatever their state.
    pub(super) async fn retire(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        self.end_with(actor, id, Ending::Retire, RailPublication::Immediate)
            .await
    }

    pub(super) async fn end_with(
        &self,
        actor: Actor,
        id: &str,
        ending: Ending,
        publication: RailPublication,
    ) -> Result<(), RpcError> {
        let remove = !matches!(ending, Ending::Stop | Ending::StopForRemoval);
        let checked_node = if ending == Ending::Remove {
            Some(self.rail().node(id)?)
        } else {
            None
        };
        if let Some(worktree) = checked_node
            .as_ref()
            .and_then(|node| node.worktree.as_ref())
        {
            let git = self.git.bounded();
            let project = self.project_dir.clone();
            let worktree = worktree::Worktree::from(worktree);
            tokio::task::spawn_blocking(move || git.require_landed(&project, &worktree))
                .await
                .map_err(RpcError::internal)??;
        }
        let (terminal_id, worktree) = {
            let rail = self.rail();
            let mut node = rail.node(id)?;
            if checked_node.as_ref().is_some_and(|checked| {
                checked.attempt != node.attempt || checked.worktree != node.worktree
            }) {
                return Err(RpcError::conflict(format!(
                    "{id} changed during Worktree precheck"
                )));
            }
            let mut runs = self.runs();
            if !remove
                && node.terminal_id.is_none()
                && runs
                    .get(id)
                    .is_none_or(|s| matches!(s, Slot::Running(r) if r.ended))
            {
                return Ok(());
            }
            match runs.get_mut(id) {
                Some(Slot::Starting { .. }) => {
                    return Err(RpcError::conflict(format!("{id} is still starting")));
                }
                // A22: whichever of a resume, a stop or a remove claims the id first wins.
                Some(Slot::Resuming { .. }) => {
                    return Err(RpcError::conflict(format!("{id} is resuming")));
                }
                Some(Slot::Running(run)) => {
                    if run.closing {
                        return Err(RpcError::conflict(format!("{id} is stopping")));
                    }
                    run.closing = true;
                    node.terminal_id = Some(run.terminal_id.clone());
                }
                None => {
                    runs.insert(id.to_owned(), Slot::Closing);
                }
                Some(Slot::ResumeCleanup {
                    terminal_id,
                    pending,
                    error,
                    ..
                }) => {
                    if *pending {
                        return Err(error.clone());
                    }
                    node.terminal_id = Some(terminal_id.clone());
                    *pending = true;
                }
                Some(Slot::Closing) => {
                    return Err(RpcError::conflict(format!("{id} is being removed")));
                }
            }
            (
                node.terminal_id,
                matches!(ending, Ending::Remove | Ending::Discard)
                    .then_some(node.worktree)
                    .flatten(),
            )
        };
        if let Some(Slot::Running(run)) = self.runs().get_mut(id) {
            self.apply(None, run, id, &actor, Observation::Stopped, None)?;
        }
        let killed = match terminal_id {
            Some(terminal_id) => {
                let killed =
                    kill_or_already_gone(&*self.ending.kill, &self.terminals, &terminal_id).await;
                if matches!(self.runs().get(id), Some(Slot::ResumeCleanup { .. })) {
                    killed.and_then(|()| self.confirm_terminal_exit(&terminal_id))
                } else {
                    killed
                }
            }
            None => Ok(()),
        };
        if killed.is_ok()
            && let Some(worktree) = worktree
        {
            let git = self.git.bounded();
            let project = self.project_dir.clone();
            let worktree = worktree::Worktree::from(&worktree);
            let removed = tokio::task::spawn_blocking(move || {
                if ending == Ending::Discard {
                    git.discard(&project, &worktree)
                } else {
                    git.remove_landed(&project, &worktree)
                }
            })
            .await
            .map_err(RpcError::internal)?;
            if let Err(err) = removed {
                self.rail().detach_terminal(id)?;
                self.release_closing(id, true);
                if publication == RailPublication::Immediate {
                    self.bus.emit(actor, EventData::RailChanged);
                }
                return Err(err);
            }
        }
        let result = {
            let mut rail = self.rail();
            let mut runs = self.runs();
            if let Err(err) = killed {
                if let Some(Slot::Running(run)) = runs.get_mut(id) {
                    run.closing = false;
                } else if let Some(Slot::ResumeCleanup { pending, .. }) = runs.get_mut(id) {
                    *pending = false;
                } else {
                    runs.remove(id);
                }
                return Err(err);
            }
            let result = if remove {
                rail.remove(id)
            } else {
                rail.detach_terminal(id)
            };
            if remove {
                runs.remove(id);
            } else if let Some(Slot::Running(run)) = runs.get_mut(id) {
                run.closing = false;
                run.ended = true;
            } else {
                runs.remove(id);
            }
            result
        };
        result?;
        if publication == RailPublication::Immediate && ending != Ending::StopForRemoval {
            self.bus.emit(actor, EventData::RailChanged);
        }
        if remove {
            // X11, X12: the node's bubbles end with it.
            report_undo(
                "close the node's Terminals",
                self.terminals.close_owned_by(id).await,
            );
        }
        Ok(())
    }
}

/// Kill a Terminal's program and return once it is observably not running (A16) or
/// `KILL_WAIT_BOUND` has passed, whichever comes first: `kill` itself returns as soon as the
/// program is reaped, which can race the Terminal's own reader thread noticing the program's end
/// and flipping `terminal.list`'s `running`, and a descendant left holding the PTY open can keep
/// that race from ever resolving (see `KILL_WAIT_BOUND`). `terminal::Shared::subscribe` checks
/// `handle` under the same lock `finish` clears it under, so subscribing before `kill` runs means
/// the exit event is never missed: either the receiver exists before `finish` publishes it, or
/// `subscribe` already found the Terminal gone and returned `NOT_FOUND`. `terminal_id` may already
/// be gone, from `kill` or from the subscribe, which is not a failure.
pub(super) async fn kill_or_already_gone(
    kill: &dyn KillsTerminals,
    terminals: &Terminals,
    terminal_id: &str,
) -> Result<(), RpcError> {
    let exit = terminals.subscribe(terminal_id).ok();
    match kill.kill(terminal_id).await {
        Err(err) if err.code != code::NOT_FOUND => return Err(err),
        _ => {}
    }
    if let Some(mut exit) = exit {
        let _ = tokio::time::timeout(KILL_WAIT_BOUND, wait_for_exit(&mut exit)).await;
    }
    Ok(())
}

/// Wait for a Terminal's own exit event, bounded by the caller. A lag never loses it, since it is
/// always the last event a Terminal sends. `Terminals` lives in an `Arc` for as long as the Daemon
/// does, so the channel this reads never closes while this can run; `Closed` is unreachable but
/// still has to be matched to satisfy `RecvError`.
pub(super) async fn wait_for_exit(events: &mut Receiver<EventData>) {
    loop {
        match events.recv().await {
            Ok(EventData::TerminalExited(_)) => return,
            Ok(_) | Err(RecvError::Lagged(_)) => {}
            Err(RecvError::Closed) => return,
        }
    }
}

/// Selected lifecycle calls leave Rail publication to their coordinator.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum RailPublication {
    Immediate,
    Coordinator,
}

/// How `Shared::end_with` ends an Agent's node.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Ending {
    /// Stop the program; the node stays on the Rail.
    Stop,
    /// A34: stop without publishing a Rail change before coordinated removal commits.
    StopForRemoval,
    /// A16: delete the node and its Worktree when landed.
    Remove,
    /// G5: delete the node and its Worktree whatever its state.
    Discard,
    /// A32: delete the node, keep its Worktree.
    Retire,
}

#[cfg(test)]
mod tests {

    use contracts::EventData;
    use contracts::terminal::{ExitedEvent, SpawnParams, TitleEvent};
    use rpc::Bus;

    use terminal::Terminals;
    use tokio::sync::broadcast;
    use tokio::sync::broadcast::error::TryRecvError;

    use tokio::time::Instant;

    use crate::tests::*;
    /// A lag skips the events it dropped, but must not end the wait on its own: only
    /// `TerminalExited` may. With capacity 1, every send before a read overwrites the one before
    /// it, so the receiver sees exactly one `Lagged`, then the last message sent.
    #[tokio::test]
    async fn wait_for_exit_keeps_waiting_past_a_lag() {
        let (tx, mut rx) = broadcast::channel(1);
        tx.send(EventData::TerminalTitle(TitleEvent {
            id: "1".into(),
            title: "a".into(),
        }))
        .unwrap();
        tx.send(EventData::TerminalTitle(TitleEvent {
            id: "1".into(),
            title: "b".into(),
        }))
        .unwrap();
        tx.send(EventData::TerminalExited(ExitedEvent {
            id: "1".into(),
            code: Some(0),
        }))
        .unwrap();

        crate::ending::wait_for_exit(&mut rx).await;

        // Had the lag ended the wait instead of being skipped past, `TerminalExited` would still
        // be sitting unread here.
        assert!(matches!(rx.try_recv(), Err(TryRecvError::Empty)));
    }
    /// An ordinary event (a title change, say output) must not end the wait on its own: only
    /// `TerminalExited` may. A large capacity means both sends land without a lag, so a mutant
    /// that returns on any `Ok(_)` would stop at the title and leave `TerminalExited` unread.
    #[tokio::test]
    async fn wait_for_exit_keeps_waiting_past_an_ordinary_event() {
        let (tx, mut rx) = broadcast::channel(8);
        tx.send(EventData::TerminalTitle(TitleEvent {
            id: "1".into(),
            title: "a".into(),
        }))
        .unwrap();
        tx.send(EventData::TerminalExited(ExitedEvent {
            id: "1".into(),
            code: Some(0),
        }))
        .unwrap();

        crate::ending::wait_for_exit(&mut rx).await;

        // Had the title event ended the wait, `TerminalExited` would still be sitting unread here.
        assert!(matches!(rx.try_recv(), Err(TryRecvError::Empty)));
    }
    /// A kill that fails must return its error at once, not wait for an exit event from a program
    /// the kill never touched: a real Terminal that is never killed proves the wait is skipped,
    /// since it would otherwise run out `KILL_WAIT_BOUND` before returning.
    #[tokio::test]
    async fn kill_or_already_gone_returns_a_failed_kills_error_without_waiting() {
        let dir = tempfile::tempdir().unwrap();
        let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
        let spawned = terminals
            .spawn(SpawnParams {
                cwd: dir.path().to_string_lossy().into_owned(),
                command: Some(vec!["sleep".into(), "30".into()]),
                env: Default::default(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();
        let began = Instant::now();

        let err = crate::ending::kill_or_already_gone(&FailingKill, &terminals, &spawned.id)
            .await
            .unwrap_err();

        assert_eq!(err.code, rpc::code::INTERNAL);
        assert!(began.elapsed() < crate::KILL_WAIT_BOUND / 2);
    }
}
