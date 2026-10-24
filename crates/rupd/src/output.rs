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
        let frame = match item {
            Output::Bytes { offset, bytes } => json!({
                "jsonrpc": "2.0",
                "method": "terminal.output",
                "params": OutputEvent { id: id.clone(), offset, data: STANDARD.encode(&bytes) },
            }),
            Output::Gap { from, to } => json!({
                "jsonrpc": "2.0",
                "method": "terminal.gap",
                "params": OutputGap { id: id.clone(), from, to },
            }),
        };
        if frames.send(frame.into()).await.is_err() {
            return;
        }
    }
}
