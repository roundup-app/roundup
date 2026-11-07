use super::*;

impl Daemon {
    /// `dir` is the Project's data folder (N1); it is created if missing. The Project folder is
    /// taken as its parent. The Watchers are the background tasks `serve` starts.
    pub fn open(dir: &Path) -> Result<(Self, Watchers), OpenError> {
        Self::open_in(dir.parent().unwrap_or(dir), dir)
    }

    /// Open `project`, keeping its data in `data` (N1); obsolete local data is refused.
    pub fn open_project(project: &Path, data: &Path) -> Result<(Self, Watchers), OpenError> {
        Self::open_observed(project, data, Observers::from_env())
    }

    /// `open_project` with the environment already read into `observers`.
    pub fn open_observed(
        project: &Path,
        data: &Path,
        observers: Observers,
    ) -> Result<(Self, Watchers), OpenError> {
        let dir = data::project_data(data, project)?;
        data::refuse_old_data(project).map_err(OpenError::from)?;
        let home = observers.home.clone();
        let (daemon, watchers) = Self::open_stores(project, &dir, observers, |agents| agents)?;
        Ok(match home {
            Some(home) => (
                daemon.with_extensions(&home.join(".roundup/extensions")),
                watchers,
            ),
            None => (daemon, watchers),
        })
    }

    pub(crate) fn open_in(project: &Path, dir: &Path) -> Result<(Self, Watchers), OpenError> {
        Self::open_stores(project, dir, Observers::from_env(), |agents| agents)
    }

