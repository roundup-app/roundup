use super::*;

impl Shared {
    /// F5: scan Door `id`, whose program's arguments hold `marker`, from the next tick on.
    pub(super) fn scan_door(self: &Arc<Self>, id: &str, marker: String) {
        self.scan
            .doors
            .lock()
            .expect("scan doors lock")
            .insert(id.to_owned(), marker);
        if self.scan.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let (me, interval) = (self.me.clone(), self.scan.interval);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                let Some(shared) = me.upgrade() else { break };
                shared.scan_once().await;
            }
        });
    }

    /// F5: read the process table once if a Door runs, and announce each Door whose strays changed.
    pub(super) async fn scan_once(&self) {
        let live: Vec<(String, String)> = {
            let runs = self.runs();
            let mut doors = self.scan.doors.lock().expect("scan doors lock");
            doors.retain(|id, _| {
                matches!(runs.get(id), Some(Slot::Running(run)) if !run.ended && !run.closing)
            });
            doors
                .iter()
                .map(|(id, marker)| (id.clone(), marker.clone()))
                .collect()
        };
        let table = if live.is_empty() {
            Vec::new()
        } else {
            match tokio::task::spawn_blocking(scan::read_table).await {
                Ok(Ok(table)) => scan::parse(&table),
                Ok(Err(err)) => return eprintln!("agents: cannot read the process table: {err}"),
                Err(err) => return eprintln!("agents: the process scan stopped: {err}"),
            }
        };
        let programs = claude_code::programs();
        let mut now: HashMap<String, Vec<Stray>> = live
            .iter()
            .map(|(id, marker)| {
                let owned: Vec<u32> = self
                    .terminals
                    .list()
                    .into_iter()
                    .filter(|info| info.owner.as_deref() == Some(id.as_str()))
                    .filter_map(|info| self.terminals.program_pid(&info.id))
                    .collect();
                (id.clone(), scan::strays(&table, marker, &owned, programs))
            })
            .collect();
        let changed: Vec<(String, Vec<Stray>)> = {
            let mut found = self.strays.lock().expect("scan found lock");
            let gone: Vec<String> = found
                .keys()
                .filter(|id| !now.contains_key(*id))
                .cloned()
                .collect();
            now.extend(gone.into_iter().map(|id| (id, Vec::new())));
            let mut changed = Vec::new();
            for (id, stray) in now {
                if found.get(&id).map_or(&[][..], Vec::as_slice) == stray.as_slice() {
                    continue;
                }
                if stray.is_empty() {
                    found.remove(&id);
                } else {
                    found.insert(id.clone(), stray.clone());
                }
                changed.push((id, stray));
            }
            changed
        };
        for (id, stray) in changed {
            self.bus.emit(
                Actor::daemon(),
                EventData::AgentStray(StrayEvent { id, stray }),
            );
        }
    }
}

impl Agents {
    /// A32: stop the program of the Door of Workstream `id`.
    pub async fn stop_door(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        self.shared.stop(actor, id).await
    }

