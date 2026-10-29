//! Original program ownership and completion, independent of PTY output.

use super::*;

/// The program, shared by whoever reaps it and whoever stops it.
/// Invariant: only code holding this lock reaps or signals, and signals only when `try_wait` under
/// that lock has just said the program is still running. A reaped pid is never signalled.
pub(super) type Program = Arc<Mutex<Box<dyn Child + Send + Sync>>>;

impl Terminals {
    /// Wait for the original program to end, independently of PTY EOF and `terminal.exited`.
    /// Unknown (including malformed) or already-ended Terminals complete immediately. Completion
    /// is retained for late callers; concurrent callers and cancellation cannot consume it.
    /// As with `program_ended`, a failure to observe the child is treated as ended.
    pub async fn wait_program_ended(&self, id: &str) {
        if let Ok(Some(remote)) = self.remote(id) {
            let mut observe = tokio::time::interval(REAP_POLL);
            while remote
                .info_within_deadline()
                .await
                .is_ok_and(|info| info.running)
            {
                observe.tick().await;
            }
            return;
        }
        let ended = parse_terminal_number(id).ok().and_then(|number| {
            let table = self.shared.table();
            table.get(&number)?;
            self.shared
                .program_ends
                .lock()
                .expect("terminal program ends lock")
                .get(&number)
                .cloned()
        });
        let Some(mut ended) = ended else {
            return;
        };
        ended
            .wait_for(|ended| *ended)
            .await
            .expect("the reaper publishes completion before closing");
    }

    /// Stop a running Terminal's program (SIGHUP, then SIGKILL if it lingers) and return once it is
    /// stopped. It stays listed as exited once `terminal.exited` is emitted. `NOT_FOUND` as for
    /// [`Terminals::write`], including a program that ended just before this call.
    pub async fn kill(&self, id: &str) -> Result<(), RpcError> {
        if let Some(remote) = self.remote(id)? {
            return remote.call("terminal.kill", serde_json::json!({"id":id}));
        }
        let handle = self.running(id)?;
        // portable-pty's `Child::kill` waits out the SIGHUP grace period, so keep it off the runtime.
        tokio::task::spawn_blocking(move || {
            let mut program = handle.program.lock().expect("terminal program lock");
            match program.try_wait() {
                Ok(None) => program.kill().map_err(RpcError::internal)?,
                Ok(Some(_)) => return Err(RpcError::not_found("running terminal")),
                Err(err) => return Err(RpcError::internal(err)),
            }
            drop(program);
            // portable-pty returns right after SIGKILL; a second kill must already see the program gone.
            reap(&handle.program).map(drop).map_err(RpcError::internal)
        })
        .await
        .map_err(RpcError::internal)?
    }

    /// Whether Terminal `id`'s program has ended, which can be before the Terminal is exited: a
    /// descendant holding the PTY open delays `terminal.exited` on Linux. An unknown Terminal has
    /// no program running either.
    pub async fn program_ended(&self, id: &str) -> bool {
        if let Ok(Some(remote)) = self.remote(id) {
            return remote
                .info_within_deadline()
                .await
                .map_or(true, |info| !info.running);
        }
        match self.running(id) {
            Ok(handle) => handle
                .program
                .lock()
                .expect("terminal program lock")
                .try_wait()
                .map_or(true, |status| status.is_some()),
            Err(_) => true,
        }
    }
}

/// Preserve the exit-code mapping used after the PTY drains, even for an unknown ending.
pub(super) fn exit_code(
    number: u64,
    result: std::io::Result<portable_pty::ExitStatus>,
) -> Option<i32> {
    match result {
        Ok(status) if status.signal().is_some() => None,
        Ok(status) => Some(i32::try_from(status.exit_code()).unwrap_or(i32::MAX)),
        Err(err) => {
            // `None` means "killed by a signal"; an unknown ending must not look like one.
            eprintln!("terminal {number}: cannot wait for program: {err}");
            Some(-1)
        }
    }
}
