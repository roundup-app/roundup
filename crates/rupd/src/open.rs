use super::*;

impl Daemon {
    /// `dir` is the Project's data folder (N1); it is created if missing. The Project folder is
    /// taken as its parent.
    pub fn open(dir: &Path) -> Result<Self, OpenError> {
        Self::open_in(dir.parent().unwrap_or(dir), dir)
    }

    /// Open `project`, keeping its data in `data` (N1) after moving an older Project's files
    /// there (N3).
    pub fn open_project(project: &Path, data: &Path) -> Result<Self, OpenError> {
        let dir = data::project_data(data, project)?;
        data::migrate(project, &dir).map_err(OpenError::from)?;
        Self::open_in(project, &dir)
    }

    pub(crate) fn open_in(project: &Path, dir: &Path) -> Result<Self, OpenError> {
        Self::open_stores(project, dir, |agents| agents)
    }

    pub(crate) fn open_stores(
        project: &Path,
        dir: &Path,
        configure: impl FnOnce(agents::Agents) -> agents::Agents,
    ) -> Result<Self, OpenError> {
        let begun = std::time::Instant::now();
        std::fs::create_dir_all(dir)?;
        let naming = Arc::new(std::sync::Mutex::new(data::open_naming(
            &data::naming_path(dir),
        )?));
        let naming_reader = Arc::clone(&naming);
        let guide_reader = Arc::clone(&naming);
        let db = storage::open(dir)?;
        let storage_at = begun.elapsed();
        let bus = Bus::with_log(Arc::new(event_log::SqliteLog::from_connection(db)?));
        let mut terminals =
            terminal::Terminals::open_with(dir, bus.clone(), &agents::claude_code::MARKERS)?
                .with_input_writer(terminal_input_observer())
                .with_exit_hold(terminal_exit_observer());
        if let Some(helper) = terminal_owner_helper() {
            terminals = terminals.with_terminal_owner(&helper);
        }
        let terminals = Arc::new(terminals);
        let messages = Arc::new(std::sync::OnceLock::<Arc<messages::Messages>>::new());
        let touches = Arc::new(Touches::open(&dir.join("project.db"))?);
        let todos = Arc::new(todos::Todos::open(dir, bus.clone())?);
        let context_todos = Arc::clone(&todos);
        let context_bus = bus.clone();
        let context_touches = Arc::clone(&touches);
        let base_at = begun.elapsed();
        let agents = Arc::new(
            configure(agents::Agents::open(
                project,
                dir,
                bus.clone(),
                Arc::clone(&terminals),
            )?)
            .with_automatic_renaming(move || {
                data::read_naming(&naming_reader.lock().expect("naming preferences poisoned"))
                    .map(|settings| settings.automatic_renaming)
                    .map_err(RpcError::internal)
            })
            .with_naming_guide(move || {
                data::read_naming(&guide_reader.lock().expect("naming preferences poisoned"))
                    .map(|settings| settings.naming_guide)
                    .map_err(RpcError::internal)
            })
            .with_context(move |nodes, id| {
                let todos = Arc::clone(&context_todos);
                let ctx = Ctx {
                    actor: Actor::daemon(),
                    bus: context_bus.clone(),
                    touches: Arc::clone(&context_touches),
                };
                async move {
                    let todos: Vec<contracts::todo::Todo> =
                        serde_json::from_value(todos.call(&ctx, "todo.list", Value::Null).await?)
                            .map_err(RpcError::internal)?;
                    let context = context::compose(&nodes, &todos, &id)?;
                    Ok(context::text(&nodes, &context))
                }
            })
            .with_coordination({
                let messages = Arc::clone(&messages);
                let ctx_bus = bus.clone();
                let ctx_touches = Arc::clone(&touches);
                move |id, text| {
                    let messages = Arc::clone(&messages);
                    let ctx = Ctx {
                        actor: Actor::daemon(),
                        bus: ctx_bus.clone(),
                        touches: Arc::clone(&ctx_touches),
                    };
                    async move {
                        let Some(messages) = messages.get() else {
                            return Err(RpcError::internal("Messages are not open yet"));
                        };
                        messages
                            .call(
                                &ctx,
                                "message.send",
                                serde_json::json!({"to": id, "kind": "note", "body": text}),
                            )
                            .await
                            .map(|_| ())
                    }
                }
            })
            .with_steer_effect(steer_effect_observer())
            .with_resume_effect(resume_effect_observer())
            .with_overview_hold(overview_read_observer()),
        );
        let agents_at = begun.elapsed();
        let agents_module: Arc<dyn messages::TerminalOwners> = agents.clone();
        let pads = Arc::new(pads::Pads::open(dir, bus.clone())?);
        let mut daemon = Self {
            naming,
            modules: HashMap::new(),
            todos: Arc::clone(&todos),
            pads: Arc::clone(&pads),
            specialists: Default::default(),
            touches,
            bus: bus.clone(),
            project: std::path::absolute(project).unwrap_or_else(|_| project.to_path_buf()),
            project_key: dir
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            attachments: attachment::Attachments::open(dir),
            digests: Arc::new(messages::digest::Seen::open(&dir.join("project.db"))?),
            sender: Arc::clone(&messages),
            agents: Arc::clone(&agents),
            terminals: Arc::clone(&terminals),
            wake_events: std::sync::Mutex::new(Some(bus.subscribe())),
            renames: std::sync::Mutex::new(Some(bus.subscribe_after(None)?)),
            owner_events: std::sync::Mutex::new(Some(bus.subscribe_after(None)?)),
            wake_gate: Default::default(),
            restarting: Default::default(),
            queue: Default::default(),
            auto: auto::Auto::new(&bus),
            pushes: std::sync::Mutex::new(Some(bus.subscribe())),
            resources: Default::default(),
            publications: deliverables::Publications::open(dir)?,
            reactions: {
                let reactions = reaction::Reactions::open(dir)?;
                reactions.listen(bus.subscribe());
                Arc::new(reactions)
            },
            prompt_effect_gate: std::env::var_os("RUPD_PROMPT_EFFECT_GATE").map(Into::into),
            waits: std::sync::Mutex::new(Some((
                bus.subscribe(),
                Arc::clone(&agents),
                Arc::clone(&todos),
            ))),
        };
        let services_at = begun.elapsed();
        daemon.register(todos);
        daemon.register(pads);
        let opened = Arc::new(messages::Messages::open_with(
            dir,
            bus,
            agents_module,
            messages_env(Arc::clone(&daemon.touches)),
        )?);
        // B50: every Message to an Agent is written to the Agent's Claude inbox; its transcript confirms it.
        opened.set_inbox(agents.clone());
        let recording = Arc::downgrade(&opened);
        agents.observe_inbox(Arc::new(move |id, ids| {
            if let Some(messages) = recording.upgrade() {
                messages.confirm_inbox(id, ids);
            }
        }));
        let _ = messages.set(Arc::clone(&opened));
        daemon.register(opened);
        let placement = Arc::new(agents.placement_call());
        daemon.register(Arc::new(agents::Asks::open(
            dir,
            daemon.bus.clone(),
            Arc::clone(&agents),
            placement,
        )?));
        daemon.register(agents);
        daemon.register(terminals);
        daemon.start_pushes();
        let messages_at = begun.elapsed();
        // R3696c: the retained open total cannot distinguish image IO from store initialization.
        // Emit once, after the measured work, into perf's existing startup log.
        eprintln!(
            "startup: stores {}",
            serde_json::json!({
                "storage_ms": storage_at.as_secs_f64() * 1e3,
                "base_ms": (base_at - storage_at).as_secs_f64() * 1e3,
                "agents_ms": (agents_at - base_at).as_secs_f64() * 1e3,
                "services_ms": (services_at - agents_at).as_secs_f64() * 1e3,
                "messages_ms": (messages_at - services_at).as_secs_f64() * 1e3,
            })
        );
        Ok(daemon)
    }

