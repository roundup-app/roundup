use super::*;
use crate::id::AgentId;

impl Shared {
    /// Swap `id` from `Starting` to `Running` (the Run `build` makes, told whether a
    /// `rail.rename` already settled its name) and apply every Signal parked for it, in arrival
    /// order, all under one `rail`-then-`runs` lock section: a Signal that arrives once the
    /// Agent is registered can never be applied ahead of one still parked for it (A14), and
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
        if !matches!(runs.slot(id), Some(Slot::Starting { attempt: active, .. }) if active.as_str() == attempt)
        {
            return Err(RpcError::conflict(format!(
                "{}: stale start completion",
                rail.name(crate::rail::agent_id(id)?)?
            )));
        }
        let Some(Slot::Starting { named, parked, .. }) = runs.take(id) else {
            return Err(RpcError::internal(format!(
                "{id} is not Starting although it was just checked"
            )));
        };
        let mut run = build(named);
        if run.input_started()
            && let Err(error) = self.save_input_started(id, run.attempt())
        {
            runs.put(id, Slot::Running(run));
            return Err(error);
        }
        run.observe(Observation::Finished(
            crate::rail::agent_id(id).map_or(0, |id| {
                crate::rail_view::finished_of(&rail, id).unwrap_or_default()
            }),
        ));
        let mut prompts = Vec::new();
        for (actor, payload) in parked {
            // A21: a parked Signal naming a conversation is saved before it is applied, same as a
            // Running Agent's; here, before `agent.spawn` has returned, a failed save fails the
            // whole spawn instead, as any other failed spawn does (A14), so the Terminal
            // `run_agent`'s own cleanup kills is this one, never left running.
            if let Err(err) = save_signal_conversation(&mut rail, &run, id, &payload) {
                // Put `id` back so the caller's own failed-spawn cleanup (which expects to find
                // its Attempt still in `runs`) still removes the orphaned node and kills the
                // Terminal `start` already recorded, exactly as any other failed spawn.
                runs.put(id, Slot::Running(run));
                return Err(err);
            }
            let first_prompt = claude_code::see(&payload).prompt.map(name::from_prompt);
            // Logged, not panicked: a panic here would unwind while `rail` and `runs` are both
            // still locked, poisoning them and taking every later `rail()`/`runs()` call down
            // with it. `rail.node(id)` itself cannot be `NOT_FOUND` (a Starting id's Rail node is
            // removed only by its own failed spawn, which never reaches here), but the write a
            // parked rename makes can still fail on its own account.
            let Some(agent) = runs.agent_mut(id) else {
                runs.put(id, Slot::Running(run));
                return Err(RpcError::internal(format!(
                    "{id} is not in runs while it starts"
                )));
            };
            let agent_facts = &mut agent.facts;
            match self.apply(
                Some(&mut *rail),
                &mut run,
                agent_facts,
                id,
                &actor,
                Observation::Signal(payload),
                first_prompt,
            ) {
                Ok((prompt, _tick_at)) => prompts.extend(prompt),
                Err(err) => eprintln!(
                    "agents: could not apply a Signal parked for {id} while it was starting: {err}"
                ),
            }
        }
        runs.put(id, Slot::Running(run));
        Ok(prompts)
    }

    /// A22: `id`'s slot is `Resuming` and `payload` is a Signal (`observe`'s own match already
    /// checked both). A non-ack Signal is parked exactly as `Starting`'s (A14); so is an ack that
    /// arrives before `agent.resume` has recorded the Terminal it started (a race only an
    /// implausibly fast hook could win, but one `promote_resuming` must never be asked to attach
    /// a Terminal id it does not have): `promote_parked_resume_ack` is what notices, once that id
    /// is recorded, that the wait is already over. Otherwise the ack — a `SessionStart` naming
    /// source `resume` and the saved conversation id — promotes it now.
    pub(super) fn finish_resuming(
        &self,
        rail: Option<&mut rail::Rail>,
        runs: &mut HashMap<AgentId, Agent>,
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
            mut parked,
            done,
        }) = runs.take(id)
        else {
            return Err(RpcError::internal(format!("{id} is not Resuming")));
        };
        let ack = is_resume_ack(&payload, &conversation_id, self.git.is_forked());
        let (terminal_id, rail) = match (terminal_id, rail) {
            (Some(terminal_id), Some(rail)) if ack => (terminal_id, rail),
            (terminal_id, rail) => {
                // An ack without the locked Rail is a fault, not a wait: report it, hold nothing.
                let fault = (ack && terminal_id.is_some() && rail.is_none()).then(|| {
                    RpcError::internal(format!("{id} resume ack arrived without the Rail locked"))
                });
                if fault.is_none() {
                    hold(id, &mut parked, actor, payload);
                }
                runs.put(
                    id,
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
                        parked,
                        done,
                    },
                );
                return fault.map_or(Ok((None, None)), Err);
            }
        };
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
            parked,
            done,
            actor,
            payload,
        )
    }

    /// A22: once a pending resume's Terminal id is recorded (`agent.resume`'s own `claimed`
    /// step), promote it at once if its ack arrived and was parked only because that id was not
    /// yet known — the one case `finish_resuming` cannot act on by itself — instead of leaving it
    /// parked until the 10 s timeout rolls a resume back that in fact already succeeded.
    pub(super) fn promote_parked_resume_ack(&self, id: &str) {
        let mut rail = self.rail();
        let mut runs = self.runs();
        let git_forked = self.git.is_forked();
        let ack = match runs.slot_mut(id) {
            Some(Slot::Resuming {
                conversation_id,
                parked,
                terminal_id: Some(_),
                ..
            }) => parked
                .iter()
                .position(|(_, payload)| is_resume_ack(payload, conversation_id, git_forked))
                .and_then(|position| parked.remove(position)),
            _ => None,
        };
        let Some((ack_actor, ack_payload)) = ack else {
            return;
        };
        let Some(Slot::Resuming {
            mode,
            attempt,
            old,
            cwd,
            prompt,
            starred,
            terminal_id: Some(terminal_id),
            parked,
            done,
            ..
        }) = runs.take(id)
        else {
            eprintln!("agents: {id}'s Resuming slot vanished under the lock that checked it");
            return;
        };
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
            parked,
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
                eprintln!("agents: could not promote {id}'s already-parked resume ack: {err}")
            }
        }
    }

    fn abandon_resume(
        &self,
        runs: &mut HashMap<AgentId, Agent>,
        id: &str,
        attempt: Ordinal,
        old: Option<Box<Run>>,
        terminal_id: String,
        done: oneshot::Sender<Result<(), RpcError>>,
    ) -> RpcError {
        let error = RpcError::internal(format!("{id} is not in runs while it resumes"));
        self.fail_resume(
            runs,
            id,
            attempt,
            Abandoned {
                old,
                terminal_id: Some(terminal_id),
                done,
            },
            error.clone(),
        );
        error
    }

    /// A22's ack confirmed for `id`: attach the Terminal `agent.resume` started (never before
    /// this moment), re-save the conversation (A21), apply every earlier parked Signal in arrival
    /// order and then the ack itself, and wake the pending `agent.resume`. On failure, restore
    /// `old` only after the failed Attempt's Terminal is confirmed ended. The completion
    /// sender follows cleanup, so no Resume result can precede its effect.
    #[allow(clippy::too_many_arguments)]
    fn promote_resuming(
        &self,
        rail: &mut rail::Rail,
        runs: &mut HashMap<AgentId, Agent>,
        id: &str,
        attempt: Ordinal,
        old: Option<Box<Run>>,
        mode: contracts::agent::ResumeMode,
        cwd: String,
        prompt: Option<String>,
        starred: bool,
        terminal_id: String,
        parked: VecDeque<(Actor, Value)>,
        done: oneshot::Sender<Result<(), RpcError>>,
        actor: Actor,
        payload: Value,
    ) -> Result<Applied, RpcError> {
        if let Err(err) = rail
            .attach_terminal(crate::rail::agent_id(id)?, &terminal_id)
            .map_err(RpcError::from)
        {
            self.fail_resume(
                runs,
                id,
                attempt,
                Abandoned {
                    old,
                    terminal_id: Some(terminal_id),
                    done,
                },
                RpcError::conflict(format!("cannot resume: {err}")),
            );
            return Err(err);
        }
        let clock = Arc::clone(&self.clock);
        // U6260b: a resume continues the conversation, so input it already received stays
        // admitted; a retained order alone is not input (A5556a).
        let continued =
            old.as_ref().is_some_and(|old| old.input_started()) || self.owner_input_started(id);
        let mut run = Run::resumed(
            clock,
            mode == contracts::agent::ResumeMode::Yolo,
            attempt.clone(),
            terminal_id.clone(),
            cwd,
            prompt,
            continued,
        );
        if run.input_started()
            && let Err(error) = self.save_input_started(id, run.attempt())
        {
            self.fail_resume(
                runs,
                id,
                attempt,
                Abandoned {
                    old,
                    terminal_id: Some(terminal_id),
                    done,
                },
                error.clone(),
            );
            return Err(error);
        }
        run.observe(Observation::Finished(
            crate::rail::agent_id(id).map_or(0, |id| {
                crate::rail_view::finished_of(rail, id).unwrap_or_default()
            }),
        ));
        // Only the matching ack may release the first prompt; a parked mismatched SessionStart
        // must not take it before the remembered title is applied below.
        for (parked_actor, parked_payload) in parked {
            let first_prompt = claude_code::see(&parked_payload)
                .prompt
                .map(name::from_prompt);
            let Some(agent) = runs.agent_mut(id) else {
                return Err(self.abandon_resume(runs, id, attempt, old, terminal_id, done));
            };
            let agent_facts = &mut agent.facts;
            if let Err(err) = self.apply(
                Some(rail),
                &mut run,
                agent_facts,
                id,
                &parked_actor,
                Observation::Signal(parked_payload),
                first_prompt,
            ) {
                eprintln!(
                    "agents: could not apply a Signal parked for {id} while it resumed: {err}"
                );
            }
        }
        if let Err(err) = save_signal_conversation(rail, &run, id, &payload) {
            let err = match rail.detach_terminal(crate::rail::agent_id(id)?) {
                Ok(()) => err,
                Err(detach) => RpcError::new(
                    err.code,
                    format!(
                        "{}; cannot detach Terminal {terminal_id}: {}",
                        err.message,
                        RpcError::from(detach).message
                    ),
                ),
            };
            self.fail_resume(
                runs,
                id,
                attempt,
                Abandoned {
                    old,
                    terminal_id: Some(terminal_id),
                    done,
                },
                RpcError::conflict(format!("cannot resume: {err}")),
            );
            return Err(err);
        }
        if starred {
            run.note_star();
        }
        let Some(agent) = runs.agent_mut(id) else {
            return Err(self.abandon_resume(runs, id, attempt, old, terminal_id, done));
        };
        let agent_facts = &mut agent.facts;
        let applied = self.apply(
            Some(rail),
            &mut run,
            agent_facts,
            id,
            &actor,
            Observation::Signal(payload),
            None,
        );
        runs.put(id, Slot::Running(run));
        let _ = done.send(Ok(()));
        applied
    }
}

