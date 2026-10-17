use super::*;

impl Shared {
    /// H12: Steer the first prompt of `id`'s `attempt` on a task of its own, since `agent.spawn`
    /// has returned by now. A Steer that fails settles the Status to `error`, never silently.
    pub(super) fn steer_first_prompt(&self, id: &str, attempt: &str, prompt: String) {
        let Some(shared) = self.me.upgrade() else {
            return;
        };
        let (completion, startup_context) = match self.runs().get(id) {
            Some(Slot::Running(run)) if run.attempt == attempt => {
                (run.first_completion.clone(), run.startup_context)
            }
            _ => return,
        };
        let (id, attempt) = (id.to_owned(), attempt.to_owned());
        tokio::spawn(async move {
            let mut prompt = prompt;
            if startup_context && let Some(read) = &shared.context {
                let context = async { read(shared.tree()?, id.clone()).await };
                match tokio::time::timeout(Duration::from_secs(4), context).await {
                    Ok(Ok(text)) => prompt.push_str(&format!(
                        "{}{text}\n</roundup-context>",
                        claude_code::CONTEXT_START
                    )),
                    Ok(Err(err)) => eprintln!("agents: no startup Context for {id}: {err}"),
                    Err(_) => eprintln!("agents: startup Context for {id} timed out"),
                }
            }
            let result = shared
                .prompt(&id, &prompt, Some(&attempt), None, !startup_context)
                .await;
            if let Err(err) = &result {
                eprintln!("agents: the first prompt of {id} failed: {err}");
                shared.refuse_prompt(&id, &attempt);
            }
            if let Some(Slot::Running(run)) = shared.runs().get_mut(&id)
                && run.attempt == attempt
            {
                run.first_pending = false;
            }
            if let Some(completion) = completion {
                completion.send_replace(Some(match result {
                    Ok(()) => FirstSteerCompletion::Submitted,
                    Err(SteerError::Refused(_)) => FirstSteerCompletion::Refused,
                    Err(SteerError::Uncertain(_)) => FirstSteerCompletion::Uncertain,
                }));
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
                    if run.prompt.take().is_some() {
                        run.first_pending = false;
                        if let Some(completion) = &run.first_completion {
                            completion.send_replace(Some(FirstSteerCompletion::Refused));
                        }
                        true
                    } else {
                        false
                    }
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
}

impl Agents {
    /// B6: wait through H19's gate, physical input and acknowledgement for this Attempt.
    /// Every completion accounts for its physical effect; none authorizes a retry.
    /// An error means completion could not be established, never permission for Takeover.
    /// Cancelling this wait changes no effect. No deadline is imposed on the physical
    /// writer: a caller deadline only stops observing, and a later caller may wait again.
    pub async fn first_steer_completion(
        &self,
        id: &str,
        attempt: &str,
    ) -> Result<FirstSteerCompletion, PromptError> {
        let missing = || PromptError::NotFound { id: id.to_owned() };
        let mut completion = {
            let runs = self.shared.runs();
            let Some(Slot::Running(run)) = runs.get(id) else {
                return Err(missing());
            };
            if run.attempt != attempt {
                return Err(missing());
            }
            let Some(completion) = &run.first_completion else {
                return Ok(FirstSteerCompletion::Refused);
            };
            completion.subscribe()
        };
        loop {
            if let Some(result) = *completion.borrow_and_update() {
                return Ok(result);
            }
            completion.changed().await.map_err(|_| missing())?;
        }
    }

    pub async fn prompt<'a>(
        &self,
        id: &str,
        text: impl Into<Steer<'a>>,
    ) -> Result<(), PromptError> {
        let (text, verbatim) = match text.into() {
            Steer::Instruction(text) => (text, false),
            Steer::User(text) => (text, true),
        };
        self.shared
            .prompt(id, text, None, None, verbatim)
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

    /// M7: a missing node is NOT_FOUND; otherwise an Agent needs Reach, or its own id
    /// when `itself` permits it. This is the same check the Agent's command dispatch uses.
    pub fn guard_reach(&self, actor: &Actor, id: &str, itself: bool) -> Result<(), RpcError> {
        self.shared.guard_reach(actor, id, itself)
    }

    /// M13, B54: whether `actor` may use Terminal `terminal`, whose `owner` is as `terminal.list` says;
    /// `pane_readable` lets an ownerless pane of an Agent in its Reach through, as a read does.
    pub fn guard_terminal_read(
        &self,
        actor: &Actor,
        terminal: &str,
        owner: Option<&str>,
        pane_readable: bool,
    ) -> Result<(), RpcError> {
        self.shared
            .guard_terminal_read(actor, terminal, owner, pane_readable)
    }

    /// B53: whether `actor` may ask the App to show Terminal `terminal`.
    pub fn guard_terminal_show(
        &self,
        actor: &Actor,
        terminal: &str,
        owner: Option<&str>,
    ) -> Result<(), RpcError> {
        self.shared.guard_terminal_show(actor, terminal, owner)
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
