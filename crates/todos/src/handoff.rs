//! T25, T26: the Daemon hands an idle Agent its next owned Todo.
use contracts::EventData;
use contracts::todo::HandParams;
use rpc::{Ctx, RpcError, reply};
use serde_json::Value;

use super::Todos;

impl Todos {
    /// T25, T26: only the Daemon hands; the Change is written before any Message is sent.
    pub(crate) fn hand(&self, ctx: &Ctx, p: HandParams) -> Result<Value, RpcError> {
        if ctx.actor != contracts::Actor::daemon() {
            return Err(RpcError::new(
                rpc::code::FORBIDDEN,
                "only the Daemon hands a Todo",
            ));
        }
        let handed = self.store()?.hand(
            &p.agent,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        if let Some(todo) = &handed {
            ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        }
        reply(&handed)
    }
}
