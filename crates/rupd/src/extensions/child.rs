//! One Extension's child process: `node` running the runner script, JSON lines over its stdio.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};

use contracts::extension::{CallError, Capability, FromExtension, ToExtension};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{Notify, mpsc, oneshot};

pub(super) const RUNNER: &str = include_str!("runner.js");
/// A line longer than this is not the protocol; the rest of it is dropped.
const LINE_CAP: usize = 1 << 20;

/// What the child made of one run.
pub(super) struct Ran {
    pub answer: Option<Value>,
    pub failure: Option<String>,
}

/// What `register` declared, or why it did not.
pub(super) type Registered = Result<Vec<Value>, String>;

/// What the child asked of the host: a `$` call to answer.
pub(super) struct Call {
    pub id: u64,
    pub path: String,
    pub params: Value,
}

pub(super) struct Child {
    pub id: u64,
    stdin: tokio::sync::Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Ran>>>,
    next: AtomicU64,
    stop: Notify,
}

/// A started child: the handle, the answer of its `register`, its calls, and its end. `ended`
/// carries how many runs were in flight when the process ended.
pub(super) struct Started {
    pub child: std::sync::Arc<Child>,
    pub registered: oneshot::Receiver<Registered>,
    pub calls: mpsc::UnboundedReceiver<Call>,
    pub ended: oneshot::Receiver<usize>,
}

static IDS: AtomicU64 = AtomicU64::new(1);

impl Child {
    pub(super) fn start(
        node: &OsStr,
        folder: &Path,
        module: &Path,
        granted: Vec<Capability>,
    ) -> std::io::Result<Started> {
        let mut process = Command::new(node)
            .arg("-e")
            .arg(RUNNER)
            .arg(module)
            .current_dir(folder)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| std::io::Error::other("stdin was not piped"))?;
        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| std::io::Error::other("stdout was not piped"))?;
        let child = std::sync::Arc::new(Self {
            id: IDS.fetch_add(1, Ordering::Relaxed),
            stdin: tokio::sync::Mutex::new(stdin),
            pending: Mutex::default(),
            next: AtomicU64::new(1),
            stop: Notify::new(),
        });
        let (registered_tx, registered) = oneshot::channel();
        let (calls_tx, calls) = mpsc::unbounded_channel();
        let (ended_tx, ended) = oneshot::channel();
        let driven = std::sync::Arc::clone(&child);
        tokio::spawn(async move {
            let mut registered_tx = Some(registered_tx);
            // EP5: first on stdin, before any run or answer can be sent.
            let _ = driven
                .send(&ToExtension::Hello {
                    offers: vec![
                        Capability::Panel,
                        Capability::Service,
                        Capability::AgentsPlace,
                        Capability::AgentsSettings,
                    ],
                    granted,
                    components: contracts::extension::COMPONENTS.map(str::to_owned).to_vec(),
                })
                .await;
            let mut lines = BufReader::new(stdout);
            let mut line = Vec::new();
            loop {
                line.clear();
                let read = tokio::select! {
                    read = read_line(&mut lines, &mut line) => read,
                    () = driven.stop.notified() => break,
                };
                if !matches!(read, Ok(true)) {
                    break;
                }
                let Ok(message) = serde_json::from_slice::<FromExtension>(&line) else {
                    continue;
                };
                driven.message(message, &mut registered_tx, &calls_tx);
            }
            let _ = process.kill().await;
            let in_flight = std::mem::take(&mut *driven.pending.lock()).len();
            let _ = ended_tx.send(in_flight);
        });
        Ok(Started {
            child,
            registered,
            calls,
            ended,
        })
    }

    fn message(
        &self,
        message: FromExtension,
        registered: &mut Option<oneshot::Sender<Registered>>,
        calls: &mpsc::UnboundedSender<Call>,
    ) {
        match message {
            FromExtension::Registered { actions } => {
                if let Some(tx) = registered.take() {
                    let _ = tx.send(Ok(actions));
                }
            }
            FromExtension::Failed { cause } => {
                if let Some(tx) = registered.take() {
                    let _ = tx.send(Err(if cause.is_empty() {
                        "register failed".into()
                    } else {
                        cause
                    }));
                }
            }
            FromExtension::Result {
                id,
                answer,
                failure,
            } => {
                let waiting = self.pending.lock().remove(&id);
                if let Some(waiting) = waiting {
                    let _ = waiting.send(Ran {
                        answer: Some(answer).filter(|answer| !answer.is_null()),
                        failure,
                    });
                }
            }
            FromExtension::Call { id, path, params } => {
                let _ = calls.send(Call { id, path, params });
            }
            FromExtension::Show { .. } | FromExtension::Health { .. } => {}
        }
    }

    async fn send(&self, message: &ToExtension) -> std::io::Result<()> {
        let mut line = serde_json::to_vec(message)?;
        line.push(b'\n');
        self.stdin.lock().await.write_all(&line).await
    }

    /// Runs `name` in the child. `None` when the child ended before it answered.
    pub(super) async fn run(
        &self,
        name: &str,
        args: Value,
        timeout: std::time::Duration,
    ) -> Option<Result<Ran, ()>> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id, tx);
        if self
            .send(&ToExtension::Run {
                id,
                name: name.into(),
                args,
            })
            .await
            .is_err()
        {
            self.pending.lock().remove(&id);
            return None;
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(ran)) => Some(Ok(ran)),
            Ok(Err(_)) => None,
            Err(_) => {
                self.pending.lock().remove(&id);
                Some(Err(()))
            }
        }
    }

    /// Answers a `$` call of the child.
    pub(super) async fn answer(&self, id: u64, answer: Result<Value, rpc::RpcError>) {
        let message = match answer {
            Ok(result) => ToExtension::CallResult {
                id,
                result: Some(result),
                error: None,
            },
            Err(error) => ToExtension::CallResult {
                id,
                result: None,
                error: Some(CallError {
                    code: error.code,
                    message: error.message,
                }),
            },
        };
        let _ = self.send(&message).await;
    }

    /// Ends the process.
    pub(super) fn stop(&self) {
        self.stop.notify_one();
    }
}

/// Reads one line into `line`, keeping at most `LINE_CAP` bytes of it. `false` at end of input.
async fn read_line(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    line: &mut Vec<u8>,
) -> std::io::Result<bool> {
    let mut any = false;
    loop {
        let buffer = reader.fill_buf().await?;
        if buffer.is_empty() {
            return Ok(any);
        }
        any = true;
        let (take, done) = match memchr::memchr(b'\n', buffer) {
            Some(at) => (at + 1, true),
            None => (buffer.len(), false),
        };
        let room = LINE_CAP.saturating_sub(line.len()).min(take);
        line.extend(buffer.iter().take(room));
        reader.consume(take);
        if done {
            return Ok(true);
        }
    }
}
