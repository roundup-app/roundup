//! Throwaway Rex client for the spike: the control and data WebSockets over a Unix socket.
//! Rex API revision 8, as the server documents it at `GET /llms.txt`.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio::net::UnixStream;
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::{WebSocketStream, client_async};

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;

pub const TERMINAL: &str = "com.superlogical.terminal";
pub const SHELL: &str = "com.superlogical.terminal.shell";

/// The socket of the user's own Rex server (the one Rex.app uses).
pub fn user_socket() -> PathBuf {
    home().join("Library/Application Support/rex/server.sock")
}

/// The `rex` CLI; not on PATH.
pub fn rex_bin() -> PathBuf {
    home().join("Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex")
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").expect("HOME"))
}

async fn websocket(
    socket: &Path,
    path: &str,
    protocol: &str,
) -> Result<WebSocketStream<UnixStream>> {
    let stream = UnixStream::connect(socket).await?;
    let mut request = format!("ws://localhost{path}").into_client_request()?;
    request
        .headers_mut()
        .insert("Sec-WebSocket-Protocol", HeaderValue::from_str(protocol)?);
    let (ws, _) = client_async(request, stream).await?;
    Ok(ws)
}

/// One control connection: requests matched to responses by id, events fanned out.
pub struct Control {
    out: mpsc::UnboundedSender<Message>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
    events: broadcast::Sender<Value>,
    next: AtomicU64,
    pub welcome: Value,
    task: tokio::task::JoinHandle<()>,
}

impl Control {
    pub async fn connect(socket: &Path, name: &str, reconnect: Option<&str>) -> Result<Self> {
        let mut ws = websocket(socket, "/api/control", "rex.control.v1").await?;
        let mut hello =
            json!({"type":"hello","api_revision":8,"client":{"kind":"other","name":name}});
        if let Some(token) = reconnect {
            hello["reconnect_token"] = json!(token);
        }
        ws.send(Message::text(hello.to_string())).await?;
        let welcome: Value = loop {
            match ws.next().await {
                Some(Ok(Message::Text(text))) => break serde_json::from_str(&text)?,
                Some(Ok(_)) => continue,
                Some(Err(err)) => return Err(err.into()),
                None => return Err("control closed before welcome".into()),
            }
        };
        if welcome["type"] != "welcome" || welcome["protocol"] != "rex.control.v1" {
            return Err(format!("not a welcome: {welcome}").into());
        }
        let (mut sink, mut stream) = ws.split();
        let (out, mut queued) = mpsc::unbounded_channel::<Message>();
        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>> = Arc::default();
        let (events, _) = broadcast::channel(8192);
        let (answers, published) = (pending.clone(), events.clone());
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    message = queued.recv() => {
                        let Some(message) = message else { break };
                        let close = matches!(message, Message::Close(_));
                        if sink.send(message).await.is_err() || close { break }
                    }
                    message = stream.next() => match message {
                        Some(Ok(Message::Text(text))) => {
                            let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                            match value["type"].as_str() {
                                Some("response") => {
                                    let id = value["id"].as_str().unwrap_or_default().to_owned();
                                    if let Some(answer) = answers.lock().expect("pending").remove(&id) {
                                        let _ = answer.send(value);
                                    }
                                }
                                Some("event") => { let _ = published.send(value); }
                                _ => {}
                            }
                        }
                        Some(Ok(_)) => {}
                        _ => break,
                    }
                }
            }
        });
        Ok(Self {
            out,
            pending,
            events,
            next: AtomicU64::new(1),
            welcome,
            task,
        })
    }

    pub fn client_id(&self) -> String {
        self.welcome["client"]["id"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }

    pub fn reconnect_token(&self) -> String {
        self.welcome["client"]["reconnect_token"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }

    pub fn events(&self) -> broadcast::Receiver<Value> {
        self.events.subscribe()
    }

    /// Send a request and wait for its full response (payload or error).
    pub async fn request(&self, method: &str, payload: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed).to_string();
        let (answer, response) = oneshot::channel();
        self.pending
            .lock()
            .expect("pending")
            .insert(id.clone(), answer);
        let request = json!({"type":"request","id":id,"method":method,"payload":payload});
        self.out.send(Message::text(request.to_string()))?;
        Ok(tokio::time::timeout(Duration::from_secs(10), response).await??)
    }

    /// As `request`, but an `error` response is an `Err`.
    pub async fn call(&self, method: &str, payload: Value) -> Result<Value> {
        let response = self.request(method, payload).await?;
        if let Some(error) = response.get("error") {
            return Err(format!("{method}: {error}").into());
        }
        Ok(response["payload"].clone())
    }

    pub async fn terminal(
        &self,
        session: &str,
        block: &str,
        method: &str,
        args: Value,
    ) -> Result<Value> {
        self.call(
            &format!("{TERMINAL}.{method}"),
            json!({"session_id":session,"block_id":block,"args":args}),
        )
        .await
    }

    /// Close with a close frame: the server ends this client at once.
    pub async fn close(self) {
        let _ = self.out.send(Message::Close(None));
        let _ = self.task.await;
    }

    /// Drop the socket with no close frame, as a crash would: the server keeps the client 60 s.
    pub fn crash(self) {
        self.task.abort();
    }
}

