use super::*;
use crate::id::AgentId;
use contracts::agent::Ordinal;

/// State the Terminal watchers and the RPC calls share.
/// A33: an `idle` Status of an Agent that waits on blocker `wait` reads `blocked`; every other
/// Kind keeps its own.
pub(super) fn waiting_on(status: &Status, wait: Option<u32>) -> Status {
    match (status.kind, wait) {
        (Kind::Idle, Some(blocker)) => Status {
            kind: Kind::Blocked,
            label: format!("waits on #{blocker}"),
            since: status.since,
            finished: status.finished.clone(),
        },
        _ => status.clone(),
    }
}

/// A guarded effect keeps Agent locks until its IO finishes. A contending async
/// worker yields its reactor duties before waiting, so Signals and effect completion
/// remain schedulable. The uncontended path and non-reactor callers need no handoff.
pub(super) fn agent_lock<T>(mutex: &Mutex<T>) -> std::sync::LockResult<MutexGuard<'_, T>> {
    match mutex.try_lock() {
        Ok(guard) => Ok(guard),
        Err(std::sync::TryLockError::Poisoned(err)) => Err(err),
        Err(std::sync::TryLockError::WouldBlock) => {
            if tokio::runtime::Handle::try_current().is_ok_and(|handle| {
                handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread
            }) {
                tokio::task::block_in_place(|| mutex.lock())
            } else {
                mutex.lock()
            }
        }
    }
}

pub(super) struct State {
    #[cfg(feature = "test-support")]
    pub(super) statuses: Mutex<HashMap<String, Status>>,
    /// Since when an Agent without a Terminal has been `done`.
    pub(super) opened: i64,
    /// The Project's data folder (N1), where an Agent's launch record lives.
    pub(super) data_dir: PathBuf,
    pub(super) launcher: Launcher,
}

/// U5151d: the Status label of an Agent whose Terminal is not running, as an action.
pub(super) const TERMINAL_GONE: &str = "Terminal closed; resume or start it again";

/// U5151d: the failed Resume's Status says what to do; the RPC error keeps the evidence.
fn resume_cleanup_label(pending: bool) -> &'static str {
    match pending {
        true => "Resume failed; wait while its Terminal closes, then resume again",
        false => "Resume failed; stop its Terminal, then resume again",
    }
}

