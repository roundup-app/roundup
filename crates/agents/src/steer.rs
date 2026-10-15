use super::*;

impl Shared {
    /// H12: Steer the first prompt of `id`'s `attempt` on a task of its own, since `agent.spawn`
    /// has returned by now. A Steer that fails settles the Status to `error`, never silently.
    pub(super) fn steer_first_prompt(&self, id: &str, attempt: &str, prompt: String) {
        let Some(shared) = self.me.upgrade() else {
            return;
        };
        let (id, attempt) = (id.to_owned(), attempt.to_owned());
        tokio::spawn(async move {
            if let Err(err) = shared.prompt(&id, &prompt, true).await {
                eprintln!("agents: the first prompt of {id} failed: {err}");
                shared.refuse_prompt(&id, &attempt);
            }
        });
    }

    /// H19: when the star has not arrived `steer_bound` after the first `SessionStart`, drop the
    /// first prompt unwritten and settle `id` to `error`, as a Steer that failed does.
    pub(super) fn refuse_unless_gate_opens(&self, id: &str, attempt: &str) {
        let Some(shared) = self.me.upgrade() else {
            return;
        };
        let (id, attempt) = (id.to_owned(), attempt.to_owned());
        tokio::spawn(async move {
            tokio::time::sleep(shared.steer_bound).await;
            let dropped = match shared.runs().get_mut(&id) {
                Some(Slot::Running(run)) if run.attempt == attempt => {
                    run.first_pending = false;
                    run.prompt.take().is_some()
                }
                _ => false,
            };
            if dropped {
                eprintln!("agents: the first prompt of {id} was never written: no star title");
                shared.refuse_prompt(&id, &attempt);
            }
        });
    }

    /// H12: settle `id` to `error` with the label `prompt not accepted`, if `attempt` is still
    /// its current Attempt.
    pub(super) fn refuse_prompt(&self, id: &str, attempt: &str) {
        let mut runs = self.runs();
        let Some(Slot::Running(run)) = runs.get_mut(id) else {
            return;
        };
        if run.attempt != attempt {
            return;
        }
        run.first_pending = false;
        if let Some(status) = run.adapter.refuse_prompt() {
            run.status_revision = run
                .status_revision
                .checked_add(1)
                .expect("Status revision exhausted");
            self.bus.emit(
                Actor::daemon(),
                EventData::AgentStatus(Box::new(StatusEvent {
                    id: id.to_owned(),
                    attempt: run.attempt.clone(),
                    status_revision: run.status_revision.to_string(),
                    status,
                })),
            );
        }
    }

