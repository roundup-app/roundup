//! App access to Daemon launches and global naming preferences.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rpc::{Client, RpcError};
pub(crate) use rupd::data::naming_settings;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

use crate::config::Config;

const STDERR_LINES_KEPT: usize = 20;
/// A grandchild that inherited the Daemon's stderr can hold the pipe open after the Daemon is gone.
const STDERR_DRAIN_BOUND: Duration = Duration::from_secs(1);

pub struct Started {
    pub client: Client,
    /// Kept open and never written: its closing is how the Daemon learns the App is gone (D1).
    pub stdin: ChildStdin,
    pub child: Child,
    pub socket: OwnedSocket,
}

/// The socket file this App's Daemon creates; removed when the App is done with the Daemon, so a
/// crashed Daemon's leftover path never makes the next run's bind fail.
pub struct OwnedSocket(PathBuf);

impl OwnedSocket {
    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for OwnedSocket {
    fn drop(&mut self) {
        match std::fs::remove_file(&self.0) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                log::warn!(target: "roundup::shell", "remove Daemon socket: IO {:?}", err.kind())
            }
        }
    }
}

#[derive(Clone, Default)]
struct StderrTail(Arc<Mutex<VecDeque<String>>>);

impl StderrTail {
    fn push(&self, line: String) {
        let mut lines = self.0.lock().expect("stderr tail lock");
        if lines.len() == STDERR_LINES_KEPT {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    fn text(&self) -> String {
        let lines = self.0.lock().expect("stderr tail lock");
        lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

/// Starts `rupd <project> --attached` on `socket` and returns once it answers `daemon.ping`.
/// `data_dir` is the App's data folder, where the Daemon keeps the Project's data (N1).
pub async fn start(
    config: &Config,
    project: &Path,
    socket: &Path,
    data_dir: Option<&Path>,
) -> Result<Started, RpcError> {
    let mut command = Command::new(&config.rupd_bin);
    command
        .arg(project)
        .arg("--attached")
        .arg("--notify-bound")
        .env("RUPD_SOCKET", socket);
    if let Some(dir) = data_dir {
        command.env("ROUNDUP_DATA_DIR", dir);
    }
    if let Some(helper) = &config.terminal_owner {
        command.env("RUPD_TERMINAL_OWNER", helper);
    }
    let mut child = command
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            log::warn!(target: "roundup::shell", "start Project Daemon: IO {:?}", err.kind());
            RpcError::internal(format!("cannot start {}: {err}", config.rupd_bin.display()))
        })?;
    let stdin = child.stdin.take().expect("stdin was requested piped");
    let stdout = child.stdout.take().expect("stdout was requested piped");
    let stderr = child.stderr.take().expect("stderr was requested piped");
    let owned_socket = OwnedSocket(socket.to_path_buf());
    let tail = StderrTail::default();
    let drain = tauri::async_runtime::spawn(drain(stderr, tail.clone()));

    let failure = tokio::select! {
        status = child.wait() => match status {
            Ok(status) => format!("exited before it answered ({})", describe(status)),
            Err(err) => format!("could not be waited on: {err}"),
        },
        ready = timeout(config.ready_bound, connect_after_bound(stdout, socket)) => match ready {
            Ok(Ok(client)) => return Ok(Started { client, stdin, child, socket: owned_socket }),
            Ok(Err(failure)) => failure,
            Err(_) => format!("did not answer daemon.ping within {:?}", config.ready_bound),
        },
    };
    if let Err(err) = child.kill().await {
        log::warn!(target: "roundup::shell", "stop refused Daemon: IO {:?}", err.kind());
    }
    // The drain ends when the pipe closes; if it does not, the tail is as complete as it will get.
    let _ = timeout(STDERR_DRAIN_BOUND, drain).await;
    Err(RpcError::internal(format!(
        "rupd {failure}; its last stderr lines:\n{}",
        tail.text()
    )))
}

/// Calls `on_exit` with the Daemon's exit code, `None` when a signal ended it.
pub fn watch_exit(mut child: Child, on_exit: impl FnOnce(Option<i32>) + Send + 'static) {
    tauri::async_runtime::spawn(async move {
        match child.wait().await {
            Ok(status) => on_exit(status.code()),
            Err(err) => {
                log::warn!(target: "roundup::shell", "wait for Daemon exit: IO {:?}", err.kind());
                on_exit(None);
            }
        }
    });
}

fn describe(status: ExitStatus) -> String {
    status.code().map_or_else(
        || "ended by a signal".to_owned(),
        |code| format!("exit code {code}"),
    )
}

/// STARTUP.md's notification permits a connection attempt; only ping proves readiness.
async fn connect_after_bound(mut stdout: ChildStdout, socket: &Path) -> Result<Client, String> {
    let mut signal = [0; 11];
    stdout
        .read_exact(&mut signal)
        .await
        .map_err(|err| format!("could not read bound notification: {err}"))?;
    if &signal != b"rupd-bound\n" {
        return Err("sent an invalid bound notification".to_owned());
    }
    drop(stdout);
    let client = Client::connect(socket)
        .await
        .map_err(|err| format!("could not connect after bound notification: {err}"))?;
    client
        .request("daemon.ping", Value::Null)
        .await
        .map_err(|err| format!("did not answer daemon.ping after bound notification: {err}"))?;
    Ok(client)
}

async fn drain(stderr: ChildStderr, tail: StderrTail) {
    let mut reader = BufReader::new(stderr);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes).await {
            Ok(0) => return,
            Ok(_) => {
                let line = String::from_utf8_lossy(&bytes).trim_end().to_owned();
                tail.push(line);
            }
            Err(err) => {
                log::warn!(target: "roundup::shell", "read Daemon stderr: IO {:?}", err.kind());
                return;
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::Path;

    // Keep attempted launches at the audited Daemon owner, using only the caller's temp folder.
    pub(crate) fn refuse_missing_executable(
        app: &tauri::AppHandle<tauri::test::MockRuntime>,
        dir: &Path,
        data: &Path,
    ) {
        let project = dir.join("project");
        std::fs::create_dir(&project).unwrap();
        let config = crate::Config::locate(
            Some(data.join("missing-rupd").into_os_string()),
            std::path::Path::new("/unused/roundup"),
            dir,
            std::process::id(),
        )
        .unwrap();
        let state = crate::AppState::new(config);
        assert!(tauri::async_runtime::block_on(state.open_project(app, &project)).is_err());
    }
}
