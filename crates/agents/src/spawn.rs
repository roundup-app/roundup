#![deny(clippy::fn_params_excessive_bools, clippy::too_many_lines)]

use super::*;
use claude_code::Permission;
use handoff::Takes;
use rail::NewAgent;

/// Where a launch's conversation comes from.
#[derive(Clone, Copy)]
pub(super) enum Origin<'a> {
    Fresh,
    /// A22: the saved conversation id, added to argv as `--resume <id>`.
    Resume(&'a str),
    /// U7191i: the saved conversation continued as a new session, `--resume <id> --fork-session`.
    Offshoot(&'a str),
}

/// When a launch's Terminal is recorded in the Rail.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Attach {
    Now,
    /// A22's pending resume must not record a `terminal_id` until its launch is acknowledged.
    AfterAck,
}

/// One start of Claude Code for node `id`.
#[derive(Clone, Copy)]
pub(super) struct Launch<'a> {
    pub id: &'a str,
    pub attempt: &'a Ordinal,
    pub cwd: &'a Path,
    pub origin: Origin<'a>,
    pub attach: Attach,
    pub permission: Permission,
    pub size: (u16, u16),
}

/// A spawn after parsing: every value the new Agent starts with.
pub(super) struct SpawnRequest {
    given: Option<String>,
    parent: Option<String>,
    visibility: contracts::agent::RailVisibility,
    role: Option<contracts::agent::SpawnRole>,
    order: Option<Order>,
    spawn_prompt: Option<String>,
    spawner: Option<String>,
    pair: LaunchFacts,
    lean: Option<claude_code::Lean>,
    /// ST1: the settings the starter sent, kept with the Agent.
    start_settings: Option<serde_json::Value>,
    start_attribution: Option<contracts::agent::StartAttribution>,
    by_user_named: bool,
    settle_name: bool,
    pub(super) size: (u16, u16),
    cwd: String,
    machine: Option<String>,
    pub(super) permission: Permission,
    /// H7200a: the caller's row, which the new Agent takes the place of.
    before: Option<String>,
    /// A7494a: a `mode` spawn's saved first prompt.
    mode_prompt: Option<String>,
}

impl Agents {
    /// The Project folder: `.roundup/`'s parent, where its git repository (if any) lives.
    pub fn project_dir(&self) -> &Path {
        &self.shared.project_dir
    }

    /// Put a new Agent in the Rail and start Claude Code for it in a Terminal.
    pub(super) async fn spawn(&self, ctx: &Ctx, params: SpawnParams) -> Result<RailNode, RpcError> {
        self.spawn_in(ctx, params, None).await
    }

    /// `spawn`, taking over the place of `takes` when it names one (H7200a): the new Agent sits
    /// under that row's parent, ahead of it, and has no spawner.
    pub(super) async fn spawn_in(
        &self,
        ctx: &Ctx,
        params: SpawnParams,
        takes: Option<&Takes>,
    ) -> Result<RailNode, RpcError> {
        let named = params.machine.clone();
        let mut request = self.spawn_request(ctx, params)?;
        if let Some(takes) = takes {
            request.parent.clone_from(&takes.parent);
            request.spawner = None;
            request.before.clone_from(&takes.before);
        }
        if let Some(machine) = &named {
            self.shared.terminals.require_reachable(machine).await?;
        } else if request.machine.is_none() {
            // MC33: a folder on no Machine yet starts where the most capacity is free; this Mac
            // when herdr-core cannot be read.
            if let Ok(load) = self.shared.terminals.machine_load().await {
                request.machine = crate::pick::pick(&load);
            }
        }
        if request.role == Some(contracts::agent::SpawnRole::Mode) {
            return self.insert_nested_mode(ctx, &request);
        }
        let (id, attempt) = self.insert_spawned(&request)?;
        // U6000e: the starting row is published before the worktree, config and launch steps.
        ctx.emit(EventData::RailChanged);
        match self
            .run_agent(
                Launch {
                    id: &id,
                    attempt: &attempt,
                    cwd: Path::new(&request.cwd),
                    origin: Origin::Fresh,
                    attach: Attach::Now,
                    permission: request.permission,
                    size: request.size,
                },
                None,
                true,
            )
            .await
            .map(drop)
        {
            Ok(()) => {}
            Err(mut err) => {
                let mut rail = self.shared.rail();
                let mut runs = self.shared.runs();
                if runs.slot(&id).is_some_and(|slot| slot.attempt() == attempt) {
                    runs.forget(&id);
                    self.shared.events.observed.notify_waiters();
                    if rail.node(crate::rail::agent_id(&id)?)?.worktree().is_none() {
                        report_undo(
                            "remove the Agent from the Rail",
                            rail.remove(crate::rail::agent_id(&id)?),
                        );
                    } else if request.start_attribution.is_some() {
                        let path = self.project_dir().to_string_lossy().into_owned();
                        let cause = err.message.clone();
                        err.message = format!(
                            "start failed for {path} row {id}: {cause}; inspect this row before retrying"
                        );
                        err.data = Some(contracts::RpcErrorData::StartFailed {
                            path,
                            id: id.clone(),
                            cause,
                        });
                        Self::touch_creation(ctx, &id, request.start_attribution.as_ref())?;
                    }
                }
                drop((rail, runs));
                ctx.emit(EventData::RailChanged);
                return Err(err);
            }
        };
        if request.start_attribution.is_some() {
            Self::touch_creation(ctx, &id, request.start_attribution.as_ref())?;
        }
        ctx.emit(EventData::RailChanged);
        self.shared.node(&id)
    }

