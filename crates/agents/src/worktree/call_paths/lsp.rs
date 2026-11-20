//! CP1, CP5: one language server child spoken to over stdio, framed by `lsp-server`'s messages.
//! The child leads its own process group and dies with the client, however the trace ends.

use std::io::BufReader;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, channel};
use std::time::{Duration, Instant};

use lsp_server::{Message, Notification, Request, RequestId, Response};
use serde_json::{Value, json};

/// Why a request ended without an answer.
#[derive(Debug)]
pub(super) enum Stop {
    Timeout,
    Cancelled,
    /// RA2: cargo could not read a dependency offline, with its message.
    Cargo(String),
    Error(String),
}

pub(super) struct Client {
    child: Child,
    stdin: ChildStdin,
    inbox: Receiver<Message>,
    next: i32,
    deadline: Instant,
    cancel: Arc<AtomicBool>,
    pub(super) capabilities: Value,
    /// What the server said when cargo failed offline.
    pub(super) cargo_failure: Option<String>,
}

impl Client {
    /// Start `program args` in `root` with `env` added and complete `initialize` with
    /// `options`; the whole client has until `deadline`.
    pub(super) fn start(
        program: &Path,
        args: &[&str],
        root: &Path,
        (env, options): (&[(String, String)], Value),
        deadline: Instant,
        cancel: Arc<AtomicBool>,
    ) -> Result<Self, Stop> {
        let mut child = Command::new(program)
            .args(args)
            .current_dir(root)
            .envs(env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|err| Stop::Error(format!("{}: {err}", program.display())))?;
        let stdin = child.stdin.take().ok_or(Stop::Error("no stdin".into()))?;
        let stdout = child.stdout.take().ok_or(Stop::Error("no stdout".into()))?;
        let (send, inbox) = channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            while let Ok(Some(message)) = Message::read(&mut reader) {
                if send.send(message).is_err() {
                    break;
                }
            }
        });
        let mut client = Self {
            child,
            stdin,
            inbox,
            next: 0,
            deadline,
            cancel,
            capabilities: Value::Null,
            cargo_failure: None,
        };
        let uri = uri(root);
        let init = client.request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "rootUri": uri,
                "workspaceFolders": [{"uri": uri, "name": "root"}],
                "initializationOptions": options,
                "capabilities": {"textDocument": {
                    "documentSymbol": {"hierarchicalDocumentSymbolSupport": true},
                    "callHierarchy": {"dynamicRegistration": false},
                }},
            }),
        )?;
        client.capabilities = init.get("capabilities").cloned().unwrap_or(Value::Null);
        client.notify("initialized", json!({}))?;
        Ok(client)
    }

    pub(super) fn notify(&mut self, method: &str, params: Value) -> Result<(), Stop> {
        Message::from(Notification::new(method.into(), params))
            .write(&mut self.stdin)
            .map_err(|err| Stop::Error(err.to_string()))
    }

    /// The result of `method`, answering the server's own requests with null meanwhile.
    pub(super) fn request(&mut self, method: &str, params: Value) -> Result<Value, Stop> {
        self.next += 1;
        let id = RequestId::from(self.next);
        Message::from(Request::new(id.clone(), method.into(), params))
            .write(&mut self.stdin)
            .map_err(|err| Stop::Error(err.to_string()))?;
        loop {
            if self.cancel.load(Ordering::Relaxed) {
                return Err(Stop::Cancelled);
            }
            let left = self.deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(Stop::Timeout);
            }
            match self.inbox.recv_timeout(left.min(Duration::from_millis(50))) {
                Ok(Message::Response(Response {
                    id: got,
                    response_result,
                })) if got == id => {
                    return response_result.map_err(|err| Stop::Error(err.message));
                }
                Ok(Message::Request(ask)) => {
                    Message::from(Response::new_ok(ask.id, Value::Null))
                        .write(&mut self.stdin)
                        .map_err(|err| Stop::Error(err.to_string()))?;
                }
                Ok(Message::Notification(note))
                    if note.method == "window/showMessage"
                        || note.method == "window/logMessage" =>
                {
                    let text = note
                        .params
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if text.contains("offline") || text.contains("no matching package") {
                        self.cargo_failure.get_or_insert_with(|| text.to_owned());
                    }
                }
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(Stop::Error("the language server exited".into()));
                }
            }
        }
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        // The child leads its own group, so a server's helpers die with it.
        let _ = nix::sys::signal::killpg(
            nix::unistd::Pid::from_raw(self.child.id() as i32),
            nix::sys::signal::Signal::SIGKILL,
        );
        let _ = self.child.wait();
    }
}

pub(super) fn uri(path: &Path) -> String {
    format!("file://{}", path.display())
}

pub(super) fn path_of(uri: &str) -> Option<PathBuf> {
    uri.strip_prefix("file://").map(PathBuf::from)
}