/// Wait for the first `block_event` named `name` from `block`, returning its payload.
pub async fn block_event(
    events: &mut broadcast::Receiver<Value>,
    block: &str,
    name: &str,
    within: Duration,
) -> Result<Value> {
    tokio::time::timeout(within, async {
        loop {
            let event = events.recv().await?;
            let inner = &event["payload"]["payload"]["event"];
            if inner["type"] == "block_event"
                && inner["payload"]["block_id"] == block
                && inner["payload"]["name"] == name
            {
                return Ok(inner["payload"]["payload"].clone());
            }
        }
    })
    .await?
}

/// One data connection: the stream of a block's bytes, with its resume state.
pub struct Data {
    ws: WebSocketStream<UnixStream>,
    pub token: [u8; 16],
    pub nonce: u64,
    pub keep_ms: u32,
    /// Stream bytes this client has used, across every connection of the stream.
    pub received: u64,
    pub close: Option<(u16, String)>,
}

impl Data {
    pub async fn open(socket: &Path, ticket: &str) -> Result<Self> {
        let mut hello = vec![0x01];
        hello.extend(URL_SAFE_NO_PAD.decode(ticket)?);
        Self::handshake(socket, hello, 0).await
    }

    pub async fn resume(socket: &Path, token: [u8; 16], received: u64) -> Result<Self> {
        let mut hello = vec![0x02];
        hello.extend(token);
        hello.extend(received.to_le_bytes());
        Self::handshake(socket, hello, received).await
    }

    async fn handshake(socket: &Path, hello: Vec<u8>, received: u64) -> Result<Self> {
        let mut ws = websocket(socket, "/api/data", "rex.data.terminal.v1").await?;
        ws.send(Message::binary(hello)).await?;
        loop {
            match ws.next().await {
                Some(Ok(Message::Binary(bytes))) => {
                    if bytes.first() == Some(&0x82) {
                        return Err(
                            format!("REJECT 0x{:02x}", bytes.get(1).copied().unwrap_or(0)).into(),
                        );
                    }
                    if bytes.len() != 32 || bytes[0] != 0x81 {
                        return Err(format!("not a WELCOME: {bytes:02x?}").into());
                    }
                    return Ok(Self {
                        ws,
                        token: bytes[1..17].try_into()?,
                        keep_ms: u32::from_le_bytes(bytes[20..24].try_into()?),
                        nonce: u64::from_le_bytes(bytes[24..32].try_into()?),
                        received,
                        close: None,
                    });
                }
                Some(Ok(Message::Close(frame))) => {
                    return Err(format!("closed in handshake: {frame:?}").into());
                }
                Some(Ok(_)) => continue,
                Some(Err(err)) => return Err(err.into()),
                None => return Err("data closed in handshake".into()),
            }
        }
    }

