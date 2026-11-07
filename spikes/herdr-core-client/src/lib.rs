//! Throwaway herdr-core client: JSON-RPC over `ssh <host> herdr-core connect`, plain mode for
//! `hello`, then framed mode (`[channel u32 LE][kind u8][len u32 LE][payload]`).
//! Protocol generation 1, herdr-core 0.1.18 (`schema/README.md` in github.com/herdrdev/herdr-core).
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot};

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;

pub const DATA: u8 = 0;
pub const CREDIT: u8 = 1;
pub const CLOSE: u8 = 2;
pub const RESIZE: u8 = 3;
pub const FOCUS: u8 = 4;

pub const HOST: &str = "herdr-spike.boxd";

/// What a stream channel delivers.
#[derive(Debug)]
pub enum Ev {
    Data(Vec<u8>),
    Resize(u16, u16),
    Close(Value),
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;
#[derive(Default)]
struct ChanState {
    live: HashMap<u32, mpsc::UnboundedSender<Ev>>,
    /// Frames that arrived before `attach` registered their channel (the first paint follows
    /// the reply immediately).
    orphans: HashMap<u32, Vec<Ev>>,
}
type Channels = Arc<Mutex<ChanState>>;

fn deliver(channels: &Channels, channel: u32, ev: Ev) {
    let mut state = channels.lock().unwrap();
    match state.live.get(&channel) {
        Some(tx) => {
            let _ = tx.send(ev);
        }
        None => state.orphans.entry(channel).or_default().push(ev),
    }
}

/// One connection to a herdr-core. Requests matched by id; notifications and streams fanned out.
pub struct Conn {
    out: mpsc::UnboundedSender<Vec<u8>>,
    pending: Pending,
    channels: Channels,
    next: AtomicU64,
    pub child_pid: u32,
    pub hello: Value,
    pub notes: Mutex<Option<mpsc::UnboundedReceiver<Value>>>,
    pub closed: Arc<std::sync::atomic::AtomicBool>,
    _child: Child,
}

pub fn frame(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(9 + payload.len());
    v.extend_from_slice(&channel.to_le_bytes());
    v.push(kind);
    v.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    v.extend_from_slice(payload);
    v
}

impl Conn {
    /// `ssh [extra] HOST herdr-core connect`, hello with framed mode.
    pub async fn connect() -> Result<Conn> {
        Self::connect_with(&["-T", "-o", "BatchMode=yes"], "herdr-core connect").await
    }

    pub async fn connect_with(ssh_args: &[&str], remote: &str) -> Result<Conn> {
        let mut child = Command::new("ssh")
            .args(ssh_args)
            .arg(HOST)
            .arg(remote)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(false)
            .spawn()?;
        let child_pid = child.id().ok_or("no pid")?;
        let mut stdin = child.stdin.take().ok_or("stdin")?;
        let mut reader = BufReader::new(child.stdout.take().ok_or("stdout")?);
        // Plain mode: one JSON message per line.
        stdin
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"hello\",\"params\":{\"generation\":1,\"framed\":true}}\n")
            .await?;
        let mut line = String::new();
        tokio::time::timeout(Duration::from_secs(30), reader.read_line(&mut line))
            .await
            .map_err(|_| "hello timed out")??;
        let hello: Value = serde_json::from_str(&line)?;
        let hello = hello.get("result").cloned().ok_or_else(|| format!("hello failed: {line}"))?;

