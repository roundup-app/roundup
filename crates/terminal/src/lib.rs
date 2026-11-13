//! Terminals: plain shell processes behind a PTY. Owner: terminal Builder.
//!
//! Rust callers (the agents module) use [`Terminals`] directly, with no socket: [`Terminals::spawn`]
//! returns the new Terminal's id together with a [`broadcast::Receiver`] of its events. The receiver
//! exists before the reader thread reads any output, so none is missed.

mod contract_handlers;
mod error;
pub use error::Error;
use error::Locked;
mod host;
mod input;
mod integration;
mod output;
mod program;
mod reattach;
pub mod reconcile;
mod remote;
mod stream;
pub use stream::InputEnded;
mod recorder;
mod scheme;
mod screen;
mod spawn;
pub use spawn::Adopted;
mod status;
pub use status::{BlockedKind, Change, ProgramState, Record};

use screen::{ScreenParser, ScreenState, Seen};

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, mpsc};
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use contracts::terminal::{
    ExitedEvent, ReadParams, ResizeParams, SchemeParams, SearchParams, Snapshot, SpawnParams,
    TerminalId, TerminalInfo, TitleEvent, WriteParams,
};
use contracts::{Actor, EventData};
use rpc::{Bus, Ctx, Module, OpenError, RpcError};
use serde_json::Value;
use tokio::sync::{broadcast, watch};

use remote::{Link, Remotes};

/// Events a slow subscriber may fall behind by before it is told it lagged (it never blocks the reader).
const EVENT_BACKLOG: usize = 1024;
/// X14: output chunks a Terminal's slow output subscriber may fall behind by before it sees a gap.
const OUTPUT_BACKLOG: usize = 256;
const SNAPSHOT_SCROLLBACK: usize = 1000;
const SNAPSHOT_MAX_BYTES: usize = 1_048_576;
const SNAPSHOT_MAX_CELLS: u32 = 65_536;
const SNAPSHOT_MAX_HISTORY_CELLS: usize = 262_144;
const TITLE_ROWS: u16 = 24;
const TITLE_COLS: u16 = 80;
const READ_CHUNK: usize = 8192;
/// Writes a Terminal accepts ahead of its program reading them. Past this, `write` is `CONFLICT`:
/// a program that never reads would otherwise hold a thread per write until the blocking pool is
/// exhausted and `kill` cannot run.
const WRITE_BACKLOG: usize = 16;
/// X11: Terminals one owner holds, running or exited.
const OWNED_CAP: usize = 8;

/// A freshly spawned Terminal: its id, its title and exit events, and its output from the first byte.
pub struct Spawned {
    pub id: String,
    pub events: broadcast::Receiver<Arc<EventData>>,
    pub output: OutputStream,
}

/// X14: one chunk of a Terminal's output and the offset of its first byte.
#[derive(Clone)]
struct Chunk {
    offset: u64,
    bytes: Arc<[u8]>,
}

/// What a subscriber to one Terminal's output receives.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Output {
    /// The next bytes, starting at `offset`.
    Bytes { offset: u64, bytes: Arc<[u8]> },
    /// The subscriber fell behind: bytes `from..to` were not delivered and delivery resumes at `to`.
    Gap { from: u64, to: u64 },
}

/// X14: the output of one Terminal from the offset it was taken at, in order. It never slows the
/// PTY reader or another Terminal's subscribers; a subscriber that falls behind sees a [`Output::Gap`].
pub struct OutputStream {
    receiver: broadcast::Receiver<Chunk>,
    /// The offset after the last byte delivered, which the next chunk must start at.
    next: u64,
    after_gap: Option<Chunk>,
}

impl OutputStream {
    /// The offset of the first byte this stream delivers.
    pub fn start(&self) -> u64 {
        self.next
    }