    /// The next stream bytes, or `None` once the server closed the connection.
    pub async fn next(&mut self) -> Option<Vec<u8>> {
        loop {
            match self.ws.next().await {
                Some(Ok(Message::Binary(bytes))) => {
                    self.received += bytes.len() as u64;
                    return Some(bytes.to_vec());
                }
                Some(Ok(Message::Close(frame))) => {
                    self.close = frame.map(|f| (u16::from(f.code), f.reason.to_string()));
                    return None;
                }
                Some(Ok(_)) => continue,
                _ => return None,
            }
        }
    }

    /// Close with status 1000, which ends the stream on the server.
    pub async fn end(mut self) {
        let _ = self
            .ws
            .close(Some(CloseFrame {
                code: CloseCode::Normal,
                reason: "".into(),
            }))
            .await;
    }
}

/// What a terminal stream holds, in order.
#[derive(Debug)]
pub enum Piece {
    /// Part of the Ghostty snapshot that starts every stream.
    Snapshot(Vec<u8>),
    /// Bytes the program printed.
    Program(Vec<u8>),
    /// A Rex message (`ESC _ rex1;<nonce>;<json> ESC \`) with this stream's nonce.
    Rex(Value),
}

/// Splits a terminal stream into snapshot, program bytes and Rex messages. The snapshot ends at
/// the first Rex message, the `resize` the server sends right after it.
pub struct Splitter {
    prefix: Vec<u8>,
    held: Vec<u8>,
    snapshot: bool,
}

impl Splitter {
    pub fn new(nonce: u64) -> Self {
        Self {
            prefix: format!("\x1b_rex1;{nonce};").into_bytes(),
            held: Vec::new(),
            snapshot: true,
        }
    }

    /// For a resumed stream: no snapshot comes first.
    pub fn resumed(nonce: u64) -> Self {
        Self {
            snapshot: false,
            ..Self::new(nonce)
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<Piece> {
        self.held.extend_from_slice(bytes);
        let mut pieces = Vec::new();
        loop {
            match find(&self.held, &self.prefix) {
                Some(start) => {
                    self.emit(start, &mut pieces);
                    let body = self.prefix.len();
                    let Some(end) = find(&self.held[body..], b"\x1b\\") else {
                        break;
                    };
                    let message = serde_json::from_slice(&self.held[body..body + end])
                        .unwrap_or_else(|_| json!({"unparsed": String::from_utf8_lossy(&self.held[body..body + end])}));
                    self.held.drain(..body + end + 2);
                    self.snapshot = false;
                    pieces.push(Piece::Rex(message));
                }
                None => {
                    let keep = (1..self.prefix.len().min(self.held.len() + 1))
                        .rev()
                        .find(|n| self.held.ends_with(&self.prefix[..*n]))
                        .unwrap_or(0);
                    self.emit(self.held.len() - keep, &mut pieces);
                    break;
                }
            }
        }
        pieces
    }

    fn emit(&mut self, len: usize, pieces: &mut Vec<Piece>) {
        if len == 0 {
            return;
        }
        let bytes: Vec<u8> = self.held.drain(..len).collect();
        pieces.push(if self.snapshot {
            Piece::Snapshot(bytes)
        } else {
            Piece::Program(bytes)
        });
    }
}

pub fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Open a stream for `block` on an attached control connection.
pub async fn stream(control: &Control, socket: &Path, session: &str, block: &str) -> Result<Data> {
    let ticket = control
        .call(
            "data.connect",
            json!({"session_id":session,"block_id":block,"data_ref_id":"terminal","subprotocol":"rex.data.terminal.v1"}),
        )
        .await?;
    Data::open(socket, ticket["ticket"].as_str().ok_or("ticket")?).await
}

/// Run the `rex` CLI against `socket`; returns stdout.
pub fn rex(socket: &Path, args: &[&str]) -> Result<String> {
    let output = std::process::Command::new(rex_bin())
        .arg("-S")
        .arg(format!("unix://{}", socket.display()))
        .arg("--autostart=false")
        .args(args)
        .output()?;
    if !output.status.success() {
        return Err(format!("rex {args:?}: {}", String::from_utf8_lossy(&output.stderr)).into());
    }
    Ok(String::from_utf8(output.stdout)?)
}
