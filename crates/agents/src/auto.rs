//! A3308: the persisted Auto choice, changed only by the user.
use super::*;
use contracts::workstream::AutoParams;

impl Agents {
    pub(super) fn set_auto(&self, ctx: &Ctx, choice: AutoParams) -> Result<(), RpcError> {
        let mut rail = self.shared.rail();
        let node = rail.node(crate::rail::agent_id(&choice.id)?)?;
        if node.kind() != NodeKind::Workstream {
            return Err(RpcError::not_found("Workstream"));
        }
        if let Some(id) = AgentId::parse(&choice.id)
            && rail.set_auto(id, choice.auto)?
        {
            ctx.emit(EventData::WorkstreamUpdated(choice));
        }
        Ok(())
    }
}
