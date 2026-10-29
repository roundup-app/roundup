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
        let listed = self.terminals.list().await;
        let mut now: HashMap<String, Vec<Stray>> = live
            .iter()
            .map(|(id, marker)| {
                let owned: Vec<u32> = listed
                    .iter()
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
    /// A4452c: type the reserved user text only into the matching fresh, idle Door.
    /// The coordinator persists its Typing fence before calling; never retry this effect.
    pub async fn opening_prompt(
        &self,
        id: &str,
        attempt: &str,
        text: &str,
    ) -> Result<(), RpcError> {
        let ready = async {
            loop {
                let observed = self.shared.events.observed.notified();
                {
                    let runs = self.shared.runs();
                    match runs.get(id) {
                        Some(Slot::Running(run))
                            if run.attempt == attempt && !run.ended && !run.closing =>
                        {
                            if run.session_started.is_some()
                                && !run.first_pending
                                && run
                                    .adapter
                                    .status()
                                    .is_some_and(|s| s.kind == contracts::Kind::Idle)
                            {
                                break;
                            }
                        }
                        _ => {
                            return Err(RpcError::conflict("fresh Door Attempt is no longer live"));
                        }
                    }
                }
                observed.await;
            }
            self.shared
                .prompt(id, text, Some(attempt), true, None)
                .await
                .map_err(|error| {
                    RpcError::unknown_outcome(format!(
                        "Opening prompt was not acknowledged: {}; do not retype",
                        PromptError::from(error)
                    ))
                })
        };
        tokio::time::timeout(Duration::from_secs(15), ready)
            .await
            .map_err(|_| {
                RpcError::unknown_outcome("Opening prompt acknowledgement timed out; do not retype")
            })?
    }

    /// A4452c: stop the program before a fresh Door session.
    pub async fn stop_door(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        self.shared.stop(actor, id).await
    }

    /// A4452c: start a fresh conversation and await SessionStart within `bound`.
    /// A4665: a failed start is retryable only after no launched program remains;
    /// unconfirmed cleanup returns UNKNOWN_OUTCOME to keep the coordinator's fence.
    pub async fn restart_door(
        &self,
        ctx: &Ctx,
        id: &str,
        bound: Duration,
    ) -> Result<RailNode, RpcError> {
        let parked = self.shared.node(id)?;
        let params = StartDoorParams {
            id: id.to_owned(),
            model: parked.model,
            effort: parked.effort,
            permission_mode: None,
            engine: None,
            cols: None,
            rows: None,
        };
        // A failed launch can have crossed the program boundary before its Rail attachment
        // failed. Only an authoritative Terminal snapshot can rule out that orphan.
        let before = self.shared.terminals.list().await;
        let node = match self
            .start_door_with(ctx, params, Some(String::new()), true)
            .await
        {
            Ok(node) => node,
            Err(error) => {
                if self.shared.terminals.list().await.iter().any(|terminal| {
                    terminal.running && !before.iter().any(|old| old.id == terminal.id)
                }) {
                    return Err(RpcError::unknown_outcome(format!(
                        "{error}; fresh Door cleanup is not confirmed"
                    )));
                }
                return Err(error);
            }
        };
        let attempt = node.attempt.clone().unwrap_or_default();
        let started = async {
            loop {
                let observed = self.shared.events.observed.notified();
                let seen = matches!(
                    self.shared.runs().get(id),
                    Some(Slot::Running(run)) if run.attempt == attempt && run.session_started.is_some()
                );
                if seen {
                    return;
                }
                observed.await;
            }
        };
        if tokio::time::timeout(bound, started).await.is_err() {
            let cause = format!("{id}: no SessionStart within {}s", bound.as_secs());
            let stopped = self.shared.stop(ctx.actor.clone(), id).await;
            let cleanup = match stopped {
                Ok(()) => match node.terminal_id.as_deref() {
                    Some(terminal) => self.shared.confirm_terminal_exit(terminal).await,
                    None => Err(RpcError::unknown_outcome("fresh Door Terminal is unknown")),
                },
                Err(error) => Err(error),
            };
            if let Err(error) = cleanup {
                return Err(RpcError::unknown_outcome(format!("{cause}; {error}")));
            }
            return Err(RpcError::conflict(cause));
        }
        self.shared.node(id).map_err(|error| {
            RpcError::unknown_outcome(format!("fresh Door started but could not be read: {error}"))
        })
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

    /// `first` requests a fresh conversation, replacing the saved order as its first prompt.
    pub(super) async fn start_door_with(
        &self,
        ctx: &Ctx,
        StartDoorParams {
            id,
            model,
            effort,
            permission_mode,
            engine,
            cols,
            rows,
        }: StartDoorParams,
        first: Option<String>,
        startup_context: bool,
    ) -> Result<RailNode, RpcError> {
        let size = terminal::window(cols.unwrap_or(80), rows.unwrap_or(24))?;
        models::check_engine(engine.as_deref())?;
        models::check_permissions(&ctx.actor, permission_mode)?;
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
            // A36: a resume takes the pair the Door parked; one the call names replaces it.
            if own {
                let parked = self.shared.rail().node(id)?;
                self.shared.rail().set_pair(
                    id,
                    pair.model.as_deref().or(parked.model.as_deref()),
                    pair.effort.as_deref().or(parked.effort.as_deref()),
                )?;
            }
            return self
                .resume_saved(
                    ctx,
                    id,
                    START_DOOR_ACK_BOUND,
                    permission_mode,
                    (size.cols, size.rows),
                )
                .await;
        }
        let listed = self.shared.terminals.list().await;
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
                        run.closing || listed.iter().any(|t| t.id == run.terminal_id && t.running)
                    }
                    _ => true,
                };
                if live {
                    return Err(RpcError::conflict(format!("Door {id} is already active")));
                }
            }
            rail.set_pair(id, pair.model.as_deref(), pair.effort.as_deref())?;
            let attempt = rail.allocate_attempt(id)?;
            self.shared.events.observed.notify_waiters();
            runs.insert(
                id.to_owned(),
                Slot::Starting {
                    attempt: attempt.clone(),
                    since: (self.shared.clock)(),
                    named: true,
                    parked: VecDeque::new(),
                },
            );
            attempt
        };
        let project = self.project_dir().to_owned();
        if let Err(err) = self
            .run_agent(
                id,
                &attempt,
                &project,
                first,
                startup_context,
                permission_mode,
                (size.cols, size.rows),
            )
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
