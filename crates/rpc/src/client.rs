use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use contracts::Event;
use contracts::terminal::{OutputEvent, OutputGap};
use serde::Serialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::net::unix::OwnedWriteHalf;
use tokio::sync::{broadcast, mpsc, oneshot};

use crate::error::{RpcError, code};

mod frame;

/// X14: what a connection that selected a Terminal with `terminal.output` is pushed.
#[derive(Clone, Debug)]
pub enum OutputFrame {
    /// Bytes the Terminal's program wrote.
    Bytes(OutputEvent),
    /// The Daemon dropped bytes `from..to` for this connection; recover with `terminal.snapshot`.
    Gap(OutputGap),
}

type Waiter = oneshot::Sender<Result<Value, RpcError>>;

/// `pending` and `closed` share one lock: `reserve` and `mark_closed` each hold it across their
/// whole read-decide-write step, so a request can never land between the Client deciding the
/// connection is open and `read_loop` actually clearing `pending`.
#[derive(Default)]
struct Shared {
    pending: HashMap<u64, Waiter>,
    closed: bool,
    output: Option<broadcast::Sender<OutputFrame>>,
}

type State = Arc<Mutex<Shared>>;

/// A persistent connection: concurrent requests, plus pushed events after `events.subscribe`.
pub struct Client {
    writer: tokio::sync::Mutex<OwnedWriteHalf>,
    state: State,
    next_id: AtomicU64,
    events: mpsc::UnboundedReceiver<Event>,
    reader: Option<tokio::task::JoinHandle<()>>,
}

impl Client {
    pub async fn connect(socket: &Path) -> io::Result<Self> {
        let (read, writer) = UnixStream::connect(socket).await?.into_split();
        let state = State::default();
        let (event_tx, events) = mpsc::unbounded_channel();
        let reader = tokio::spawn(read_loop(
            BufReader::new(read),
            Arc::clone(&state),
            event_tx,
        ));
        Ok(Self {
            writer: tokio::sync::Mutex::new(writer),
            state,
            next_id: AtomicU64::new(1),
            events,
            reader: Some(reader),
        })
    }

    /// Receive the Terminal output this connection selects with `terminal.output`.
    ///
    /// Call once, before sending `terminal.output`; output pushed before this call is dropped.
    /// Returns `None` if already taken or the connection closed. Retains at most 64 frames
    /// (an item bound, not a byte/RSS bound).
    ///
    /// Saturation evicts the oldest frames and reports Tokio's `RecvError::Lagged`.
    /// On lag, callers must recover by snapshot, reconciling the Terminal's byte offsets
    /// rather than concatenating discontinuous output. Replies and events continue
    /// independently and are never evicted.
    ///
    /// Dropping the receiver releases retained output; future output is discarded.
    /// Drop the Client to release its socket and, at the Daemon, every selection it made.
    pub fn take_output(&mut self) -> Option<broadcast::Receiver<OutputFrame>> {
        let mut state = self.state.lock().ok()?;
        if state.closed || state.output.is_some() {
            return None;
        }
        let (sender, receiver) = broadcast::channel(64);
        state.output = Some(sender);
        Some(receiver)
    }

    pub async fn request(&self, method: &str, params: impl Serialize) -> Result<Value, RpcError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        reserve(&self.state, id, tx)?;
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(err) = self
            .writer
            .lock()
            .await
            .write_all(format!("{line}\n").as_bytes())
            .await
        {
            self.state
                .lock()
                .map_err(RpcError::internal)?
                .pending
                .remove(&id);
            return Err(RpcError::internal(format!(
                "the request was not sent: {err}"
            )));
        }
        match rx.await {
            Ok(outcome) => outcome,
            Err(_) => Err(RpcError::unknown_outcome(
                "the connection closed before the reply; the Daemon may have run the call",
            )),
        }
    }

    /// The next pushed event; `None` once the connection closes.
    pub async fn next_event(&mut self) -> Option<Event> {
        self.events.recv().await
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        if let Some(reader) = self.reader.take() {
            reader.abort();
        }
        mark_closed(&self.state);
    }
}

/// Reserves `id` in `pending` unless `mark_closed` already ran. Holding the lock across the
/// check and the insert is what makes the two mutually exclusive with `mark_closed`'s own
/// lock-parked clear: a reservation always either completes before the clear (and is woken by
/// it, below) or is refused, never both.
fn reserve(state: &State, id: u64, tx: Waiter) -> Result<(), RpcError> {
    let mut state = state.lock().map_err(RpcError::internal)?;
    if state.closed {
        return Err(RpcError::internal(
            "the connection is already closed; the request was not sent",
        ));
    }
    state.pending.insert(id, tx);
    Ok(())
}