    /// The next output, or `None` once the Terminal's program has exited and every byte was delivered.
    pub async fn next(&mut self) -> Option<Output> {
        // R21: a buffered flood must give another Terminal's input and echo a runtime turn.
        tokio::task::yield_now().await;
        let chunk = match self.after_gap.take() {
            Some(chunk) => chunk,
            None => loop {
                match self.receiver.recv().await {
                    Ok(chunk) => break chunk,
                    // The next receive yields the oldest retained chunk, whose offset shows the gap.
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            },
        };
        if chunk.offset > self.next {
            let gap = Output::Gap {
                from: self.next,
                to: chunk.offset,
            };
            self.next = chunk.offset;
            self.after_gap = Some(chunk);
            return Some(gap);
        }
        self.next = chunk.offset + chunk.bytes.len() as u64;
        Some(Output::Bytes {
            offset: chunk.offset,
            bytes: chunk.bytes,
        })
    }
}

/// What it takes to drive a running program. Dropped from the Terminal's entry once it is reaped.
struct Handle {
    /// The core's connection and the channel's sending half; a remote Terminal's change on a reattach.
    link: Arc<Mutex<Link>>,
    /// The core's id for this Terminal.
    core_id: String,
    /// The Machine it runs on; `None` is this Mac.
    machine: Option<String>,
    input: SyncSender<Input>,
    /// True once the program has ended and the stream has drained.
    ended: watch::Receiver<bool>,
    recorder: Arc<OnceLock<Mutex<recorder::Recording>>>,
}

impl Handle {
    fn conn(&self) -> Result<Arc<herdr::Conn>, Error> {
        Ok(Arc::clone(&self.link.locked("terminal link")?.conn))
    }

    fn enqueue(&self, id: &str, input: Input) -> Result<(), Error> {
        match self.input.try_send(input) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err(Error::conflict(format!(
                "terminal {id} is not reading its input"
            ))),
            Err(TrySendError::Disconnected(_)) => Err(Error::internal(format!(
                "terminal {id} can no longer take input"
            ))),
        }
    }
}

type InputWriter = dyn Fn(Box<dyn Write + Send>) -> Box<dyn Write + Send> + Send + Sync;

type ExitHold = dyn Fn() + Send + Sync;

type Effect = Box<dyn FnOnce(&mut dyn Write) -> Result<(), Error> + Send>;

enum Input {
    Bytes(Vec<u8>, Vec<recorder::Sample>),
    Effect(Effect, tokio::sync::oneshot::Sender<Result<(), Error>>),
}

struct Entry {
    info: TerminalInfo,
    /// The program's pid while it runs; gone at its exit, before `terminal.exited` is published,
    /// so a pid the OS reuses afterwards names no Terminal (H21).
    pid: Option<u32>,
    events: broadcast::Sender<Arc<EventData>>,
    /// X14: dropped when the program exits, which ends every output stream after its last byte.
    output: Option<broadcast::Sender<Chunk>>,
    handle: Option<Arc<Handle>>,
    screen: Arc<Mutex<ScreenState>>,
}

struct Shared {
    clock: Arc<dyn Fn() -> f64 + Send + Sync>,
    bus: Bus,
    table: Mutex<BTreeMap<u64, Entry>>,
    /// Wait registrations exist until the original program ends, independently of its PTY.
    program_ends: Mutex<BTreeMap<u64, watch::Receiver<bool>>>,
    /// Env var names stripped from every spawned program's environment, however they reached the
    /// Daemon: its own environment or a caller's `params.env` (`open_with`'s caller owns the list).
    clean_env: Vec<String>,
    /// X17: the App's scheme; `None` until it is told, and until then no program is answered.
    scheme: Mutex<Option<scheme::Palette>>,
    /// PS1: one change per applied report, for the Daemon.
    status: broadcast::Sender<Arc<Change>>,
    /// PS5: whether `ESC ] 7501 ; ? ST` gets its reply. Off until the daemon reads the records (#5229): a
    /// program that sees the reply stops moving its title, which the Daemon's interrupt ack reads.
    answer_status_query: AtomicBool,
}

impl Shared {
    fn table(&self) -> Result<MutexGuard<'_, BTreeMap<u64, Entry>>, Error> {
        self.table.locked("terminal table lock")
    }

    /// Hand a title or exit event to the Bus, then to this Terminal's subscribers, so a subscriber
    /// that saw the event can rely on the Bus having it. Neither can block the caller.
    fn publish(&self, number: u64, data: EventData) -> Result<(), Error> {
        self.bus.emit(Actor::daemon(), data.clone());
        if let Some(entry) = self.table()?.get(&number) {
            let _ = entry.events.send(Arc::new(data));
        }
        Ok(())
    }

    fn retitle(&self, number: u64, title: String) -> Result<(), Error> {
        let id = number.to_string();
        if let Some(entry) = self.table()?.get_mut(&number) {
            entry.info.title = Some(title.clone());
        }
        self.publish(number, EventData::TerminalTitle(TitleEvent { id, title }))
    }

    fn finish(&self, number: u64, code: Option<i32>) -> Result<(), Error> {
        let id = number.to_string();
        self.program_exited(number)?;
        if let Some(entry) = self.table()?.get_mut(&number) {
            entry.info.running = false;
            entry.handle = None;
            entry.pid = None;
            entry.info.program_pid = None;
            entry.info.exit_code = code;
            entry.output = None;
        }
        self.publish(number, EventData::TerminalExited(ExitedEvent { id, code }))
    }
}