    /// Open the stores with `configure` applied to the Agents, and subscribe the Watchers.
    pub(crate) fn open_stores(
        project: &Path,
        dir: &Path,
        observers: Observers,
        configure: impl FnOnce(agents::Agents) -> agents::Agents,
    ) -> Result<(Self, Watchers), OpenError> {
        let begun = std::time::Instant::now();
        std::fs::create_dir_all(dir)?;
        let naming = Arc::new(std::sync::Mutex::new(data::open_naming(
            &data::naming_path(dir),
        )?));
        let naming_reader = Arc::clone(&naming);
        let guide_reader = Arc::clone(&naming);
        let db = storage::connect(dir)?;
        let storage_at = begun.elapsed();
        let bus = Bus::with_log(Arc::new(event_log::SqliteLog::from_connection(db)?));
        let mut terminals =
            terminal::Terminals::open_with(dir, bus.clone(), &agents::claude_code::MARKERS)?
                .with_input_writer(terminal_input_observer(&observers))
                .with_exit_hold(terminal_exit_observer(&observers));
        if let Some(helper) = &observers.terminal_owner {
            terminals = terminals.with_terminal_owner(helper);
        }
        let terminals = Arc::new(terminals);
        terminals.answer_status_query(true);
        let messages = Arc::new(std::sync::OnceLock::<Arc<messages::Messages>>::new());
        let touches = Arc::new(Touches::open(dir)?);
        let todos = Arc::new(todos::Todos::open(dir, bus.clone())?);
        let context_todos = Arc::clone(&todos);
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
                async move {
                    let todos = todos.list_all()?;
                    let context = context::compose(&nodes, &todos, &id)?;
                    Ok(context::text(&nodes, &context))
                }
            })
            .with_coordination({
                let messages = Arc::clone(&messages);
                let ctx_bus = bus.clone();
                let ctx_touches = Arc::clone(&touches);
                move |from, id, text| {
                    let messages = Arc::clone(&messages);
                    let ctx = Ctx {
                        actor: from,
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
            .with_steer_effect(steer_effect_observer(&observers))
            .with_resume_effect(resume_effect_observer(&observers))
            .with_overview_hold(overview_read_observer(&observers)),
        );
        let agents_at = begun.elapsed();
        let agents_module: Arc<dyn Module> = agents.clone();
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
            data_dir: dir.to_path_buf(),
            fork_colour: crate::fork::colour_of(dir),
            project_key: dir
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            digests: Arc::new(messages::digest::Seen::open(&dir.join("project.db"))?),
            sender: Arc::clone(&messages),
            agents: Arc::clone(&agents),
            rail: agents.clone(),
            program_statuses: Default::default(),
            terminals: Arc::clone(&terminals),
            wake_gate: Default::default(),
            restarting: Default::default(),
            queue: Default::default(),
            auto: Default::default(),
            rail_told: Default::default(),
            observers: observers.clone(),
            resources: Default::default(),
            publications: deliverables::Publications::open(dir)?,
            prompt_effect_gate: observers.prompt_effect_gate.clone(),
            actions: Default::default(),
            extensions: extensions::Host::new(dir.join("extensions")),
        };
        let services_at = begun.elapsed();
        daemon.register(todos);
        daemon.register(pads);
        let opened = Arc::new(messages::Messages::open_with(
            dir,
            bus,
            agents_module,
            messages_env(&observers, Arc::clone(&daemon.touches)),
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
        let watchers = daemon.watchers()?;
        Ok((daemon, watchers))
    }

    /// Subscribe every watcher to the Bus now, so no Event between `open` and `serve` is lost.
    pub(crate) fn watchers(&self) -> Result<Watchers, OpenError> {
        Ok(Watchers {
            programs: self.terminals.subscribe_status(),
            waits: self.bus.subscribe(),
            pushes: self.bus.subscribe(),
            renames: self.bus.subscribe_after(Default::default())?,
            owners: self.bus.subscribe_after(Default::default())?,
            wakes: self.bus.subscribe(),
            resumes: self.bus.subscribe(),
            auto: self.bus.subscribe(),
            queue: self.bus.subscribe(),
            rail: self.bus.subscribe(),
            #[cfg(test)]
            extra: Vec::new(),
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
            self.observers.digest_observer.clone(),
            self.project_key.clone(),
        )
        .with_agents(Arc::clone(&self.agents))
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

impl Daemon {
    /// Attach the Terminal owners that outlived the previous Daemon (A12a) and return the
    /// sockets their programs still call, for the caller to serve beside its own.
    pub async fn reattach_owners(&self) -> Vec<std::path::PathBuf> {
        self.agents.reattach_owners().await;
        self.sender
            .get()
            .expect("Messages opened")
            .recover()
            .await
            .expect("recovered Message receivers");
        self.agents.retained_sockets()
    }
}

/// The Daemon's background tasks, owned by value from `open` until `serve` starts each once.
/// Each owns the receiver it was subscribed with at `open`.
pub struct Watchers {
    programs: tokio::sync::broadcast::Receiver<Arc<terminal::Change>>,
    waits: tokio::sync::broadcast::Receiver<contracts::Event>,
    pushes: tokio::sync::broadcast::Receiver<contracts::Event>,
    renames: rpc::Subscription,
    owners: rpc::Subscription,
    wakes: tokio::sync::broadcast::Receiver<contracts::Event>,
    resumes: tokio::sync::broadcast::Receiver<contracts::Event>,
    auto: tokio::sync::broadcast::Receiver<contracts::Event>,
    queue: tokio::sync::broadcast::Receiver<contracts::Event>,
    rail: tokio::sync::broadcast::Receiver<contracts::Event>,
    #[cfg(test)]
    extra: Vec<std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>>>,
}

impl Watchers {
    /// Start every watcher in one set. A watcher that ends while the set lives has failed: the
    /// Bus it follows closes only when the Daemon is gone.
    pub(crate) fn spawn(self, daemon: &Daemon) -> tokio::task::JoinSet<()> {
        let mut set = tokio::task::JoinSet::new();
        let todos = Arc::clone(&daemon.todos);
        set.spawn(waits::keep(
            self.waits,
            Arc::clone(&daemon.agents),
            move || {
                let todos = Arc::clone(&todos);
                async move { todos.list_all().ok() }
            },
        ));
        set.spawn(Arc::clone(&daemon.program_statuses).run(
            self.programs,
            daemon.bus.clone(),
            Arc::clone(&daemon.terminals),
            Arc::clone(&daemon.agents),
        ));
        set.spawn(daemon.auto.watch(self.auto, daemon.reader()));
        set.spawn(daemon.queuer().watch(self.queue));
        set.spawn(wake::tell_renames(daemon.reader(), self.renames));
        set.spawn(resume_turn::resume_turns(
            daemon.reader(),
            Arc::clone(&daemon.agents),
            self.resumes,
        ));
        set.spawn(owner_told::tell_owners(daemon.reader(), self.owners));
        if let Some(waker) = daemon.waker() {
            set.spawn(waker.run(self.wakes));
        }
        if let Some(sender) = daemon.sender.get() {
            set.spawn(workstream_state::tell_changes(
                daemon.reader(),
                Arc::clone(&daemon.sender),
                Arc::clone(&daemon.agents),
                daemon.bus.clone(),
                Arc::clone(&daemon.rail_told),
                self.rail,
            ));
            set.spawn(digest::push_changes(
                daemon.reader(),
                Arc::clone(sender),
                Arc::clone(&daemon.digests),
                Arc::new(
                    settlement::Settlements::open(&daemon.data_dir.join("project.db"))
                        .unwrap_or_else(|err| {
                            eprintln!("settlement store not opened, kept in memory: {err}");
                            settlement::Settlements::default()
                        }),
                ),
                Some(Arc::clone(&daemon.rail_told)),
                self.pushes,
            ));
        }
        #[cfg(test)]
        for task in self.extra {
            set.spawn(task);
        }
        set
    }

    /// A test's own watcher, started with the others.
    #[cfg(test)]
    pub(crate) fn also(&mut self, task: impl std::future::Future<Output = ()> + Send + 'static) {
        self.extra.push(Box::pin(task));
    }
}

#[cfg(test)]
impl Daemon {
    /// `open_stores` with its watchers dropped, for a test of one request.
    pub(crate) fn open_stores_idle(
        project: &Path,
        dir: &Path,
        configure: impl FnOnce(agents::Agents) -> agents::Agents,
    ) -> Result<Self, OpenError> {
        Self::open_stores(project, dir, Observers::from_env(), configure).map(|(daemon, _)| daemon)
    }

    /// Run the watchers on the current runtime for as long as it lives.
    pub(crate) fn watch(&self, watchers: Watchers) {
        watchers.spawn(self).detach_all();
    }
}
