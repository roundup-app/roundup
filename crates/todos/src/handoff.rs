//! T25, T26: the Daemon hands an idle Agent its next owned Todo.
use contracts::EventData;
use contracts::todo::{HandParams, Todo};
use rpc::Ctx;

use super::Todos;
use crate::error::Error;

impl Todos {
    /// T25, T26: only the Daemon hands; the Change is written before any Message is sent.
    pub(crate) async fn hand(&self, ctx: &Ctx, p: HandParams) -> Result<Option<Todo>, Error> {
        if ctx.actor != contracts::Actor::daemon() {
            return Err(Error::Forbidden("only the Daemon hands a Todo".into()));
        }
        let handed = self
            .store()?
            .hand(&p.agent, ctx.touches.sequence()?, &ctx.actor)?;
        if let Some(todo) = &handed {
            ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        }
        Ok(handed)
    }
}
