use super::*;

impl Pads {
    pub(super) async fn rpc_pad_create(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.create(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_read(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.read(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_list(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        self.list()
    }

    pub(super) async fn rpc_pad_rename(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.rename(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_write(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.write(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_append(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.append(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_append_section(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.append_section(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_reorder(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.reorder(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_move(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.move_to(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_delete(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.delete(ctx, params(value)?, deletion::cause(&ctx.actor))
    }

    pub(super) async fn rpc_pad_redo_delete(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.redo_delete(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_get_deletion(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.get_deletion(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_restore(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.restore(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_set_storage(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.set_storage(ctx, params(value)?)
    }

    pub(super) async fn rpc_pad_export(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.export(ctx, params(value)?)
    }
}