/// Say on stderr that a Terminal's background thread stopped on `err`; nothing above it can answer.
fn stopped(number: u64, what: &str, result: Result<(), Error>) {
    if let Err(err) = result {
        eprintln!("terminal {number}: {what}: {err}");
    }
}

pub struct Terminals {
    #[cfg(feature = "test-support")]
    test_input: Option<Mutex<Box<dyn Write + Send>>>,
    /// The herdr-core binary, started on first use from a clean environment.
    core_bin: Option<std::path::PathBuf>,
    /// MC59: the `HOME` of a test-support core, made when the core first starts.
    #[cfg(feature = "test-support")]
    scratch: std::sync::OnceLock<tempfile::TempDir>,
    core: tokio::sync::Mutex<Option<Arc<herdr::Conn>>>,
    /// MC13: the connections to the Machines other than this Mac.
    remotes: Arc<Remotes>,
    shared: Arc<Shared>,
    /// Where X15's shell integration files are written.
    integration_dir: std::path::PathBuf,
    next: AtomicU64,
    input_writer: Option<Arc<InputWriter>>,
    exit_hold: Option<Arc<ExitHold>>,
}

impl Terminals {
    /// `dir` is the Project's data folder (N1). `bus` is for events no call caused. No env
    /// var is stripped from a spawned program; see [`Terminals::open_with`] for that.
    pub fn open(dir: &Path, bus: Bus) -> Result<Self, OpenError> {
        Self::open_with(dir, bus, &[])
    }

    /// As [`Terminals::open`], but `clean_env` names env vars that must never reach a spawned
    /// program's environment, however they arrived (the Daemon's own environment or a caller's
    /// `params.env`): the caller owns the list and what it means.
    pub fn open_with(dir: &Path, bus: Bus, clean_env: &[&str]) -> Result<Self, OpenError> {
        Ok(Self {
            #[cfg(feature = "test-support")]
            test_input: None,
            core_bin: host::default_core(),
            #[cfg(feature = "test-support")]
            scratch: std::sync::OnceLock::new(),
            core: tokio::sync::Mutex::new(None),
            remotes: Arc::new(Remotes::ssh()),
            shared: Arc::new(Shared {
                bus,
                clock: recorder::clock(),
                table: Mutex::new(BTreeMap::new()),
                program_ends: Mutex::new(BTreeMap::new()),
                clean_env: clean_env
                    .iter()
                    .map(|marker| (*marker).to_owned())
                    .collect(),
                scheme: Mutex::new(None),
                status: broadcast::channel(EVENT_BACKLOG).0,
                answer_status_query: AtomicBool::new(false),
            }),
            integration_dir: dir.join("shell-integration"),
            next: AtomicU64::new(1),
            input_writer: None,
            exit_hold: None,
        })
    }

    /// Adapt each PTY input writer before its input thread starts, for isolated physical-IO observers.
    pub fn with_input_writer(
        mut self,
        adapt: impl Fn(Box<dyn Write + Send>) -> Box<dyn Write + Send> + Send + Sync + 'static,
    ) -> Self {
        self.input_writer = Some(Arc::new(adapt));
        self
    }

    /// Run `hold` after a program is reaped and before its Terminal is reported exited, for isolated
    /// observers that keep an exit unconfirmed on any host, whether or not its PTY reports EOF.
    pub fn with_exit_hold(mut self, hold: impl Fn() + Send + Sync + 'static) -> Self {
        self.exit_hold = Some(Arc::new(hold));
        self
    }

