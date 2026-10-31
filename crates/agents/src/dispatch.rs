use super::*;

#[async_trait]
impl Module for Agents {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent", "rail", "project", "import", "models", "workstream"]
    }

    async fn call_reply(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Reply, RpcError> {
        match method {
            // R3696c: the Rail is the largest reply a keystroke-paced client asks for.
            "rail.tree" | "rail.list" => rpc::json(&self.shared.tree()?),
            _ => self.call(ctx, method, value).await.map(Reply::Value),
        }
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        contracts::agents_methods!(rpc::dispatch_methods, self, ctx, method, value)
    }
}

impl Agents {
    async fn rpc_agent_spawn(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.spawn(ctx, params(value)?).await?)
    }

    async fn rpc_agent_extras(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        reply(&claude_code::extras::available(
            &self.launcher.extras_sources(self.project_dir()),
        ))
    }

    async fn rpc_agent_extras_add(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let params: ExtrasAddParams = params(value)?;
            let id = params.id.clone();
            let node = self.add_extras(ctx, params).await?;
            Self::touch_rail(ctx, &id)?;
            reply(&node)
        }
    }

    async fn rpc_agent_make_workstream(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let NodeId { id } = params(value)?;
        reply(&self.make_workstream(ctx, &id).await?)
    }

    async fn rpc_agent_save_as_mode(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.save_as_mode(ctx, params(value)?)?)
    }

    async fn rpc_agent_prompt(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let PromptParams { id, text } = params(value)?;
            self.may_steer(&ctx.actor, &id, "Steer")?;
            let steer = if ctx.actor.kind == ActorKind::User && text.starts_with('/') {
                Steer::User(&text)
            } else {
                Steer::Instruction(&text)
            };
            // A4452d: only the user's words are typed; an Agent's text goes to the inbox.
            if ctx.actor.kind == ActorKind::Agent {
                self.shared
                    .coordinate(&id, None, text)
                    .await
                    .map_err(PromptError::from)?;
            } else {
                self.prompt(&id, steer).await?;
            }
            Self::touch_rail(ctx, &id)?;
            reply(&())
        }
    }

    async fn rpc_agent_interrupt(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = params(value)?;
            self.may_steer(&ctx.actor, &id, "Interrupt")?;
            shared.interrupt(&id).await?;
            Self::touch_rail(ctx, &id)?;
            reply(&())
        }
    }

    async fn rpc_agent_stop(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = params(value)?;
            shared.guard_reach(&ctx.actor, &id, false)?;
            shared.stop(ctx.actor.clone(), &id).await?;
            Self::touch_rail(ctx, &id)?;
            reply(&())
        }
    }

    async fn rpc_agent_worktree_state(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = params(value)?;
            shared.guard_reach(&ctx.actor, &id, true)?;
            reply(&self.worktree_state(&id).await?)
        }
    }

    async fn rpc_agent_changed_files(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = params(value)?;
            shared.guard_reach(&ctx.actor, &id, true)?;
            reply(&self.changed_files(&id).await?)
        }
    }

    async fn rpc_agent_compare_file(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let contracts::agent::CompareFileParams { id, path } = params(value)?;
            shared.guard_reach(&ctx.actor, &id, true)?;
            reply(&self.compare_file(&id, &path).await?)
        }
    }

    async fn rpc_agent_land(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = params(value)?;
            shared.guard_reach(&ctx.actor, &id, false)?;
            let landed = self.land(&id).await?;
            Self::touch_rail(ctx, &id)?;
            reply(&landed)
        }
    }

    async fn rpc_agent_discard(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = params(value)?;
            shared.guard_reach(&ctx.actor, &id, false)?;
            shared.discard(ctx.actor.clone(), &id).await?;
            Self::touch_rail(ctx, &id)?;
            reply(&())
        }
    }

    async fn rpc_rail_start_door(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let start: StartDoorParams = params(value)?;
            let id = start.id.clone();
            shared.guard_reach(&ctx.actor, &id, false)?;
            let door = self.start_door(ctx, start).await?;
            Self::touch_rail(ctx, &id)?;
            reply(&door)
        }
    }

    async fn rpc_agent_resume(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
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
    }

    async fn rpc_agent_set_model(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let set: SetModelParams = params(value)?;
            let id = set.id.clone();
            let node = self.set_model(ctx, set).await?;
            Self::touch_rail(ctx, &id)?;
            reply(&node)
        }
    }

    async fn rpc_agent_set_order(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.set_order(ctx, params(value)?).await?)
    }

    async fn rpc_agent_channel_up(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = params(value)?;
            shared.channel_up(&ctx.actor, &id)?;
            reply(&())
        }
    }

    async fn rpc_agent_signal(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
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
    }

    async fn rpc_rail_tree(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        reply(&shared.tree()?)
    }

    async fn rpc_workstream_set_auto(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let choice = params(value)?;
            self.set_auto(ctx, choice)?;
            reply(&())
        }
    }

    async fn rpc_workstream_set_opening_prompt(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.set_opening_prompt(ctx, params(value)?)?;
        reply(&())
    }

    async fn rpc_agent_instructions(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
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
    }

    async fn rpc_agent_spawn_prompt(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = params(value)?;
            shared.guard_reach(&ctx.actor, &id, true)?;
            reply(&serde_json::json!({ "prompt": shared.rail().spawn_prompt(&id)? }))
        }
    }

    async fn rpc_rail_create_workstream(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
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
    }

    async fn rpc_rail_rename(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
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
    }

    async fn rpc_agent_run(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.run(ctx, params(value)?).await?)
    }

    async fn rpc_terminal_open(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.open_terminal(params(value)?).await?)
    }

    async fn rpc_project_set_worktrees(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
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
    }

    async fn rpc_project_set_mcp(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let mcp: Mcp = params(value)?;
            shared.rail().set_mcp(&mcp)?;
            reply(&())
        }
    }

    async fn rpc_project_set_prepared(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            self.set_prepared(params(value)?).await?;
            reply(&())
        }
    }

    async fn rpc_import_list(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let params: contracts::project::ImportListParams = params(value)?;
            reply(&self.import_list(ctx, params).await?)
        }
    }

    async fn rpc_project_import_discover(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let params: contracts::project::ImportDiscoverParams = params(value)?;
            reply(&self.import_discover(ctx, params).await?)
        }
    }

    async fn rpc_project_import_commit(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let params: contracts::project::ImportCommitParams = params(value)?;
            reply(&self.import_commit(ctx, params).await?)
        }
    }

    async fn rpc_project_get_prepared(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        reply(&shared.rail().get_prepared()?)
    }

    async fn rpc_project_prepare_directory(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let PrepareParams { path } = params(value)?;
            self.prepare_directory(&path).await?;
            reply(&())
        }
    }

    async fn rpc_project_set_models(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let settings: ProjectModels = params(value)?;
            models::check_settings(&settings)?;
            shared.rail().set_models(&settings)?;
            ctx.touch(contracts::Verb::Wrote, "project:models")?;
            reply(&())
        }
    }

    async fn rpc_models_list(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        // The Adapter's static table: no Project item is read, so no Touch is written to `project.db`.
        reply(&models::list())
    }

    async fn rpc_project_get(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
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
    }

    async fn rpc_project_open(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
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
    }

    async fn rpc_project_rename(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
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
    }

    async fn rpc_rail_move(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let MoveParams { id, parent, index } = params(value)?;
            shared.guard_reach(&ctx.actor, &id, false)?;
            shared.rail().move_node(&id, parent.as_deref(), index)?;
            Self::touch_rail(ctx, &id)?;
            ctx.emit(EventData::RailChanged);
            reply(&())
        }
    }

    async fn rpc_rail_remove(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let shared = &self.shared;
        {
            let contracts::agent::RemoveParams {
                id,
                operation,
                scope,
            } = params(value)?;
            if operation.is_some() {
                return Err(RpcError::forbidden(
                    "reversible removal requires the Project Daemon",
                ));
            }
            let scope = scope.unwrap_or_default();
            shared.guard_reach(&ctx.actor, &id, false)?;
            if scope == RemoveScope::All && shared.rail().node(&id)?.kind != NodeKind::Workstream {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    "scope all requires a Workstream",
                ));
            }
            if shared.rail().node(&id)?.kind == NodeKind::Workstream {
                let removal = shared
                    .remove_workstream(ctx.actor.clone(), &id, scope)
                    .await?;
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
    }
}
