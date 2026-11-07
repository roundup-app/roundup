//! The one client of herdr-core's public JSON-RPC (generation 1, 0.1.x): plain-mode `hello`, then
//! frames `[channel u32 LE][kind u8][len u32 LE][payload]` with channel 0 carrying JSON-RPC.
//! A core is reached through a local program or `ssh <host> herdr-core connect`, never a port.
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

/// The protocol generation roundup speaks and pins.
pub const GENERATION: u64 = 1;
const DATA: u8 = 0;
/// Exit status of a shell that finds no `herdr-core` on its PATH.
const NOT_FOUND_EXIT: i32 = 127;

/// herdr-core's error object: `code`, and `data.kind` and `data.hint`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub hint: String,
}

impl RpcError {
    fn from_value(v: &Value) -> RpcError {
        let text = |p: &str| v["data"][p].as_str().unwrap_or_default().to_owned();
        RpcError {
            code: v["code"].as_i64().unwrap_or_default(),
            message: v["message"].as_str().unwrap_or_default().to_owned(),
            kind: text("kind"),
            hint: text("hint"),
        }
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} ({}, {}): {}",
            self.message, self.code, self.kind, self.hint
        )
    }
}

/// Why a core could not be read. Each cause is its own variant.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// `herdr-core` is not on the host's PATH (or the local program does not exist).
    #[error("herdr-core is missing")]
    Missing,
    /// The core refused the protocol generation, or answered one other than ours.
    #[error("herdr-core refused protocol generation {GENERATION}: {0}")]
    Refused(RpcError),
    /// The pipe closed before or during the call.
    #[error("connection to herdr-core closed")]
    Closed,
    /// No answer within the timeout.
    #[error("herdr-core did not answer")]
    TimedOut,
    /// The core answered the call with an error.
    #[error("herdr-core error: {0}")]
    Rpc(RpcError),
    /// The core said something outside the protocol.
    #[error("herdr-core protocol error: {0}")]
    Protocol(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl Error {
    /// The code a caller returns for this cause.
    pub fn code(&self) -> &'static str {
        match self {
            Error::Missing => "core_missing",
            Error::Refused(_) => "unsupported_generation",
            Error::Closed => "core_closed",
            Error::TimedOut => "core_silent",
            Error::Rpc(_) => "core_error",
            Error::Protocol(_) => "core_protocol",
            Error::Io(_) => "core_io",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// One machine as herdr-core lists it; fields beyond `name` are kept as sent.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct Machine {
    pub name: String,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

/// A notification from the core (a message without an id).
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub method: String,
    pub params: Value,
}

/// What `hello` answered.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Hello {
    pub generation: u64,
    pub version: String,
    #[serde(default)]
    pub methods: Vec<Value>,
}

/// Waiting calls by id; `closed` is set, under the same lock, once the reader has cleared them.
#[derive(Default)]
struct Waiting {
    closed: bool,
    calls: HashMap<u64, oneshot::Sender<Value>>,
}

type Pending = Arc<Mutex<Waiting>>;

/// The longest frame payload read; a longer header is a corrupt or hostile stream.
const MAX_FRAME: usize = 16 << 20;

/// One framed connection to a herdr-core. Requests match by id; events go to [`Conn::events`].
pub struct Conn {
    out: mpsc::UnboundedSender<Vec<u8>>,
    pending: Pending,
    next: AtomicU64,
    timeout: Duration,
    pub hello: Hello,
    events: Option<mpsc::UnboundedReceiver<Event>>,
    _child: Option<Child>,
}

fn frame(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(9 + payload.len());
    v.extend_from_slice(&channel.to_le_bytes());
    v.push(kind);
    v.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    v.extend_from_slice(payload);
    v
}

impl Conn {
    /// A core on this machine: `herdr-core connect` from PATH.
    pub async fn connect_local(timeout: Duration) -> Result<Conn> {
        let mut cmd = Command::new("herdr-core");
        cmd.arg("connect");
        Self::spawn(cmd, timeout).await
    }

    /// `ssh <host> herdr-core connect`, through the user's own ssh config.
    pub async fn connect_ssh(host: &str, timeout: Duration) -> Result<Conn> {
        let mut cmd = Command::new("ssh");
        cmd.args([
            "-T",
            "-o",
            "BatchMode=yes",
            "--",
            host,
            "herdr-core connect",
        ]);
        Self::spawn(cmd, timeout).await
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
        let hello: Hello = serde_json::from_value(msg["result"].clone())
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
        tokio::spawn(async move {
            while let Ok((channel, kind, payload)) = read_frame(&mut reader).await {
                if channel != 0 || kind != DATA {
                    continue;
                }
                let Ok(msg) = serde_json::from_slice::<Value>(&payload) else {
                    continue;
                };
                if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                    if let Some(tx) = waiting.lock().unwrap().calls.remove(&id) {
                        let _ = tx.send(msg);
                    }
                } else if let Some(method) = msg["method"].as_str() {
                    let _ = events_tx.send(Event {
                        method: method.to_owned(),
                        params: msg["params"].clone(),
                    });
                }
            }
            // Pipe gone: dropping the senders fails every waiter with `Closed`.
            let mut w = waiting.lock().unwrap();
            w.closed = true;
            w.calls.clear();
        });
        Ok(Conn {
            out,
            pending,
            next: AtomicU64::new(1),
            timeout,
            hello,
            events: Some(events),
            _child: None,
        })
    }

    /// The event receiver; present once.
    pub fn events(&mut self) -> Option<mpsc::UnboundedReceiver<Event>> {
        self.events.take()
    }

    /// Wait for the answer to `id`; `Closed` once the reader has cleared `pending`.
    fn register(&self, id: u64) -> Result<oneshot::Receiver<Value>> {
        let (tx, rx) = oneshot::channel();
        let mut w = self.pending.lock().unwrap();
        if w.closed {
            return Err(Error::Closed);
        }
        w.calls.insert(id, tx);
        Ok(rx)
    }

    /// Send a request and return its `result`; the core's error object becomes [`Error::Rpc`].
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let rx = self.register(id)?;
        let body =
            serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
                .map_err(|e| Error::Protocol(e.to_string()))?;
        if self.out.send(frame(0, DATA, &body)).is_err() {
            self.pending.lock().unwrap().calls.remove(&id);
            return Err(Error::Closed);
        }
        let msg = match tokio::time::timeout(self.timeout, rx).await {
            Err(_) => {
                self.pending.lock().unwrap().calls.remove(&id);
                return Err(Error::TimedOut);
            }
            Ok(Err(_)) => return Err(Error::Closed),
            Ok(Ok(msg)) => msg,
        };
        match msg.get("error") {
            Some(e) => Err(Error::Rpc(RpcError::from_value(e))),
            None => Ok(msg["result"].clone()),
        }
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

async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<(u32, u8, Vec<u8>)> {
    let mut h = [0u8; 9];
    r.read_exact(&mut h).await?;
    let channel = u32::from_le_bytes([h[0], h[1], h[2], h[3]]);
    let len = u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize;
    if len > MAX_FRAME {
        return Err(Error::Protocol(format!(
            "frame of {len} bytes exceeds the {MAX_FRAME} byte cap"
        )));
    }
    let mut payload = vec![0u8; len];
    r.read_exact(&mut payload).await?;
    Ok((channel, h[4], payload))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, duplex};

    fn header(len: u32) -> Vec<u8> {
        let mut h = vec![0u8; 5];
        h.extend_from_slice(&len.to_le_bytes());
        h
    }

    #[tokio::test]
    async fn mc47_an_oversized_frame_is_a_protocol_error() {
        let mut r = &header(u32::MAX)[..];
        match read_frame(&mut r).await {
            Err(Error::Protocol(m)) => assert!(m.contains(&u32::MAX.to_string())),
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn mc47_a_frame_at_the_cap_is_read() {
        let mut bytes = header(MAX_FRAME as u32);
        bytes.extend((0..MAX_FRAME).map(|i| (i % 251) as u8));
        let mut r = &bytes[..];
        let (_, _, p) = read_frame(&mut r).await.unwrap();
        assert!(p.iter().enumerate().all(|(i, b)| *b == (i % 251) as u8) && p.len() == MAX_FRAME);
    }

    async fn closed_conn() -> Conn {
        let (mac_r, mut core_w) = duplex(1 << 16);
        let (core_r, mac_w) = duplex(1 << 16);
        let core = tokio::spawn(async move {
            let mut r = tokio::io::BufReader::new(core_r);
            let mut line = String::new();
            r.read_line(&mut line).await.unwrap();
            let hello =
                r#"{"id":0,"jsonrpc":"2.0","result":{"generation":1,"version":"0","methods":[]}}"#;
            core_w
                .write_all(format!("{hello}\n").as_bytes())
                .await
                .unwrap();
        });
        let conn = Conn::over(mac_r, mac_w, Duration::from_secs(5))
            .await
            .unwrap();
        core.await.unwrap();
        // A waiter fails once the reader has cleared `pending`, so `closed` is set after it.
        if let Ok(rx) = conn.register(0) {
            assert!(rx.await.is_err());
        }
        conn
    }

    #[tokio::test]
    async fn mc48_a_call_after_the_pipe_closed_is_closed_not_timed_out() {
        let conn = closed_conn().await;
        let t = std::time::Instant::now();
        assert!(matches!(
            conn.call("machine.list", json!({})).await,
            Err(Error::Closed)
        ));
        assert!(t.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn mc48_a_call_registered_after_the_clear_is_closed() {
        let conn = closed_conn().await;
        assert!(matches!(conn.register(99), Err(Error::Closed)));
    }
}
