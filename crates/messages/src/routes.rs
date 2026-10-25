//! Route ownership checks, persistence and change events.

use super::*;

impl Messages {
    pub(super) async fn set_route(&self, ctx: &Ctx, p: SetRouteParams) -> Result<Value, RpcError> {
        let by_agent = ctx.actor.kind == ActorKind::Agent;
        if ctx.actor.kind == ActorKind::Ext {
            return Err(RpcError::forbidden(
                "only the user or an Agent may set a Route",
            ));
        }
        if p.to == Actor::user().id {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "a Route cannot deliver to the user",
            ));
        }
        if p.from == p.to {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "a Route's from and to must differ",
            ));
        }
        let nodes = if by_agent {
            load_rail_nodes(&self.inner).await?
        } else {
            Vec::new()
        };
        let name = |id: &str| {
            if id == Actor::user().id {
                "you"
            } else {
                nodes
                    .iter()
                    .find(|node| node.id == id)
                    .map_or("an Agent that is gone", |node| node.name.as_str())
            }
        };
        {
            let store = self.store()?;
            // M14: a Route the user or an Extension set is never overridden by an Agent (B5).
            if by_agent
                && store.get_route(&p.from, &p.to)?.is_some()
                && !store.route_set_by_agent(&p.from, &p.to)?
            {
                return Err(RpcError::forbidden(format!(
                    "the Route from {} to {} was set by the user",
                    name(&p.from),
                    name(&p.to)
                )));
            }
            store.set_route(
                &p.from,
                &p.to,
                p.delivery,
                if by_agent { "agent" } else { "user" },
            )?;
        }
        if by_agent {
            ctx.touch(Verb::Wrote, &format!("route:{}>{}", p.from, p.to))?;
        }
        let route = Route {
            from: p.from,
            to: p.to,
            delivery: p.delivery,
        };
        ctx.emit(EventData::RouteChanged(route.clone()));
        reply(&route)
    }

    pub(super) fn list_routes(&self) -> Result<Value, RpcError> {
        reply(&self.store()?.list_routes()?)
    }
}