    /// Start `params.command` (or the login shell) in a new PTY.
    /// A missing cwd, an empty command, or a program that cannot be found or run is the caller's error;
    /// any other failure to start is the Daemon's.
    pub async fn spawn(&self, params: SpawnParams) -> Result<Spawned, RpcError> {
        Ok(self.start(params, None, None).await?)
    }

    /// As [`Terminals::spawn`], with `labels` (see `reconcile::labels`) on the core's Terminal so the
    /// core's list names its Project, Agent and Attempt (MC52).
    pub async fn spawn_labelled(
        &self,
        params: SpawnParams,
        labels: Value,
    ) -> Result<Spawned, RpcError> {
        Ok(self.start(params, None, Some(labels)).await?)
    }

    /// As [`Terminals::spawn`], for a Terminal that `owner` shows as a bubble (X11, X12). A ninth
    /// forgets the owner's oldest exited Terminal, and is `CONFLICT` when all eight run. Emits
    /// `terminal.changed`.
    pub async fn spawn_owned(&self, params: SpawnParams, owner: &str) -> Result<Spawned, RpcError> {
        Ok(self.spawn_owned_in(params, owner).await?)
    }

    async fn spawn_owned_in(&self, params: SpawnParams, owner: &str) -> Result<Spawned, Error> {
        let forgot = self.evict_for_cap(owner)?;
        let spawned = self.start(params, Some(owner.to_owned()), None).await;
        if forgot || spawned.is_ok() {
            self.shared
                .bus
                .emit(Actor::daemon(), EventData::TerminalChanged);
        }
        spawned
    }

    /// X12, X15: the login shell at `shell` in `cwd`, owned by `owner`, with `env` over the Daemon's. A zsh, bash or fish prints
    /// shell marks; any other shell starts as `shell -l` with no change. Emits `terminal.changed`.
    pub async fn spawn_shell_owned(
        &self,
        cwd: &str,
        shell: &str,
        owner: &str,
        env: BTreeMap<String, String>,
        size: (u16, u16),
    ) -> Result<Spawned, RpcError> {
        Ok(self
            .spawn_shell_owned_in(cwd, shell, owner, env, size)
            .await?)
    }

    async fn spawn_shell_owned_in(
        &self,
        cwd: &str,
        shell: &str,
        owner: &str,
        env: BTreeMap<String, String>,
        size: (u16, u16),
    ) -> Result<Spawned, Error> {
        window(size.0, size.1)?;
        let start =
            integration::start(&self.integration_dir, shell, &env).map_err(Error::internal)?;
        let mut command = vec![shell.to_owned()];
        command.extend(start.args);
        self.spawn_owned_in(
            SpawnParams {
                cwd: cwd.to_owned(),
                command: Some(command),
                env: start.env,
                unset: Vec::new(),
                cols: size.0,
                rows: size.1,
                machine: None,
            },
            owner,
        )
        .await
    }

    /// X12: stop Terminal `id` if it runs and forget it. `INVALID_PARAMS` for one with no owner.
    pub async fn close(&self, id: &str) -> Result<(), RpcError> {
        Ok(self.close_in(id).await?)
    }

    async fn close_in(&self, id: &str) -> Result<(), Error> {
        let number = parse_terminal_number(id)?;
        let running = {
            let table = self.shared.table()?;
            let entry = table
                .get(&number)
                .ok_or_else(|| Error::not_found(format!("terminal {id}")))?;
            if entry.info.owner.is_none() {
                return Err(invalid(format!("terminal {id} has no owner to close it")));
            }
            entry.handle.is_some()
        };
        if running {
            match self.kill_in(id).await {
                Ok(()) => {}
                // It ended on its own just before; closing it is still right.
                Err(err) if err.is_not_found() => {}
                Err(err) => return Err(err),
            }
        }
        if self.shared.table()?.remove(&number).is_none() {
            return Err(Error::not_found(format!("terminal {id}")));
        }
        self.shared.changed(number, Vec::new());
        self.shared
            .bus
            .emit(Actor::daemon(), EventData::TerminalChanged);
        Ok(())
    }

    /// Close every Terminal `owner` holds; one `terminal.changed` for all, none for none.
    pub async fn close_owned_by(&self, owner: &str) -> Result<(), RpcError> {
        Ok(self.close_owned_by_in(owner).await?)
    }

