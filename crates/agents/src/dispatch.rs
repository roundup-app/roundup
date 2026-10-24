use super::*;

#[async_trait]
impl Module for Agents {
    fn namespaces(&self) -> &'static [&'static str] {
        &[
            "agent",
            "rail",
            "project",
            "import",
            "decision",
            "models",
            "workstream",
        ]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        let shared = &self.shared;
        match method {
            "project.measurements" | "project.measurementSummary" => {
                let summary = if method == "project.measurementSummary" {
                    Some(params::<contracts::project::MeasurementSummaryParams>(
                        value,
                    )?)
                } else {
                    None
                };
                let mut rail = shared.rail();
                let mut timing = shared.timing.lock().expect("measurement timing lock");
                timing.sample();
                let cause = timing.failure();
                let mut measurements = rail.measurements(self.project_dir())?;
                if cause.is_some() {
                    measurements.cause = cause;
                }
                if let Some(params) = summary {
                    // U3016i: the live Status says whether an Agent still runs.
                    let runs = shared.runs();
                    let tree = rail
                        .tree()?
                        .into_iter()
                        .map(|node| shared.present(node, &runs, &rail))
                        .collect::<Result<Vec<_>, _>>()?;
                    reply(&measurement::summarize(measurements, tree, params)?)
                } else {
                    reply(&measurements)
                }
            }
            "project.weeklyLimit" => reply(&self.launcher.weekly_limit().await),
            "agent.spawn" => reply(&self.spawn(ctx, params(value)?).await?),
            "agent.extras" => reply(&claude_code::extras::available(
                &self.launcher.extras_sources(self.project_dir()),
            )),
            "agent.extras_add" => {
                let params: ExtrasAddParams = params(value)?;
                let id = params.id.clone();
                let node = self.add_extras(ctx, params).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&node)
            }
            "agent.prompt" => {
                let PromptParams { id, text } = params(value)?;
                self.may_steer(&ctx.actor, &id, "Steer")?;
                let steer = if ctx.actor.kind == ActorKind::User && text.starts_with('/') {
                    Steer::User(&text)
                } else {
                    Steer::Instruction(&text)
                };
                self.prompt(&id, steer).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&())
            }
            "agent.interrupt" => {
                let NodeId { id } = params(value)?;
                self.may_steer(&ctx.actor, &id, "Interrupt")?;
                shared.interrupt(&id).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&())
            }
            "agent.stop" => {
                let NodeId { id } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, false)?;
                shared.stop(ctx.actor.clone(), &id).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&())
            }
            "agent.worktreeState" => {
                let NodeId { id } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, true)?;
                reply(&self.worktree_state(&id).await?)
            }
            "agent.changedFiles" => {
                let NodeId { id } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, true)?;
                reply(&self.changed_files(&id).await?)
            }
            "agent.compareFile" => {
                let contracts::agent::CompareFileParams { id, path } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, true)?;
                reply(&self.compare_file(&id, &path).await?)
            }
            "agent.land" => {
                let NodeId { id } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, false)?;
                let landed = self.land(&id).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&landed)
            }
            "agent.discard" => {
                let NodeId { id } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, false)?;
                shared.discard(ctx.actor.clone(), &id).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&())
            }
            "rail.startDoor" => {
                let start: StartDoorParams = params(value)?;
                let id = start.id.clone();
                shared.guard_reach(&ctx.actor, &id, false)?;
                let door = self.start_door(ctx, start).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&door)
            }
            "agent.resume" => {
                let contracts::agent::ResumeParams {
                    id,
                    mode,
                    permission_mode,
                } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, false)?;
                let node = self.resume(ctx, &id, mode, permission_mode).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&node)
            }
            "agent.setModel" => {
                let set: SetModelParams = params(value)?;
                let id = set.id.clone();
                let node = self.set_model(ctx, set).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&node)
            }
            "agent.setOrder" => reply(&self.set_order(ctx, params(value)?).await?),
            "agent.channelUp" => {
                let NodeId { id } = params(value)?;
                shared.channel_up(&ctx.actor, &id)?;
                reply(&())
            }
            "agent.signal" => {
                let SignalParams {
                    id,
                    attempt,
                    payload,
                } = params(value)?;
                if contracts::agent::parse_positive_ordinal(&attempt).is_none() {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        "attempt must be a canonical positive decimal within signed 64-bit range",
                    ));
                }
                shared.events.inbox.scan(&id, &payload);
                shared.observe(
                    ctx.actor.clone(),
                    &id,
                    &attempt,
                    Observation::Signal(payload),
                )?;
                reply(&None::<SignalOutcome>)
            }
            "agent.permission" => {
                let PermissionParams { id, payload } = params(value)?;
                reply(&shared.permission(ctx.actor.clone(), &id, payload).await?)
            }
            "agent.ask" => {
                let ask: contracts::decision::AskParams = params(value)?;
                reply(&shared.ask(ctx.actor.clone(), ask).await?)
            }
            "decision.answers" => {
                let contracts::decision::AnswersParams { agent } = params(value)?;
                reply(&shared.answers_for(&ctx.actor, &agent)?)
            }
            "decision.list" => reply(&shared.decisions_for(&ctx.actor)?),
            "decision.capture" => {
                let CaptureParams { id } = params(value)?;
                reply(&shared.capture(&ctx.actor, &id)?)
            }
            "decision.answer" => {
                let answer: AnswerParams = params(value)?;
                let shared = Arc::clone(shared);
                let ctx = Ctx {
                    actor: ctx.actor.clone(),
                    bus: ctx.bus.clone(),
                    touches: Arc::clone(&ctx.touches),
                };
                // An answer may wait for a guarded physical write. Keep that wait off
                // the reactor so the user's competing call can reach its own effect.
                tokio::task::spawn_blocking(move || shared.answer(&ctx, answer))
                    .await
                    .map_err(|err| {
                        RpcError::unknown_outcome(format!("prompt effect worker ended: {err}"))
                    })??;
                reply(&())
            }
            "decision.revoke" => {
                let revoke: contracts::decision::RevokeParams = params(value)?;
                reply(&shared.revoke(ctx, revoke)?)
            }
            "rail.tree" | "rail.list" => reply(&shared.tree()?),
            "workstream.setAuto" => {
                let choice = params(value)?;
                self.set_auto(ctx, choice)?;
                reply(&())
            }
            "agent.instructions" => {
                let NodeId { id } = params(value)?;
                if ctx.actor.kind != ActorKind::User {
                    shared.guard_reach(&ctx.actor, &id, true)?;
                }
                reply(
                    &shared
                        .rail()
                        .instructions(&id, &shared.project_dir.to_string_lossy())?,
                )
            }
            "agent.spawnPrompt" => {
                let NodeId { id } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, true)?;
                reply(&serde_json::json!({ "prompt": shared.rail().spawn_prompt(&id)? }))
            }
            "rail.createWorkstream" => {
                let CreateWorkstreamParams {
                    name,
                    parent,
                    order,
                } = params(value)?;
                if let Some(order) = &order {
                    valid_explicit_order(order)?;
                }
                let node = shared.rail().insert_ordered(
                    NodeKind::Workstream,
                    &name,
                    parent.as_deref(),
                    None,
                    order.as_ref(),
                )?;
                if ctx.actor.kind == ActorKind::Agent {
                    shared.rail().set_creator(&node.id, &ctx.actor.id)?;
                }
                Self::touch_rail(ctx, &node.id)?;
                ctx.emit(EventData::RailChanged);
                reply(&shared.node(&node.id)?)
            }
            "rail.rename" => {
                let RenameParams { id, name } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, true)?;
                let node = {
                    let mut rail = shared.rail();
                    let before = rail.node(&id)?.name;
                    let node = rail.rename(&id, &name)?;
                    // Publish before releasing Rail: both producers follow its commit order.
                    if node.name != before {
                        shared.bus.emit(
                            ctx.actor.clone(),
                            EventData::RailRenamed {
                                id: node.id.clone(),
                                name: node.name.clone(),
                            },
                        );
                    }
                    if let Some(slot) = shared.runs().get_mut(&id) {
                        slot.settle_name();
                    }
                    node
                };
                Self::touch_rail(ctx, &id)?;
                ctx.emit(EventData::RailChanged);
                reply(&shared.node(&node.id)?)
            }
            "agent.run" => reply(&self.run(ctx, params(value)?).await?),
            "terminal.open" => reply(&self.open_terminal(params(value)?).await?),
            "project.setWorktrees" => {
                let Worktrees { on, check } = params(value)?;
                if check.as_deref() == Some("") {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        "check must not be empty",
                    ));
                }
                shared.rail().set_worktrees(&Worktrees { on, check })?;
                reply(&())
            }
            "project.setMcp" => {
                let mcp: Mcp = params(value)?;
                shared.rail().set_mcp(&mcp)?;
                reply(&())
            }
            "project.setPrepared" => {
                self.set_prepared(params(value)?).await?;
                reply(&())
            }
            "import.list" => {
                let params: contracts::project::ImportListParams = params(value)?;
                reply(&self.import_list(ctx, params).await?)
            }
            "project.importDiscover" => {
                let params: contracts::project::ImportDiscoverParams = params(value)?;
                reply(&self.import_discover(ctx, params).await?)
            }
            "project.importCommit" => {
                let params: contracts::project::ImportCommitParams = params(value)?;
                reply(&self.import_commit(ctx, params).await?)
            }
            "project.getPrepared" => reply(&shared.rail().get_prepared()?),
            "project.prepareDirectory" => {
                let PrepareParams { path } = params(value)?;
                self.prepare_directory(&path).await?;
                reply(&())
            }
            "project.setModels" => {
                let settings: ProjectModels = params(value)?;
                models::check_settings(&settings)?;
                shared.rail().set_models(&settings)?;
                ctx.touch(contracts::Verb::Wrote, "project:models")?;
                reply(&())
            }
            "models.list" => {
                ctx.touch(contracts::Verb::Read, "project:models")?;
                reply(&models::list())
            }
            "project.get" => {
                let worktrees = shared.rail().get_worktrees()?;
                let models = self.project_models()?;
                let mcp = shared.rail().get_mcp()?;
                reply(&ProjectSettings {
                    worktrees,
                    models,
                    mcp,
                    workstream_cap: shared.rail().get_workstream_cap()?,
                })
            }
            "project.open" => {
                let contracts::project::OpenParams { path } = params(value)?;
                let folder = Path::new(&path);
                if !folder.is_absolute() {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        format!("path {path} is not absolute"),
                    ));
                }
                if !folder.is_dir() {
                    return Err(RpcError::not_found(format!("directory {path}")));
                }
                ctx.touch(contracts::Verb::Wrote, &format!("project:{path}"))?;
                ctx.emit(EventData::ProjectRequested(
                    contracts::project::Requested::Open { path },
                ));
                reply(&())
            }
            "project.rename" => {
                let contracts::project::RenameParams { name } = params(value)?;
                let name = name.trim();
                if name.is_empty() || name.chars().count() > 40 || name.contains(['\n', '\r']) {
                    return Err(RpcError::new(
                        code::INVALID_PARAMS,
                        "a Project's name is 1 to 40 characters on one line",
                    ));
                }
                let path = shared.project_dir.to_string_lossy().into_owned();
                ctx.touch(contracts::Verb::Wrote, &format!("project:{path}"))?;
                ctx.emit(EventData::ProjectRequested(
                    contracts::project::Requested::Rename {
                        path,
                        name: name.to_owned(),
                    },
                ));
                reply(&())
            }
            "rail.move" => {
                let MoveParams { id, parent, index } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, false)?;
                shared.rail().move_node(&id, parent.as_deref(), index)?;
                Self::touch_rail(ctx, &id)?;
                ctx.emit(EventData::RailChanged);
                reply(&())
            }
            "rail.remove" => {
                let NodeId { id } = params(value)?;
                shared.guard_reach(&ctx.actor, &id, false)?;
                if shared.rail().node(&id)?.kind == NodeKind::Workstream {
                    let removal = shared.remove_workstream(ctx.actor.clone(), &id).await?;
                    for item in &removal.removed {
                        Self::touch_rail(ctx, &item.id)?;
                    }
                    for item in &removal.kept {
                        Self::touch_rail(ctx, &item.id)?;
                    }
                    Self::touch_rail(ctx, &id)?;
                    return reply(&removal);
                }
                shared.remove(ctx.actor.clone(), &id).await?;
                Self::touch_rail(ctx, &id)?;
                reply(&())
            }
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}
