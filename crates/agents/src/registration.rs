use super::*;

impl Shared {
    /// Swap `id` from `Starting` to `Running` (the Run `build` makes, told whether a
    /// `rail.rename` already settled its name) and apply every Signal held for it, in arrival
    /// order, all under one `rail`-then-`runs` lock section: a Signal that arrives once the
    /// Agent is registered can never be applied ahead of one still held for it (A14), and
    /// `agent.signal` never finds `id` missing between the two (it is never `NOT_FOUND` for an
    /// id that was spawned). Returns the first prompt, if an applied `SessionStart` released it,
    /// to Steer once the locks are let go.
    pub(super) fn finish_starting(
        &self,
        id: &str,
        attempt: &str,
        build: impl FnOnce(bool) -> Run,
    ) -> Result<Vec<String>, RpcError> {
        let mut rail = self.rail();
        let mut runs = self.runs();
        if !matches!(runs.get(id), Some(Slot::Starting { attempt: active, .. }) if active == attempt)
        {
            return Err(RpcError::conflict(format!(
                "agent {id}: stale start completion"
            )));
        }
        let Some(Slot::Starting { named, held, .. }) = runs.remove(id) else {
            unreachable!("spawn marks {id} Starting before run_agent runs")
        };
        let mut run = build(named);
        let mut prompts = Vec::new();
        for (actor, payload) in held {
            // A21: a held Signal naming a conversation is saved before it is applied, same as a
            // Running Agent's; here, before `agent.spawn` has returned, a failed save fails the
            // whole spawn instead, as any other failed spawn does (A14), so the Terminal
            // `run_agent`'s own cleanup kills is this one, never left running.
            if let Err(err) = save_signal_conversation(&mut rail, &run, id, &payload) {
                // Put `id` back so the caller's own failed-spawn cleanup (which expects to find
                // its Attempt still in `runs`) still removes the orphaned node and kills the
                // Terminal `start` already recorded, exactly as any other failed spawn.
                runs.insert(id.to_owned(), Slot::Running(run));
                return Err(err);
            }
            let first_prompt = claude_code::submitted_prompt(&payload).map(name::from_prompt);
            // Logged, not panicked: a panic here would unwind while `rail` and `runs` are both
            // still locked, poisoning them and taking every later `rail()`/`runs()` call down
            // with it. `rail.node(id)` itself cannot be `NOT_FOUND` (a Starting id's Rail node is
            // removed only by its own failed spawn, which never reaches here), but the write a
            // held rename makes can still fail on its own account.
            match self.apply(
                Some(&mut *rail),
                &mut run,
                id,
                &actor,
                Observation::Signal(payload),
                first_prompt,
            ) {
                Ok((prompt, _tick_at)) => prompts.extend(prompt),
                Err(err) => eprintln!(
                    "agents: could not apply a Signal held for {id} while it was starting: {err}"
                ),
            }
        }
        runs.insert(id.to_owned(), Slot::Running(run));
        Ok(prompts)
    }