/// Marks the connection closed and drops every still-pending sender, under the same lock
/// `reserve` checks. A dropped sender resolves its `request` as `UNKNOWN_OUTCOME` instead of
/// leaving it waiting on a reply `read_loop` has already stopped listening for.
fn mark_closed(state: &State) {
    if let Ok(mut state) = state.lock() {
        state.closed = true;
        state.pending.clear();
        state.output.take();
    }
}

async fn read_loop(
    reader: BufReader<tokio::net::unix::OwnedReadHalf>,
    state: State,
    events: mpsc::UnboundedSender<Event>,
) {
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(frame::Parsed(mut frame)) = serde_json::from_str::<frame::Parsed>(&line) else {
            eprintln!("rpc: dropped a frame that is not JSON");
            continue;
        };
        if matches!(
            frame["method"].as_str(),
            Some("terminal.output" | "terminal.gap")
        ) {
            let params = frame.get_mut("params").map_or(Value::Null, Value::take);
            let parsed = if frame["method"] == "terminal.output" {
                serde_json::from_value(params).map(OutputFrame::Bytes)
            } else {
                serde_json::from_value(params).map(OutputFrame::Gap)
            };
            match parsed {
                Ok(output) => {
                    if let Some(sender) = &state.lock().expect("Client state poisoned").output {
                        let _ = sender.send(output);
                    }
                }
                Err(err) => {
                    eprintln!("rpc: dropped output that does not match the contract: {err}")
                }
            }
            continue;
        }
        if frame["method"] == "event" {
            match serde_json::from_value::<Event>(
                frame.get_mut("params").map_or(Value::Null, Value::take),
            ) {
                Ok(event) => {
                    let _ = events.send(event);
                }
                Err(err) => {
                    eprintln!("rpc: dropped an event that does not match the contract: {err}")
                }
            }
            continue;
        }
        let Some(id) = frame["id"].as_u64() else {
            continue;
        };
        let outcome = match frame.get_mut("error") {
            Some(error) => Err(serde_json::from_value(error.take())
                .unwrap_or_else(|_| RpcError::new(code::INTERNAL, "malformed error reply"))),
            None => Ok(frame.get_mut("result").map_or(Value::Null, Value::take)),
        };
        if let Some(waiter) = state.lock().ok().and_then(|mut s| s.pending.remove(&id)) {
            let _ = waiter.send(outcome);
        }
    }
    mark_closed(&state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn c1_a_reservation_made_before_close_is_woken_instead_of_left_pending() {
        let state = State::default();
        let (tx, rx) = oneshot::channel();

        reserve(&state, 1, tx).unwrap();
        mark_closed(&state);

        assert!(state.lock().unwrap().pending.is_empty());
        let outcome = tokio::time::timeout(Duration::from_millis(200), rx)
            .await
            .expect("closing must drop the sender, not strand the waiter forever");
        assert!(
            outcome.is_err(),
            "a dropped sender resolves the receiver as Err, which request() turns into UNKNOWN_OUTCOME"
        );
    }

    #[tokio::test]
    async fn c1_a_reservation_made_after_close_is_refused_instead_of_racing_the_clear() {
        let state = State::default();
        mark_closed(&state);

        let (tx, _rx) = oneshot::channel();
        let err = reserve(&state, 1, tx).unwrap_err();

        assert_eq!(err.code, code::INTERNAL);
        assert!(state.lock().unwrap().pending.is_empty());
    }

    #[tokio::test]
    async fn a_write_failure_removes_the_reservation_instead_of_leaking_it() {
        let (a, b) = UnixStream::pair().unwrap();
        drop(b);
        let (_read, writer) = a.into_split();
        let (_event_tx, events) = mpsc::unbounded_channel();
        let client = Client {
            writer: tokio::sync::Mutex::new(writer),
            state: State::default(),
            next_id: AtomicU64::new(1),
            events,
            reader: None,
        };

        let err = client
            .request("daemon.ping", Value::Null)
            .await
            .unwrap_err();

        assert_eq!(err.code, code::INTERNAL);
        assert!(err.message.contains("not sent"), "{}", err.message);
        assert!(
            client.state.lock().unwrap().pending.is_empty(),
            "a failed write must not leak a reservation that nothing will ever remove"
        );
    }
}
