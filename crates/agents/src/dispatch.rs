use super::*;

#[async_trait]
impl Module for Agents {
    fn namespaces(&self) -> &'static [&'static str] {
        &["agent", "rail", "project", "import", "models", "workstream"]
    }

    async fn call_reply(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Reply, RpcError> {
        if self.misconfigured {
            return Err(RpcError::internal(
                "the Agents were configured after sharing",
            ));
        }
        match method {
            // R3696c: the Rail is the largest reply a keystroke-paced client asks for.
            "rail.tree" => rpc::json(&self.shared.tree()?),
            _ => self.call(ctx, method, value).await.map(Reply::Value),
        }
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        if self.misconfigured {
            return Err(RpcError::internal(
                "the Agents were configured after sharing",
            ));
        }
        contracts::agents_methods!(rpc::dispatch_methods, Agents, self, ctx, method, value)
    }
}

impl Agents {
    async fn rail_set_alert_level(
        &self,
        ctx: &Ctx,
        p: contracts::agent::SetAlertLevelParams,
    ) -> Result<(), RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user sets alert levels"));
        }
        let choice: contracts::agent::SetAlertLevelParams = p;
        if Path::new(&choice.project) != self.project_dir() {
            return Err(RpcError::forbidden(
                "alert level target belongs to another Project",
            ));
        }
        self.shared
            .rail()
            .set_alert_level(crate::rail::agent_id(&choice.id)?, choice.level)?;
        ctx.emit(EventData::RailChanged);
        Ok(())
    }

    async fn agent_extras(&self, _ctx: &Ctx) -> Result<contracts::agent::Extras, RpcError> {
        Ok(claude_code::extras::available(
            &self.launcher.extras_sources(self.project_dir()),
        ))
    }

    async fn agent_extras_add(
        &self,
        ctx: &Ctx,
        p: contracts::agent::ExtrasAddParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        {
            let params: ExtrasAddParams = p;
            let id = params.id.clone();
            let node = self.add_extras(ctx, params).await?;
            Self::touch_rail(ctx, &id)?;
            Ok(node)
        }
    }

    async fn agent_make_workstream(
        &self,
        ctx: &Ctx,
        p: contracts::agent::NodeId,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        let NodeId { id } = p;
        self.make_workstream(ctx, &id).await
    }

    async fn agent_prompt(
        &self,
        ctx: &Ctx,
        p: contracts::agent::PromptParams,
    ) -> Result<(), RpcError> {
        {
            let PromptParams { id, text } = p;
            self.may_steer(&ctx.actor, &id, "Steer")?;
            let steer = if ctx.actor.kind == ActorKind::User && text.starts_with('/') {
                Steer::User(&text)
            } else {
                Steer::Instruction(&text)
            };
            // A4452d: only the user's words are typed; an Agent's text goes to the inbox as its
            // own Message, so U6260a's waiting reason is readable in the sender's Message list.
            if ctx.actor.kind == ActorKind::Agent {
                self.shared
                    .coordinate(ctx.actor.clone(), &id, None, text)
                    .await
                    .map_err(PromptError::from)?;
            } else {
                self.prompt(&id, steer).await?;
            }
            Self::touch_rail(ctx, &id)?;
            Ok(())
        }
    }

    async fn agent_interrupt(
        &self,
        ctx: &Ctx,
        p: contracts::agent::NodeId,
    ) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            self.may_steer(&ctx.actor, &id, "Interrupt")?;
            shared.interrupt(&id).await?;
            Self::touch_rail(ctx, &id)?;
            Ok(())
        }
    }

    async fn agent_stop(&self, ctx: &Ctx, p: contracts::agent::NodeId) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            shared.guard_reach(&ctx.actor, &id, false)?;
            shared.stop(ctx.actor.clone(), &id).await?;
            Self::touch_rail(ctx, &id)?;
            Ok(())
        }
    }

    async fn agent_worktree_state(
        &self,
        ctx: &Ctx,
        p: contracts::agent::NodeId,
    ) -> Result<contracts::agent::WorktreeState, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            shared.guard_reach(&ctx.actor, &id, true)?;
            self.worktree_state(&id).await
        }
    }

    async fn agent_changed_files(
        &self,
        ctx: &Ctx,
        p: contracts::agent::NodeId,
    ) -> Result<contracts::agent::ChangedFiles, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            shared.guard_reach(&ctx.actor, &id, true)?;
            self.changed_files(&id).await
        }
    }

    async fn agent_compare_file(
        &self,
        ctx: &Ctx,
        p: contracts::agent::CompareFileParams,
    ) -> Result<contracts::agent::FileComparison, RpcError> {
        let shared = &self.shared;
        {
            let contracts::agent::CompareFileParams { id, path } = p;
            shared.guard_reach(&ctx.actor, &id, true)?;
            self.compare_file(&id, &path).await
        }
    }

    async fn agent_land(
        &self,
        ctx: &Ctx,
        p: contracts::agent::NodeId,
    ) -> Result<contracts::agent::Landed, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            shared.guard_reach(&ctx.actor, &id, false)?;
            let landed = self.land(&id).await?;
            Self::touch_rail(ctx, &id)?;
            Ok(landed)
        }
    }

    async fn agent_discard(&self, ctx: &Ctx, p: contracts::agent::NodeId) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            shared.guard_reach(&ctx.actor, &id, false)?;
            shared.discard(ctx.actor.clone(), &id).await?;
            Self::touch_rail(ctx, &id)?;
            Ok(())
        }
    }

    async fn agent_resume(
        &self,
        ctx: &Ctx,
        p: contracts::agent::ResumeParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        let shared = &self.shared;
        {
            let contracts::agent::ResumeParams {
                id,
                mode,
                permission_mode,
            } = p;
            shared.guard_reach(&ctx.actor, &id, false)?;
            let node = self.resume(ctx, &id, mode, permission_mode).await?;
            Self::touch_rail(ctx, &id)?;
            Ok(node)
        }
    }

    async fn agent_set_model(
        &self,
        ctx: &Ctx,
        p: contracts::agent::SetModelParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        {
            let set: SetModelParams = p;
            let id = set.id.clone();
            let node = self.set_model(ctx, set).await?;
            Self::touch_rail(ctx, &id)?;
            Ok(node)
        }
    }

    async fn agent_set_visibility(
        &self,
        ctx: &Ctx,
        p: contracts::agent::SetVisibilityParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        let p: contracts::agent::SetVisibilityParams = p;
        let rail = self.shared.rail();
        let node = rail.node(crate::rail::agent_id(&p.id)?)?;
        if node.kind != NodeKind::Agent
            || (ctx.actor.kind == ActorKind::Agent
                && (node.parent.as_deref() != Some(&ctx.actor.id)
                    || rail.node(crate::rail::agent_id(&ctx.actor.id)?)?.kind != NodeKind::Workstream))
        {
            return Err(RpcError::forbidden(
                "only a Door may choose visibility for its direct Agent children",
            ));
        }
        let presented = self.shared.present(
            node,
            &self.shared.runs(),
            &rail,
            crate::rail_view::finished_of(&rail, &p.id)?,
        )?;
        if p.visibility == contracts::agent::RailVisibility::Internal
            && let Some(reason) = super::rail_view::visibility_reason(&presented)
        {
            return Err(RpcError::new(code::INVALID_PARAMS, reason));
        }
        let changed = rail.set_visibility(crate::rail::agent_id(&p.id)?, p.visibility)?;
        drop(rail);
        if changed {
            ctx.touch(contracts::Verb::Wrote, &format!("agent:{}", p.id))?;
            ctx.emit(EventData::RailChanged);
        }
        self.shared.node(&p.id)
    }

    async fn agent_channel_up(
        &self,
        ctx: &Ctx,
        p: contracts::agent::NodeId,
    ) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            shared.channel_up(&ctx.actor, &id)?;
            Ok(())
        }
    }

    async fn agent_signal(
        &self,
        ctx: &Ctx,
        p: contracts::agent::SignalParams,
    ) -> Result<Option<contracts::agent::SignalOutcome>, RpcError> {
        let shared = &self.shared;
        {
            let SignalParams {
                id,
                attempt,
                payload,
            } = p;
            shared.events.inbox.scan(&id, &payload);
            shared.observe(
                ctx.actor.clone(),
                &id,
                &attempt,
                Observation::Signal(payload),
            )?;
            Ok(None::<SignalOutcome>)
        }
    }

    async fn rail_tree(&self, _ctx: &Ctx) -> Result<Vec<contracts::agent::RailNode>, RpcError> {
        self.tree()
    }

    async fn workstream_set_auto(
        &self,
        ctx: &Ctx,
        p: contracts::workstream::AutoParams,
    ) -> Result<(), RpcError> {
        {
            let choice = p;
            self.set_auto(ctx, choice)?;
            Ok(())
        }
    }

    async fn workstream_set_opening_prompt(
        &self,
        ctx: &Ctx,
        p: contracts::workstream::OpeningPromptParams,
    ) -> Result<(), RpcError> {
        self.set_opening_prompt(ctx, p)?;
        Ok(())
    }

    async fn agent_instructions(
        &self,
        ctx: &Ctx,
        p: contracts::agent::NodeId,
    ) -> Result<contracts::agent::Instructions, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            if ctx.actor.kind != ActorKind::User {
                shared.guard_reach(&ctx.actor, &id, true)?;
            }
            Ok(shared
                .rail()
                .instructions(crate::rail::agent_id(&id)?, &shared.project_dir.to_string_lossy())?)
        }
    }

    async fn agent_spawn_prompt(
        &self,
        ctx: &Ctx,
        p: contracts::agent::NodeId,
    ) -> Result<contracts::agent::SpawnPrompt, RpcError> {
        let shared = &self.shared;
        {
            let NodeId { id } = p;
            shared.guard_reach(&ctx.actor, &id, true)?;
            let rail = shared.rail();
            Ok(contracts::agent::SpawnPrompt {
                prompt: rail.spawn_prompt(crate::rail::agent_id(&id)?)?,
                role: rail.role(crate::rail::agent_id(&id)?)?,
            })
        }
    }

    async fn rail_create_workstream(
        &self,
        ctx: &Ctx,
        p: contracts::agent::CreateWorkstreamParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        self.create_workstream(ctx, p)
    }

    async fn rail_group(
        &self,
        ctx: &Ctx,
        p: contracts::agent::GroupParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user groups Rail selections"));
        }
        let selection: contracts::agent::GroupParams = p;
        let node = self.shared.rail().group(&selection.ids)?;
        Self::touch_rail(ctx, &node.id)?;
        for id in selection
            .ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
        {
            Self::touch_rail(ctx, id)?;
        }
        ctx.emit(EventData::RailChanged);
        Ok(node)
    }

    async fn rail_rename(
        &self,
        ctx: &Ctx,
        p: contracts::agent::RenameParams,
    ) -> Result<contracts::agent::RailNode, RpcError> {
        let shared = &self.shared;
        {
            let RenameParams { id, name } = p;
            shared.guard_reach(&ctx.actor, &id, true)?;
            if name.chars().count() > name::MAX_CHARS {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    format!("name is longer than {} characters", name::MAX_CHARS),
                ));
            }
            let node = {
                let mut rail = shared.rail();
                let user = ctx.actor.kind == ActorKind::User;
                // U6380c: only the user renames a row the user named.
                if !user && rail.user_named(crate::rail::agent_id(&id)?)? {
                    return Err(RpcError::forbidden(
                        "the user named this row; keep its name",
                    ));
                }
                let before = rail.node(crate::rail::agent_id(&id)?)?.name;
                let node = rail.rename(crate::rail::agent_id(&id)?, &name)?;
                if user {
                    rail.set_user_named(crate::rail::agent_id(&id)?)?;
                }
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
                if let Some(slot) = shared.runs().slot_mut(&id) {
                    slot.settle_name();
                }
                node
            };
            Self::touch_rail(ctx, &id)?;
            ctx.emit(EventData::RailChanged);
            shared.node(&node.id)
        }
    }

    async fn terminal_open(
        &self,
        _ctx: &Ctx,
        p: contracts::terminal::OpenParams,
    ) -> Result<contracts::terminal::Opened, RpcError> {
        self.open_terminal(p).await
    }

    async fn project_set_worktrees(
        &self,
        _ctx: &Ctx,
        p: contracts::project::Worktrees,
    ) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let Worktrees { on, check } = p;
            if check.as_deref() == Some("") {
                return Err(RpcError::new(
                    code::INVALID_PARAMS,
                    "check must not be empty",
                ));
            }
            shared.rail().set_worktrees(&Worktrees { on, check })?;
            Ok(())
        }
    }

    async fn project_set_mcp(
        &self,
        _ctx: &Ctx,
        p: contracts::project::Mcp,
    ) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let mcp: Mcp = p;
            shared.rail().set_mcp(&mcp)?;
            Ok(())
        }
    }

    async fn project_set_prepared(
        &self,
        _ctx: &Ctx,
        p: contracts::project::Prepared,
    ) -> Result<(), RpcError> {
        {
            self.set_prepared(p).await?;
            Ok(())
        }
    }

    async fn project_import_discover(
        &self,
        ctx: &Ctx,
        p: contracts::project::ImportDiscoverParams,
    ) -> Result<contracts::project::ImportDiscovery, RpcError> {
        {
            let params: contracts::project::ImportDiscoverParams = p;
            self.import_discover(ctx, params).await
        }
    }

    async fn project_import_commit(
        &self,
        ctx: &Ctx,
        p: contracts::project::ImportCommitParams,
    ) -> Result<contracts::project::ImportResult, RpcError> {
        {
            let params: contracts::project::ImportCommitParams = p;
            self.import_commit(ctx, params).await
        }
    }

    async fn project_prepare_directory(
        &self,
        _ctx: &Ctx,
        p: contracts::project::PrepareParams,
    ) -> Result<(), RpcError> {
        {
            let PrepareParams { path } = p;
            self.prepare_directory(&path).await?;
            Ok(())
        }
    }

    async fn project_set_models(
        &self,
        ctx: &Ctx,
        p: contracts::project::ProjectModels,
    ) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let settings: ProjectModels = p;
            models::check_settings(&settings)?;
            shared.rail().set_models(&settings)?;
            ctx.touch(contracts::Verb::Wrote, "project:models")?;
            Ok(())
        }
    }

    async fn models_list(&self, _ctx: &Ctx) -> Result<contracts::project::ModelList, RpcError> {
        // The Adapter's static table: no Project item is read, so no Touch is written to `project.db`.
        Ok(models::list())
    }

    async fn project_get(
        &self,
        _ctx: &Ctx,
    ) -> Result<contracts::project::ProjectSettings, RpcError> {
        let shared = &self.shared;
        {
            let worktrees = shared.rail().get_worktrees()?;
            let models = self.project_models()?;
            let mcp = shared.rail().get_mcp()?;
            Ok(ProjectSettings {
                worktrees,
                models,
                mcp,
                workstream_cap: shared.rail().get_workstream_cap()?,
            })
        }
    }

    async fn project_rename(
        &self,
        ctx: &Ctx,
        p: contracts::project::RenameParams,
    ) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let contracts::project::RenameParams { name } = p;
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
            Ok(())
        }
    }

    async fn rail_move(&self, ctx: &Ctx, p: contracts::agent::MoveParams) -> Result<(), RpcError> {
        let shared = &self.shared;
        {
            let MoveParams { id, parent, index } = p;
            shared.guard_reach(&ctx.actor, &id, false)?;
            shared.rail().move_node(
                crate::rail::agent_id(&id)?,
                parent.as_deref().map(crate::rail::agent_id).transpose()?,
                index,
            )?;
            Self::touch_rail(ctx, &id)?;
            ctx.emit(EventData::RailChanged);
            Ok(())
        }
    }

    async fn rail_remove_selection(
        &self,
        _ctx: &Ctx,
        _p: contracts::agent::RemoveSelectionParams,
    ) -> Result<contracts::agent::Removal, RpcError> {
        Err(RpcError::forbidden(
            "selection removal requires the Project Daemon",
        ))
    }
}