    /// Parse `params` and the caller into the values the new Agent starts with, or refuse before
    /// anything is written.
    pub(super) fn spawn_request(
        &self,
        ctx: &Ctx,
        mut params: SpawnParams,
    ) -> Result<SpawnRequest, RpcError> {
        let size = self.check_spawner(ctx, &mut params)?;
        let by_agent = ctx.actor.kind == ActorKind::Agent;
        let mode = params.role == Some(contracts::agent::SpawnRole::Mode);
        let lean = if mode {
            None
        } else {
            self.lean_of(&mut params, by_agent)?
        };
        let role = order::check_role(params.role, by_agent)?;
        if mode {
            self.mode_of(ctx, &params)?;
        }
        let pair = self.choose(
            &ctx.actor,
            Role::Agent,
            params.launch.model.take(),
            params.launch.effort.take(),
        )?;
        let (mode_prompt, (order, spawn_prompt)) = if mode {
            (params.prompt.take(), (None, None))
        } else {
            (
                None,
                order::order_of(params.prompt, params.launch.order, by_agent)?,
            )
        };
        let given = params
            .name
            .as_deref()
            .map(name::given)
            .transpose()
            .map_err(|reason| RpcError::new(code::INVALID_PARAMS, reason))?;
        Ok(SpawnRequest {
            by_user_named: given.is_some()
                && ctx.actor.kind == ActorKind::User
                && params.app_named != Some(true),
            settle_name: given.is_some() && !(params.app_named == Some(true) && !by_agent),
            given,
            parent: params.launch.parent,
            visibility: params.launch.visibility.unwrap_or_default(),
            role,
            order,
            spawn_prompt,
            spawner: by_agent.then(|| ctx.actor.id.clone()),
            pair,
            lean,
            start_settings: params.launch.settings,
            start_attribution: params.start_attribution,
            size,
            cwd: params.cwd,
            // MC30: an Agent runs where its Project's folder is, unless the caller says otherwise.
            machine: match params.machine {
                Some(machine) => Some(machine),
                None => self.shared.rail().get_machine()?,
            },
            permission: params.permission_mode.into(),
            before: None,
            mode_prompt,
        })
    }