        let (out, mut out_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let pending: Pending = Default::default();
        let channels: Channels = Default::default();
        let (notes_tx, notes_rx) = mpsc::unbounded_channel();
        let closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        tokio::spawn(async move {
            while let Some(bytes) = out_rx.recv().await {
                if stdin.write_all(&bytes).await.is_err() || stdin.flush().await.is_err() {
                    break;
                }
            }
        });
        let (p2, c2, o2, cl2) = (pending.clone(), channels.clone(), out.clone(), closed.clone());
        tokio::spawn(async move {
            loop {
                let mut h = [0u8; 9];
                if reader.read_exact(&mut h).await.is_err() {
                    break;
                }
                let channel = u32::from_le_bytes(h[0..4].try_into().unwrap());
                let kind = h[4];
                let len = u32::from_le_bytes(h[5..9].try_into().unwrap()) as usize;
                let mut payload = vec![0u8; len];
                if reader.read_exact(&mut payload).await.is_err() {
                    break;
                }
                if channel == 0 && kind == DATA {
                    let Ok(msg) = serde_json::from_slice::<Value>(&payload) else { continue };
                    if let Some(id) = msg.get("id").and_then(Value::as_u64) {
                        if let Some(tx) = p2.lock().unwrap().remove(&id) {
                            let _ = tx.send(msg);
                        }
                    } else {
                        let _ = notes_tx.send(msg);
                    }
                    continue;
                }
                match kind {
                    DATA => {
                        let n = payload.len() as u32;
                        deliver(&c2, channel, Ev::Data(payload));
                        // Stream bytes are consumed on arrival: hand the credit back.
                        let _ = o2.send(frame(channel, CREDIT, &n.to_le_bytes()));
                    }
                    RESIZE if payload.len() == 4 => {
                        deliver(&c2, channel, Ev::Resize(
                            u16::from_le_bytes([payload[0], payload[1]]),
                            u16::from_le_bytes([payload[2], payload[3]]),
                        ));
                    }
                    CLOSE => {
                        let reason = serde_json::from_slice(&payload).unwrap_or(Value::Null);
                        deliver(&c2, channel, Ev::Close(reason));
                    }
                    _ => {}
                }
            }
            cl2.store(true, Ordering::SeqCst);
            // Connection gone: fail every waiter and close every stream.
            p2.lock().unwrap().clear();
            for (_, tx) in c2.lock().unwrap().live.drain() {
                let _ = tx.send(Ev::Close(json!({"reason":"connection_lost"})));
            }
        });
        Ok(Conn {
            out,
            pending,
            channels,
            next: AtomicU64::new(1),
            child_pid,
            hello,
            notes: Mutex::new(Some(notes_rx)),
            closed,
            _child: child,
        })
    }

    /// Send a request, return its `result`, or the error object as `Err`.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        self.call_raw(method, params).await.and_then(|m| match m.get("error") {
            Some(e) => Err(format!("{e}").into()),
            None => Ok(m["result"].clone()),
        })
    }

    /// The whole response message (result or error).
    pub async fn call_raw(&self, method: &str, params: Value) -> Result<Value> {
        let rx = self.send_call(method, params)?;
        tokio::time::timeout(Duration::from_secs(60), rx)
            .await
            .map_err(|_| "call timed out")?
            .map_err(|_| "connection lost".into())
    }

    /// Queue a request without waiting; await the receiver for the response.
    pub fn send_call(&self, method: &str, params: Value) -> Result<oneshot::Receiver<Value>> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let body = serde_json::to_vec(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        self.out.send(frame(0, DATA, &body)).map_err(|_| "connection closed")?;
        Ok(rx)
    }

    /// `terminal.attach`: returns the channel's stream.
    pub async fn attach(&self, terminal: &str, cols: u16, rows: u16, extra: Value) -> Result<(Value, Stream)> {
        let mut params = json!({"terminal":terminal,"cols":cols,"rows":rows});
        if let Value::Object(map) = extra {
            for (k, v) in map {
                params[k] = v;
            }
        }
        let reply = self.call("terminal.attach", params).await?;
        let channel = reply["channel"].as_u64().ok_or("no channel")? as u32;
        Ok((reply, self.open_channel(channel)))
    }

    /// Register a channel the core announced in a reply (`terminal.attach`, `events.subscribe`).
    /// Frames that arrived before this call (the first paint follows the reply at once) are
    /// delivered first, in order.
    pub fn open_channel(&self, channel: u32) -> Stream {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut state = self.channels.lock().unwrap();
        for ev in state.orphans.remove(&channel).unwrap_or_default() {
            let _ = tx.send(ev);
        }
        state.live.insert(channel, tx);
        Stream { channel, rx, out: self.out.clone() }
    }

    pub fn send_frame(&self, channel: u32, kind: u8, payload: &[u8]) {
        let _ = self.out.send(frame(channel, kind, payload));
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }
}

pub struct Stream {
    pub channel: u32,
    pub rx: mpsc::UnboundedReceiver<Ev>,
    out: mpsc::UnboundedSender<Vec<u8>>,
}

impl Stream {
    pub fn send(&self, bytes: &[u8]) {
        let _ = self.out.send(frame(self.channel, DATA, bytes));
    }
    pub fn resize(&self, cols: u16, rows: u16) {
        let mut p = cols.to_le_bytes().to_vec();
        p.extend_from_slice(&rows.to_le_bytes());
        let _ = self.out.send(frame(self.channel, RESIZE, &p));
    }
    pub fn close(&self) {
        let _ = self.out.send(frame(self.channel, CLOSE, &[]));
    }
    /// Next bytes, or None when the stream closed.
    pub async fn next(&mut self) -> Option<Ev> {
        self.rx.recv().await
    }
}

pub fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}
