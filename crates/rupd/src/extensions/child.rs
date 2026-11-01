//! One Extension's child process: `node` running the runner script, JSON lines over its stdio.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{Notify, mpsc, oneshot};

const RUNNER: &str = include_str!("runner.js");
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
    pub(super) fn start(node: &OsStr, folder: &Path, module: &Path) -> std::io::Result<Started> {
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
        let stdin = process.stdin.take().expect("stdin was piped");
        let stdout = process.stdout.take().expect("stdout was piped");
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
                let Ok(message) = serde_json::from_slice::<Value>(&line) else {
                    continue;
                };
                driven.message(&message, &mut registered_tx, &calls_tx);
            }
            let _ = process.kill().await;
            let in_flight =
                std::mem::take(&mut *driven.pending.lock().expect("runs poisoned")).len();
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
        message: &Value,
        registered: &mut Option<oneshot::Sender<Registered>>,
        calls: &mpsc::UnboundedSender<Call>,
    ) {
        match message["t"].as_str() {
            Some("registered") => {
                if let Some(tx) = registered.take() {
                    let actions = message["actions"].as_array().cloned().unwrap_or_default();
                    let _ = tx.send(Ok(actions));
                }
            }
            Some("failed") => {
                if let Some(tx) = registered.take() {
                    let _ = tx.send(Err(message["cause"]
                        .as_str()
                        .unwrap_or("register failed")
                        .into()));
                }
            }
            Some("result") => {
                let Some(id) = message["id"].as_u64() else {
                    return;
                };
                let waiting = self.pending.lock().expect("runs poisoned").remove(&id);
                if let Some(waiting) = waiting {
                    let _ = waiting.send(Ran {
                        answer: Some(message["answer"].clone()).filter(|answer| !answer.is_null()),
                        failure: message["failure"].as_str().map(str::to_owned),
                    });
                }
            }
            Some("call") => {
                if let (Some(id), Some(path)) = (message["id"].as_u64(), message["path"].as_str()) {
                    let _ = calls.send(Call {
                        id,
                        path: path.into(),
                        params: message["params"].clone(),
                    });
                }
            }
            _ => {}
        }
    }

    async fn send(&self, message: &Value) -> std::io::Result<()> {
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
        self.pending.lock().expect("runs poisoned").insert(id, tx);
        if self
            .send(&json!({ "t": "run", "id": id, "name": name, "args": args }))
            .await
            .is_err()
        {
            self.pending.lock().expect("runs poisoned").remove(&id);
            return None;
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(ran)) => Some(Ok(ran)),
            Ok(Err(_)) => None,
            Err(_) => {
                self.pending.lock().expect("runs poisoned").remove(&id);
                Some(Err(()))
            }
        }
    }

    /// Answers a `$` call of the child.
    pub(super) async fn answer(&self, id: u64, answer: Result<Value, rpc::RpcError>) {
        let message = match answer {
            Ok(result) => json!({ "t": "callResult", "id": id, "result": result }),
            Err(error) => json!({ "t": "callResult", "id": id, "error": error }),
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
        line.extend_from_slice(&buffer[..room]);
        reader.consume(take);
        if done {
            return Ok(true);
        }
    }
}
