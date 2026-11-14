//! App access to Daemon launches and global naming preferences.

use crate::Unpoisoned;
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

/// FB9: where the Daemon's stderr lines go in the App's data folder; the Daemon's Feedback report
/// reads its tail from here.
const DAEMON_LOG: &str = "rupd.log";
/// The first Daemon of a run empties the file, so it holds this run's lines only.
static LOG_STARTED: std::sync::Once = std::sync::Once::new();

fn remember(dir: Option<&Path>, line: &str) {
    use std::io::Write;
    let Some(dir) = dir else { return };
    let path = dir.join(DAEMON_LOG);
    LOG_STARTED.call_once(|| {
        let _ = std::fs::write(&path, "");
    });
    let written = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&path)
        .and_then(|mut file| writeln!(file, "{line}"));
    if let Err(err) = written {
        log::warn!(target: "roundup::shell", "write Daemon log: IO {:?}", err.kind());
    }
}

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
        let mut lines = self.0.lock().unpoisoned();
        if lines.len() == STDERR_LINES_KEPT {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    fn text(&self) -> String {
        let lines = self.0.lock().unpoisoned();
        lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

/// The `rupd <project> --attached` launch on `socket`. CH7077b: an installed build's Daemon gets
/// none of a checkout's variables, so it runs the `rup` and sidecar of its own bundle; CH7077c:
/// Dev's keeps its Terminals in its own herdr-core session.
fn command(config: &Config, project: &Path, socket: &Path, data_dir: Option<&Path>) -> Command {
    let mut command = Command::new(&config.rupd_bin);
    command
        .arg(project)
        .arg("--attached")
        .arg("--notify-bound")
        .env("RUPD_SOCKET", socket);
    if let Some(dir) = data_dir {
        command.env("ROUNDUP_DATA_DIR", dir);
    }
    if config.channel.installed() {
        for name in crate::channel::CHECKOUT_VARS {
            command.env_remove(name);
        }
    }
    if let Some(session) = config.channel.core_session() {
        command.env("RUPD_CORE_SESSION", session);
    }
    command
}

/// Starts `rupd <project> --attached` on `socket` and returns once it answers `daemon.ping`.
/// `data_dir` is the App's data folder, where the Daemon keeps the Project's data (N1).
pub async fn start(
    config: &Config,
    project: &Path,
    socket: &Path,
    data_dir: Option<&Path>,
) -> Result<Started, RpcError> {
    let mut child = command(config, project, socket, data_dir)
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            log::warn!(target: "roundup::shell", "start Project Daemon: IO {:?}", err.kind());
            RpcError::internal(format!("cannot start {}: {err}", config.rupd_bin.display()))
        })?;
    let (Some(stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return Err(RpcError::internal("the Project Daemon's pipes are missing"));
    };
    let owned_socket = OwnedSocket(socket.to_path_buf());
    let tail = StderrTail::default();
    let drain =
        tauri::async_runtime::spawn(drain(stderr, tail.clone(), data_dir.map(Path::to_path_buf)));

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
    Err(RpcError::internal(failure_text(&failure, &tail.text())))
}

/// The error's first line is all the App shows, so it leads with the Daemon's last stderr line
/// (its cause) and then the failure; the whole tail follows on the lines after it (S6123a).
fn failure_text(failure: &str, tail: &str) -> String {
    match tail.lines().rev().find(|line| !line.trim().is_empty()) {
        Some(last) => format!("{}; rupd {failure}\n{tail}", last.trim()),
        None => format!("rupd {failure}"),
    }
}

/// Sent to `watch_exit` to end the Daemon by SIGKILL, which runs none of its stop (S5981a); the
/// receiver is answered once the process is gone.
pub type Leave = tokio::sync::oneshot::Sender<tokio::sync::oneshot::Sender<()>>;

/// Calls `on_exit` with the Daemon's exit code, `None` when a signal ended it. The returned
/// `Leave` kills the Daemon without closing its stdin.
pub fn watch_exit(mut child: Child, on_exit: impl FnOnce(Option<i32>) + Send + 'static) -> Leave {
    let (leave, left) = tokio::sync::oneshot::channel::<tokio::sync::oneshot::Sender<()>>();
    tauri::async_runtime::spawn(async move {
        let mut ack = None;
        let waited = tokio::select! {
            waited = child.wait() => waited,
            Ok(answer) = left => {
                if let Err(err) = child.start_kill() {
                    log::warn!(target: "roundup::shell", "kill Daemon for update: IO {:?}", err.kind());
                }
                ack = Some(answer);
                child.wait().await
            }
        };
        if let Some(ack) = ack {
            let _ = ack.send(());
        }
        match waited {
            Ok(status) => on_exit(status.code()),
            Err(err) => {
                log::warn!(target: "roundup::shell", "wait for Daemon exit: IO {:?}", err.kind());
                on_exit(None);
            }
        }
    });
    leave
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

async fn drain(stderr: ChildStderr, tail: StderrTail, log_dir: Option<PathBuf>) {
    let mut reader = BufReader::new(stderr);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        match reader.read_until(b'\n', &mut bytes).await {
            Ok(0) => return,
            Ok(_) => {
                let line = String::from_utf8_lossy(&bytes).trim_end().to_owned();
                remember(log_dir.as_deref(), &line);
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

    #[test]
    fn fb9_the_daemon_log_holds_its_recent_stderr_lines() {
        let dir = tempfile::tempdir().unwrap();
        tauri::async_runtime::block_on(async {
            let mut child = tokio::process::Command::new("sh")
                .args(["-c", "echo fb9-marker-1 >&2; echo fb9-marker-2 >&2"])
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            let stderr = child.stderr.take().unwrap();
            super::drain(
                stderr,
                super::StderrTail::default(),
                Some(dir.path().to_path_buf()),
            )
            .await;
        });
        let text = std::fs::read_to_string(dir.path().join(super::DAEMON_LOG)).unwrap();
        assert_eq!(text, "fb9-marker-1\nfb9-marker-2\n");
    }

    #[test]
    fn s6123a_first_line_leads_with_the_last_stderr_line() {
        let failure = "exited before it answered (exit code 1)";
        let refusal = "rupd: refusing to start: x: Local data is incompatible with this build.";
        let tail = format!("warming up\n{refusal}");
        let text = super::failure_text(failure, &tail);
        let first = text.lines().next().unwrap();
        assert!(
            first.contains(refusal) && first.contains("exit code 1"),
            "{first}"
        );
        assert!(text.contains(&tail));

        let empty = super::failure_text(failure, "");
        assert!(empty.contains("exit code 1") && !empty.contains("stderr lines"));
        assert_eq!(empty.lines().count(), 1);
    }

    #[test]
    fn ch7077b_an_installed_builds_daemon_gets_its_bundles_files_and_dev_its_own_session() {
        use crate::Channel;
        let launch = |channel: Channel| {
            let mut config =
                crate::Config::locate(None, Path::new("/App/roundup"), Path::new("/tmp"), 1)
                    .unwrap();
            config.channel = channel;
            let command = super::command(&config, Path::new("/p"), Path::new("/s"), None);
            let envs: Vec<(String, Option<String>)> = command
                .as_std()
                .get_envs()
                .map(|(name, value)| {
                    let text = |s: &std::ffi::OsStr| s.to_string_lossy().into_owned();
                    (text(name), value.map(text))
                })
                .collect();
            envs
        };
        let removed =
            |envs: &[(String, Option<String>)], name: &str| envs.contains(&(name.to_owned(), None));
        let session = |envs: &[(String, Option<String>)]| {
            envs.iter()
                .find(|(name, _)| name == "RUPD_CORE_SESSION")
                .and_then(|(_, value)| value.clone())
        };
        for channel in [Channel::Stable, Channel::Dev] {
            let envs = launch(channel);
            for name in crate::channel::CHECKOUT_VARS {
                assert!(removed(&envs, name), "{channel:?} {name}");
            }
        }
        let source = launch(Channel::Source);
        assert!(!removed(&source, "ROUNDUP_RUP_BIN"));
        assert_eq!(
            session(&launch(Channel::Dev)).as_deref(),
            Some("roundup-dev")
        );
        assert_eq!(session(&launch(Channel::Stable)), None);
        assert_eq!(session(&source), None);
    }

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
