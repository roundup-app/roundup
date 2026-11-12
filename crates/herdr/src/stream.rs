use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use crate::types::Ev;
use crate::wire::{CLOSE, DATA, RESIZE, frame};

/// Live channels by number. The first paint follows an attach reply at once, so frames for a
/// channel nobody has opened yet wait in `orphans`, in order.
#[derive(Default)]
pub(crate) struct Channels {
    pub(crate) live: HashMap<u32, mpsc::UnboundedSender<Ev>>,
    pub(crate) orphans: HashMap<u32, Vec<Ev>>,
    /// Data bytes kept in `orphans`, bounded by [`MAX_ORPHAN_BYTES`].
    pub(crate) orphan_bytes: usize,
}

/// The most Data bytes kept across channels nobody has claimed; a frame past it is dropped.
pub(crate) const MAX_ORPHAN_BYTES: usize = 4 << 20;

impl Channels {
    /// Free what is kept for `channel`.
    pub(crate) fn free(&mut self, channel: u32) {
        for ev in self.orphans.remove(&channel).unwrap_or_default() {
            if let Ev::Data(d) = ev {
                self.orphan_bytes -= d.len();
            }
        }
    }

    /// Hand `channel`'s kept frames to a reader, in order.
    pub(crate) fn claim(&mut self, channel: u32, tx: &mpsc::UnboundedSender<Ev>) {
        for ev in self.orphans.remove(&channel).unwrap_or_default() {
            if let Ev::Data(d) = &ev {
                self.orphan_bytes -= d.len();
            }
            let _ = tx.send(ev);
        }
    }

    #[cfg(test)]
    pub(crate) fn unclaimed(&self) -> (usize, usize) {
        (self.orphans.values().map(Vec::len).sum(), self.orphan_bytes)
    }
}

pub(crate) type Streams = Arc<Mutex<Channels>>;

pub(crate) fn streams(channels: &Streams) -> std::sync::MutexGuard<'_, Channels> {
    channels
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub(crate) fn deliver(channels: &Streams, channel: u32, ev: Ev) {
    let mut state = streams(channels);
    match state.live.get(&channel) {
        Some(tx) => {
            let _ = tx.send(ev);
        }
        None => match ev {
            // An unclaimed channel that closes will never be attached.
            Ev::Close(_) => state.free(channel),
            Ev::Data(d) if state.orphan_bytes + d.len() > MAX_ORPHAN_BYTES => {}
            ev => {
                if let Ev::Data(d) = &ev {
                    state.orphan_bytes += d.len();
                }
                state.orphans.entry(channel).or_default().push(ev);
            }
        },
    }
}

/// One attached terminal channel: its bytes in, and the viewer's input and size out.
pub struct Stream {
    pub(crate) channel: u32,
    pub(crate) rx: mpsc::UnboundedReceiver<Ev>,
    pub(crate) out: mpsc::UnboundedSender<Vec<u8>>,
}

impl Stream {
    /// Type `bytes` through the fast stream.
    pub fn send(&self, bytes: &[u8]) {
        let _ = self.out.send(frame(self.channel, DATA, bytes));
    }

    /// Take the terminal's size (the last active non-observer sets it).
    pub fn resize(&self, cols: u16, rows: u16) {
        let mut p = cols.to_le_bytes().to_vec();
        p.extend_from_slice(&rows.to_le_bytes());
        let _ = self.out.send(frame(self.channel, RESIZE, &p));
    }

    /// Detach; the program keeps running.
    pub fn close(&self) {
        let _ = self.out.send(frame(self.channel, CLOSE, &[]));
    }

    /// The next event, or `None` once the channel is closed and drained.
    pub async fn next(&mut self) -> Option<Ev> {
        self.rx.recv().await
    }

    /// [`Stream::next`] for a thread that is not on the runtime.
    pub fn blocking_next(&mut self) -> Option<Ev> {
        self.rx.blocking_recv()
    }
}
