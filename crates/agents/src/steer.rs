use super::*;

impl Shared {
    /// A4452a: send the coordination text of `id`'s `attempt` to its Claude inbox on a task of its
    /// own, since `agent.spawn` has returned by now. Nothing is typed; a refused write settles to
    /// the Message states of B3563c, never to Status `error`.
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
                .coordinate(Actor::daemon(), &id, Some(&attempt), prompt)
                .await;
            if let Err(err) = &result {
                eprintln!("agents: the coordination text of {id} failed: {err}");
            }
            if let Some(Slot::Running(run)) = shared.runs().get_mut(&id)
                && run.attempt == attempt
            {
                run.first_pending = false;
            }
            shared.events.observed.notify_waiters();
            if let Some(completion) = completion {
                completion.send_replace(Some(match result {
                    Ok(()) => FirstSteerCompletion::Submitted,
                    Err(SteerError::Refused(_)) => FirstSteerCompletion::Refused,
                    Err(SteerError::Uncertain(_)) => FirstSteerCompletion::Uncertain,
                }));
            }
        });
    }

    /// A4452a, A4452d: roundup's own text reaches `id` as a Message to its Claude inbox and writes
    /// no byte to its Terminal. `attempt` fences a stale start.
    pub(super) async fn coordinate(
        &self,
        from: Actor,
        id: &str,
        attempt: Option<&str>,
        text: String,
    ) -> Result<(), SteerError> {
        let name = self
            .rail()
            .name(id)
            .map_err(|error| SteerError::Refused(PromptError::Rail(error)))?;
        match self.runs().get(id) {
            Some(Slot::Running(run))
                if attempt.is_none_or(|attempt| run.attempt == attempt)
                    && !run.ended
                    && !run.closing => {}
            _ => {
                return Err(SteerError::Refused(PromptError::NotFound {
                    id: id.to_owned(),
                    name,
                }));
            }
        }
        let Some(send) = &self.coordination else {
            return Err(SteerError::Refused(PromptError::NotAccepted {
                id: id.to_owned(),
                name,
            }));
        };
        send(from, id.to_owned(), text)
            .await
            .map_err(|error| SteerError::Refused(PromptError::Rail(error)))
    }
}

