//! Pad links attached to a Todo.
use contracts::todo::{RefParams, Todo, TodoId};
use contracts::{EventData, Verb};
use rpc::Ctx;

use super::{Todos, item};
use crate::error::Error;

impl Todos {
    /// T27: a link that is no Pad link is `INVALID_PARAMS` before the Todo is looked up. The Daemon has checked the Pad and heading exist (`pads::Pads::holds`).
    pub(super) async fn add_ref(&self, ctx: &Ctx, p: RefParams) -> Result<Todo, Error> {
        let link = pads::reference::parse(&p.url)
            .map_err(|why| Error::InvalidParams(format!("not a Pad link: {why}")))?;
        let store = self.store()?;
        if store.add_ref(p.id, &link.target(), &p.url)? {
            ctx.touch(Verb::Wrote, &item(p.id))?;
            ctx.emit(EventData::TodoRefAdded(TodoId { id: p.id }));
        }
        store.get(p.id)
    }

    pub(super) async fn remove_ref(&self, ctx: &Ctx, p: RefParams) -> Result<Todo, Error> {
        let link = pads::reference::parse(&p.url)
            .map_err(|why| Error::InvalidParams(format!("not a Pad link: {why}")))?;
        let store = self.store()?;
        if store.remove_ref(p.id, &link.target())? {
            ctx.touch(Verb::Wrote, &item(p.id))?;
            ctx.emit(EventData::TodoRefRemoved(TodoId { id: p.id }));
        }
        store.get(p.id)
    }
    /// T27: the links of a Todo as added, for the Daemon to read their state. It logs no Touch.
    pub(super) fn read_refs(&self, id: u32) -> Result<Vec<String>, Error> {
        let store = self.store()?;
        store.get(id)?;
        store.refs(id)
    }
}
