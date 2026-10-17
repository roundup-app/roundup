use super::*;

impl Agents {
    /// A36, M12: check a call's Model and Effort and settle the pair `role` starts on: the call's
    /// own, else the Project's. An Agent's call may not set an Effort.
    pub(super) fn choose(
        &self,
        actor: &Actor,
        role: Role,
        model: Option<String>,
        effort: Option<String>,
    ) -> Result<Pair, RpcError> {
        models::check_listed(model.as_deref(), effort.as_deref())?;
        let project = self.project_models()?;
        if actor.kind == ActorKind::Agent {
            models::check_agents_choice(effort.as_deref())?;
        }
        Ok(models::resolve(&project, role, model, effort))
    }

    pub(super) fn project_models(&self) -> Result<ProjectModels, RpcError> {
        let roles: Vec<&str> = Role::ALL.iter().map(|role| role.id()).collect();
        self.shared.rail().get_models(&roles)
    }

    /// A37: change the Model and Effort of node `id`. A live Agent is stopped and resumed once on
    /// the new pair; any other only stores it.
    pub(super) async fn set_model(
        &self,
        ctx: &Ctx,
        SetModelParams {
            id,
            model,
            effort,
            confirmed,
        }: SetModelParams,
    ) -> Result<RailNode, RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user changes an Agent's model: it spends the user's usage",
            ));
        }
        if !confirmed {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "confirmed must be true: the Agent re-reads its conversation on the new model",
            ));
        }
        let id = id.as_str();
        models::check_listed(model.as_deref(), effort.as_deref())?;
        let kind = self.shared.rail().node(id)?.kind;
        let role = match kind {
            NodeKind::Workstream => Role::Door,
            NodeKind::Agent => Role::Agent,
        };
        let pair = models::resolve(&self.project_models()?, role, model, effort);
        let held = self.shared.node(id)?;
        if (&held.model, &held.effort) == (&pair.model, &pair.effort) {
            return Ok(held);
        }
        let live = held.channel.is_some();
        if live && !self.shared.rail().has_conversation(id)? {
            return Err(RpcError::conflict(format!(
                "{id} has no saved conversation yet to resume on the new model"
            )));
        }
        if live {
            self.shared.stop(ctx.actor.clone(), id).await?;
        }
        self.shared
            .rail()
            .set_pair(id, pair.model.as_deref(), pair.effort.as_deref())?;
        if live {
            let bound = match kind {
                NodeKind::Workstream => START_DOOR_ACK_BOUND,
                _ => RESUME_ACK_BOUND,
            };
            self.resume_saved(ctx, id, bound).await?;
        }
        ctx.emit(EventData::RailChanged);
        self.shared.node(id)
    }
}
