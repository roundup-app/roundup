use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

use crate::error::{Error, Result, RpcError};
use crate::stream::{Stream, Streams, deliver, streams};
use crate::types::{Ev, Event, Hello, Machine};
use crate::wire::{CLOSE, CREDIT, DATA, RESIZE, frame, read_frame};

/// The protocol generation roundup speaks and pins.
pub const GENERATION: u64 = 1;
/// What the remote shell runs for `connect_ssh`.
const REMOTE_CONNECT: &str = "env -i PATH=\"$PATH\" HOME=\"$HOME\" USER=\"$USER\" LOGNAME=\"$LOGNAME\" SHELL=\"$SHELL\" LANG=\"${LANG:-C.UTF-8}\" herdr-core connect";
/// Exit status of a shell that finds no `herdr-core` on its PATH.
const NOT_FOUND_EXIT: i32 = 127;

/// Waiting calls by id; `closed` is set, under the same lock, once the reader has cleared them.
#[derive(Default)]
struct Waiting {
    closed: bool,
    calls: HashMap<u64, oneshot::Sender<Value>>,
    /// Attach calls: the reader opens the reply's channel for the sender before any later frame.
    claims: HashMap<u64, mpsc::UnboundedSender<Ev>>,
}

type Pending = Arc<Mutex<Waiting>>;

/// The waiting calls hold no invariant a panicking holder could break, so a poisoned lock is used as is.
fn locked(pending: &Pending) -> std::sync::MutexGuard<'_, Waiting> {
    pending
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// One framed connection to a herdr-core. Requests match by id; events go to [`Conn::events`].
pub struct Conn {
    out: mpsc::UnboundedSender<Vec<u8>>,
    pending: Pending,
    next: AtomicU64,
    timeout: Duration,
    pub hello: Hello,
    events: Option<mpsc::UnboundedReceiver<Event>>,
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) channels: Streams,
    _child: Option<Child>,
}

impl Conn {
    /// A core on this machine: `herdr-core connect` from PATH.
    pub async fn connect_local(timeout: Duration) -> Result<Conn> {
        let mut cmd = Command::new("herdr-core");
        cmd.arg("connect");
        Self::spawn(cmd, timeout).await
    }

    /// `ssh <host> herdr-core connect`, through the user's own ssh config. The core inherits the
    /// environment of the session that starts it and gives it to every terminal, so it starts from
    /// `env -i` with only the names a program finds itself by (MC16); the remote shell fills them in.
    pub async fn connect_ssh(host: &str, timeout: Duration) -> Result<Conn> {
        let mut cmd = Command::new("ssh");
        cmd.args(["-T", "-o", "BatchMode=yes", "--", host, REMOTE_CONNECT]);
        Self::spawn(cmd, timeout).await
    }

    /// True once the pipe to the core is gone: every later call fails with `Closed`.
    pub fn is_closed(&self) -> bool {
        locked(&self.pending).closed
    }

