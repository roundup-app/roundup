//! X14: the Terminal output a connection selected with `terminal.output`.
//!
//! Each selection has its own task and its own bounded path to the socket writer, so a connection
//! that reads slowly sees a gap in that Terminal's bytes and slows nothing else.

use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Serialize;

use crate::connection::Frame;
use terminal::{Output, OutputStream};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// Output frames waiting for the socket writer; past this a Terminal's stream is told it lagged.
pub(crate) const PENDING_FRAMES: usize = 64;

/// A connection's output selections and the bounded path they write through.
#[derive(Clone)]
pub(crate) struct Port {
    frames: mpsc::Sender<Frame>,
    selected: Arc<Selected>,
}

#[derive(Default)]
struct Selected(Mutex<HashMap<String, JoinHandle<()>>>);

impl Drop for Selected {
    fn drop(&mut self) {
        for task in self.0.get_mut().values() {
            task.abort();
        }
    }
}

impl Port {
    pub(crate) fn new() -> (Self, mpsc::Receiver<Frame>) {
        let (frames, pending) = mpsc::channel(PENDING_FRAMES);
        (
            Self {
                frames,
                selected: Arc::default(),
            },
            pending,
        )
    }

    /// Deliver `stream` as this connection's selection of Terminal `id`, replacing an earlier one.
    pub(crate) fn select(&self, id: &str, stream: OutputStream) {
        self.select_with(id, Stream::Terminal(stream));
    }

    fn select_with(&self, id: &str, stream: Stream) {
        let task = tokio::spawn(forward(id.to_owned(), stream, self.frames.clone()));
        let earlier = self.selected.0.lock().insert(id.to_owned(), task);
        if let Some(earlier) = earlier {
            earlier.abort();
        }
    }

    /// Release the selection of Terminal `id`; none selected is not an error.
    pub(crate) fn release(&self, id: &str) {
        if let Some(task) = self.selected.0.lock().remove(id) {
            task.abort();
        }
    }
}

// The in-memory variant observes forwarding/cancellation without starting a PTY.
enum Stream {
    Terminal(OutputStream),
    #[cfg(test)]
    Memory(mpsc::Receiver<Output>),
}
impl Stream {
    async fn next(&mut self) -> Option<Output> {
        match self {
            Self::Terminal(stream) => stream.next().await,
            #[cfg(test)]
            Self::Memory(stream) => stream.recv().await,
        }
    }
}

async fn forward(id: String, mut stream: Stream, frames: mpsc::Sender<Frame>) {
    loop {
        let item = tokio::select! {
            _ = frames.closed() => return,
            item = stream.next() => item,
        };
        let Some(item) = item else { return };
        let Ok(frame) = frame(&id, &item) else { return };
        if frames.send(frame).await.is_err() {
            return;
        }
    }
}