    /// A7494a: a `mode` spawn is the root Agent's own, outside any Workstream, and gives a name and
    /// a first prompt, with no order and none of a lean child's choices.
    fn mode_of(&self, ctx: &Ctx, params: &SpawnParams) -> Result<(), RpcError> {
        let refuse = |reason: &str| Err(RpcError::new(code::INVALID_PARAMS, reason.to_owned()));
        let caller = self.shared.node(&ctx.actor.id)?;
        if caller.kind() != NodeKind::Agent || caller.parent.is_some() {
            return Err(RpcError::conflict(
                "a Mode starts only under a root Agent outside any Workstream",
            ));
        }
        if params.launch.order.is_some() {
            return refuse("a Mode takes a first prompt, not an order");
        }
        if params.scout.is_some() || params.extras.is_some() {
            return refuse("a Mode launches with the user's whole setup: no scout or extras");
        }
        if params
            .name
            .as_deref()
            .is_none_or(|name| name.trim().is_empty())
        {
            return refuse("a Mode needs a name");
        }
        match params.prompt.as_deref() {
            Some(prompt) if !prompt.trim().is_empty() => {
                if prompt.chars().count() > contracts::agent::MODE_PROMPT_MAX {
                    return refuse("the Mode prompt is too long");
                }
            }
            _ => return refuse("a Mode needs a first prompt"),
        }
        Ok(())
    }

    /// A7494a: the nested Mode's row, saved with its first prompt and not yet running; the Daemon
    /// starts it through `agent.restartMode`'s reservation so the prompt is typed once.
    fn insert_nested_mode(&self, ctx: &Ctx, request: &SpawnRequest) -> Result<RailNode, RpcError> {
        let id = {
            let mut rail = self.shared.rail();
            self.insert_node(&mut rail, request)?.base.id
        };
        ctx.emit(EventData::RailChanged);
        self.shared.node(&id)
    }