impl Shared {
    pub(super) fn rail(&self) -> MutexGuard<'_, rail::Rail> {
        agent_lock(&self.rail).expect("rail lock")
    }

    /// A33: replace the blockers Agents wait on. A running Agent whose reading changes gets a
    /// new `status_revision` and a Status event.
    pub(super) fn set_waits(&self, next: HashMap<String, u32>) {
        let mut runs = self.runs();
        for (id, agent) in runs.iter_mut() {
            let wait = next.get(&id.to_string()).copied();
            let before = std::mem::replace(&mut agent.facts.wait, wait);
            let Slot::Running(run) = &mut agent.slot else {
                continue;
            };
            let Some(status) = run.view().status.as_ref() else {
                continue;
            };
            let before = waiting_on(status, before);
            let after = waiting_on(status, wait);
            if run.ended() || (before.kind, &before.label) == (after.kind, &after.label) {
                continue;
            }
            run.publish(&self.bus, Actor::daemon(), &id.to_string(), after);
        }
    }

    pub(super) fn runs(&self) -> MutexGuard<'_, HashMap<AgentId, Agent>> {
        agent_lock(&self.runs).expect("runs lock")
    }

    pub(super) fn mark_starting(&self, id: &str, attempt: Ordinal) {
        let since = (self.clock)();
        self.runs().put(
            id,
            Slot::Starting {
                attempt,
                since,
                named: false,
                parked: VecDeque::new(),
            },
        );
        self.events.observed.notify_waiters();
    }

    /// Every node leaving the module carries its Attempt's Status. During resume the old
    /// Terminal stays visible until acknowledgement, but its ended Status would close the new
    /// Attempt's Message receiver (B36). A node without a run is done after a Daemon reopen.
    pub(super) fn present(
        &self,
        mut node: RailNode,
        runs: &HashMap<AgentId, Agent>,
        rail: &rail::Rail,
        finished: u64,
    ) -> Result<RailNode, RpcError> {
        if node.kind == NodeKind::Group {
            return Ok(node);
        }
        let entry = runs.agent(&node.id);
        let slot = entry
            .map(|agent| &agent.slot)
            .filter(|slot| !matches!(slot, Slot::Gone));
        node.final_text = match slot {
            Some(Slot::Running(run)) => {
                run.view()
                    .turn
                    .as_deref()
                    .map(|turn| contracts::agent::FinalText {
                        turn: turn.to_owned(),
                        attempt: run.attempt().to_string(),
                        finished: run.view().finished.to_string(),
                        kind: run.view().final_text,
                    })
            }
            _ => None,
        };
        node.status_revision = match slot {
            Some(Slot::Running(run)) => Some(run.status_revision().clone()),
            // B36: inheriting the ended run's revision closes Messages on the new Attempt.
            Some(Slot::Starting { .. } | Slot::Resuming { .. }) => Some(Ordinal::first()),
            _ => None,
        };
        let live = match slot {
            Some(Slot::Running(run)) => run
                .view()
                .status
                .as_ref()
                .map(|status| waiting_on(status, entry.and_then(|agent| agent.facts.wait))),
            Some(Slot::Starting { since, .. } | Slot::Resuming { since, .. }) => Some(Status {
                kind: Kind::Working,
                label: "starting".into(),
                since: *since,
                finished: finished.to_string(),
            }),
            Some(Slot::ResumeCleanup {
                terminal_id,
                pending,
                ..
            }) => {
                node.terminal_id = Some(terminal_id.clone());
                Some(Status {
                    kind: Kind::Error,
                    label: resume_cleanup_label(*pending).into(),
                    since: self.rail_view.opened,
                    finished: finished.to_string(),
                })
            }
            None | Some(Slot::Closing | Slot::Gone) => None,
        };
        node.status = Some(live.unwrap_or_else(|| Status {
            kind: Kind::Done,
            label: TERMINAL_GONE.into(),
            since: self.rail_view.opened,
            finished: finished.to_string(),
        }));
        #[cfg(feature = "test-support")]
        if let Some(status) = self.rail_view.statuses.lock().unwrap().get(&node.id) {
            node.status = Some(status.clone());
            node.status_revision = Some(Ordinal::first());
        }
        // A22: exited (no live process, and no start in flight), with A21 data to resume.
        let exited = match slot {
            Some(Slot::Running(run)) => run.ended(),
            Some(
                Slot::Starting { .. }
                | Slot::Resuming { .. }
                | Slot::ResumeCleanup { .. }
                | Slot::Closing,
            ) => false,
            None | Some(Slot::Gone) => true,
        };
        node.can_resume &= exited;
        // A5287: the guards of `agent.makeWorkstream` and `agent.saveAsMode`.
        let agent = node.kind == NodeKind::Agent;
        node.can_make_workstream =
            agent && node.parent.is_none() && rail.has_conversation(&node.id)?;
        node.can_save_as_mode = agent
            && matches!(
                Launcher::load_lean(&self.rail_view.data_dir, &node.id),
                Ok(Some(_))
            );
        node.yolo = match slot {
            Some(Slot::Running(run)) => run.yolo(),
            Some(
                Slot::Resuming { old: Some(old), .. } | Slot::ResumeCleanup { old: Some(old), .. },
            ) => old.yolo(),
            _ => false,
        };
        if node.can_resume
            && !matches!(slot, Some(Slot::Running(run)) if run.closing())
            && let Some((id, cwd)) = rail.conversation(&node.id)?
        {
            // RO2: the cache only; a task of its own reads the transcript and announces it.
            node.overview = self.rail_view.launcher.cached_overview(&id);
            let me = self.me.clone();
            self.rail_view
                .launcher
                .keep_overview(Path::new(&cwd), &id, move || {
                    if let Some(shared) = me.upgrade() {
                        shared.bus.emit(Actor::daemon(), EventData::RailChanged);
                    }
                });
        }
        // R3696c: a Workstream holds a channel, inbox, tool call or stray only while a
        // Door runs under its id.
        if node.kind == NodeKind::Workstream && slot.is_none() {
            return Ok(node);
        }
        node.channel = channel_in(entry);
        node.inbox = self.events.inbox.fact(&node.id);
        if let Some(Facts {
            tool_call, strays, ..
        }) = entry.map(|agent| &agent.facts)
        {
            node.tool_call = tool_call.as_ref().map(|tracked| tracked.call.clone());
            node.stray = strays.clone();
        }
        Ok(node)
    }

    pub(super) fn node(&self, id: &str) -> Result<RailNode, RpcError> {
        let rail = self.rail();
        let runs = self.runs();
        let finished = rail.finished(id)?;
        self.present(rail.node(id)?, &runs, &rail, finished)
    }

    pub(super) fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
        self.presented_tree(&self.rail())
    }

    /// Every node of `rail` as `tree` presents it, its finish count read with the node.
    pub(super) fn presented_tree(&self, rail: &rail::Rail) -> Result<Vec<RailNode>, RpcError> {
        let runs = self.runs();
        Ok(rail.tree_with(|node, finished| self.present(node, &runs, rail, finished))?)
    }
}

impl Agents {
    /// Whether this Agent's name has already been chosen explicitly or by its first prompt.
    pub fn naming_settled(&self, id: &str) -> bool {
        match self.shared.runs().slot(id) {
            Some(Slot::Running(run)) => run.named(),
            Some(Slot::Starting { named, .. }) => *named,
            _ => true,
        }
    }

    /// U6380c: whether the user named `id`; a row that is gone reads false.
    pub fn user_named(&self, id: &str) -> bool {
        self.shared.rail().user_named(id).unwrap_or(false)
    }

    /// Resolve an Agent's current Rail name for prose, preserving storage failures.
    pub fn rail_name(&self, id: &str) -> Result<String, RpcError> {
        Ok(self.shared.rail().name(id)?)
    }

