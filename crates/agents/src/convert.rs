use super::*;
use contracts::agent::{Order, ResumeMode, SaveAsModeParams};

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
            let node = rail.node(id)?;
            if node.kind != NodeKind::Agent
                || node.parent.is_some()
                || !rail.has_conversation(id)?
                || !rail.convert_kind(id, true)?
            {
                return Err(RpcError::conflict(format!(
                    "{id} is not a root Agent with a saved conversation"
                )));
            }
            matches!(self.shared.runs().get(id), Some(Slot::Running(run)) if !run.ended)
        };
        if live {
            if let Err(error) = self
                .resume_conversation(
                    ctx,
                    id,
                    RESUME_ACK_BOUND,
                    None,
                    None,
                    RailPublication::Immediate,
                    Some(ResumeMode::Normal),
                    self.launcher.selected_permission_mode(id),
                    (80, 24),
                )
                .await
            {
                self.shared.rail().convert_kind(id, false)?;
                return Err(error);
            }
        }
        ctx.emit(EventData::RailChanged);
        self.shared.node(id)
    }

    /// A5214b: a Mode named `name` holding Agent `id`'s first prompt, extras, Model and Effort.
    /// The Agent is not touched.
    pub(super) fn save_as_mode(
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
        let Some(lean) = Launcher::load_lean(&self.dir, &id) else {
            return Err(RpcError::conflict(format!(
                "{id} keeps the user's full setup: it was not started by an Agent"
            )));
        };
        let mode = {
            let mut rail = self.shared.rail();
            let agent = rail.node(&id)?;
            if agent.kind != NodeKind::Agent {
                return Err(RpcError::conflict(format!("{id} is not an Agent")));
            }
            let prompt = match &agent.work {
                Some(Order::Work { ask, .. }) if !ask.trim().is_empty() => ask.clone(),
                _ => agent.name.clone(),
            };
            let mode = rail.insert_ordered(NodeKind::Workstream, name, None, None, None)?;
            rail.set_opening_prompt(&mode.id, Some(&prompt))?;
            rail.set_pair(&mode.id, agent.model.as_deref(), agent.effort.as_deref())?;
            mode
        };
        Launcher::save_lean(&self.dir, &mode.id, &lean)?;
        ctx.emit(EventData::RailChanged);
        self.shared.node(&mode.id)
    }
}