fn frame(id: &str, item: &Output) -> serde_json::Result<Frame> {
    #[derive(Serialize)]
    struct Envelope<T> {
        jsonrpc: &'static str,
        method: &'static str,
        params: T,
    }
    #[derive(Serialize)]
    struct Bytes<'a> {
        id: &'a str,
        offset: u64,
        data: &'a str,
    }
    #[derive(Serialize)]
    struct Gap<'a> {
        id: &'a str,
        from: u64,
        to: u64,
    }
    let text = match item {
        Output::Bytes { offset, bytes } => serde_json::to_string(&Envelope {
            jsonrpc: "2.0",
            method: "terminal.output",
            params: Bytes {
                id,
                offset: *offset,
                data: &STANDARD.encode(bytes),
            },
        }),
        Output::Gap { from, to } => serde_json::to_string(&Envelope {
            jsonrpc: "2.0",
            method: "terminal.gap",
            params: Gap {
                id,
                from: *from,
                to: *to,
            },
        }),
    };
    text.map(Frame::Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts::terminal::{OutputEvent, OutputGap};
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, BufReader};

    fn fixture() -> (String, Output) {
        let mut bytes: Vec<u8> = (0..8192).map(|n| n as u8).collect();
        bytes[0] = 0xa9;
        bytes[8191] = 0xc3;
        (
            "终端\"\\\n\t\0".into(),
            Output::Bytes {
                offset: 71,
                bytes: bytes.into(),
            },
        )
    }

    fn old_frame(id: &str, item: &Output) -> Frame {
        match item {
            Output::Bytes { offset, bytes } => json!({
                "jsonrpc": "2.0", "method": "terminal.output",
                "params": OutputEvent { id: id.to_owned(), offset: *offset, data: STANDARD.encode(bytes) },
            }),
            Output::Gap { from, to } => json!({
                "jsonrpc": "2.0", "method": "terminal.gap",
                "params": OutputGap { id: id.to_owned(), from: *from, to: *to },
            }),
        }.into()
    }

    fn line_value(line: &[u8]) -> Value {
        assert_eq!(line.last(), Some(&b'\n'));
        assert_eq!(line.iter().filter(|&&b| b == b'\n').count(), 1);
        serde_json::from_slice(line).unwrap()
    }

    #[test]
    fn r5638a_output_line_preserves_bytes_and_metadata() {
        let (id, item) = fixture();
        let value = line_value(&frame(&id, &item).unwrap().into_line().unwrap());
        assert_eq!(value, old_frame(&id, &item).into_value().unwrap());
        let Output::Bytes { bytes, .. } = item else {
            unreachable!()
        };
        assert_eq!(
            STANDARD
                .decode(value["params"]["data"].as_str().unwrap())
                .unwrap(),
            &*bytes
        );
        assert!(value.get("id").is_none());
    }

    #[test]
    fn r5638a_gap_line_preserves_range() {
        let (id, _) = fixture();
        let gap = Output::Gap {
            from: (1 << 54) + 1,
            to: u64::MAX,
        };
        assert_eq!(
            line_value(&frame(&id, &gap).unwrap().into_line().unwrap()),
            old_frame(&id, &gap).into_value().unwrap()
        );
    }

    #[test]
    fn r5638b_output_framing_allocates_less_than_value_envelope() {
        let (id, item) = fixture();
        let (mut old, mut new) = (None, None);
        let before =
            allocation_counter::measure(|| old = Some(old_frame(&id, &item).into_line().unwrap()));
        let after = allocation_counter::measure(|| {
            new = Some(frame(&id, &item).unwrap().into_line().unwrap())
        });
        assert_eq!(
            line_value(old.as_ref().unwrap()),
            line_value(new.as_ref().unwrap())
        );
        eprintln!(
            "8 KiB output allocated bytes: old={} new={}",
            before.bytes_total, after.bytes_total
        );
        assert!(after.bytes_total < before.bytes_total);
    }

    #[tokio::test]
    async fn r5638f_gap_and_final_tail_survive_framing() {
        let (port, mut pending) = Port::new();
        let (tx, rx) = mpsc::channel(2);
        tx.send(Output::Gap { from: 7, to: 19 }).await.unwrap();
        tx.send(Output::Bytes {
            offset: 19,
            bytes: Arc::from(&b"tail\xc3"[..]),
        })
        .await
        .unwrap();
        drop(tx);
        port.select_with("one", Stream::Memory(rx));
        let gap = pending.recv().await.unwrap().into_value().unwrap();
        let tail = pending.recv().await.unwrap().into_value().unwrap();
        assert_eq!(
            gap,
            json!({"jsonrpc":"2.0","method":"terminal.gap","params":{"id":"one","from":7,"to":19}})
        );
        assert_eq!(tail["params"]["offset"], 19);
        assert_eq!(
            STANDARD
                .decode(tail["params"]["data"].as_str().unwrap())
                .unwrap(),
            b"tail\xc3"
        );
        let task = port.selected.0.lock().remove("one").unwrap();
        task.await.unwrap();
    }

    #[tokio::test]
    async fn r5638f_selection_cancellation_releases_only_its_stream() {
        let (port, mut pending) = Port::new();
        let (old, rx) = mpsc::channel(1);
        port.select_with("one", Stream::Memory(rx));
        let (new, rx) = mpsc::channel(1);
        port.select_with("one", Stream::Memory(rx));
        old.closed().await;
        let (other, rx) = mpsc::channel(1);
        port.select_with("two", Stream::Memory(rx));
        port.release("one");
        new.closed().await;
        assert!(!other.is_closed());
        other.send(Output::Gap { from: 3, to: 9 }).await.unwrap();
        assert_eq!(
            pending.recv().await.unwrap().into_value().unwrap()["params"]["id"],
            "two"
        );
        assert!(pending.try_recv().is_err());
        drop(port);
        other.closed().await;
        assert!(pending.recv().await.is_none());
    }

    #[tokio::test]
    async fn r5638f_reply_precedes_queued_output() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (port, pending) = Port::new();
        let output = &port.frames;
        for n in 0..64 {
            output.try_send(json!({"output": n}).into()).unwrap();
        }
        assert!(matches!(
            output.try_send(json!({}).into()),
            Err(mpsc::error::TrySendError::Full(_))
        ));
        tx.send(json!({"id":7,"result":null}).into()).unwrap();
        let (_done, finish) = tokio::sync::oneshot::channel();
        let (writer, reader) = tokio::io::duplex(65536);
        let task = tokio::spawn(crate::connection::write_frames(writer, rx, pending, finish));
        let mut lines = BufReader::new(reader).lines();
        let first: Value =
            serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(first, json!({"id":7,"result":null}));
        for n in 0..64 {
            let value: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(value, json!({"output":n}));
        }
        drop(tx);
        task.await.unwrap().unwrap();
    }
}
