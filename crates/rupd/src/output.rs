//! X14: the Terminal output a connection selected with `terminal.output`.
//!
//! Each selection has its own task and its own bounded path to the socket writer, so a connection
//! that reads slowly sees a gap in that Terminal's bytes and slows nothing else.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use contracts::terminal::{OutputEvent, OutputGap};
use serde_json::json;

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
        for task in self.0.get_mut().expect("selections lock").values() {
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
        let task = tokio::spawn(forward(id.to_owned(), stream, self.frames.clone()));
        let earlier = self
            .selected
            .0
            .lock()
            .expect("selections lock")
            .insert(id.to_owned(), task);
        if let Some(earlier) = earlier {
            earlier.abort();
        }
    }

    /// Release the selection of Terminal `id`; none selected is not an error.
    pub(crate) fn release(&self, id: &str) {
        if let Some(task) = self.selected.0.lock().expect("selections lock").remove(id) {
            task.abort();
        }
    }
}

async fn forward(id: String, mut stream: OutputStream, frames: mpsc::Sender<Frame>) {
    loop {
        let item = tokio::select! {
            _ = frames.closed() => return,
            item = stream.next() => item,
        };
        let Some(item) = item else { return };
        let frame = frame(&id, &item);
        if frames.send(frame).await.is_err() {
            return;
        }
    }
}

fn frame(id: &str, item: &Output) -> Frame {
    let frame = match item {
        Output::Bytes { offset, bytes } => json!({
            "jsonrpc": "2.0",
            "method": "terminal.output",
            "params": OutputEvent { id: id.to_owned(), offset: *offset, data: STANDARD.encode(&bytes) },
        }),
        Output::Gap { from, to } => json!({
            "jsonrpc": "2.0",
            "method": "terminal.gap",
            "params": OutputGap { id: id.to_owned(), from: *from, to: *to },
        }),
    };
    frame.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn fixture() -> (String, Output) {
        (
            "终端\"\\\n\t\0".into(),
            Output::Bytes {
                offset: 71,
                bytes: (0..8192).map(|n| n as u8).collect::<Vec<_>>().into(),
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
        let value = line_value(&frame(&id, &item).into_line().unwrap());
        assert_eq!(value, old_frame(&id, &item).into_value());
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
            line_value(&frame(&id, &gap).into_line().unwrap()),
            old_frame(&id, &gap).into_value()
        );
    }

    #[test]
    fn r5638b_output_framing_allocates_less_than_value_envelope() {
        let (id, item) = fixture();
        let (mut old, mut new) = (None, None);
        let before =
            allocation_counter::measure(|| old = Some(old_frame(&id, &item).into_line().unwrap()));
        let after =
            allocation_counter::measure(|| new = Some(frame(&id, &item).into_line().unwrap()));
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
}