    async fn close_owned_by_in(&self, owner: &str) -> Result<(), Error> {
        let ids: Vec<u64> = self
            .shared
            .table()?
            .iter()
            .filter(|(_, entry)| entry.info.owner.as_deref() == Some(owner))
            .map(|(number, _)| *number)
            .collect();
        for number in &ids {
            let id = number.to_string();
            match self.kill_in(&id).await {
                Ok(()) => {}
                Err(err) if err.is_not_found() => {}
                Err(err) => return Err(err),
            }
            self.shared.table()?.remove(number);
            self.shared.changed(*number, Vec::new());
        }
        if !ids.is_empty() {
            self.shared
                .bus
                .emit(Actor::daemon(), EventData::TerminalChanged);
        }
        Ok(())
    }

    /// Tell a running Terminal its window is now `cols` x `rows`. `NOT_FOUND` as for [`Terminals::write`].
    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), RpcError> {
        Ok(self.resize_in(id, cols, rows).await?)
    }

    async fn resize_in(&self, id: &str, cols: u16, rows: u16) -> Result<(), Error> {
        window(cols, rows)?;
        let handle = self.running(id)?;
        let screen = self.screen(id)?;
        let mut state = screen.locked("terminal screen lock")?;
        // The last active non-observer sets the size, so roundup keeps authority by sending RESIZE.
        handle.link.locked("terminal link")?.tx.resize(cols, rows);
        state.cols = cols;
        state.rows = rows;
        if state.snapshot_available && screen::snapshot_size_supported(cols, rows) {
            // History beyond the budget at this width is trimmed, oldest first; it stays gone after a shrink.
            let keep = SNAPSHOT_SCROLLBACK.min(SNAPSHOT_MAX_HISTORY_CELLS / usize::from(cols));
            state.scrollback_rows = keep;
            if let ScreenParser::Active(parser) = &mut state.parser {
                parser.screen_mut().set_size(rows, cols);
                parser.screen_mut().set_scrollback_len(keep);
            }
        } else {
            // A window beyond the visible bound loses the screen; a later shrink cannot restore it.
            state.snapshot_available = false;
        }
        Ok(())
    }

    /// Return the Terminal's last screen and the output offset represented by it, from one cut.
    pub fn snapshot(&self, id: &str) -> Result<Snapshot, RpcError> {
        Ok(self.snapshot_in(id)?)
    }

    fn snapshot_in(&self, id: &str) -> Result<Snapshot, Error> {
        let screen = self.screen(id)?;
        let mut state = screen.locked("terminal screen lock")?;
        if !state.snapshot_available {
            return Err(Error::conflict(format!(
                "terminal {id} screen is too large to snapshot"
            )));
        }
        let after = state.after;
        let parser = state
            .ensure_parser()
            .ok_or_else(|| Error::internal("terminal screen parser stopped"))?;
        let (rows, cols) = parser.screen().size();
        let data = screen::formatted_snapshot(parser.screen())?;
        Ok(Snapshot {
            cols,
            rows,
            after,
            data: STANDARD.encode(data),
        })
    }

    /// X13: the screen as it is now, as plain text. Changes nothing.
    pub fn read_screen(
        &self,
        id: &str,
        max: Option<u32>,
    ) -> Result<contracts::terminal::Screen, RpcError> {
        Ok(self.read_screen_in(id, max)?)
    }

    fn read_screen_in(
        &self,
        id: &str,
        max: Option<u32>,
    ) -> Result<contracts::terminal::Screen, Error> {
        let cap = output::cap(max)?;
        let screen = self.screen(id)?;
        let mut state = screen.locked("terminal screen lock")?;
        if !state.snapshot_available {
            return Err(Error::conflict(format!(
                "terminal {id} screen is too large to read"
            )));
        }
        let offset = state.log.end();
        let parser = state
            .ensure_parser()
            .ok_or_else(|| Error::internal("terminal screen parser stopped"))?;
        let (rows, cols) = parser.screen().size();
        let shown = parser.screen().rows(0, cols).collect();
        Ok(output::screen(cols, rows, offset, shown, cap))
    }

    /// X13, X16: the output from `params.after` on, or from the reader's cursor, as plain text.
    /// Writes nothing and emits nothing; only a read by `reader` moves that reader's cursor.
    pub fn read(&self, params: &ReadParams) -> Result<contracts::terminal::Read, RpcError> {
        Ok(self.read_in(params)?)
    }

    fn read_in(&self, params: &ReadParams) -> Result<contracts::terminal::Read, Error> {
        let cap = output::cap(params.max)?;
        let (after, reader) = match (params.after, params.reader.as_deref()) {
            (Some(after), _) => (Some(after), None),
            (None, Some(reader)) => (None, Some(reader)),
            (None, None) => {
                return Err(invalid("terminal.read needs `after` or `reader`"));
            }
        };
        let screen = self.screen(&params.id)?;
        let mut state = screen.locked("terminal screen lock")?;
        let start = after.unwrap_or_else(|| {
            reader
                .and_then(|r| state.cursors.get(r).copied())
                .unwrap_or(0)
        });
        let window = state.log.from(start)?;
        let read = output::read(&window, cap);
        if let Some(reader) = reader {
            state.cursors.insert(reader.to_owned(), read.next);
        }
        Ok(read)
    }

    /// X13: the lines of the output that match `params.pattern`. Changes nothing, and searches a
    /// copy of the log with no lock parked.
    pub fn search(&self, params: &SearchParams) -> Result<contracts::terminal::Search, RpcError> {
        Ok(self.search_in(params)?)
    }

    fn search_in(&self, params: &SearchParams) -> Result<contracts::terminal::Search, Error> {
        let cap = output::cap(params.max)?;
        let window = self.window(&params.id, params.after.unwrap_or(0))?;
        output::search(&window, &params.pattern, cap)
    }

    fn window(&self, id: &str, after: u64) -> Result<output::Window, Error> {
        let screen = self.screen(id)?;
        let state = screen.locked("terminal screen lock")?;
        state.log.from(after)
    }

    fn screen(&self, id: &str) -> Result<Arc<Mutex<ScreenState>>, Error> {
        let number = parse_terminal_number(id)?;
        self.shared
            .table()?
            .get(&number)
            .map(|entry| Arc::clone(&entry.screen))
            .ok_or_else(|| Error::not_found(format!("terminal {id}")))
    }

    /// The pid of Terminal `id`'s program, only while it runs (H21).
    pub fn program_pid(&self, id: &str) -> Option<u32> {
        let number = parse_terminal_number(id).ok()?;
        let table = self.shared.table().ok()?;
        table.get(&number).and_then(|entry| entry.pid)
    }

    fn running(&self, id: &str) -> Result<Arc<Handle>, Error> {
        let number = parse_terminal_number(id)?;
        self.shared
            .table()?
            .get(&number)
            .and_then(|entry| entry.handle.clone())
            .ok_or_else(|| Error::not_found(format!("running terminal {id}")))
    }

    /// Every event this Terminal emits from now on, in order. `NOT_FOUND` if it is unknown or has
    /// exited, as for [`Terminals::write`]: an exited Terminal has no more events, so a receiver
    /// would never yield or close.
    /// A subscriber that falls too far behind gets `RecvError::Lagged` and then the newest events;
    /// it never slows the PTY reader. For output from the first byte and a guaranteed exit event,
    /// use [`Spawned::events`] instead.
    pub fn subscribe(&self, id: &str) -> Result<broadcast::Receiver<Arc<EventData>>, RpcError> {
        Ok(self.subscribe_in(id)?)
    }

    fn subscribe_in(&self, id: &str) -> Result<broadcast::Receiver<Arc<EventData>>, Error> {
        let number = parse_terminal_number(id)?;
        let table = self.shared.table()?;
        table
            .get(&number)
            .filter(|entry| entry.handle.is_some())
            .map(|entry| entry.events.subscribe())
            .ok_or_else(|| Error::not_found(format!("terminal {id}")))
    }

    /// X14: the output of a running Terminal from its current end, in order. `NOT_FOUND` as for
    /// [`Terminals::subscribe`]. Dropping the stream releases the subscription.
    pub fn subscribe_output(&self, id: &str) -> Result<OutputStream, RpcError> {
        Ok(self.subscribe_output_in(id)?)
    }

    fn subscribe_output_in(&self, id: &str) -> Result<OutputStream, Error> {
        let number = parse_terminal_number(id)?;
        let (start, receiver) = {
            let table = self.shared.table()?;
            let entry = table
                .get(&number)
                .filter(|entry| entry.handle.is_some())
                .ok_or_else(|| Error::not_found(format!("terminal {id}")))?;
            let sender = entry
                .output
                .as_ref()
                .ok_or_else(|| Error::not_found(format!("terminal {id}")))?;
            // The reader sends a chunk under this lock, so the end read here is where the receiver starts.
            let screen = Arc::clone(&entry.screen);
            let state = screen.locked("terminal screen lock")?;
            let start = state.after;
            let receiver = sender.subscribe();
            drop(state);
            (start, receiver)
        };
        Ok(OutputStream {
            receiver,
            next: start,
            after_gap: None,
        })
    }

    /// PS5: answer, or stop answering, a program's feature-detection query.
    /// PS8.1: the program status `terminal.list` shows for a Terminal; `None` clears it.
    pub fn set_program_status(&self, id: &str, status: Option<contracts::Status>) {
        let Ok(number) = id.parse() else { return };
        match self.shared.table() {
            Ok(mut table) => {
                if let Some(entry) = table.get_mut(&number) {
                    entry.info.status = status;
                }
            }
            Err(err) => eprintln!("terminal {number}: program status dropped: {err}"),
        }
    }

    pub fn answer_status_query(&self, on: bool) {
        self.shared.answer_status_query.store(on, Ordering::Relaxed);
    }

    /// X17: set the scheme every program is answered in. A change from the one before (or from none)
    /// sends one notice to each running program that turned on mode 2031.
    pub async fn set_scheme(&self, params: SchemeParams) -> Result<(), RpcError> {
        Ok(self.set_scheme_in(params).await?)
    }

    async fn set_scheme_in(&self, params: SchemeParams) -> Result<(), Error> {
        let palette = scheme::Palette::parse(&params)?;
        let before = self
            .shared
            .scheme
            .locked("terminal scheme lock")?
            .replace(palette);
        if before.is_some_and(|before| before.scheme == palette.scheme) {
            return Ok(());
        }
        let running: Vec<(u64, Arc<Mutex<ScreenState>>)> = self
            .shared
            .table()?
            .iter()
            .filter(|(_, entry)| entry.handle.is_some())
            .map(|(number, entry)| (*number, Arc::clone(&entry.screen)))
            .collect();
        for (number, screen) in running {
            if screen.locked("terminal screen lock")?.scheme_notices {
                self.shared.type_into(number, palette.notice());
            }
        }
        Ok(())
    }

    /// Every Terminal, running or exited, oldest first.
    pub async fn list(&self) -> Vec<TerminalInfo> {
        let mut infos = Vec::new();
        match self.shared.table() {
            Ok(table) => infos.extend(table.values().map(|entry| entry.info.clone())),
            Err(err) => eprintln!("terminals not listed: {err}"),
        }
        infos.sort_by_key(|info| info.id.parse::<u64>().unwrap_or(u64::MAX));
        infos
    }
}

