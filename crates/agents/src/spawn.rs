use super::*;

impl Agents {
    /// The Project folder: `.roundup/`'s parent, where its git repository (if any) lives.
    pub(super) fn project_dir(&self) -> &Path {
        &self.shared.project_dir
    }

    /// Put a new Agent in the Rail and start Claude Code for it in a Terminal.
    pub(super) async fn spawn(
        &self,
        ctx: &Ctx,
        mut params: SpawnParams,
    ) -> Result<RailNode, RpcError> {
        let size = terminal::window(params.cols.unwrap_or(80), params.rows.unwrap_or(24))?;
        models::check_engine(params.engine.as_deref())?;
        models::check_permissions(&ctx.actor, params.permission_mode)?;
        // F3, A26: any Agent may start a child, which sits under it; a `parent` it passes is ignored.
        if ctx.actor.kind == ActorKind::Agent {
            let agent = self.shared.rail().node(&ctx.actor.id).is_ok();
            if !agent {
                return Err(RpcError::forbidden(format!(
                    "{} is not an Agent and may not start an Agent",
                    ctx.actor.id
                )));
            }
            params.parent = Some(ctx.actor.id.clone());
        } else if let Some(parent) = &params.parent
            && self.shared.rail().node(parent)?.kind == NodeKind::Agent
        {
            return Err(RpcError::conflict(format!(
                "{parent} is an Agent: only an Agent's own start nests under it"
            )));
        }
        // LC4, LC7: only an Agent's own start is lean, so only it names a scout or extras.
        let by_agent = ctx.actor.kind == ActorKind::Agent;
        if params.specialist.is_some() && (!by_agent || params.scout != Some(true)) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "specialist requires an Agent's scout: true start",
            ));
        }
        if !by_agent && (params.scout == Some(true) || params.extras.is_some()) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "scout and extras are for an Agent's start: the user's own Agents keep the full setup",
            ));
        }
        let lean = by_agent.then(|| claude_code::Lean {
            scout: params.scout == Some(true),
            extras: params.extras.take().unwrap_or_default(),
            fresh_brief: false,
        });
        if let Some(lean) = &lean {
            claude_code::extras::resolve(
                &self.launcher.extras_sources(self.project_dir()),
                &lean.extras,
            )?;
        }
        let pair = self.choose(
            &ctx.actor,
            Role::Agent,
            params.model.take(),
            params.effort.take(),
        )?;
        let cwd = Path::new(&params.cwd);
        let explicit = params.order.is_some();
        let (order, spawn_prompt) = match (params.prompt, params.order) {
            (Some(prompt), Some(order)) if by_agent => (Some(order), Some(prompt)),
            (Some(_), Some(_)) => {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    "prompt and order are exclusive",
                ));
            }
            (Some(_), None) if by_agent => {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    "an Agent's spawn needs an `order` with the ask, the done condition and the \
                     limits; add it, and keep the working detail in `prompt`",
                ));
            }
            (Some(prompt), None) => (Some(Order::work(&prompt)), None),
            (None, Some(order)) => (Some(order), None),
            (None, None) => (None, None),
        };
        if let Some(order) = &order {
            if explicit {
                valid_explicit_order(order)?;
            } else {
                valid_order(order)?;
            }
        }
        let given = params
            .name
            .as_deref()
            .map(name::given)
            .transpose()
            .map_err(|reason| RpcError::new(code::INVALID_PARAMS, reason))?;
        let (id, attempt) = {
            let mut rail = self.shared.rail();
            let name = match &given {
                Some(given) => {
                    let tree = rail.tree()?;
                    let taken = tree
                        .iter()
                        .filter(|node| node.parent == params.parent)
                        .map(|node| node.name.as_str());
                    name::unique(given, taken)
                }
                None => name::UNNAMED.to_owned(),
            };
            let node = rail.insert_ordered(
                NodeKind::Agent,
                &name,
                params.parent.as_deref(),
                None,
                order.as_ref(),
            )?;
            if let Some(prompt) = &spawn_prompt {
                rail.set_spawn_prompt(&node.id, prompt)?;
            }
            if by_agent {
                rail.set_spawner(&node.id, &ctx.actor.id)?;
            }
            rail.set_pair(&node.id, pair.model.as_deref(), pair.effort.as_deref())?;
            if let Some(lean) = &lean {
                Launcher::save_lean(&self.dir, &node.id, lean)?;
            }
            let attempt = rail.allocate_attempt(&node.id)?;
            self.shared.mark_starting(&node.id, attempt.clone());
            if given.is_some()
                && let Some(slot) = self.shared.runs().get_mut(&node.id)
            {
                slot.settle_name();
            }
            (node.id, attempt)
        };
        match self
            .run_agent(
                &id,
                &attempt,
                cwd,
                None,
                true,
                params.permission_mode,
                (size.cols, size.rows),
            )
            .await
            .map(drop)
        {
            Ok(()) => {}
            Err(err) => {
                let mut rail = self.shared.rail();
                let mut runs = self.shared.runs();
                if runs.get(&id).is_some_and(|slot| slot.attempt() == attempt) {
                    runs.remove(&id);
                    self.shared.events.observed.notify_waiters();
                    if rail.node(&id)?.worktree.is_none() {
                        report_undo("remove the Agent from the Rail", rail.remove(&id));
                    }
                }
                return Err(err);
            }
        };
        ctx.emit(EventData::RailChanged);
        self.shared.node(&id)
    }

    /// X11: start `command` in a Terminal owned by Agent `params.id`; it adds no Rail node.
    pub(super) async fn run(&self, ctx: &Ctx, params: RunParams) -> Result<Opened, RpcError> {
        let RunParams {
            id,
            command,
            cwd,
            cols,
            rows,
        } = params;
        let size = terminal::window(cols.unwrap_or(80), rows.unwrap_or(24))?;
        if command.is_empty() {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "command must not be empty",
            ));
        }
        let (node, saved_cwd) = {
            let rail = self.shared.rail();
            let node = rail.node(&id)?;
            let saved_cwd = match self.shared.runs().get(&id) {
                Some(Slot::Running(run)) => Some(run.cwd.clone()),
                _ => None,
            };
            (node, saved_cwd)
        };
        if node.kind != NodeKind::Agent {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("{id} is not an Agent"),
            ));
        }
        self.shared.guard_reach(&ctx.actor, &id, true)?;
        let cwd = cwd
            .or_else(|| node.worktree.map(|worktree| worktree.path))
            .or(saved_cwd)
            .unwrap_or_else(|| self.project_dir().to_string_lossy().into_owned());
        let spawned = self
            .shared
            .terminals
            .spawn_owned(
                TerminalSpawn {
                    cwd,
                    command: Some(command),
                    env: BTreeMap::new(),
                    cols: size.cols,
                    rows: size.rows,
                },
                &id,
            )
            .await?;
        ctx.touch(contracts::Verb::Wrote, &format!("agent:{id}"))?;
        Ok(Opened {
            terminal_id: spawned.id,
        })
    }

    /// X12: start the user's login shell in the Project folder, owned by its Workstream or Project.
    pub(super) async fn open_terminal(&self, params: OpenParams) -> Result<Opened, RpcError> {
        let OpenParams {
            workstream,
            cols,
            rows,
        } = params;
        let size = terminal::window(cols.unwrap_or(80), rows.unwrap_or(24))?;
        let owner = match workstream {
            Some(workstream) => {
                let node = self.shared.rail().node(&workstream)?;
                if node.kind != NodeKind::Workstream {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        format!("{workstream} is not a Workstream"),
                    ));
                }
                workstream
            }
            None => self.project_dir().to_string_lossy().into_owned(),
        };
        let shell = std::env::var_os("SHELL")
            .map(|shell| shell.to_string_lossy().into_owned())
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| "/bin/sh".into());
        let spawned = self
            .shared
            .terminals
            .spawn_shell_owned(
                &self.project_dir().to_string_lossy(),
                &shell,
                &owner,
                BTreeMap::new(),
                (size.cols, size.rows),
            )
            .await?;
        Ok(Opened {
            terminal_id: spawned.id,
        })
    }

    /// Start Claude Code for node `id`, marked as starting, in a Terminal recorded in the Rail,
    /// then register and watch it; returns the Terminal's id. Failed cleanup keeps its Worktree
    /// ownership record so reopening can recover it without deleting unrelated work.
    // Each argument carries an existing launch constraint; size must reach PTY creation.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn run_agent(
        &self,
        id: &str,
        attempt: &str,
        cwd: &Path,
        first: Option<String>,
        startup_context: bool,
        permission_mode: Option<contracts::agent::PermissionMode>,
        size: (u16, u16),
    ) -> Result<String, RpcError> {
        let (node, prompt) = {
            let mut rail = self.shared.rail();
            let node = rail.node(id)?;
            // O2, O3: the first Steer is the node's order, whichever way it was set.
            let spawn_prompt = rail.spawn_prompt(id)?;
            let prompt = first.or_else(|| {
                node.work
                    .as_ref()
                    .map(|work| order::steer(work, spawn_prompt.as_deref()))
            });

            if let (Some(text), Some(revision)) = (&prompt, rail.order_revision(id)?) {
                rail.prepare_instruction(&revision, attempt, text, true)?;
            }
            (node, prompt)
        };

        let retained = node.worktree.map(|w| PathBuf::from(w.path));
        if let Some(path) = &retained
            && !path.is_dir()
        {
            return Err(RpcError::internal(format!(
                "worktree_missing: {}",
                path.display()
            )));
        }
        let provisioned = if retained.is_none() {
            self.provision_worktree(id, cwd).await?
        } else {
            None
        };
        let effective_cwd = provisioned.as_ref().map_or_else(
            || retained.unwrap_or_else(|| cwd.to_owned()),
            |(cwd, _)| cwd.clone(),
        );
        let spawned = match self
            .start(
                id,
                attempt,
                &effective_cwd,
                None,
                true,
                false,
                permission_mode,
                size,
            )
            .await
        {
            Ok(spawned) => spawned,
            Err(err) => {
                report_undo(
                    "delete the Agent's settings file",
                    Launcher::discard(&self.dir, id),
                );
                if let Some((_, worktree)) = provisioned {
                    self.discard_worktree(id, worktree).await;
                }
                return Err(err);
            }
        };
        let clock = Arc::clone(&self.shared.clock);
        let terminal_id = spawned.id.clone();
        let run_cwd = effective_cwd.to_string_lossy().into_owned();
        let prompts = self.shared.finish_starting(id, attempt, |named| Run {
            yolo: false,
            startup_context,
            attempt: attempt.to_owned(),
            status_revision: 1,
            closing: false,
            ended: false,
            adapter: ClaudeCode::starting(move || clock()),
            first_pending: prompt.is_some(),
            first_completion: prompt.as_ref().map(|_| tokio::sync::watch::channel(None).0),
            first_prompt: None,
            prompt,
            steer: None,
            session_started: None,
            starred: false,
            interrupt: None,
            named,
            terminal_id,
            cwd: run_cwd,
        });
        let prompts = match prompts {
            Ok(prompts) => prompts,
            Err(err) => {
                report_undo(
                    "kill obsolete start Terminal",
                    self.shared.terminals.kill(&spawned.id).await,
                );
                return Err(err);
            }
        };
        for prompt in prompts {
            self.shared.steer_first_prompt(id, attempt, prompt);
        }
        tokio::spawn(watch(
            Arc::clone(&self.shared),
            id.to_owned(),
            attempt.to_owned(),
            spawned.events,
        ));
        Ok(spawned.id)
    }

    /// `resume` is A22's saved conversation id, added to argv as `--resume <id>`; `None` starts
    /// fresh. `attach` is false only for A22's pending resume, which must not record a
    /// `terminal_id` in the Rail until its launch is acknowledged.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn start(
        &self,
        id: &str,
        attempt: &str,
        cwd: &Path,
        resume: Option<&str>,
        attach: bool,
        yolo: bool,
        permission_mode: Option<contracts::agent::PermissionMode>,
        size: (u16, u16),
    ) -> Result<terminal::Spawned, RpcError> {
        let node = self.shared.rail().node(id)?;
        let role = match node.kind {
            NodeKind::Workstream => Role::Door,
            _ => Role::Agent,
        };
        let pair = Pair {
            naming_guide: self
                .shared
                .naming_guide
                .as_ref()
                .map(|read| read())
                .transpose()?,
            yolo,
            permission_mode,
            model: node.model,
            effort: node.effort,
            mcp_off: !models::mcp_on(
                std::env::var_os("ROUNDUP_MCP").as_deref(),
                self.shared.rail().get_mcp()?.on,
            ),
            lean: Launcher::load_lean(&self.dir, id),
        };
        let started = attempt.to_owned();
        let (argv, env) = self
            .launcher
            .launch_on(
                claude_code::Folders {
                    project: self.project_dir(),
                    data: &self.dir,
                },
                id,
                attempt,
                cwd,
                resume,
                role,
                &pair,
            )
            .await?;
        self.retain_worktree(id).await?;
        let spawned = match self
            .spawn_behind(id, cwd, Some(argv), env, attach, size)
            .await
        {
            Ok(spawned) => spawned,
            Err(error) => return Err(error),
        };
        self.shared.watch_channel(id, &started);
        if role == Role::Door
            && let Some(marker) = claude_code::settings_marker(&self.dir, id)
        {
            self.shared
                .scan_door(id, marker.to_string_lossy().into_owned());
        }
        Ok(spawned)
    }

    /// Start `command` (the login shell when `None`) in a Terminal and, when `attach`, record it
    /// as the one behind node `id`.
    pub(super) async fn spawn_behind(
        &self,
        id: &str,
        cwd: &Path,
        command: Option<Vec<String>>,
        env: BTreeMap<String, String>,
        attach: bool,
        size: (u16, u16),
    ) -> Result<terminal::Spawned, RpcError> {
        let spawned = self
            .shared
            .terminals
            .spawn(TerminalSpawn {
                cwd: cwd.to_string_lossy().into_owned(),
                command,
                env,
                cols: size.0,
                rows: size.1,
            })
            .await?;
        if attach {
            let attached = self.shared.rail().attach_terminal(id, &spawned.id);
            let attached = attached.and_then(|()| self.save_owner(id, &spawned.id));
            if let Err(err) = attached {
                report_undo(
                    "kill the Agent's Terminal",
                    self.shared.terminals.kill(&spawned.id).await,
                );
                return Err(err);
            }
        }
        Ok(spawned)
    }
}
