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
            let received = (self.shared.clock)();
            let WriteParams { id, data } = params(value)?;
            let bytes = STANDARD
                .decode(data)
                .map_err(|err| invalid(format!("data is not base64: {err}")))?;
            if ctx.actor.kind == contracts::ActorKind::Agent {
                self.write_completed(&id, bytes).await.and(reply(&()))
            } else {
                self.write_at(&id, &bytes, received).and(reply(&()))
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
        reply(&self.list().await)
    }

    pub(super) async fn rpc_terminal_catch_up(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        if ctx.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden(
                "only the App may catch up raw Terminal output",
            ));
        }
        reply(&self.catch_up(&params(value)?)?)
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

impl Terminals {
    pub(super) async fn rpc_terminal_measure(
        &self,
        ctx: &Ctx,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        if ctx.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden("only the user may record keystrokes"));
        }
        let contracts::terminal::MeasureParams { id, run } = params(value)?;
        let handle = self.running(&id)?;
        let recording = recorder::Recording::new(&run)?;
        let recorder = handle.recorder.get_or_init(|| Mutex::new(recording));
        let recorder = recorder.lock().expect("recorder lock");
        if recorder.run != run {
            return Err(RpcError::conflict("Terminal already records another run"));
        }
        reply(&contracts::terminal::Measurement {
            at: (self.shared.clock)(),
            samples: recorder.samples(),
        })
    }
}
