//! Original program ownership and completion, independent of PTY output.

use super::*;
use portable_pty::Child;

/// The program, shared by whoever reaps it and whoever stops it.
/// Invariant: only code holding this lock reaps or signals, and signals only when `try_wait` under
/// that lock has just said the program is still running. A reaped pid is never signalled.
pub(super) type Program = Arc<Mutex<Box<dyn Child + Send + Sync>>>;

impl Terminals {
    /// Stop a running Terminal's program (SIGHUP, then SIGKILL if it lingers) and return once it is
    /// stopped. It stays listed as exited once `terminal.exited` is emitted. `NOT_FOUND` as for
    /// [`Terminals::write`], including a program that ended just before this call.
    pub async fn kill(&self, id: &str) -> Result<(), RpcError> {
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
    pub fn program_ended(&self, id: &str) -> bool {
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

/// Wait for the program to end without holding the lock while it runs, so `kill` can take it.
pub(super) fn reap(program: &Program) -> std::io::Result<portable_pty::ExitStatus> {
    loop {
        let status = program.lock().expect("terminal program lock").try_wait()?;
        match status {
            Some(status) => return Ok(status),
            None => std::thread::sleep(REAP_POLL),
        }
    }
}
