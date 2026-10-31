//! M5159b: Claude Code's own file rewind, `claude --resume <session> --rewind-files <turn>`
//! (https://code.claude.com/docs/en/agent-sdk/file-checkpointing). It runs as a program of its own
//! beside the Agent, so nothing is typed into the Agent's Terminal (P9).

use std::path::Path;
use std::time::Duration;

use super::Launcher;

/// Under the shim's `CALL_TIMEOUT`, so the Door is told each outcome instead of losing the call.
const BUDGET: Duration = Duration::from_secs(8);

impl Launcher {
    /// Ask Claude Code to restore the files of `session` to the state at user message `turn`.
    pub async fn rewind_files(&self, session: &str, cwd: &Path, turn: &str) -> Result<(), String> {
        if !super::is_uuid(turn) {
            return Err("a Claude Code turn is the UUID of a user message".into());
        }
        let mut command = tokio::process::Command::new(&self.bin);
        command
            .args(["--resume", session, "--rewind-files", turn])
            .env("CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "1")
            .current_dir(cwd)
            .stdin(std::process::Stdio::null());
        for marker in super::MARKERS {
            command.env_remove(marker);
        }
        let output = tokio::time::timeout(BUDGET, command.output())
            .await
            .map_err(|_| {
                format!(
                    "Claude Code had not finished in {} s; the rewind may still finish",
                    BUDGET.as_secs()
                )
            })?
            .map_err(|err| format!("cannot run Claude Code `{}`: {err}", self.bin))?;
        if output.status.success() {
            return Ok(());
        }
        let said = String::from_utf8_lossy(&output.stderr);
        let said = said.trim();
        Err(if said.is_empty() {
            format!("Claude Code exited with {}", output.status)
        } else {
            said.lines().last().unwrap_or(said).to_owned()
        })
    }
}
