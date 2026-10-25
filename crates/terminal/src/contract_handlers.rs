use super::*;

impl Terminals {
    pub(super) async fn rpc_terminal_spawn(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            // M14: a Terminal an Agent starts is owned by it; the user's and an Extension's is ownerless (X1).
            let spawned = if ctx.actor.kind == contracts::ActorKind::Agent {
                self.spawn_owned(params(value)?, &ctx.actor.id).await?
            } else {
                self.spawn(params(value)?).await?
            };
            reply(&TerminalId { id: spawned.id })
        }
    }

    pub(super) async fn rpc_terminal_write(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let WriteParams { id, data } = params(value)?;
            let bytes = STANDARD
                .decode(data)
                .map_err(|err| invalid(format!("data is not base64: {err}")))?;
            if ctx.actor.kind == contracts::ActorKind::Agent {
                self.write_completed(&id, bytes).await.and(reply(&()))
            } else {
                self.write(&id, &bytes).await.and(reply(&()))
            }
        }
    }

    pub(super) async fn rpc_terminal_resize(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let ResizeParams { id, cols, rows } = params(value)?;
            self.resize(&id, cols, rows).await.and(reply(&()))
        }
    }

    pub(super) async fn rpc_terminal_close(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let TerminalId { id } = params(value)?;
            self.close(&id).await.and(reply(&()))
        }
    }

    pub(super) async fn rpc_terminal_kill(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let TerminalId { id } = params(value)?;
            self.kill(&id).await.and(reply(&()))
        }
    }

    pub(super) async fn rpc_terminal_scheme(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        self.set_scheme(params(value)?).await.and(reply(&()))
    }

    pub(super) async fn rpc_terminal_show(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let TerminalId { id } = params(value)?;
            self.screen(&id)?;
            self.shared
                .bus
                .emit(Actor::daemon(), EventData::TerminalShown(TerminalId { id }));
            reply(&())
        }
    }

    pub(super) async fn rpc_terminal_list(
        &self,
        _ctx: &Ctx,
        _method: &str,
        _value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.list())
    }

    pub(super) async fn rpc_terminal_snapshot(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let TerminalId { id } = params(value)?;
            reply(&self.snapshot(&id)?)
        }
    }

    pub(super) async fn rpc_terminal_screen(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        {
            let TerminalId { id } = params(value)?;
            reply(&self.read_screen(&id, None)?)
        }
    }

    pub(super) async fn rpc_terminal_read(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.read(&params::<ReadParams>(value)?)?)
    }

    pub(super) async fn rpc_terminal_search(
        &self,
        _ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        reply(&self.search(&params::<SearchParams>(value)?)?)
    }
}