    /// B21: start sending children's changes to their Doors, at most once.
    pub(crate) fn start_pushes(&self) {
        if tokio::runtime::Handle::try_current().is_err() {
            return;
        }
        let waiter = self
            .waits
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some((events, agents, todos)) = waiter {
            let (touches, bus) = (Arc::clone(&self.touches), self.bus.clone());
            tokio::spawn(waits::keep(events, agents, move || {
                let ctx = Ctx {
                    actor: Actor::daemon(),
                    bus: bus.clone(),
                    touches: Arc::clone(&touches),
                };
                let todos = Arc::clone(&todos);
                async move {
                    let list = todos.call(&ctx, "todo.list", Value::Null).await.ok()?;
                    serde_json::from_value(list).ok()
                }
            }));
        }
        let events = self
            .pushes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(renames) = self
            .renames
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            tokio::spawn(wake::tell_renames(self.reader(), renames));
        }
        if let Some(owner_events) = self
            .owner_events
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            tokio::spawn(owner_told::tell_owners(self.reader(), owner_events));
        }
        let wake_events = self
            .wake_events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        // `waker` and `evaluator` copy the module map and read the environment, so they are
        // built only when there are events to hand them, not on every request.
        if let Some(events) = wake_events
            && let Some(waker) = self.waker()
        {
            tokio::spawn(waker.run(events));
        }
        if let Some(sender) = self.sender.get().filter(|_| {
            !self
                .reactions
                .timed
                .swap(true, std::sync::atomic::Ordering::SeqCst)
        }) {
            tokio::spawn(
                reaction_time::Timer::new(
                    Arc::clone(&self.reactions),
                    Arc::clone(&self.agents),
                    Arc::clone(sender),
                )
                .run(),
            );
        }
        if let Some(events) = self.reactions.take_events()
            && let Some(evaluator) = self.evaluator()
        {
            tokio::spawn(evaluator.run(events));
        }
        if let (Some(events), Some(sender)) = (events, self.sender.get()) {
            // Once, with the other watchers: `start_pushes` runs on every call, and `events` is taken once.
            tokio::spawn(
                reaction_checks::Watcher {
                    reactions: Arc::clone(&self.reactions),
                    agents: Arc::clone(&self.agents),
                    messages: Arc::clone(sender),
                    bus: self.bus.clone(),
                    touches: Arc::clone(&self.touches),
                }
                .run(),
            );
            tokio::spawn(digest::push_changes(
                self.reader(),
                Arc::clone(sender),
                Arc::clone(&self.digests),
                events,
            ));
        }
    }

    pub(crate) fn evaluator(&self) -> Option<reaction::Evaluator> {
        Some(reaction::Evaluator {
            agents: Arc::clone(&self.agents),
            reactions: Arc::clone(&self.reactions),
            reader: self.reader(),
            messages: Arc::clone(self.sender.get()?),
            bus: self.bus.clone(),
        })
    }

    pub(crate) fn waker(&self) -> Option<wake::Waker> {
        Some(wake::Waker {
            agents: Arc::clone(&self.agents),
            reader: self.reader(),
            messages: Arc::clone(self.sender.get()?),
            digests: Arc::clone(&self.digests),
            bus: self.bus.clone(),
            gate: Arc::clone(&self.wake_gate),
        })
    }

    pub(crate) fn reader(&self) -> digest::Reader {
        digest::Reader::new(
            &self.modules,
            self.bus.clone(),
            Arc::clone(&self.touches),
            std::env::var_os("RUPD_DIGEST_OBSERVER").map(std::path::PathBuf::from),
        )
    }

    pub(crate) fn register(&mut self, module: Arc<dyn Module>) {
        for namespace in module.namespaces() {
            self.modules.insert(namespace, Arc::clone(&module));
        }
    }
}

#[cfg(feature = "test-support")]
impl Daemon {
    /// U4593 seeds a controlled Agent observation without starting a program.
    pub fn set_agent_status_for_test(&self, id: &str, kind: contracts::Kind) {
        self.agents.set_status_for_test(
            id,
            contracts::Status {
                kind,
                label: "fixture".into(),
                since: 0,
                finished: "0".into(),
            },
        );
    }
}

/// The packaged `terminal-owner` helper (X8), named by `RUPD_TERMINAL_OWNER`. The App sets it
/// for its Daemon; without it, Terminals stay children of the Daemon and a reopen reports Agents
/// `done`.
fn terminal_owner_helper() -> Option<std::path::PathBuf> {
    std::env::var_os("RUPD_TERMINAL_OWNER").map(Into::into)
}

impl Daemon {
    /// Attach the Terminal owners that outlived the previous Daemon (A12a) and return the
    /// sockets their programs still call, for the caller to serve beside its own.
    pub async fn reattach_owners(&self) -> Vec<std::path::PathBuf> {
        self.agents.reattach_owners().await;
        self.agents.retained_sockets()
    }
}
