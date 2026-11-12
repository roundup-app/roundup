use super::*;
use contracts::agent::{CreateModeParams, ModePromptParams, Order, ResumeMode, SaveAsModeParams};

impl Agents {
    /// A5214a: the root Agent `id` becomes a Workstream in place, its conversation the Door's. A
    /// live Agent restarts once on that conversation so it launches with the Door's Brief and
    /// tools; an exited one converts without a launch. A refusal leaves the node as it was.
    pub(super) async fn make_workstream(&self, ctx: &Ctx, id: &str) -> Result<RailNode, RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user converts an Agent"));
        }
        let _lifecycle = self.shared.door_lifecycle.read().await;
        let live = {
            let mut rail = self.shared.rail();
            let node = rail.node(crate::rail::agent_id(id)?)?;
            if node.kind != NodeKind::Agent
                || node.parent.is_some()
                || node.mode_prompt.is_some()
                || !rail.has_conversation(crate::rail::agent_id(id)?)?
                || !rail.convert_kind(crate::rail::agent_id(id)?, true)?
            {
                return Err(RpcError::conflict(format!(
                    "{id} is not a root Agent with a saved conversation"
                )));
            }
            matches!(self.shared.runs().slot(id), Some(Slot::Running(run)) if !run.ended())
        };
        if live
            && let Err(error) = self
                .resume_conversation(
                    ctx,
                    id,
                    Resumption {
                        ack_bound: RESUME_ACK_BOUND,
                        conversation: None,
                        prompt: None,
                        publication: RailPublication::Immediate,
                        mode: Some(ResumeMode::Normal),
                        permission_mode: self.launcher.selected_permission_mode(id),
                        size: (80, 24),
                    },
                )
                .await
        {
            self.shared
                .rail()
                .convert_kind(crate::rail::agent_id(id)?, false)?;
            return Err(error);
        }
        ctx.emit(EventData::RailChanged);
        self.shared.node(id)
    }

    /// A5214b: a root Agent Mode holding Agent `id`'s first prompt and saved setup.
    /// The Agent is not touched.
    pub(super) async fn save_as_mode(
        &self,
        ctx: &Ctx,
        SaveAsModeParams { id, name }: SaveAsModeParams,
    ) -> Result<RailNode, RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user saves a Mode"));
        }
        let name = name.trim();
        if name.is_empty() {
            return Err(RpcError::new(code::INVALID_PARAMS, "a Mode needs a name"));
        }
        let Some(lean) = Launcher::load_lean(&self.dir, &id)? else {
            return Err(RpcError::conflict(format!(
                "{id} keeps the user's full setup: it was not started by an Agent"
            )));
        };
        let mode = {
            let mut rail = self.shared.rail();
            let agent = rail.node(crate::rail::agent_id(&id)?)?;
            if agent.kind != NodeKind::Agent || agent.mode_prompt.is_some() {
                return Err(RpcError::conflict(format!("{id} is not an ordinary Agent")));
            }
            let prompt = match &agent.work {
                Some(Order::Work { ask, .. }) if !ask.trim().is_empty() => ask.clone(),
                _ => agent.name.clone(),
            };
            rail.insert_agent(crate::rail::NewAgent {
                name,
                parent: None,
                work: None,
                start_attribution: None,
                visibility: contracts::agent::RailVisibility::default(),
                spawn_prompt: None,
                spawner: None,
                role: None,
                model: agent.model.as_deref(),
                effort: agent.effort.as_deref(),
                mode_prompt: Some(&prompt),
                machine: None,
            })?
        };
        Launcher::save_lean(&self.dir, &mode.id, &lean)?;
        ctx.emit(EventData::RailChanged);
        self.shared.node(&mode.id)
    }

    pub(super) fn create_mode(
        &self,
        ctx: &Ctx,
        CreateModeParams {
            start_attribution,
            name,
            prompt,
        }: CreateModeParams,
    ) -> Result<RailNode, RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user creates a Mode"));
        }
        let name = name.trim();
        if name.is_empty() || name.chars().count() > crate::name::MAX_CHARS {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "a Mode needs a valid name",
            ));
        }
        if prompt.trim().is_empty() {
            return Err(RpcError::new(code::INVALID_PARAMS, "a Mode needs a prompt"));
        }
        if prompt.chars().count() > contracts::agent::MODE_PROMPT_MAX {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "the Mode prompt is too long",
            ));
        }
        let mode = self.shared.rail().insert_agent(crate::rail::NewAgent {
            name,
            parent: None,
            work: None,
            start_attribution: start_attribution.as_ref(),
            visibility: contracts::agent::RailVisibility::default(),
            spawn_prompt: None,
            spawner: None,
            role: None,
            model: None,
            effort: None,
            mode_prompt: Some(&prompt),
            machine: None,
        })?;
        Self::touch_creation(ctx, &mode.id, start_attribution.as_ref())?;
        ctx.emit(EventData::RailChanged);
        self.shared.node(&mode.id)
    }

    pub(super) fn set_mode_prompt(
        &self,
        ctx: &Ctx,
        ModePromptParams { id, prompt }: ModePromptParams,
    ) -> Result<(), RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user sets a Mode prompt"));
        }
        let prompt = prompt.as_deref().filter(|text| !text.trim().is_empty());
        if prompt.is_some_and(|text| text.chars().count() > contracts::agent::MODE_PROMPT_MAX) {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "the Mode prompt is too long",
            ));
        }
        let mut rail = self.shared.rail();
        let node = rail.node(crate::rail::agent_id(&id)?)?;
        if node.kind != NodeKind::Agent || node.parent.is_some() {
            return Err(RpcError::not_found("root Agent"));
        }
        if rail.set_mode_prompt(crate::rail::agent_id(&id)?, prompt)? {
            drop(rail);
            ctx.touch(contracts::Verb::Wrote, &format!("agent:{id}"))?;
            ctx.emit(EventData::RailChanged);
        }
        Ok(())
    }
}
