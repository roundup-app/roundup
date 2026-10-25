use super::*;

impl Checkpoints {
    pub(super) async fn rpc_checkpoint_write(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.write(ctx, params(value)?).await
    }

    pub(super) async fn rpc_checkpoint_list(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.list(params(value)?)
    }
}
