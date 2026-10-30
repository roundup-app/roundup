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
        contracts::todos_methods!(rpc::dispatch_methods, self, ctx, method, value)
    }
}

impl Todos {
    async fn rpc_todo_create(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.create(ctx, params(value)?)
    }

    async fn rpc_todo_list(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.store()?.list()?)
    }

    async fn rpc_todo_list_handed(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.store()?.list_handed()?)
    }

    async fn rpc_todo_get(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.get(ctx, params(value)?)
    }

    async fn rpc_todo_get_history(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.get_history(ctx, params(value)?)
    }

    async fn rpc_todo_read_history(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.read_history(ctx, params(value)?)
    }

    async fn rpc_todo_update(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.update(ctx, params(value)?)
    }

    async fn rpc_todo_complete(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.complete(ctx, params(value)?)
    }

    async fn rpc_todo_reopen(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.reopen(ctx, params(value)?)
    }

    async fn rpc_todo_set_blockers(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.set_blockers(ctx, params(value)?)
    }

    async fn rpc_todo_reorder(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.reorder(ctx, params(value)?)
    }

    async fn rpc_todo_assign(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.assign(ctx, params(value)?)
    }

    async fn rpc_todo_hand(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.hand(ctx, params(value)?)
    }

    async fn rpc_todo_move(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.move_to(ctx, params(value)?)
    }

    async fn rpc_todo_delete(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.delete(ctx, params(value)?)
    }

    async fn rpc_todo_deletion(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.deletion(ctx, params(value)?)
    }

    async fn rpc_todo_redo(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.redo(ctx, params(value)?)
    }

    async fn rpc_todo_restore(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.restore(ctx, params(value)?)
    }

    async fn rpc_todo_comment(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.comment(ctx, params(value)?)
    }

    async fn rpc_todo_comments(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.comments(params(value)?)
    }

    async fn rpc_todo_add_ref(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.add_ref(ctx, params(value)?)
    }

    async fn rpc_todo_remove_ref(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.remove_ref(ctx, params(value)?)
    }

    async fn rpc_todo_unread(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        self.unread()
    }

    async fn rpc_todo_mark_comments_read(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.mark_comments_read(ctx, params(value)?)
    }
}
