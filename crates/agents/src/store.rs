use super::*;

impl Agents {
    /// `project` is the Project folder and `dir` its data folder (N1). `bus` is for events no call
    /// caused. Claude Code is `ROUNDUP_CLAUDE_BIN` (default `claude`); `git` is whatever `PATH` finds.
    pub fn open(
        project: &Path,
        dir: &Path,
        bus: Bus,
        terminals: Arc<Terminals>,
    ) -> Result<Self, OpenError> {
        Self::open_in(
            project,
            dir,
            bus,
            terminals,
            Launcher::from_env()?,
            worktree::Git::from_env(),
        )
    }

    /// Like `open_in`, with the Project folder taken as `dir`'s parent.
    pub fn open_with(
        dir: &Path,
        bus: Bus,
        terminals: Arc<Terminals>,
        launcher: Launcher,
        git: worktree::Git,
    ) -> Result<Self, OpenError> {
        let project = dir.parent().unwrap_or(dir);
        Self::open_in(project, dir, bus, terminals, launcher, git)
    }

    pub fn open_in(
        project: &Path,
        dir: &Path,
        bus: Bus,
        terminals: Arc<Terminals>,
        launcher: Launcher,
        git: worktree::Git,
    ) -> Result<Self, OpenError> {
        let mut rail = rail::Rail::open(&dir.join("agents.db"))?;
        let recovery = git.bounded();
        for (node, plan, ready) in rail.provisioning()? {
            let Some(plan) = plan else {
                eprintln!("agents: {}: {UNPROVEN}; kept", node.id);
                continue;
            };
            let settled = if ready {
                recovery
                    .finish(project, &plan)
                    .and_then(|()| rail.clear_provisioning_owner(&node.id))
            } else {
                recovery.recover(project, &plan).and_then(|()| {
                    Launcher::discard(dir, &node.id).map_err(RpcError::internal)?;
                    if node.kind == NodeKind::Agent {
                        rail.remove(&node.id)
                    } else {
                        rail.clear_worktree(&node.id)
                    }
                })
            };
            // G6: a record recovery refuses keeps its work and its row; the Project still opens.
            if let Err(error) = settled {
                eprintln!("agents: {}: {}; kept", node.id, error.message);
            }
        }
        Ok(Self {
            shared: Arc::new_cyclic(|me| Shared {
                git,
                project_dir: project.to_owned(),
                rail: Mutex::new(rail),
                runs: Mutex::new(HashMap::new()),
                bus,
                kill: Arc::clone(&terminals) as Arc<dyn KillsTerminals>,
                terminals,
                clock: Arc::new(now_ms),
                opened: now_ms(),
                decisions: decision::Decisions::new(
                    None,
                    Duration::from_secs(claude_code::PERMISSION_TIMEOUT_SECS),
                ),
                me: me.clone(),
                steer_bound: STEER_BOUND,
                before_steer: None,
                gate_observer: None,
                interrupt_bound: INTERRUPT_BOUND,
                channels: Mutex::new(HashMap::new()),
                channel_deadline: channel_deadline_from_env(),
                scan: Scan::new(scan_interval_from_env()),
                takeover: None,
                waits: Mutex::new(HashMap::new()),
            }),
            dir: dir.to_owned(),
            launcher,
        })
    }

    /// Change a setting before any call has shared the Agents: the only holder of `shared` is
    /// `self`, plus its own `me`.
    pub(super) fn configure(mut self, set: impl FnOnce(&mut Shared)) -> Self {
        let mut shared = Arc::into_inner(self.shared).expect("the Agents are not shared yet");
        set(&mut shared);
        self.shared = Arc::new_cyclic(|me| {
            shared.me = me.clone();
            shared
        });
        self
    }

    /// H3, H4: answers need `proof`; the App holds it. Without one every `decision.answer` is
    /// `FORBIDDEN`. Call it before the first call is made.
    #[must_use]
    pub fn with_proof(self, proof: Option<String>) -> Self {
        self.configure(|shared| shared.decisions.set_proof(proof))
    }

    /// O4: `active` says whether a Takeover of an Agent is active. Call it before the first call.
    #[must_use]
    pub fn with_takeover(self, active: impl Fn(&str) -> bool + Send + Sync + 'static) -> Self {
        self.configure(|shared| shared.takeover = Some(Arc::new(active)))
    }

    /// Stamp Statuses and time Ticks by `clock`, milliseconds since the Unix epoch, instead of
    /// the system's. Call it before the first call is made.
    #[must_use]
    pub fn with_clock(self, clock: impl Fn() -> i64 + Send + Sync + 'static) -> Self {
        self.configure(|shared| shared.clock = Arc::new(clock))
    }

    /// H11: wait `bound` instead of `STEER_BOUND` for a Steer's `UserPromptSubmit`. Call it
    /// before the first call is made.
    #[must_use]
    pub fn with_steer_bound(self, bound: Duration) -> Self {
        self.configure(|shared| shared.steer_bound = bound)
    }

    /// H19: tell `observer`, for each `SessionStart` Signal and star title an Agent's Run folds,
    /// whether that Observation released the Agent's first prompt to its Steer. It runs under
    /// the Agents' locks, so it must not call back into them. Call it before the first call is
    /// made.
    #[must_use]
    pub fn with_gate_observer(self, observer: impl Fn(&str, bool) + Send + Sync + 'static) -> Self {
        self.configure(|shared| shared.gate_observer = Some(Arc::new(observer)))
    }

    /// H13: wait `bound` instead of `INTERRUPT_BOUND` for an Interrupt's title. Call it before
    /// the first call is made.
    #[must_use]
    pub fn with_interrupt_bound(self, bound: Duration) -> Self {
        self.configure(|shared| shared.interrupt_bound = bound)
    }

    /// B6: observe or refuse a Steer immediately before its physical Terminal write.
    /// Configure before sharing Agents; the observer runs on the Terminal input thread
    /// and must not reenter its input queue.
    #[must_use]
    pub fn with_steer_effect(
        self,
        before: impl Fn(&str) -> Result<(), RpcError> + Send + Sync + 'static,
    ) -> Self {
        self.configure(|shared| shared.before_steer = Some(Arc::new(before)))
    }
}

/// Milliseconds since the Unix epoch.
pub(super) fn now_ms() -> i64 {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    i64::try_from(since_epoch.as_millis()).unwrap_or(i64::MAX)
}
