//! A3308: the persisted Auto choice, changed only by the user.
use super::*;
use contracts::workstream::AutoParams;

impl Agents {
    /// A4452c: the user's saved opening prompt; an Agent, a Message and an Ask cannot set it.
    pub(super) fn set_opening_prompt(
        &self,
        ctx: &Ctx,
        choice: contracts::workstream::OpeningPromptParams,
    ) -> Result<(), RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user sets the opening prompt"));
        }
        let text = choice
            .prompt
            .as_deref()
            .filter(|text| !text.trim().is_empty());
        if text.is_some_and(|text| text.chars().count() > contracts::workstream::OPENING_PROMPT_MAX)
        {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "the opening prompt is too long",
            ));
        }
        let mut rail = self.shared.rail();
        if rail.node(&choice.id)?.kind != NodeKind::Workstream {
            return Err(RpcError::not_found("Workstream"));
        }
        if rail.set_opening_prompt(&choice.id, text)? {
            drop(rail);
            ctx.emit(EventData::RailChanged);
        }
        Ok(())
    }

    pub(super) fn set_auto(&self, ctx: &Ctx, choice: AutoParams) -> Result<(), RpcError> {
        if ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user changes Auto"));
        }
        let mut rail = self.shared.rail();
        let node = rail.node(&choice.id)?;
        if node.kind != NodeKind::Workstream {
            return Err(RpcError::not_found("Workstream"));
        }
        if rail.set_auto(&choice.id, choice.auto)? {
            ctx.emit(EventData::WorkstreamUpdated(choice));
        }
        Ok(())
    }
}
