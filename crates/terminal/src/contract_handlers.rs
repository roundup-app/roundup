use super::*;
use contracts::terminal::{
    CatchUp, CatchUpParams, MeasureParams, Measurement, Read as ReadReply, Screen,
    Search as SearchReply,
};

impl Terminals {
    pub(super) async fn spawn_terminal(
        &self,
        ctx: &Ctx,
        p: SpawnParams,
    ) -> Result<TerminalId, RpcError> {
        // M14: a Terminal an Agent starts is owned by it; the user's and an Extension's is ownerless (X1).
        let spawned = if ctx.actor.kind == contracts::ActorKind::Agent {
            self.spawn_owned(p, &ctx.actor.id).await?
        } else {
            self.spawn(p).await?
        };
        Ok(TerminalId { id: spawned.id })
    }

    pub(super) async fn write_terminal(&self, ctx: &Ctx, p: WriteParams) -> Result<(), RpcError> {
        let received = (self.shared.clock)();
        let WriteParams { id, data } = p;
        let bytes = STANDARD
            .decode(data)
            .map_err(|err| invalid(format!("data is not base64: {err}")))?;
        if ctx.actor.kind == contracts::ActorKind::Agent {
            self.write_completed(&id, bytes).await
        } else {
            Ok(self.write_at(&id, &bytes, received)?)
        }
    }

    pub(super) async fn resize_terminal(
        &self,
        _ctx: &Ctx,
        p: ResizeParams,
    ) -> Result<(), RpcError> {
        self.resize(&p.id, p.cols, p.rows).await
    }

    pub(super) async fn close_terminal(&self, _ctx: &Ctx, p: TerminalId) -> Result<(), RpcError> {
        self.close(&p.id).await
    }

    pub(super) async fn kill_terminal(&self, _ctx: &Ctx, p: TerminalId) -> Result<(), RpcError> {
        self.kill(&p.id).await
    }

    pub(super) async fn scheme_terminal(&self, _ctx: &Ctx, p: SchemeParams) -> Result<(), RpcError> {
        self.set_scheme(p).await
    }

    pub(super) async fn show_terminal(&self, _ctx: &Ctx, p: TerminalId) -> Result<(), RpcError> {
        self.screen(&p.id)?;
        self.shared.bus.emit(
            Actor::daemon(),
            EventData::TerminalShown(TerminalId { id: p.id }),
        );
        Ok(())
    }

    pub(super) async fn list_terminals(&self, _ctx: &Ctx) -> Result<Vec<TerminalInfo>, RpcError> {
        Ok(self.list().await)
    }

    pub(super) async fn catch_up_terminal(
        &self,
        ctx: &Ctx,
        p: CatchUpParams,
    ) -> Result<CatchUp, RpcError> {
        if ctx.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden(
                "only the App may catch up raw Terminal output",
            ));
        }
        self.catch_up(&p)
    }

    pub(super) async fn snapshot_terminal(
        &self,
        _ctx: &Ctx,
        p: TerminalId,
    ) -> Result<Snapshot, RpcError> {
        self.snapshot(&p.id)
    }

    pub(super) async fn screen_terminal(
        &self,
        _ctx: &Ctx,
        p: TerminalId,
    ) -> Result<Screen, RpcError> {
        self.read_screen(&p.id, None)
    }

    pub(super) async fn read_terminal(
        &self,
        _ctx: &Ctx,
        p: ReadParams,
    ) -> Result<ReadReply, RpcError> {
        self.read(&p)
    }

    pub(super) async fn search_terminal(
        &self,
        _ctx: &Ctx,
        p: SearchParams,
    ) -> Result<SearchReply, RpcError> {
        self.search(&p)
    }

    pub(super) async fn measure_terminal(
        &self,
        ctx: &Ctx,
        p: MeasureParams,
    ) -> Result<Measurement, RpcError> {
        if ctx.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden("only the user may record keystrokes"));
        }
        let MeasureParams { id, run } = p;
        let handle = self.running(&id)?;
        let recording = recorder::Recording::new(&run)?;
        let recorder = handle.recorder.get_or_init(|| Mutex::new(recording));
        let recorder = recorder.locked("recorder lock")?;
        if recorder.run != run {
            return Err(RpcError::conflict("Terminal already records another run"));
        }
        Ok(Measurement {
            at: (self.shared.clock)(),
            samples: recorder.samples()?,
        })
    }
}