    /// H11, H16: the one place a prompt is written to a Terminal. `first` marks the H12 first
    /// Steer, which goes before any Message. `text` goes out once, as one
    /// bracketed paste and `\r`, when `id` is `idle`; this returns when its `UserPromptSubmit`
    /// Signal arrives. Nothing is written again on any failure.
    pub(super) async fn prompt(&self, id: &str, text: &str, first: bool) -> Result<(), SteerError> {
        let not_found = || PromptError::NotFound { id: id.to_owned() };
        let (terminal_id, submitted) = {
            let mut runs = self.runs();
            let Some(Slot::Running(run)) = runs.get_mut(id) else {
                return Err(SteerError::Refused(match runs.get(id) {
                    Some(Slot::Starting { .. } | Slot::Resuming { .. }) => PromptError::Busy {
                        id: id.to_owned(),
                        kind: Kind::Working,
                    },
                    _ => not_found(),
                }));
            };
            if run.ended || run.closing || run.adapter.is_ended() {
                return Err(SteerError::Refused(not_found()));
            }
            let kind = run
                .adapter
                .status()
                .map_or(Kind::Working, |status| status.kind);
            let ahead = run.first_pending && !first;
            if ahead
                || !matches!(kind, Kind::Idle | Kind::Error)
                || run.steer.as_ref().is_some_and(|steer| !steer.is_closed())
            {
                return Err(SteerError::Refused(PromptError::Busy {
                    id: id.to_owned(),
                    kind,
                }));
            }
            let (steer, submitted) = oneshot::channel();
            run.steer = Some(steer);
            run.first_pending &= !first;
            if first && matches!(run.first_prompt, Some(FirstPrompt::Reserved)) {
                run.first_prompt = Some(FirstPrompt::Written);
            }
            (run.terminal_id.clone(), submitted)
        };
        let bytes = claude_code::steer_bytes(text);
        let before = self.before_steer.clone();
        let agent = id.to_owned();
        // B6: await the physical effect before starting the submit timeout. An enqueue
        // acknowledgement could otherwise leave bytes to execute after completion.
        let written = self
            .terminals
            .write_with(&terminal_id, move |writer| {
                if let Some(before) = before {
                    before(&agent)?;
                }
                writer
                    .write_all(&bytes)
                    .and_then(|()| writer.flush())
                    .map_err(|err| {
                        RpcError::unknown_outcome(format!(
                            "Steer bytes may have been written: {err}"
                        ))
                    })
            })
            .await;
        let failure = match written {
            Err(err) if err.code == code::NOT_FOUND => {
                return Err(SteerError::Refused(not_found()));
            }
            Err(err) => {
                eprintln!("agents: could not write the prompt to terminal {terminal_id}: {err}");
                let reason = PromptError::NotAccepted { id: id.to_owned() };
                if err.code == code::UNKNOWN_OUTCOME {
                    SteerError::Uncertain(reason)
                } else {
                    SteerError::Refused(reason)
                }
            }
            Ok(()) => match tokio::time::timeout(self.steer_bound, submitted).await {
                Ok(Ok(())) => return Ok(()),
                _ => SteerError::Uncertain(PromptError::NotAccepted { id: id.to_owned() }),
            },
        };
        let mut runs = self.runs();
        let ended = match runs.get_mut(id) {
            Some(Slot::Running(run)) => {
                run.steer = None;
                run.ended || run.closing
            }
            _ => true,
        };
        Err(if ended {
            match failure {
                SteerError::Refused(_) => SteerError::Refused(not_found()),
                SteerError::Uncertain(_) => SteerError::Uncertain(not_found()),
            }
        } else {
            failure
        })
    }

    /// H13, H16: the other place a Terminal is written on an Agent's behalf. One `ESC` goes out
    /// when `id` has a turn to end; this returns when the Agent's title shows it is no longer
    /// working (`Kind::Idle`). Physical completion precedes the title timeout; `NOT_ACKED`
    /// means the Escape was written but its outcome is uncertain. Nothing is retried.
    pub(super) async fn interrupt(&self, id: &str) -> Result<(), RpcError> {
        let not_found = || RpcError::not_found(format!("agent {id} is not running"));
        let (terminal_id, acked) = {
            let mut runs = self.runs();
            let Some(Slot::Running(run)) = runs.get_mut(id) else {
                return Err(match runs.get(id) {
                    Some(Slot::Starting { .. } | Slot::Resuming { .. }) => RpcError::new(
                        code::NOT_RUNNING,
                        format!("agent {id} has no turn to interrupt yet"),
                    ),
                    _ => not_found(),
                });
            };
            if run.ended || run.closing {
                return Err(not_found());
            }
            let kind = run
                .adapter
                .status()
                .map_or(Kind::Working, |status| status.kind);
            if matches!(kind, Kind::Idle | Kind::Done | Kind::Error) {
                return Err(RpcError::new(
                    code::NOT_RUNNING,
                    format!("agent {id} is {kind:?}, with no turn to interrupt"),
                ));
            }
            if run
                .interrupt
                .as_ref()
                .is_some_and(|waiting| !waiting.is_closed())
            {
                return Err(RpcError::conflict(format!(
                    "agent {id} is already being interrupted"
                )));
            }
            let (waiting, acked) = oneshot::channel();
            run.interrupt = Some(waiting);
            (run.terminal_id.clone(), acked)
        };
        // B6: an enqueue acknowledgement cannot bound the Escape's effect. Await its
        // physical completion so no timeout result leaves a future write behind.
        let written = self
            .terminals
            .write_with(&terminal_id, |writer| {
                writer
                    .write_all(&claude_code::interrupt_bytes())
                    .and_then(|()| writer.flush())
                    .map_err(|err| {
                        RpcError::unknown_outcome(format!(
                            "Interrupt bytes may have been written: {err}"
                        ))
                    })
            })
            .await;
        let error = match written {
            Err(err) => {
                eprintln!("agents: could not write the interrupt to terminal {terminal_id}: {err}");
                if err.code == code::UNKNOWN_OUTCOME {
                    RpcError::unknown_outcome(format!(
                        "agent {id}: Interrupt outcome uncertain; do not retry: {err}"
                    ))
                } else {
                    RpcError::new(
                        err.code,
                        format!("agent {id}: Interrupt refused; no bytes written: {err}"),
                    )
                }
            }
            Ok(()) => match tokio::time::timeout(self.interrupt_bound, acked).await {
                Ok(Ok(())) => return Ok(()),
                _ => {
                    eprintln!("agents: {id}: the title did not change after the interrupt");
                    RpcError::new(
                        code::NOT_ACKED,
                        format!(
                            "agent {id} did not acknowledge the interrupt; Escape written; outcome uncertain; do not retry"
                        ),
                    )
                }
            },
        };
        if let Some(Slot::Running(run)) = self.runs().get_mut(id) {
            run.interrupt = None;
        }
        Err(error)
    }
}