/// `bytes[range]` for a range the caller computed from `bytes` itself, so it is never out of bounds.
fn within(bytes: &[u8], range: impl std::slice::SliceIndex<[u8], Output = [u8]>) -> &[u8] {
    bytes.get(range).unwrap_or_default()
}

/// The number a Terminal id names. Only the form `spawn` hands out is an id: `+5`, `05` and `nope`
/// are malformed, never a second spelling of an existing Terminal.
fn parse_terminal_number(id: &str) -> Result<u64, Error> {
    id.parse::<u64>()
        .ok()
        .filter(|number| number.to_string() == id)
        .ok_or_else(|| invalid(format!("not a terminal id: {id:?}")))
}

/// A validated Terminal size.
#[derive(Clone, Copy)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}

/// Validate Terminal dimensions before allocating launch resources.
pub fn window(cols: u16, rows: u16) -> Result<Size, RpcError> {
    if cols == 0 || rows == 0 {
        return Err(invalid("cols and rows must be at least 1").into());
    }
    Ok(Size { cols, rows })
}

fn invalid(message: impl Into<String>) -> Error {
    Error::InvalidParams(message.into())
}

#[async_trait]
impl Module for Terminals {
    fn namespaces(&self) -> &'static [&'static str] {
        &["terminal"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        contracts::terminal_methods!(rpc::dispatch_methods, Terminals, self, ctx, method, value)
    }
}
