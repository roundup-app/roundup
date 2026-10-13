//! P14: an Agent a `pads.db` from before bound to a Pad leaves the Rail, with its Terminal stopped (S5).

use contracts::{Actor, EventData};
use rpc::{Module, RpcError};
use serde_json::json;

use super::Daemon;

impl Daemon {
    /// Removes each of the Agents `pads` handed over at `open` that is still in the Rail; once.
    pub(crate) async fn remove_old_bound_agents(&self) -> Result<(), RpcError> {
        let ids = std::mem::take(
            &mut *self
                .old_bound
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
        if ids.is_empty() {
            return Ok(());
        }
        let ctx = self.ctx(Actor::user());
        let nodes = self.rail().await?;
        for id in ids
            .iter()
            .filter(|id| nodes.iter().any(|node| &node.id == *id))
        {
            self.agents
                .call(&ctx, "rail.remove", json!({ "id": id }))
                .await?;
        }
        ctx.emit(EventData::RailChanged);
        Ok(())
    }
}