/// How many Signals a `Slot::Starting` holds (A14); past this, the oldest is dropped and logged,
/// as A5 does for a payload the adapter refuses.
const PARKED_BOUND: usize = 8;

pub(super) fn hold(id: &str, parked: &mut VecDeque<(Actor, Value)>, actor: Actor, payload: Value) {
    if parked.len() >= PARKED_BOUND {
        parked.pop_front();
        eprintln!(
            "agents: dropping the oldest Signal parked for {id}: more than {PARKED_BOUND} arrived \
             before it was registered"
        );
    }
    parked.push_back((actor, payload));
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
    let Some(conversation_id) = claude_code::see(payload).conversation else {
        return Ok(());
    };
    rail.save_conversation(crate::rail::agent_id(id)?, conversation_id, run.cwd())?;
    rail.save_conversation_yolo(crate::rail::agent_id(id)?, run.yolo())?;
    Ok(())
}

/// A22: whether `payload` is the acknowledgement a pending resume waits for: a `SessionStart`
/// that began with `--resume` and names the saved conversation id. In a Fork the resume carries
/// `--fork-session` (FOP5978c), so Claude Code sends source `fork` with a new conversation id,
/// which becomes the Agent's saved conversation (U6266c).
pub(super) fn is_resume_ack(payload: &Value, conversation_id: &str, forked: bool) -> bool {
    let seen = claude_code::see(payload);
    match seen.source {
        Some(Source::Resume) => seen.conversation == Some(conversation_id),
        Some(Source::Fork) => forked && seen.conversation.is_some(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use crate::tests::Watched;

    #[tokio::test]
    async fn a2703a_errors_use_rail_names() {
        let watched = Watched::named();
        for (id, name) in [("7013", "sad"), ("8013", "an Agent that is gone")] {
            let error = watched
                .shared
                .finish_starting(id, "stale", |_| unreachable!())
                .unwrap_err();
            assert!(
                error.message.contains(name) && !error.message.contains(id),
                "{error}"
            );
        }
    }

    #[test]
    fn u6266c_a_fork_session_start_acknowledges_a_resume_in_a_fork() {
        let fork = serde_json::json!({
            "hook_event_name": "SessionStart",
            "source": "fork",
            "session_id": "22222222-2222-4222-8222-222222222222",
        });
        let saved = "11111111-1111-4111-8111-111111111111";
        assert!(super::is_resume_ack(&fork, saved, true));
        assert!(!super::is_resume_ack(&fork, saved, false));
    }
}
