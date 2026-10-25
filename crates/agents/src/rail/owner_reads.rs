//! Schema-only read leases for Terminal ownership queries.
use std::path::{Path, PathBuf};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use rusqlite::Connection;

// R3696c: unused Projects must not pay for a Terminal-owner thread at startup.
pub(super) struct OwnerReads {
    path: PathBuf,
    worker: Option<Worker>,
}

impl OwnerReads {
    pub(super) fn open(path: &Path) -> Self {
        Self {
            path: path.to_owned(),
            worker: None,
        }
    }

    pub(super) fn wake(&mut self) {
        self.worker
            .get_or_insert_with(|| Worker::open(&self.path))
            .wake();
    }
}

// R16 attribution (#1901, r16/owner-transaction): a fresh WAL reader's lock/unlock
// syscalls dominate the owner step. A schema-only peer lets SQLite share its local
// read lock. It must never supply owner facts: the authoritative query stays fresh.
struct Worker {
    wake: Option<std::sync::mpsc::SyncSender<()>>,
    pending: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Worker {
    fn open(path: &Path) -> Self {
        let (wake, receive) = std::sync::mpsc::sync_channel(1);
        let pending = Arc::new(AtomicBool::new(false));
        let peer_pending = Arc::clone(&pending);
        let path = path.to_owned();
        let thread = std::thread::Builder::new()
            .name("Terminal owner reads".into())
            .spawn(move || {
                if let Err(error) = read_leases(&path, receive, &peer_pending) {
                    eprintln!("Terminal owner read lease stopped: {error}");
                }
            });
        let thread = match thread {
            Ok(thread) => Some(thread),
            Err(error) => {
                eprintln!("Terminal owner read lease unavailable: {error}");
                None
            }
        };
        Self {
            wake: Some(wake),
            pending,
            thread,
        }
    }

    fn wake(&self) {
        // R16 attribution (#1913): each unnecessary channel submission costs
        // 130–160 ns in the release Daemon. A pending attempt needs no further input.
        // This flag carries no owner facts and never renews the peer's deadline.
        if self.pending.load(Ordering::Relaxed) {
            return;
        }
        if !self.pending.swap(true, Ordering::Relaxed)
            && let Some(wake) = &self.wake
        {
            // A disconnected peer disables only the optimization, not the query.
            let _ = wake.try_send(());
        }
    }
}

fn read_leases(
    path: &Path,
    receive: std::sync::mpsc::Receiver<()>,
    pending: &AtomicBool,
) -> rusqlite::Result<()> {
    if receive.recv().is_err() {
        return Ok(());
    }
    let db = Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::default() & !rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    db.busy_timeout(std::time::Duration::ZERO)?;
    let mut checkpoint = db.prepare("PRAGMA wal_checkpoint(PASSIVE)")?;
    let mut begin = db.prepare("BEGIN DEFERRED")?;
    let mut schema = db.prepare("SELECT rootpage FROM sqlite_schema LIMIT 1")?;
    let mut rollback = db.prepare("ROLLBACK")?;
    loop {
        let (busy, frames, copied): (i64, i64, i64) =
            checkpoint.query_row([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        // Do not overlap leases with unfinished backfill: renewing old snapshots
        // indefinitely would starve checkpoints under sustained input and writes.
        let leased = busy == 0 && frames >= 0 && frames == copied;
        if leased {
            begin.execute([])?;
            schema.exists([])?;
        }
        // Pending wake admission stays closed for this lease, so only shutdown can
        // interrupt its deadline. A disconnected owner needs no remaining lease.
        let disconnected = matches!(
            receive.recv_timeout(std::time::Duration::from_millis(5)),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected)
        );
        if leased {
            rollback.execute([])?;
        }
        // Rearm only after rollback (or a skipped attempt's timeout), before waiting.
        // The flag synchronizes only wake admission; the channel publishes work.
        pending.store(false, Ordering::Relaxed);
        if disconnected || receive.recv().is_err() {
            return Ok(());
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.wake.take();
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            eprintln!("Terminal owner read lease thread panicked");
        }
    }
}