impl Agents {
    pub async fn prompt(&self, id: &str, text: &str) -> Result<(), PromptError> {
        self.shared
            .prompt(id, text, false)
            .await
            .map_err(PromptError::from)
    }

    /// H11, H13, M7: the user, or an Agent for a node in its Reach, may Steer or Interrupt; an
    /// Extension may not.
    pub(super) fn may_steer(&self, actor: &Actor, id: &str, verb: &str) -> Result<(), RpcError> {
        if actor.kind == ActorKind::Ext {
            return Err(RpcError::forbidden(format!(
                "{} may not {verb} agent {id}",
                actor.id
            )));
        }
        self.shared.guard_reach(actor, id, false)
    }

    /// M13: whether `actor` may read Terminal `terminal`, whose `owner` is as `terminal.list` says.
    pub fn guard_terminal_read(
        &self,
        actor: &Actor,
        terminal: &str,
        owner: Option<&str>,
    ) -> Result<(), RpcError> {
        self.shared.guard_terminal_read(actor, terminal, owner)
    }

    /// M14: whether `actor` may set the Route in `params`.
    pub fn guard_route(&self, actor: &Actor, params: &Value) -> Result<(), RpcError> {
        self.shared.guard_route(actor, params)
    }

    /// M7: log the `wrote` Touch on `rail:<id>` for a call that succeeded.
    pub(super) fn touch_rail(ctx: &Ctx, id: &str) -> Result<(), RpcError> {
        ctx.touch(contracts::Verb::Wrote, &format!("rail:{id}"))
    }
}

#[derive(Debug)]
pub(super) enum SteerError {
    Refused(PromptError),
    Uncertain(PromptError),
}

impl std::fmt::Display for SteerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Refused(err) | Self::Uncertain(err) => err.fmt(f),
        }
    }
}

impl From<SteerError> for PromptError {
    fn from(error: SteerError) -> Self {
        match error {
            SteerError::Refused(err) | SteerError::Uncertain(err) => err,
        }
    }
}

#[cfg(test)]
mod tests {

    use contracts::{EventData, Kind};

    use crate::tests::*;
    #[tokio::test]
    async fn h7_a_close_at_the_hook_timeout_leaves_the_decision_open_and_unanswerable() {
        let (seen, open, kind) = hook_closes_after(4_000).await;

        assert_eq!(open.len(), 1);
        assert!(!open[0].answerable);
        assert_eq!(kind, Kind::NeedsYou);
        assert_eq!(
            seen.len(),
            1,
            "decision.opened is not repeated and nothing clears: {}",
            seen.len()
        );
        assert!(matches!(seen[0], EventData::DecisionOpened(_)));
    }
    #[tokio::test]
    async fn h7_a_close_before_the_hook_timeout_is_a_no_or_an_esc() {
        let (seen, open, kind) = hook_closes_after(3_999).await;

        assert!(open.is_empty());
        assert_eq!(kind, Kind::Idle);
        assert!(
            matches!(&seen[1], EventData::DecisionCleared(c) if c.outcome == contracts::decision::Outcome::Terminal)
        );
    }
}