    /// A22: `id`'s slot is `Resuming` and `payload` is a Signal (`observe`'s own match already
    /// checked both). A non-ack Signal is held exactly as `Starting`'s (A14); so is an ack that
    /// arrives before `agent.resume` has recorded the Terminal it started (a race only an
    /// implausibly fast hook could win, but one `promote_resuming` must never be asked to attach
    /// a Terminal id it does not have): `promote_held_resume_ack` is what notices, once that id
    /// is recorded, that the wait is already over. Otherwise the ack — a `SessionStart` naming
    /// source `resume` and the saved conversation id — promotes it now.
    pub(super) fn finish_resuming(
        &self,
        rail: Option<&mut rail::Rail>,
        runs: &mut HashMap<String, Slot>,
        id: &str,
        actor: Actor,
        payload: Value,
    ) -> Result<Applied, RpcError> {
        let Some(Slot::Resuming {
            mode,
            attempt,
            since,
            old,
            conversation_id,
            cwd,
            prompt,
            starred,
            terminal_id,
            mut held,
            done,
        }) = runs.remove(id)
        else {
            unreachable!("observe matched a Resuming slot for {id}");
        };
        if !is_resume_ack(&payload, &conversation_id) || terminal_id.is_none() {
            hold(id, &mut held, actor, payload);
            runs.insert(
                id.to_owned(),
                Slot::Resuming {
                    mode,
                    attempt,
                    since,
                    old,
                    conversation_id,
                    cwd,
                    prompt,
                    starred,
                    terminal_id,
                    held,
                    done,
                },
            );
            return Ok((None, None));
        }
        let terminal_id = terminal_id.expect("checked above");
        let rail = rail.expect("rail locked for a conversation Signal");
        self.promote_resuming(
            rail,
            runs,
            id,
            attempt,
            old,
            mode,
            cwd,
            prompt,
            starred,
            terminal_id,
            held,
            done,
            actor,
            payload,
        )
    }

    /// A22: once a pending resume's Terminal id is recorded (`agent.resume`'s own `claimed`
    /// step), promote it at once if its ack arrived and was held only because that id was not
    /// yet known — the one case `finish_resuming` cannot act on by itself — instead of leaving it
    /// held until the 10 s timeout rolls a resume back that in fact already succeeded.
    pub(super) fn promote_held_resume_ack(&self, id: &str) {
        let mut rail = self.rail();
        let mut runs = self.runs();
        let found = match runs.get(id) {
            Some(Slot::Resuming {
                conversation_id,
                held,
                ..
            }) => held
                .iter()
                .position(|(_, payload)| is_resume_ack(payload, conversation_id)),
            _ => None,
        };
        let Some(position) = found else { return };
        let Some(Slot::Resuming {
            mode,
            attempt,
            old,
            cwd,
            prompt,
            starred,
            terminal_id,
            mut held,
            done,
            ..
        }) = runs.remove(id)
        else {
            unreachable!("checked above, under the same lock")
        };
        let (ack_actor, ack_payload) = held
            .remove(position)
            .expect("position came from this held, under the same lock");
        let terminal_id = terminal_id.expect("promote_held_resume_ack only runs once it is Some");
        let promoted = self.promote_resuming(
            &mut rail,
            &mut runs,
            id,
            attempt.clone(),
            old,
            mode,
            cwd,
            prompt,
            starred,
            terminal_id,
            held,
            done,
            ack_actor,
            ack_payload,
        );
        drop(runs);
        drop(rail);
        match promoted {
            Ok((Some(prompt), _)) => self.steer_first_prompt(id, &attempt, prompt),
            Ok((None, _)) => {}
            Err(err) => {
                eprintln!("agents: could not promote {id}'s already-held resume ack: {err}")
            }
        }
    }