impl Agents {
    /// B6: wait through H19's gate, physical input and acknowledgement for this Attempt.
    /// Every completion accounts for its physical effect; none authorizes a retry.
    /// An error means completion could not be established.
    /// Cancelling this wait changes no effect. No deadline is imposed on the physical
    /// writer: a caller deadline only stops observing, and a later caller may wait again.
    pub async fn first_steer_completion(
        &self,
        id: &str,
        attempt: &str,
    ) -> Result<FirstSteerCompletion, PromptError> {
        let name = self.shared.rail().name(id).map_err(PromptError::Rail)?;
        let missing = || PromptError::NotFound {
            id: id.to_owned(),
            name: name.clone(),
        };
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

    /// A4452d: send roundup's own `text` to `id`'s Claude inbox as a Message; no byte is typed.
    pub async fn coordinate(&self, id: &str, text: String) -> Result<(), PromptError> {
        self.shared
            .coordinate(Actor::daemon(), id, None, text)
            .await
            .map_err(PromptError::from)
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
            .prompt(id, text, None, verbatim, None)
            .await
            .map_err(PromptError::from)
    }

    /// H11, H13, M7: the user, or an Agent for a node in its Reach, may Steer or Interrupt; an
    /// Extension may not.
    pub(super) fn may_steer(&self, actor: &Actor, id: &str, verb: &str) -> Result<(), RpcError> {
        if actor.kind == ActorKind::Ext {
            return Err(RpcError::forbidden(format!(
                "{} may not {verb} {}",
                actor.id,
                self.rail_name(id)?
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

impl Shared {
    /// H11, H16: the one place a prompt is written to a Terminal. `first` marks the H12 first
    /// Steer, which goes before any Message. `text` goes out once, as one
    /// bracketed paste and then `\r` as a write of its own, when `id` is `idle`.
    /// User slash commands also accept post-write local-command Signals (A2698a). `first` binds the initial Steer to its Attempt.
    /// Nothing is written again on any failure.
    pub(super) async fn prompt(
        &self,
        id: &str,
        text: &str,
        first: Option<&str>,
        verbatim: bool,
        record: Option<PromptRecord>,
    ) -> Result<(), SteerError> {
        let name = self
            .rail()
            .name(id)
            .map_err(|error| SteerError::Refused(PromptError::Rail(error)))?;
        let not_found = |name: &str| PromptError::NotFound {
            id: id.to_owned(),
            name: name.to_owned(),
        };
        let (terminal_id, attempt, submitted, slash_written) = loop {
            let mut completion = {
                let mut runs = self.runs();
                let Some(Slot::Running(run)) = runs.get_mut(id) else {
                    return Err(SteerError::Refused(match runs.get(id) {
                        Some(Slot::Starting { .. } | Slot::Resuming { .. }) => PromptError::Busy {
                            id: id.to_owned(),
                            name: name.clone(),
                            kind: Kind::Working,
                        },
                        _ => not_found(&name),
                    }));
                };
                if first.is_some_and(|attempt| attempt != run.attempt)
                    || run.ended
                    || run.closing
                    || run.adapter.is_ended()
                {
                    return Err(SteerError::Refused(not_found(&name)));
                }
                let kind = run
                    .adapter
                    .status()
                    .map_or(Kind::Working, |status| status.kind);
                if let Some(attempt) = record.as_ref().and_then(|record| record.attempt.as_deref())
                {
                    if run.attempt != attempt {
                        return Err(SteerError::Refused(not_found(&name)));
                    }
                    let started = run.session_started;
                    if started.is_some_and(|started| {
                        tokio::time::Instant::now() >= started + START_DOOR_ACK_BOUND
                    }) {
                        return Err(SteerError::Refused(PromptError::NotAccepted {
                            id: id.to_owned(),
                            name: name.clone(),
                        }));
                    }
                    if started.is_none() || !run.starred || kind != Kind::Idle {
                        return Err(SteerError::Refused(PromptError::Busy {
                            id: id.to_owned(),
                            name: name.clone(),
                            kind,
                        }));
                    }
                }
                let ahead = run.first_pending && first.is_none();
                // An idle Signal can precede the first Steer's task resuming from its ack.
                // Subscribe under the admission lock so Busy cannot miss the final wake-up.
                if ahead
                    && matches!(kind, Kind::Idle | Kind::Error)
                    && matches!(run.first_prompt, Some(FirstPrompt::Acknowledged))
                    && let Some(completion) = &run.first_completion
                {
                    completion.subscribe()
                } else {
                    if ahead
                        || !matches!(kind, Kind::Idle | Kind::Error)
                        || run
                            .steer
                            .as_ref()
                            .is_some_and(|steer| !steer.submitted.is_closed())
                    {
                        return Err(SteerError::Refused(PromptError::Busy {
                            id: id.to_owned(),
                            name: name.clone(),
                            kind,
                        }));
                    }
                    let (steer, submitted) = oneshot::channel();
                    let slash_written = (verbatim && first.is_none() && text.starts_with('/'))
                        .then(|| Arc::new(Mutex::new(false)));
                    run.steer = Some(SteerWait {
                        submitted: steer,
                        slash_written: slash_written.clone(),
                    });
                    // The first Steer stays ahead of Messages through physical completion.
                    if first.is_some() && matches!(run.first_prompt, Some(FirstPrompt::Reserved)) {
                        run.first_prompt = Some(FirstPrompt::Written);
                    }
                    break (
                        run.terminal_id.clone(),
                        run.attempt.clone(),
                        submitted,
                        slash_written,
                    );
                }
            };
            completion
                .wait_for(Option::is_some)
                .await
                .map_err(|_| SteerError::Refused(not_found(&name)))?;
        };
        let delivery = {
            let mut rail = self.rail();
            if first.is_some() {
                rail.first_instruction(id, &attempt)
            } else if let Some(revision) = record.as_ref().and_then(|r| r.revision.as_deref()) {
                rail.prepare_instruction(revision, &attempt, text, false)
                    .map(Some)
            } else {
                Ok(None)
            }
        }
        .map_err(|error| SteerError::Refused(PromptError::Rail(error)))?;
        let retaining = self.me.upgrade();
        let retained_delivery = delivery.clone();
        let bytes = if verbatim {
            claude_code::verbatim_bytes(text)
        } else {
            claude_code::steer_bytes(text)
        };
        let before = self.steer.before_steer.clone();
        let agent = id.to_owned();
        // B6: await the physical effect before starting the submit timeout. An enqueue
        // acknowledgement could otherwise leave bytes to execute after completion.
        let effect = self
            .terminals
            .write_with(&terminal_id, move |writer| {
                if let Some(before) = before {
                    before(&agent)?;
                }
                if let (Some(shared), Some(delivery)) = (&retaining, &retained_delivery) {
                    shared.rail().instruction_state(
                        delivery,
                        contracts::agent::InstructionState::Uncertain,
                    )?;
                }
                claude_code::write_submitted(writer, &bytes, slash_written.as_deref()).map_err(
                    |err| {
                        RpcError::unknown_outcome(format!(
                            "Steer bytes may have been written: {err}"
                        ))
                    },
                )
            })
            .await;
        if let (Some(delivery), Err(error)) = (&delivery, &effect)
            && error.code != code::UNKNOWN_OUTCOME
        {
            self.rail()
                .instruction_state(delivery, contracts::agent::InstructionState::Refused)
                .map_err(|error| SteerError::Refused(PromptError::Rail(error)))?;
        }
        let failure = match effect {
            Err(err) if err.code == code::NOT_FOUND => {
                let name = self
                    .rail()
                    .name(id)
                    .map_err(|error| SteerError::Refused(PromptError::Rail(error)))?;
                return Err(SteerError::Refused(not_found(&name)));
            }
            Err(err) => {
                eprintln!("agents: could not write the prompt to terminal {terminal_id}: {err}");
                let reason = PromptError::NotAccepted {
                    id: id.to_owned(),
                    name: self
                        .rail()
                        .name(id)
                        .map_err(|error| SteerError::Uncertain(PromptError::Rail(error)))?,
                };
                if err.code == code::UNKNOWN_OUTCOME {
                    SteerError::Uncertain(reason)
                } else {
                    SteerError::Refused(reason)
                }
            }
            Ok(()) => {
                if let Some(written) = record.and_then(|r| r.written) {
                    written(id).expect("announce a physically written Steer");
                }
                match tokio::time::timeout(self.steer_bound, submitted).await {
                    Ok(Ok(())) => {
                        if let Some(delivery) = delivery {
                            self.rail()
                                .instruction_state(
                                    &delivery,
                                    contracts::agent::InstructionState::Submitted,
                                )
                                .map_err(|error| SteerError::Uncertain(PromptError::Rail(error)))?;
                        }
                        return Ok(());
                    }
                    _ => SteerError::Uncertain(PromptError::NotAccepted {
                        id: id.to_owned(),
                        name: self
                            .rail()
                            .name(id)
                            .map_err(|error| SteerError::Uncertain(PromptError::Rail(error)))?,
                    }),
                }
            }
        };
        let name = self
            .rail()
            .name(id)
            .map_err(|error| SteerError::Uncertain(PromptError::Rail(error)))?;
        let mut runs = self.runs();
        let ended = match runs.get_mut(id) {
            Some(Slot::Running(run)) if run.terminal_id == terminal_id => {
                run.steer = None;
                // An unacknowledged Steer can release input without a Kind change.
                self.events.observed.notify_waiters();
                run.ended || run.closing
            }
            _ => true,
        };
        Err(if ended {
            match failure {
                SteerError::Refused(_) => SteerError::Refused(not_found(&name)),
                SteerError::Uncertain(_) => SteerError::Uncertain(not_found(&name)),
            }
        } else {
            failure
        })
    }
    /// H13, H16: the other place a Terminal is written on an Agent's behalf. One `ESC` goes out
    /// when `id` has a turn to end; this returns when the Agent's title shows it is no longer
    /// working (`Kind::Idle`) or a question's Kind leaves `needs-you` (H4702a). Physical completion precedes the title timeout; `NOT_ACKED`
    /// means the Escape was written but its outcome is uncertain. Nothing is retried.
    pub(super) async fn interrupt(&self, id: &str) -> Result<(), RpcError> {
        let name = self.rail().name(id)?;
        let not_found = || RpcError::not_found(format!("{name} is not running"));
        let (terminal_id, acked) = {
            let mut runs = self.runs();
            let Some(Slot::Running(run)) = runs.get_mut(id) else {
                return Err(match runs.get(id) {
                    Some(Slot::Starting { .. } | Slot::Resuming { .. }) => RpcError::new(
                        code::NOT_RUNNING,
                        format!("{name} has no turn to interrupt yet"),
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
                    format!("{name} is {kind:?}, with no turn to interrupt"),
                ));
            }
            if run
                .interrupt
                .as_ref()
                .is_some_and(|waiting| !waiting.is_closed())
            {
                return Err(RpcError::conflict(format!(
                    "{name} is already being interrupted"
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
                let name = self.rail().name(id)?;
                eprintln!("agents: could not write the interrupt to terminal {terminal_id}: {err}");
                if err.code == code::UNKNOWN_OUTCOME {
                    RpcError::unknown_outcome(format!(
                        "{name}: Interrupt outcome uncertain; do not retry: {err}"
                    ))
                } else {
                    RpcError::new(
                        err.code,
                        format!("{name}: Interrupt refused; no bytes written: {err}"),
                    )
                }
            }
            Ok(()) => match tokio::time::timeout(self.steer.interrupt_bound, acked).await {
                Ok(Ok(())) => return Ok(()),
                _ => {
                    let name = self.rail().name(id)?;
                    eprintln!("agents: {id}: the title did not change after the interrupt");
                    RpcError::new(
                        code::NOT_ACKED,
                        format!(
                            "{name} did not acknowledge the interrupt; Escape written; outcome uncertain; do not retry"
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

#[cfg(test)]
mod tests {
    use crate::tests::*;
    #[tokio::test]
    async fn a2703a_prompt_storage_failure_stays_an_error() {
        let watched = Watched::named();
        rusqlite::Connection::open(watched._dir.path().join("agents.db"))
            .unwrap()
            .execute_batch("DROP TABLE nodes")
            .unwrap();
        let error = crate::PromptError::from(
            watched
                .shared
                .prompt("7013", "hello", None, false, None)
                .await
                .unwrap_err(),
        );
        assert!(matches!(error, crate::PromptError::Rail(_)));
        let error = rpc::RpcError::from(error);
        assert_eq!(error.code, rpc::code::INTERNAL);
        assert!(
            !error.message.contains("7013") && !error.message.contains("gone"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn a2703a_interrupt_write_failure_uses_rail_name() {
        struct Broken;
        impl std::io::Write for Broken {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("lost write"))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut watched = Watched::named();
        let _ = (&mut watched.watcher).await;
        let terminals = std::sync::Arc::new(
            terminal::Terminals::open(watched._dir.path(), rpc::Bus::new())
                .unwrap()
                .with_input_writer(|_| Box::new(Broken)),
        );
        let terminal = terminals
            .spawn(contracts::terminal::SpawnParams {
                cwd: watched._dir.path().to_string_lossy().into_owned(),
                command: Some(vec!["sh".into(), "-c".into(), "sleep 30".into()]),
                env: Default::default(),
                cols: 80,
                rows: 24,
            })
            .await
            .unwrap();
        std::sync::Arc::get_mut(&mut watched.shared)
            .unwrap()
            .terminals = terminals.clone();
        if let Some(crate::Slot::Running(run)) = watched.shared.runs().get_mut("7013") {
            run.terminal_id = terminal.id.clone();
        }
        let error = watched.shared.interrupt("7013").await.unwrap_err();
        assert_eq!(error.code, rpc::code::UNKNOWN_OUTCOME);
        assert!(
            error.message.contains("sad") && !error.message.contains("7013"),
            "{error}"
        );
        terminals.kill(&terminal.id).await.unwrap();
    }

    #[tokio::test]
    async fn a2703a_errors_use_rail_names() {
        for case in [
            "missing",
            "ended",
            "closing",
            "starting",
            "idle",
            "interrupted",
            "write",
        ] {
            let watched = Watched::named();
            let shared = &watched.shared;
            let mut receiver = None;
            match case {
                "missing" => {
                    shared.runs().remove("7013");
                }
                "closing" => {
                    shared.runs().insert("7013".into(), crate::Slot::Closing);
                }
                "starting" => shared.mark_starting("7013", "1".into()),
                "ended" => {
                    if let Some(crate::Slot::Running(run)) = shared.runs().get_mut("7013") {
                        run.ended = true;
                    }
                }
                "idle" => {
                    shared
                        .observe(
                            contracts::Actor::daemon(),
                            "7013",
                            "1",
                            crate::Observation::Signal(
                                serde_json::json!({"hook_event_name":"Stop"}),
                            ),
                        )
                        .unwrap();
                }
                "interrupted" => {
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    receiver = Some(rx);
                    if let Some(crate::Slot::Running(run)) = shared.runs().get_mut("7013") {
                        run.interrupt = Some(tx);
                    }
                }
                _ => {}
            }
            let error = shared.interrupt("7013").await.unwrap_err();
            assert!(
                error.message.contains("sad") && !error.message.contains("7013"),
                "{case}: {error}"
            );
            drop(receiver);
        }
        let watched = Watched::named();
        let error = watched.shared.interrupt("8013").await.unwrap_err();
        assert!(
            error.message.contains("an Agent that is gone") && !error.message.contains("8013"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn a2703a_prompt_errors_use_rail_names() {
        let watched = Watched::named();
        let agents = owner_agents(watched.shared.clone(), watched._dir.path());
        let busy = agents.prompt("7013", "hello").await.unwrap_err();
        assert!(matches!(busy, crate::PromptError::Busy { .. }));
        assert!(busy.to_string().contains("sad") && !busy.to_string().contains("7013"));
        // NotAccepted's Rail-name path is already proved with physical bytes by
        // h11_a_lost_submit_is_not_accepted_and_nothing_is_sent_again.
        watched
            .shared
            .stop(contracts::Actor::user(), "7013")
            .await
            .unwrap();
        let stopped = agents.prompt("7013", "hello").await.unwrap_err();
        assert!(matches!(stopped, crate::PromptError::NotFound { .. }));
        assert!(stopped.to_string().contains("sad") && !stopped.to_string().contains("7013"));
        let gone = agents.prompt("8013", "hello").await.unwrap_err();
        assert!(gone.to_string().contains("an Agent that is gone"));
        assert!(!gone.to_string().contains("8013"));
    }
}
