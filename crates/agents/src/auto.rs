//! A3308: the persisted Auto choice, changed only by the user.
use super::*;
use contracts::workstream::AutoParams;

impl Agents {
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