    /// A22's ack confirmed for `id`: attach the Terminal `agent.resume` started (never before
    /// this moment), re-save the conversation (A21), apply every earlier held Signal in arrival
    /// order and then the ack itself, and wake the pending `agent.resume`. On failure, restore
    /// `old` only after the failed Attempt's Terminal is confirmed ended. The completion
    /// sender follows cleanup, so no Resume result can precede its effect.
    #[allow(clippy::too_many_arguments)]
    fn promote_resuming(
        &self,
        rail: &mut rail::Rail,
        runs: &mut HashMap<String, Slot>,
        id: &str,
        attempt: String,
        old: Option<Box<Run>>,
        mode: contracts::agent::ResumeMode,
        cwd: String,
        prompt: Option<String>,
        starred: bool,
        terminal_id: String,
        held: VecDeque<(Actor, Value)>,
        done: oneshot::Sender<Result<(), RpcError>>,
        actor: Actor,
        payload: Value,
    ) -> Result<Applied, RpcError> {
        if let Err(err) = rail.attach_terminal(id, &terminal_id) {
            self.fail_resume(
                runs,
                id,
                attempt,
                old,
                Some(terminal_id),
                done,
                RpcError::conflict(format!("cannot resume: {err}")),
            );
            return Err(err);
        }
        let clock = Arc::clone(&self.clock);
        let mut run = Run {
            yolo: mode == contracts::agent::ResumeMode::Yolo,
            startup_context: true,
            attempt: attempt.clone(),
            status_revision: 1,
            closing: false,
            ended: false,
            adapter: ClaudeCode::starting(move || clock()),
            first_pending: prompt.is_some(),
            first_completion: prompt.as_ref().map(|_| tokio::sync::watch::channel(None).0),
            first_prompt: prompt.as_ref().map(|_| FirstPrompt::Reserved),
            prompt,
            steer: None,
            session_started: false,
            starred: false,
            interrupt: None,
            named: true,
            terminal_id: terminal_id.clone(),
            cwd,
        };
        // Only the matching ack may release the first prompt; a held mismatched SessionStart
        // must not take it before the remembered title is applied below.
        for (held_actor, held_payload) in held {
            let first_prompt = claude_code::submitted_prompt(&held_payload).map(name::from_prompt);
            if let Err(err) = self.apply(
                Some(rail),
                &mut run,
                id,
                &held_actor,
                Observation::Signal(held_payload),
                first_prompt,
            ) {
                eprintln!("agents: could not apply a Signal held for {id} while it resumed: {err}");
            }
        }
        if let Err(err) = save_signal_conversation(rail, &run, id, &payload) {
            let err = match rail.detach_terminal(id) {
                Ok(()) => err,
                Err(detach) => RpcError::new(
                    err.code,
                    format!(
                        "{}; cannot detach Terminal {terminal_id}: {}",
                        err.message, detach.message
                    ),
                ),
            };
            self.fail_resume(
                runs,
                id,
                attempt,
                old,
                Some(terminal_id),
                done,
                RpcError::conflict(format!("cannot resume: {err}")),
            );
            return Err(err);
        }
        run.starred = starred;
        let applied = self.apply(
            Some(rail),
            &mut run,
            id,
            &actor,
            Observation::Signal(payload),
            None,
        );
        runs.insert(id.to_owned(), Slot::Running(run));
        let _ = done.send(Ok(()));
        applied
    }
}

/// How many Signals a `Slot::Starting` holds (A14); past this, the oldest is dropped and logged,
/// as A5 does for a payload the adapter refuses.
const HELD_BOUND: usize = 8;

pub(super) fn hold(id: &str, held: &mut VecDeque<(Actor, Value)>, actor: Actor, payload: Value) {
    if held.len() >= HELD_BOUND {
        held.pop_front();
        eprintln!(
            "agents: dropping the oldest Signal held for {id}: more than {HELD_BOUND} arrived \
             before it was registered"
        );
    }
    held.push_back((actor, payload));
}

/// A21: if `payload` is a Signal naming a conversation, save it and `run`'s effective cwd,
/// replacing any earlier save for `id`. A payload naming none, or one that fails UUID
/// validation, is a no-op: it never names a conversation at all.
pub(super) fn save_signal_conversation(
    rail: &mut rail::Rail,
    run: &Run,
    id: &str,
    payload: &Value,
) -> Result<(), RpcError> {
    let Some(conversation_id) = claude_code::conversation_id(payload) else {
        return Ok(());
    };
    rail.save_conversation(id, &conversation_id, &run.cwd)
}

/// A22: whether `payload` is the acknowledgement a pending resume waits for: a `SessionStart`
/// that began with `--resume` and names the saved conversation id.
pub(super) fn is_resume_ack(payload: &Value, conversation_id: &str) -> bool {
    claude_code::session_source(payload) == Some("resume")
        && claude_code::conversation_id(payload).as_deref() == Some(conversation_id)
}
