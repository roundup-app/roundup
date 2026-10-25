//! RPC method dispatch for Todos.
use rpc::{Ctx, RpcError, params, reply};
use serde_json::Value;

use super::Todos;

impl Todos {
    pub(super) async fn dispatch(
        &self,
        ctx: &Ctx,
        method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        match method {
            "todo.create" => self.create(ctx, params(value)?),
            "todo.list" => reply(&self.store()?.list()?),
            "todo.listHanded" => reply(&self.store()?.list_handed()?),
            "todo.get" => self.get(ctx, params(value)?),
            "todo.getHistory" => self.get_history(ctx, params(value)?),
            "todo.readHistory" => self.read_history(ctx, params(value)?),
            "todo.update" => self.update(ctx, params(value)?),
            "todo.complete" => self.complete(ctx, params(value)?),
            "todo.reopen" => self.reopen(ctx, params(value)?),
            "todo.setBlockers" => self.set_blockers(ctx, params(value)?),
            "todo.reorder" => self.reorder(ctx, params(value)?),
            "todo.assign" => self.assign(ctx, params(value)?),
            "todo.hand" => self.hand(ctx, params(value)?),
            "todo.move" => self.move_to(ctx, params(value)?),
            "todo.delete" => self.delete(ctx, params(value)?),
            "todo.deletion" => self.deletion(ctx, params(value)?),
            "todo.restore" => self.restore(ctx, params(value)?),
            "todo.comment" => self.comment(ctx, params(value)?),
            "todo.comments" => self.comments(params(value)?),
            "todo.addRef" => self.add_ref(ctx, params(value)?),
            "todo.removeRef" => self.remove_ref(ctx, params(value)?),
            "todo.unread" => self.unread(),
            "todo.markCommentsRead" => self.mark_comments_read(ctx, params(value)?),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}