    /// Preserve canonical Rail identities after their nodes leave the live tree.
    pub fn rail_last_id(&self) -> Result<i64, RpcError> {
        Ok(self.shared.rail().last_id()?)
    }

    /// H21: the Agent a call from process `pid` is by, found by walking its parents to the
    /// `claude` of a running Agent; `None` for a process that descends from no Agent.
    pub fn agent_of_peer(&self, pid: u32) -> Option<String> {
        let claudes: HashMap<u32, String> = self
            .running_programs()
            .into_iter()
            .map(|(id, pid)| (pid, id))
            .collect();
        peer::agent_above(pid, &claudes, peer::parent_of)
    }

    /// D8: each running Agent with the pid of its program; an Agent that is not running has none.
    pub fn running_programs(&self) -> Vec<(String, u32)> {
        self.shared
            .runs()
            .iter()
            .filter_map(|(id, agent)| match &agent.slot {
                Slot::Running(run) => self
                    .shared
                    .terminals
                    .program_pid(run.terminal_id())
                    .map(|pid| (id.to_string(), pid)),
                _ => None,
            })
            .collect()
    }

    /// A33: `waits` maps each Agent to the lowest open blocker of its blocked Todos.
    pub fn set_waits(&self, waits: HashMap<String, u32>) {
        self.shared.set_waits(waits);
    }

    /// O4, O13: replace the order of an Agent or a Door, and Steer it the new one unless the caller is
    /// the Agent itself. A child change by an Agent waits for
    /// the physical Steer and submit. Post-storage errors name the stored Order:
    /// A refused Steer reports no bytes; UNKNOWN_OUTCOME forbids blind retry.
    /// Direct user changes retain O4's asynchronous Steer.
    pub(super) async fn set_order(
        &self,
        ctx: &Ctx,
        params: SetOrderParams,
    ) -> Result<RailNode, RpcError> {
        let SetOrderParams {
            id,
            order,
            captured,
        } = params;
        valid_explicit_order(&order)?;
        self.shared.rail().node(&id)?;
        let allowed = match ctx.actor.kind {
            ActorKind::User => true,
            // O13: a Door sets the order only of an Agent it, or an Agent under it, spawned.
            ActorKind::Agent => {
                ctx.actor.id == id || self.shared.rail().spawned_under(&id, &ctx.actor.id)?
            }
            ActorKind::Ext => false,
        };
        if !allowed {
            return Err(RpcError::forbidden(format!(
                "{} may not set the order of {}",
                if ctx.actor.kind == ActorKind::Agent {
                    self.rail_name(&ctx.actor.id)?
                } else {
                    ctx.actor.id.clone()
                },
                self.rail_name(&id)?
            )));
        }
        let node = self
            .shared
            .rail()
            .set_order(&id, &order, captured.as_ref())?;
        ctx.touch(contracts::Verb::Wrote, &format!("agent:{id}"))?;
        ctx.emit(EventData::RailChanged);
        if ctx.actor.id != id {
            // A4452d: a changed Order reaches the target's inbox, never its Terminal.
            let shared = Arc::clone(&self.shared);
            let text = order::steer(&order, None);
            if let Some(attempt) = node.attempt.as_deref() {
                let mut rail = shared.rail();
                if let Some(revision) = rail.order_revision(&id)? {
                    rail.prepare_instruction(&revision, attempt, &text, false)?;
                }
            }
            // User orders use the same physical-delivery admission as user Messages:
            // retained automatic notes can follow this instruction, never precede it.
            let from = if ctx.actor.kind == ActorKind::User {
                ctx.actor.clone()
            } else {
                Actor::daemon()
            };
            let sent = shared.coordinate(from, &id, None, text).await;
            if let Err(err) = sent {
                if ctx.actor.kind == ActorKind::Agent {
                    let mut error = RpcError::from(PromptError::from(err));
                    error.message = format!("Order stored; not sent: {}", error.message);
                    return Err(error);
                }
                eprintln!("agents: the new order of {id} was not sent: {err}");
            }
        }
        self.shared.node(&node.id)
    }
}

/// O7: an explicit order, also parked to the ask cap.
pub(super) fn valid_explicit_order(order: &Order) -> Result<(), RpcError> {
    order
        .validate_explicit()
        .map_err(|message| RpcError::new(code::INVALID_PARAMS, message))
}

/// O1: an order of the right shape, or `INVALID_PARAMS`.
pub(super) fn valid_order(order: &Order) -> Result<(), RpcError> {
    order
        .validate()
        .map_err(|message| RpcError::new(code::INVALID_PARAMS, message))
}

#[cfg(test)]
mod tests;

/// U5531c: only native attention or error keeps a child shown; settled turns, questions and orders never do.
pub(super) fn visibility_reason(node: &RailNode) -> Option<&'static str> {
    visibility_protection(node.status.as_ref().map(|s| s.kind))
}

pub(super) fn visibility_protection(kind: Option<Kind>) -> Option<&'static str> {
    match kind {
        Some(Kind::NeedsYou) => Some("native attention is active"),
        Some(Kind::Error) => Some("error is active"),
        _ => None,
    }
}