    /// Run `cmd` as the core's pipe and say hello over it.
    pub async fn spawn(mut cmd: Command, timeout: Duration) -> Result<Conn> {
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => Error::Missing,
                _ => Error::Io(e),
            })?;
        let stdin = child.stdin.take().ok_or(Error::Closed)?;
        let stdout = child.stdout.take().ok_or(Error::Closed)?;
        match Self::over(stdout, stdin, timeout).await {
            Err(Error::Closed) => match child.wait().await {
                Ok(s) if s.code() == Some(NOT_FOUND_EXIT) => Err(Error::Missing),
                _ => Err(Error::Closed),
            },
            Ok(mut conn) => {
                conn._child = Some(child);
                Ok(conn)
            }
            Err(e) => Err(e),
        }
    }

    /// Say hello over an open pipe and switch it to frames.
    pub async fn over<R, W>(reader: R, mut writer: W, timeout: Duration) -> Result<Conn>
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let mut reader = BufReader::new(reader);
        let hello = json!({"jsonrpc":"2.0","id":0,"method":"hello","params":{"generation":GENERATION,"framed":true}});
        let mut line = serde_json::to_vec(&hello).map_err(|e| Error::Protocol(e.to_string()))?;
        line.push(b'\n');
        let say = async {
            writer.write_all(&line).await?;
            writer.flush().await?;
            let mut reply = String::new();
            match reader.read_line(&mut reply).await? {
                0 => Err(Error::Closed),
                _ => Ok(reply),
            }
        };
        let reply = tokio::time::timeout(timeout, say)
            .await
            .map_err(|_| Error::TimedOut)??;
        let msg: Value =
            serde_json::from_str(&reply).map_err(|e| Error::Protocol(e.to_string()))?;
        if let Some(e) = msg.get("error") {
            let e = RpcError::from_value(e);
            return Err(if e.kind == "unsupported_generation" {
                Error::Refused(e)
            } else {
                Error::Rpc(e)
            });
        }
        let hello: Hello =
            serde_json::from_value(msg.get("result").cloned().unwrap_or(Value::Null))
                .map_err(|e| Error::Protocol(e.to_string()))?;
        if hello.generation != GENERATION {
            let message = format!("core answered generation {}", hello.generation);
            return Err(Error::Refused(RpcError {
                code: 0,
                message,
                kind: "unsupported_generation".into(),
                hint: format!("roundup speaks generation {GENERATION}"),
            }));
        }

        let (out, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (events_tx, events) = mpsc::unbounded_channel();
        let pending: Pending = Default::default();
        tokio::spawn(async move {
            while let Some(bytes) = out_rx.recv().await {
                if writer.write_all(&bytes).await.is_err() || writer.flush().await.is_err() {
                    break;
                }
            }
        });
        let waiting = pending.clone();
        let channels: Streams = Default::default();
        let routed = channels.clone();
        let credit = out.clone();
        tokio::spawn(async move {
            while let Ok((channel, kind, payload)) = read_frame(&mut reader).await {
                if channel != 0 {
                    match kind {
                        DATA => {
                            let len = payload.len() as u32;
                            deliver(&routed, channel, Ev::Data(payload));
                            // Consumed on arrival: hand the credit back.
                            let _ = credit.send(frame(channel, CREDIT, &len.to_le_bytes()));
                        }
                        RESIZE => {
                            if let [c0, c1, r0, r1] = payload[..] {
                                deliver(
                                    &routed,
                                    channel,
                                    Ev::Resize(
                                        u16::from_le_bytes([c0, c1]),
                                        u16::from_le_bytes([r0, r1]),
                                    ),
                                );
                            }
                        }
                        CLOSE => {
                            let reason = serde_json::from_slice(&payload).unwrap_or(Value::Null);
                            deliver(&routed, channel, Ev::Close(reason));
                        }
                        _ => {}
                    }
                    continue;
                }
                if kind != DATA {
                    continue;
                }
                let Ok(msg) = serde_json::from_slice::<Value>(&payload) else {
                    continue;
                };
                if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                    let (call, claim) = {
                        let mut w = locked(&waiting);
                        (w.calls.remove(&id), w.claims.remove(&id))
                    };
                    if let Some(tx) = claim {
                        let channel = msg
                            .pointer("/result/channel")
                            .and_then(Value::as_u64)
                            .and_then(|c| u32::try_from(c).ok());
                        if let Some(channel) = channel {
                            let mut state = streams(&routed);
                            state.claim(channel, &tx);
                            state.live.insert(channel, tx);
                        }
                    }
                    if let Some(tx) = call {
                        let _ = tx.send(msg);
                    }
                } else if let Some(method) = msg.get("method").and_then(Value::as_str) {
                    let _ = events_tx.send(Event {
                        method: method.to_owned(),
                        params: msg.get("params").cloned().unwrap_or(Value::Null),
                    });
                }
            }
            // Pipe gone: dropping the senders fails every waiter with `Closed`.
            let mut w = locked(&waiting);
            w.closed = true;
            w.calls.clear();
            w.claims.clear();
            drop(w);
            let gone = serde_json::json!({"reason":"connection_lost"});
            let mut state = streams(&routed);
            state.orphans.clear();
            state.orphan_bytes = 0;
            for (_, tx) in state.live.drain() {
                let _ = tx.send(Ev::Close(gone.clone()));
            }
        });
        Ok(Conn {
            out,
            pending,
            next: AtomicU64::new(1),
            timeout,
            hello,
            events: Some(events),
            channels,
            _child: None,
        })
    }

    /// The event receiver; present once.
    pub fn events(&mut self) -> Option<mpsc::UnboundedReceiver<Event>> {
        self.events.take()
    }

    /// Wait for the answer to `id`; `Closed` once the reader has cleared `pending`.
    pub(crate) fn register(&self, id: u64) -> Result<oneshot::Receiver<Value>> {
        let (tx, rx) = oneshot::channel();
        let mut w = locked(&self.pending);
        if w.closed {
            return Err(Error::Closed);
        }
        w.calls.insert(id, tx);
        Ok(rx)
    }

    /// Send a request and return its `result`; the core's error object becomes [`Error::Rpc`].
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.call_claiming(method, params, None).await
    }

    /// [`Conn::call`], with `claim` made the live reader of the reply's channel by the reader task.
    async fn call_claiming(
        &self,
        method: &str,
        params: Value,
        claim: Option<mpsc::UnboundedSender<Ev>>,
    ) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let rx = self.register(id)?;
        if let Some(tx) = claim {
            locked(&self.pending).claims.insert(id, tx);
        }
        let body =
            serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
                .map_err(|e| Error::Protocol(e.to_string()))?;
        if self.out.send(frame(0, DATA, &body)).is_err() {
            let mut w = locked(&self.pending);
            w.calls.remove(&id);
            w.claims.remove(&id);
            return Err(Error::Closed);
        }
        let msg = match tokio::time::timeout(self.timeout, rx).await {
            Err(_) => {
                let mut w = locked(&self.pending);
                w.calls.remove(&id);
                w.claims.remove(&id);
                return Err(Error::TimedOut);
            }
            Ok(Err(_)) => return Err(Error::Closed),
            Ok(Ok(msg)) => msg,
        };
        match msg.get("error") {
            Some(e) => Err(Error::Rpc(RpcError::from_value(e))),
            None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
        }
    }

    /// `terminal.attach` as the viewer that sets the size, with `history` lines of scrollback in the
    /// first repaint. Returns the terminal's channel.
    pub async fn attach(
        &self,
        terminal: &str,
        cols: u16,
        rows: u16,
        history: u32,
    ) -> Result<Stream> {
        let (tx, rx) = mpsc::unbounded_channel();
        let reply = self
            .call_claiming(
                "terminal.attach",
                json!({"terminal":terminal,"cols":cols,"rows":rows,"history":history}),
                Some(tx),
            )
            .await?;
        let channel = reply
            .get("channel")
            .and_then(Value::as_u64)
            .and_then(|c| u32::try_from(c).ok())
            .ok_or_else(|| Error::Protocol("terminal.attach: no channel".into()))?;
        Ok(Stream {
            channel,
            rx,
            out: self.out.clone(),
        })
    }

    /// `machine.list`: herdr-core's list, as it answers.
    pub async fn machine_list(&self) -> Result<Vec<Machine>> {
        let reply = self.call("machine.list", json!({})).await?;
        let list = match reply {
            Value::Object(mut o) => o.remove("machines").unwrap_or(Value::Null),
            other => other,
        };
        serde_json::from_value(list).map_err(|e| Error::Protocol(format!("machine.list: {e}")))
    }

    /// `machine.add` for an ssh name; returns the core's answer.
    pub async fn machine_add(&self, name: &str) -> Result<Value> {
        self.call("machine.add", json!({"name": name})).await
    }
}