    /// Who may start what: start attribution and internal children, and an Agent's child sits
    /// under it (F3, A26).
    fn check_spawner(&self, ctx: &Ctx, params: &mut SpawnParams) -> Result<(u16, u16), RpcError> {
        if params.start_attribution.is_some() && ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user connection supplies start attribution",
            ));
        }
        if params.launch.visibility == Some(contracts::agent::RailVisibility::Internal) {
            let rail = self.shared.rail();
            if ctx.actor.kind == ActorKind::Agent
                && rail.node(crate::rail::agent_id(&ctx.actor.id)?)?.kind() != NodeKind::Workstream
            {
                return Err(RpcError::forbidden(
                    "only a Door may start internal children",
                ));
            }
        }
        let size = terminal::window(params.cols.unwrap_or(80), params.rows.unwrap_or(24))?;
        models::check_engine(params.engine.as_deref())?;
        models::check_permissions(&ctx.actor, params.permission_mode)?;
        if let Some(settings) = &params.launch.settings {
            // ST4: the Daemon refuses any caller but the user and the program before this; an
            // Agent never sends them.
            if ctx.actor.kind == ActorKind::Agent {
                return Err(RpcError::forbidden(
                    "only the user or the Project's program starts an Agent with settings",
                ));
            }
            claude_code::start_settings::check(settings)?;
        }
        if ctx.actor.kind == ActorKind::Agent {
            let agent = self
                .shared
                .rail()
                .node(crate::rail::agent_id(&ctx.actor.id)?)
                .is_ok();
            if !agent {
                return Err(RpcError::forbidden(format!(
                    "{} is not an Agent and may not start an Agent",
                    ctx.actor.id
                )));
            }
            params.launch.parent = Some(ctx.actor.id.clone());
        } else if let Some(parent) = &params.launch.parent
            && self
                .shared
                .rail()
                .node(crate::rail::agent_id(parent)?)?
                .kind()
                == NodeKind::Agent
        {
            return Err(RpcError::conflict(format!(
                "{parent} is an Agent: only an Agent's own start nests under it"
            )));
        }
        Ok((size.cols, size.rows))
    }

    /// LC4, LC7: only an Agent's own start is lean, so only it names a scout or extras.
    fn lean_of(
        &self,
        params: &mut SpawnParams,
        by_agent: bool,
    ) -> Result<Option<claude_code::Lean>, RpcError> {
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
        Ok(lean)
    }

    /// Write the Agent node of `request`.
    fn insert_node(
        &self,
        rail: &mut rail::Rail,
        request: &SpawnRequest,
    ) -> Result<RailNode, RpcError> {
        let name = match &request.given {
            Some(given) => {
                let taken = rail
                    .tree()?
                    .into_iter()
                    .filter(|node| node.parent == request.parent)
                    .map(|node| node.base.name)
                    .collect::<Vec<_>>();
                name::unique(given, taken.iter().map(String::as_str))
            }
            None => name::UNNAMED.to_owned(),
        };
        let node = rail.insert_agent(NewAgent {
            name: &name,
            parent: request.parent.as_deref(),
            work: request.order.as_ref(),
            start_attribution: request.start_attribution.as_ref(),
            visibility: request.visibility,
            spawn_prompt: request.spawn_prompt.as_deref(),
            spawner: request.spawner.as_deref(),
            // A7494a: a Mode is told by its saved prompt, so no role is stored for it.
            role: request
                .role
                .filter(|role| *role != contracts::agent::SpawnRole::Mode),
            model: request.pair.model.as_deref(),
            effort: request.pair.effort.as_deref(),
            mode_prompt: request.mode_prompt.as_deref(),
            machine: request.machine.as_deref(),
        })?;
        if let Some(lean) = &request.lean {
            Launcher::save_lean(&self.dir, &node.id, lean)?;
        }
        if let Some(settings) = &request.start_settings {
            Launcher::save_start_settings(&self.dir, &node.id, settings)?;
        }
        if let Some(before) = &request.before {
            rail.take_place(
                crate::rail::agent_id(&node.id)?,
                crate::rail::agent_id(before)?,
            )?;
        }
        Ok(node)
    }

    /// Write the Agent node and mark its first attempt starting: one insert, so a failed write
    /// leaves no node.
    pub(super) fn insert_spawned(
        &self,
        request: &SpawnRequest,
    ) -> Result<(String, Ordinal), RpcError> {
        let mut rail = self.shared.rail();
        let node = self.insert_node(&mut rail, request)?;
        let attempt = rail.allocate_attempt(crate::rail::agent_id(&node.id)?)?;
        self.shared.mark_starting(&node.id, attempt.clone());
        if request.by_user_named {
            rail.set_user_named(crate::rail::agent_id(&node.id)?)?;
        }
        if request.settle_name
            && let Some(slot) = self.shared.runs().slot_mut(&node.id)
        {
            slot.settle_name();
        }
        Ok((node.base.id, attempt))
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
            let node = rail.node(crate::rail::agent_id(&id)?)?;
            let saved_cwd = match self.shared.runs().slot(&id) {
                Some(Slot::Running(run)) => Some(run.cwd().to_owned()),
                _ => None,
            };
            (node, saved_cwd)
        };
        if node.kind() != NodeKind::Agent {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                format!("{id} is not an Agent"),
            ));
        }
        self.shared.guard_reach(&ctx.actor, &id, true)?;
        let cwd = cwd
            .or_else(|| node.worktree().map(|worktree| worktree.path))
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
                    unset: Vec::new(),
                    cols: size.cols,
                    rows: size.rows,
                    machine: None,
                },
                &id,
            )
            .await?;
        ctx.touch(contracts::Verb::Wrote, &format!("agent:{id}"))?;
        Ok(Opened {
            terminal_id: spawned.id,
        })
    }

    /// X12: start the user's login shell in the Project folder, owned by any Agent or the Project.
    pub(super) async fn open_terminal(&self, params: OpenParams) -> Result<Opened, RpcError> {
        let OpenParams {
            workstream,
            cols,
            rows,
        } = params;
        let size = terminal::window(cols.unwrap_or(80), rows.unwrap_or(24))?;
        let owner = match workstream {
            Some(workstream) => {
                self.shared
                    .rail()
                    .node(crate::rail::agent_id(&workstream)?)?;
                workstream
            }
            None => self.project_dir().to_string_lossy().into_owned(),
        };
        let shell = self.shared.shell.clone();
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
    pub(super) async fn run_agent(
        &self,
        launch: Launch<'_>,
        first: Option<String>,
        startup_context: bool,
    ) -> Result<String, RpcError> {
        let Launch {
            id, attempt, cwd, ..
        } = launch;
        let (node, prompt) = {
            let mut rail = self.shared.rail();
            let node = rail.node(crate::rail::agent_id(id)?)?;
            // O2, O3: the first Steer is the node's order, whichever way it was set.
            let spawn_prompt = rail.spawn_prompt(crate::rail::agent_id(id)?)?;
            let prompt = order::first_input(
                first,
                node.work().as_ref(),
                spawn_prompt.as_deref(),
                rail.order_revision(crate::rail::agent_id(id)?)?.is_some(),
                attempt,
            );

            if let (Some(text), Some(revision)) =
                (&prompt, rail.order_revision(crate::rail::agent_id(id)?)?)
            {
                rail.prepare_instruction(&revision, attempt, text, true)?;
            }
            (node, prompt)
        };

        let retained = node.worktree().map(|w| PathBuf::from(w.path));
        if let Some(path) = &retained
            && !self.shared.git.is_dir(path)
        {
            return Err(worktree::WorktreeError::Missing(path.display().to_string()).into());
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
            .start(Launch {
                cwd: &effective_cwd,
                ..launch
            })
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
        let prompts = self.shared.finish_starting(id, attempt, |named| {
            Run::starting(
                Arc::clone(&self.shared.clock),
                attempt.clone(),
                spawned.id.clone(),
                effective_cwd.to_string_lossy().into_owned(),
                prompt,
                startup_context,
                named,
            )
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
        self.shared.bound_first_prompt(id, attempt);
        for prompt in prompts {
            self.shared.steer_first_prompt(id, attempt, prompt);
        }
        tokio::spawn(watch(
            Arc::clone(&self.shared),
            id.to_owned(),
            attempt.clone(),
            spawned.events,
        ));
        Ok(spawned.id)
    }

    /// Start Claude Code as `launch` says: its Origin, when its Terminal is recorded and how it asks
    /// for permission.
    pub(super) async fn start(&self, launch: Launch<'_>) -> Result<terminal::Spawned, RpcError> {
        let Launch {
            id,
            attempt,
            cwd,
            origin,
            attach,
            permission,
            size,
        } = launch;
        let (resume, forking) = match origin {
            Origin::Fresh => (None, false),
            Origin::Resume(conversation) => (Some(conversation), false),
            Origin::Offshoot(conversation) => (Some(conversation), true),
        };
        let launcher = if forking {
            self.launcher.forking()
        } else {
            self.launcher.clone()
        };
        let node = self.shared.rail().node(crate::rail::agent_id(id)?)?;
        let role = match node.kind() {
            NodeKind::Workstream => Role::Door,
            _ => Role::Agent,
        };
        let pair = LaunchFacts {
            naming_guide: self.shared.wiring.naming()?.guide,
            permission,
            model: node.model(),
            effort: node.effort(),
            mcp_off: !models::mcp_on(
                self.shared.mcp_env.as_deref(),
                self.shared.rail().get_mcp()?.on,
            ),
            lean: Launcher::load_lean(&self.dir, id)?,
            start_settings: Launcher::load_start_settings(&self.dir, id)?,
        };
        let started = attempt.to_owned();
        let adopted = node
            .worktree()
            .filter(|worktree| worktree.adopted)
            .map(|worktree| PathBuf::from(worktree.path));
        let (argv, env, unset) = launcher
            .launch_on(&claude_code::Request {
                folders: claude_code::Folders {
                    project: self.project_dir(),
                    data: &self.dir,
                    adopted: adopted.as_deref(),
                },
                id,
                attempt,
                cwd,
                resume,
                role,
                facts: &pair,
            })
            .await?;
        self.retain_worktree(id).await?;
        let spawned = match self
            .spawn_behind(
                id,
                TerminalSpawn {
                    cwd: cwd.to_string_lossy().into_owned(),
                    command: Some(argv),
                    env,
                    unset,
                    cols: size.0,
                    rows: size.1,
                    machine: node.machine(),
                },
                attach,
            )
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
                .scan_door(id, marker.to_string_lossy().into_owned())?;
        }
        Ok(spawned)
    }

    /// Start `command` (the login shell when `None`) in a Terminal and, when `attach` is `Now`,
    /// record it as the one behind node `id`.
    pub(super) async fn spawn_behind(
        &self,
        id: &str,
        spawn: TerminalSpawn,
        attach: Attach,
    ) -> Result<terminal::Spawned, RpcError> {
        // MC52: the core's list names this Terminal's Project, Agent and Attempt.
        let attempt = self
            .shared
            .rail()
            .node(crate::rail::agent_id(id)?)?
            .attempt()
            .map(|attempt| attempt.to_string())
            .unwrap_or_default();
        let labels =
            terminal::reconcile::labels(&self.project_dir().to_string_lossy(), id, &attempt);
        // UKR3: a live program of this node is never adopted as a launch, whose rollback would
        // stop it; the start is refused and the program keeps running.
        if self
            .shared
            .terminals
            .has_live_program(spawn.machine.as_deref(), &labels)
            .await
        {
            return Err(RpcError::conflict(format!(
                "{id} already has a running program"
            )));
        }
        let spawned = self.shared.terminals.spawn_labelled(spawn, labels).await?;
        if attach == Attach::Now {
            let attached = self
                .shared
                .rail()
                .attach_terminal(crate::rail::agent_id(id)?, &spawned.id);
            let attached = attached
                .map_err(RpcError::from)
                .and_then(|()| self.save_owner(id, &spawned.id));
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

#[cfg(feature = "test-support")]
impl Agents {
    /// Controlled launch completion at the production lifecycle seam, without a vendor or PTY.
    pub fn start_for_test(&self, id: &str, first: Option<String>) -> Result<(), RpcError> {
        let (attempt, prompt) = {
            let mut rail = self.shared.rail();
            let agent = crate::rail::agent_id(id)?;
            let node = rail.node(agent)?;
            let attempt = rail.allocate_attempt(agent)?;
            let prompt = order::first_input(
                first,
                node.work().as_ref(),
                rail.spawn_prompt(agent)?.as_deref(),
                rail.order_revision(agent)?.is_some(),
                &attempt,
            );
            rail.attach_terminal(agent, "fixture")?;
            (attempt, prompt)
        };
        self.shared.mark_starting(id, attempt.clone());
        let prompts = self.shared.finish_starting(id, &attempt, |named| {
            Run::starting(
                Arc::clone(&self.shared.clock),
                attempt.clone(),
                "fixture".into(),
                self.project_dir().to_string_lossy().into_owned(),
                prompt,
                true,
                named,
            )
        })?;
        for prompt in prompts {
            self.shared.steer_first_prompt(id, &attempt, prompt);
        }
        Ok(())
    }

    /// Isolate the vendor socket in a process-free Daemon observer.
    pub fn with_launcher_for_test(mut self, launcher: Launcher) -> Self {
        self.launcher = launcher;
        self
    }
}

#[cfg(test)]
#[allow(clippy::too_many_lines)]
mod idle_tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a5556c_start_paths_require_explicit_input() {
        for (kind, parent, restart) in [
            (NodeKind::Workstream, false, false),
            (NodeKind::Agent, false, false),
            (NodeKind::Agent, true, false),
            (NodeKind::Workstream, false, true),
            (NodeKind::Agent, false, true),
        ] {
            let (_dir, _bus, shared) = tests::shared_over_temp_dir(Arc::new(|| 0));
            let mut rail = shared.rail();
            let home = rail
                .insert(NodeKind::Workstream, "Home", None, None)
                .unwrap();
            let node = rail
                .insert_ordered(
                    kind,
                    "Waiting",
                    parent.then_some(home.id.as_str()),
                    None,
                    restart.then_some(&Order::work("stored order")),
                    None,
                )
                .unwrap();
            if restart {
                let mut earlier = Run::starting(
                    Arc::new(|| 0),
                    contracts::agent::Ordinal::parse("1").unwrap(),
                    "old".into(),
                    "/".into(),
                    None,
                    true,
                    false,
                );
                shared.apply(Some(&mut rail), &mut earlier, &mut Facts::default(), &node.id, &Actor::user(),
                    Observation::Signal(serde_json::json!({"hook_event_name":"UserPromptSubmit","prompt":"earlier request"})), None).unwrap();
                assert!(earlier.input_started());
                shared.runs().put(&node.id, Slot::Running(earlier));
            }
            let prompt = order::first_input(
                None,
                node.work().as_ref(),
                None,
                rail.order_revision(crate::rail::agent_id(&node.id).unwrap())
                    .unwrap()
                    .is_some(),
                if restart { "2" } else { "1" },
            );
            let mut run = Run::starting(
                Arc::new(|| 0),
                contracts::agent::Ordinal::parse("1").unwrap(),
                "none".into(),
                "/".into(),
                prompt,
                true,
                false,
            );
            for observation in [
                Observation::Signal(serde_json::json!({"hook_event_name":"SessionStart"})),
                Observation::Title("✳ ready".into()),
                Observation::Tick,
                Observation::Signal(serde_json::json!({"hook_event_name":"Stop"})),
                Observation::Tick,
            ] {
                let (input, _) = shared
                    .apply(
                        Some(&mut rail),
                        &mut run,
                        &mut Facts::default(),
                        &node.id,
                        &Actor::daemon(),
                        observation,
                        None,
                    )
                    .unwrap();
                assert!(input.is_none(), "automatic startup input: {input:?}");
                assert!(!run.input_started());
                assert!(run.steer().is_none());
            }
            shared.apply(Some(&mut rail), &mut run, &mut Facts::default(), &node.id, &Actor::user(),
                Observation::Signal(serde_json::json!({"hook_event_name":"UserPromptSubmit","prompt":"my request"})), None).unwrap();
            assert!(run.input_started());
        }
        // Resume uses its actual promotion seam: a retained order is not fresh input.
        let (_dir, _bus, shared) = tests::shared_over_temp_dir(Arc::new(|| 0));
        let mut rail = shared.rail();
        let node = rail
            .insert_ordered(
                NodeKind::Agent,
                "Resumed",
                None,
                None,
                Some(&Order::work("retained")),
                None,
            )
            .unwrap();
        let mut earlier = Run::starting(
            Arc::new(|| 0),
            contracts::agent::Ordinal::parse("1").unwrap(),
            "old".into(),
            "/".into(),
            None,
            true,
            false,
        );
        shared.apply(Some(&mut rail), &mut earlier, &mut Facts::default(), &node.id, &Actor::user(),
            Observation::Signal(serde_json::json!({"hook_event_name":"UserPromptSubmit","prompt":"earlier request"})), None).unwrap();
        assert!(earlier.input_started());
        shared.runs().put(&node.id, Slot::Running(earlier));
        let (done, _completion) = oneshot::channel();
        let conversation = "00000000-0000-4000-8000-000000000001";
        let mut runs = HashMap::from([(
            crate::id::AgentId::parse(&node.id).unwrap(),
            Agent {
                facts: Facts::default(),
                slot: Slot::Resuming {
                    mode: contracts::agent::ResumeMode::default(),
                    attempt: contracts::agent::Ordinal::parse("2").unwrap(),
                    since: 0,
                    old: None,
                    conversation_id: conversation.into(),
                    fork: false,
                    cwd: "/".into(),
                    prompt: None,
                    starred: true,
                    terminal_id: Some("fixture".into()),
                    parked: VecDeque::new(),
                    done,
                },
            },
        )]);
        let (input, _) = shared.finish_resuming(Some(&mut rail), &mut runs, &node.id, Actor::daemon(),
            serde_json::json!({"hook_event_name":"SessionStart","source":"resume","session_id":conversation})).unwrap();
        assert!(input.is_none());
        let Some(Agent {
            slot: Slot::Running(run),
            facts,
        }) = runs.agent_mut(&node.id)
        else {
            panic!("resume was not promoted")
        };
        assert!(!run.input_started());
        shared
            .apply(
                Some(&mut rail),
                run,
                facts,
                &node.id,
                &Actor::user(),
                Observation::Signal(
                    serde_json::json!({"hook_event_name":"UserPromptSubmit","prompt":"continue"}),
                ),
                None,
            )
            .unwrap();
        assert!(run.input_started());
        let work = Order::work("build");
        assert_eq!(
            order::first_input(None, Some(&work), Some("details"), true, "1"),
            Some("build\n\nDetails:\ndetails".into())
        );
        for words in ["saved opening", "new Ask", "creation prompt"] {
            assert_eq!(
                order::first_input(Some(words.into()), None, None, false, "1"),
                Some(words.into())
            );
        }
    }
}