    /// A32: start the Door's next Iteration as a fresh conversation whose first prompt is
    /// `handoff`, and return once its `SessionStart` has arrived, within `bound`. Only then is its
    /// Iteration advanced; a start that does not get there leaves the Door stopped.
    pub async fn restart_door(
        &self,
        ctx: &Ctx,
        id: &str,
        handoff: String,
        iteration: u32,
        bound: Duration,
    ) -> Result<RailNode, RpcError> {
        let held = self.shared.node(id)?;
        let params = StartDoorParams {
            id: id.to_owned(),
            model: held.model,
            effort: held.effort,
        };
        let node = self
            .start_door_with(ctx, params, Some(handoff), true)
            .await?;
        let attempt = node.attempt.clone().unwrap_or_default();
        let started = async {
            loop {
                let seen = matches!(
                    self.shared.runs().get(id),
                    Some(Slot::Running(run)) if run.attempt == attempt && run.session_started
                );
                if seen {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        };
        if tokio::time::timeout(bound, started).await.is_err() {
            report_undo(
                "stop a Door that never started",
                self.shared.stop(ctx.actor.clone(), id).await,
            );
            return Err(RpcError::conflict(format!(
                "{id}: no SessionStart within {}s",
                bound.as_secs()
            )));
        }
        self.shared.rail().set_iteration(id, iteration)?;
        self.shared.node(id)
    }

    /// A7: start a Workstream's Door. A23: a Door with A21 data resumes that conversation exactly as
    /// `resume` does (so a saved conversation that cannot resume fails and never starts fresh);
    /// any other Door, its first start included, starts fresh.
    pub(super) async fn start_door(
        &self,
        ctx: &Ctx,
        params: StartDoorParams,
    ) -> Result<RailNode, RpcError> {
        self.start_door_with(ctx, params, None, true).await
    }

    /// `first` is A32's Handoff: it replaces the Door's order as the first prompt and a saved
    /// conversation is not resumed.
    pub(super) async fn start_door_with(
        &self,
        ctx: &Ctx,
        StartDoorParams { id, model, effort }: StartDoorParams,
        first: Option<String>,
        startup_context: bool,
    ) -> Result<RailNode, RpcError> {
        let _lifecycle = self.shared.door_lifecycle.read().await;
        let id = id.as_str();
        let saved = {
            let rail = self.shared.rail();
            if rail.node(id)?.kind != NodeKind::Workstream {
                return Err(RpcError::conflict(format!("{id} is not a Workstream")));
            }
            rail.has_conversation(id)?
        };
        let own = model.is_some() || effort.is_some();
        let pair = self.choose(&ctx.actor, Role::Door, model, effort)?;
        if saved && first.is_none() {
            // A36: a resume takes the pair the Door held; one the call names replaces it.
            if own {
                let held = self.shared.rail().node(id)?;
                self.shared.rail().set_pair(
                    id,
                    pair.model.as_deref().or(held.model.as_deref()),
                    pair.effort.as_deref().or(held.effort.as_deref()),
                )?;
            }
            return self.resume_saved(ctx, id, START_DOOR_ACK_BOUND).await;
        }
        let attempt = {
            let mut rail = self.shared.rail();
            let node = rail.node(id)?;
            if node.kind != NodeKind::Workstream {
                return Err(RpcError::conflict(format!("{id} is not a Workstream")));
            }
            let mut runs = self.shared.runs();
            if let Some(slot) = runs.get(id) {
                let live = match slot {
                    Slot::Running(run) => {
                        run.closing
                            || self
                                .shared
                                .terminals
                                .list()
                                .iter()
                                .any(|t| t.id == run.terminal_id && t.running)
                    }
                    _ => true,
                };
                if live {
                    return Err(RpcError::conflict(format!("Door {id} is already active")));
                }
            }
            rail.set_pair(id, pair.model.as_deref(), pair.effort.as_deref())?;
            let attempt = rail.allocate_attempt(id)?;
            runs.insert(
                id.to_owned(),
                Slot::Starting {
                    attempt: attempt.clone(),
                    since: (self.shared.clock)(),
                    named: true,
                    held: VecDeque::new(),
                },
            );
            attempt
        };
        let project = self.project_dir().to_owned();
        if let Err(err) = self
            .run_agent(id, &attempt, &project, first, startup_context)
            .await
        {
            let mut rail = self.shared.rail();
            let mut runs = self.shared.runs();
            if runs.get(id).is_some_and(|slot| slot.attempt() == attempt) {
                runs.remove(id);
                rail.detach_terminal(id)?;
            }
            return Err(err);
        }
        ctx.emit(EventData::RailChanged);
        self.shared.node(id)
    }
}

/// F5: what the scan of the Doors' process trees keeps.
pub(super) struct Scan {
    /// How long between two reads of the process table.
    pub(super) interval: Duration,
    /// The scan loop starts with the first Door and ends with the Daemon.
    pub(super) started: AtomicBool,
    /// Each started Door's marker: the path its program's arguments hold.
    pub(super) doors: Mutex<HashMap<String, String>>,
}

impl Scan {
    pub(super) fn new(interval: Duration) -> Self {
        Self {
            interval,
            started: AtomicBool::new(false),
            doors: Mutex::new(HashMap::new()),
        }
    }
}

/// F5: `ROUNDUP_SCAN_MS` when it is a positive whole number of milliseconds, else `SCAN_INTERVAL`.
pub(super) fn scan_interval_from_env() -> Duration {
    match std::env::var("ROUNDUP_SCAN_MS") {
        Ok(ms) => match ms.parse::<u64>() {
            Ok(ms) if ms > 0 => Duration::from_millis(ms),
            _ => {
                eprintln!("agents: ROUNDUP_SCAN_MS={ms:?} is not positive milliseconds; ignored");
                SCAN_INTERVAL
            }
        },
        Err(_) => SCAN_INTERVAL,
    }
}
