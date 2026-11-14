//! Original program completion, independent of its output.

use super::*;

/// How long `kill` waits for the core to report the program gone.
const KILL_WAIT: Duration = Duration::from_secs(10);

impl Terminals {
    /// Wait for the original program to end, independently of PTY EOF and `terminal.exited`.
    /// Unknown (including malformed) or already-ended Terminals complete immediately. Completion
    /// is retained for late callers; concurrent callers and cancellation cannot consume it.
    /// As with `program_ended`, a failure to observe the child is treated as ended.
    pub async fn wait_program_ended(&self, id: &str) {
        let ended = parse_terminal_number(id).ok().and_then(|number| {
            let table = self.shared.table().ok()?;
            table.get(&number)?;
            self.shared
                .program_ends
                .locked("terminal program ends lock")
                .ok()?
                .get(&number)
                .cloned()
        });
        let Some(mut ended) = ended else {
            return;
        };
        // A reaper that closed without publishing has ended the program all the same.
        let _ = ended.wait_for(|ended| *ended).await;
    }

    /// Stop a running Terminal's program (SIGHUP, then SIGKILL if it lingers) and return once it is
    /// stopped. It stays listed as exited once `terminal.exited` is emitted. `NOT_FOUND` as for
    /// [`Terminals::write`], including a program that ended just before this call.
    pub async fn kill(&self, id: &str) -> Result<(), RpcError> {
        Ok(self.kill_in(id).await?)
    }

    pub(super) async fn kill_in(&self, id: &str) -> Result<(), Error> {
        let handle = self.running(id)?;
        match handle
            .conn()?
            .call(
                "terminal.kill",
                serde_json::json!({"terminal": handle.core_id}),
            )
            .await
        {
            Ok(_) => {}
            Err(herdr::Error::Rpc(err)) if err.kind == "not_found" => {
                return Err(Error::not_found("running terminal"));
            }
            Err(err) => return Err(Error::core(&err)),
        }
        let mut ended = handle.ended.clone();
        tokio::time::timeout(KILL_WAIT, ended.wait_for(|ended| *ended))
            .await
            .map_err(|_| Error::internal("the program did not stop"))?
            .map_err(Error::internal)?;
        Ok(())
    }

    /// Whether Terminal `id`'s program has ended, which can be before the Terminal is exited: a
    /// descendant holding the PTY open delays `terminal.exited` on Linux. An unknown Terminal has
    /// no program running either.
    pub async fn program_ended(&self, id: &str) -> bool {
        match self.running(id) {
            Ok(handle) => *handle.ended.borrow(),
            Err(_) => true,
        }
    }
}
