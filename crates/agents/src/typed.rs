//! The Rail's methods as typed functions: the Daemon calls these, and each RPC handler is a
//! parse and a reply around the same function.
use super::*;

/// The Rail's nodes, read by whoever the Daemon asks (the fixture of the Messages reply tests
/// stands in for the Agents there).
pub trait RailRead: Send + Sync {
    fn tree(&self) -> Result<Vec<RailNode>, RpcError>;
}

impl RailRead for Agents {
    fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
        Agents::tree(self)
    }
}

impl Agents {
    /// `rail.tree`: every node, each parent before its children. It waits on no file (RO2).
    pub fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
        self.shared.tree()
    }

    /// `rail.startDoor`.
    pub async fn start_door_node(
        &self,
        ctx: &Ctx,
        start: StartDoorParams,
    ) -> Result<RailNode, RpcError> {
        let id = start.id.clone();
        self.shared.guard_reach(&ctx.actor, &id, false)?;
        let door = self.start_door(ctx, start).await?;
        Self::touch_rail(ctx, &id)?;
        Ok(door)
    }

    /// `rail.createWorkstream`.
    pub fn create_workstream(
        &self,
        ctx: &Ctx,
        request: CreateWorkstreamParams,
    ) -> Result<RailNode, RpcError> {
        let shared = &self.shared;
        let CreateWorkstreamParams {
            start_attribution,
            name,
            parent,
            order,
        } = request;
        if start_attribution.is_some() && ctx.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden(
                "only the user connection supplies start attribution",
            ));
        }
        if let Some(order) = &order {
            valid_explicit_order(order)?;
        }
        let typed = ctx.actor.kind == ActorKind::User && !name::is_workstream_placeholder(&name);
        let node = shared.rail().insert_ordered(
            NodeKind::Workstream,
            &name,
            parent.as_deref(),
            None,
            order.as_ref(),
            start_attribution.as_ref(),
        )?;
        if typed {
            shared
                .rail()
                .set_user_named(crate::rail::agent_id(&node.id)?)?;
        }
        if ctx.actor.kind == ActorKind::Agent {
            shared
                .rail()
                .set_creator(crate::rail::agent_id(&node.id)?, &ctx.actor.id)?;
        }
        Self::touch_creation(ctx, &node.id, start_attribution.as_ref())?;
        ctx.emit(EventData::RailChanged);
        shared.node(crate::rail::agent_id(&node.id)?)
    }

    /// `rail.remove`: a Workstream's outcome, `None` for any other node.
    pub async fn remove_node(
        &self,
        ctx: &Ctx,
        request: contracts::agent::RemoveParams,
    ) -> Result<Option<contracts::agent::Removal>, RpcError> {
        let shared = &self.shared;
        let contracts::agent::RemoveParams {
            id,
            operation,
            scope,
        } = request;
        if operation.is_some() {
            return Err(RpcError::forbidden(
                "reversible removal requires the Project Daemon",
            ));
        }
        let scope = scope.unwrap_or_default();
        shared.guard_reach(&ctx.actor, &id, false)?;
        if scope == RemoveScope::All
            && shared.rail().node(crate::rail::agent_id(&id)?)?.kind != NodeKind::Workstream
        {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "scope all requires a Workstream",
            ));
        }
        if shared.rail().node(crate::rail::agent_id(&id)?)?.kind == NodeKind::Workstream {
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
            return Ok(Some(removal));
        }
        shared.remove(ctx.actor.clone(), &id).await?;
        Self::touch_rail(ctx, &id)?;
        Ok(None)
    }
}
