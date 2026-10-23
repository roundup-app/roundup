use super::*;

impl Daemon {
    /// `dir` is the Project's data folder (N1); it is created if missing. The Project folder is
    /// taken as its parent.
    pub fn open(dir: &Path) -> Result<Self, OpenError> {
        Self::open_with_proof(dir, None)
    }

    /// Open `project`, keeping its data in `data` (N1) after moving an older Project's files
    /// there (N3).
    pub fn open_project(
        project: &Path,
        data: &Path,
        proof: Option<String>,
    ) -> Result<Self, OpenError> {
        let dir = data::project_data(data, project)?;
        data::migrate(project, &dir).map_err(OpenError::from)?;
        Self::open_in(project, &dir, proof)
    }

    /// Like `open`, with the `proof` an attached App handed over (H4, H18); without one every
    /// `decision.answer` is `FORBIDDEN`.
    pub fn open_with_proof(dir: &Path, proof: Option<String>) -> Result<Self, OpenError> {
        Self::open_in(dir.parent().unwrap_or(dir), dir, proof)
    }

    pub(crate) fn open_in(
        project: &Path,
        dir: &Path,
        proof: Option<String>,
    ) -> Result<Self, OpenError> {
        Self::open_stores(project, dir, proof, |agents| agents)
    }

    pub(crate) fn open_stores(
        project: &Path,
        dir: &Path,
        proof: Option<String>,
        configure: impl FnOnce(agents::Agents) -> agents::Agents,
    ) -> Result<Self, OpenError> {
        std::fs::create_dir_all(dir)?;
        storage::open(dir)?;
        let bus = Bus::with_log(Arc::new(event_log::SqliteLog::open(dir)?));
        let terminals = Arc::new(
            terminal::Terminals::open_with(dir, bus.clone(), &agents::claude_code::MARKERS)?
                .with_input_writer(terminal_input_observer())
                .with_exit_hold(terminal_exit_observer()),
        );
        // O4: the Agents ask whether a Takeover is active before they Steer a changed order; the
        // Messages that know are made after them.
        let messages = Arc::new(std::sync::OnceLock::<Arc<messages::Messages>>::new());
        let probe = Arc::clone(&messages);
        let touches = Arc::new(Touches::open(&dir.join("project.db"))?);
        let todos = Arc::new(todos::Todos::open(dir, bus.clone())?);
        let context_todos = Arc::clone(&todos);
        let context_bus = bus.clone();
        let context_touches = Arc::clone(&touches);
        let agents = Arc::new(
            configure(agents::Agents::open(
                project,
                dir,
                bus.clone(),
                Arc::clone(&terminals),
            )?)
            .with_proof(proof)
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
            .with_prompt_effect(prompt_effect_observer())
            .with_steer_effect(steer_effect_observer())
            .with_resume_effect(resume_effect_observer())
            .with_takeover(move |agent| {
                probe
                    .get()
                    .is_some_and(|messages| messages.takeover_active(agent))
            }),
        );
        let agents_module: Arc<dyn messages::TerminalOwners> = agents.clone();
        let checkpoints = Arc::new(checkpoints::Checkpoints::open(dir)?.with_marks(agents.clone()));
        let pads = Arc::new(pads::Pads::open(dir, bus.clone())?);
        let mut daemon = Self {
            modules: HashMap::new(),
            todos: Arc::clone(&todos),
            pads: Arc::clone(&pads),
            door_first_steers: Default::default(),
            child_effects: Default::default(),
            held_actions: resize::HeldActions::open(dir)?,
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
            notes: std::sync::Mutex::new(Some(bus.subscribe())),
            wake_events: std::sync::Mutex::new(Some(bus.subscribe())),
            renames: std::sync::Mutex::new(Some(bus.subscribe_after(None)?)),
            owner_events: std::sync::Mutex::new(Some(bus.subscribe_after(None)?)),
            wake_gate: Default::default(),
            clears: clear::Clears::new(Arc::clone(&agents)),
            checkpoints: Arc::clone(&checkpoints),
            rewinding: Default::default(),
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
        daemon.register(todos);
        daemon.register(pads);
        daemon.register(checkpoints);
        // B2: the one function that types a Message is `Agents::prompt` (H11).
        let typist = Arc::clone(&agents);
        let deliver: messages::Deliver = Arc::new(move |id, text| {
            let typist = Arc::clone(&typist);
            Box::pin(async move {
                typist
                    .prompt(&id, &text)
                    .await
                    .map_err(|refused| match refused {
                        agents::PromptError::Busy { .. } => messages::Refusal::Busy,
                        agents::PromptError::NotAccepted { .. } | agents::PromptError::Rail(_) => {
                            messages::Refusal::NotAccepted
                        }
                        agents::PromptError::NotFound { .. } => messages::Refusal::NotFound,
                    })
            })
        });
        let opened = Arc::new(messages::Messages::open_with(
            dir,
            bus,
            agents_module,
            deliver,
            messages_env(Arc::clone(&daemon.touches)),
        )?);
        // B39: the Agent's `UserPromptSubmit` Signal confirms the Messages its prompt carried.
        let confirming = Arc::downgrade(&opened);
        agents.observe_prompts(Arc::new(move |id, prompt| {
            confirming
                .upgrade()
                .is_some_and(|messages| messages.confirm_prompt(id, prompt))
        }));
        // B50: a `note` is written to the Agent's Claude inbox; its transcript confirms it.
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
        let notes = self
            .notes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let (Some(events), Some(sender)) = (notes, self.sender.get()) {
            tokio::spawn(decision_notes::tell_doors(
                self.reader(),
                Arc::clone(sender),
                events,
            ));
        }
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
            tokio::spawn(owner_told::tell_owners(
                self.reader(),
                owner_events,
                self.sender.clone(),
            ));
        }
        let wake_events = self
            .wake_events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let (Some(events), Some(waker)) = (wake_events, self.waker()) {
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
        if let (Some(events), Some(evaluator)) = (self.reactions.take_events(), self.evaluator()) {
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
