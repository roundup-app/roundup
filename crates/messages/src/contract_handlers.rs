use super::*;

impl Messages {
    pub(super) async fn rpc_message_send(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.send(ctx, send_params(value)?).await
    }

    pub(super) async fn rpc_message_get(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.get(ctx, params(value)?)
    }

    pub(super) async fn rpc_message_list(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.list(ctx, params(value)?)
    }

    pub(super) async fn rpc_message_drop(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.drop_message(ctx, params(value)?).await
    }

    pub(super) async fn rpc_route_set(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.set_route(ctx, params(value)?).await
    }

    pub(super) async fn rpc_route_list(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        self.list_routes()
    }
}
