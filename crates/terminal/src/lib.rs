//! Terminals: plain shell processes behind a PTY. Owner: terminal Builder.
//!
//! Rust callers (the agents module) use [`Terminals`] directly, with no socket: [`Terminals::spawn`]
//! returns the new Terminal's id together with a [`broadcast::Receiver`] of its events. The receiver
//! exists before the reader thread reads any output, so none is missed.

mod contract_handlers;
mod input;
mod integration;
mod output;
mod owner;
mod remote;
pub use owner::TerminalOwner;
mod program;
mod pty;
mod recorder;
mod scheme;
mod screen;
mod status;
pub use status::{BlockedKind, Change, ProgramState, Record};

use program::Program;
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
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use rpc::{Bus, Ctx, Module, OpenError, RpcError, code, params, reply};
use serde_json::Value;
use tokio::sync::{broadcast, watch};

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
/// How often the reaper checks whether the original program has ended.
const REAP_POLL: Duration = Duration::from_millis(5);
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
    master: Mutex<Box<dyn MasterPty + Send>>,
    input: SyncSender<Input>,
    program: Program,
    recorder: Arc<OnceLock<Mutex<recorder::Recording>>>,
}

impl Handle {
    fn enqueue(&self, id: &str, input: Input) -> Result<(), RpcError> {
        match self.input.try_send(input) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err(RpcError::conflict(format!(
                "terminal {id} is not reading its input"
            ))),
            Err(TrySendError::Disconnected(_)) => Err(RpcError::internal(format!(
                "terminal {id} can no longer take input"
            ))),
        }
    }
}

type InputWriter = dyn Fn(Box<dyn Write + Send>) -> Box<dyn Write + Send> + Send + Sync;

type ExitHold = dyn Fn() + Send + Sync;

type Effect = Box<dyn FnOnce(&mut dyn Write) -> Result<(), RpcError> + Send>;

enum Input {
    Bytes(Vec<u8>, Vec<recorder::Sample>),
    Effect(Effect, tokio::sync::oneshot::Sender<Result<(), RpcError>>),
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
    /// PS5: whether `ESC ] 7501 ; ? ST` gets its reply. Off until rupd reads the records (#5229): a
    /// program that sees the reply stops moving its title, which the Daemon's interrupt ack reads.
    answer_status_query: AtomicBool,
}

impl Shared {
    fn table(&self) -> MutexGuard<'_, BTreeMap<u64, Entry>> {
        self.table.lock().expect("terminal table lock")
    }

    /// Hand a title or exit event to the Bus, then to this Terminal's subscribers, so a subscriber
    /// that saw the event can rely on the Bus having it. Neither can block the caller.
    fn publish(&self, number: u64, data: EventData) {
        self.bus.emit(Actor::daemon(), data.clone());
        if let Some(entry) = self.table().get(&number) {
            let _ = entry.events.send(Arc::new(data));
        }
    }

    fn retitle(&self, number: u64, title: String) {
        let id = number.to_string();
        if let Some(entry) = self.table().get_mut(&number) {
            entry.info.title = Some(title.clone());
        }
        self.publish(number, EventData::TerminalTitle(TitleEvent { id, title }));
    }

    fn finish(&self, number: u64, code: Option<i32>) {
        let id = number.to_string();
        self.program_exited(number);
        if let Some(entry) = self.table().get_mut(&number) {
            entry.info.running = false;
            entry.handle = None;
            entry.pid = None;
            entry.info.program_pid = None;
            entry.info.exit_code = code;
            entry.output = None;
        }
        self.publish(number, EventData::TerminalExited(ExitedEvent { id, code }));
    }
}

pub struct Terminals {
    #[cfg(feature = "test-support")]
    test_input: Option<Mutex<Box<dyn Write + Send>>>,
    owner_helper: Option<std::path::PathBuf>,
    remotes: Mutex<BTreeMap<u64, Arc<remote::Remote>>>,
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
            owner_helper: None,
            remotes: Mutex::new(BTreeMap::new()),
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
        self.start(params, None).await
    }

    /// As [`Terminals::spawn`], for a Terminal that `owner` shows as a bubble (X11, X12). A ninth
    /// forgets the owner's oldest exited Terminal, and is `CONFLICT` when all eight run. Emits
    /// `terminal.changed`.
    pub async fn spawn_owned(&self, params: SpawnParams, owner: &str) -> Result<Spawned, RpcError> {
        let forgot = self.make_room(owner)?;
        let spawned = self.start(params, Some(owner.to_owned())).await;
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
        window(size.0, size.1)?;
        let start =
            integration::start(&self.integration_dir, shell, &env).map_err(RpcError::internal)?;
        let mut command = vec![shell.to_owned()];
        command.extend(start.args);
        self.spawn_owned(
            SpawnParams {
                cwd: cwd.to_owned(),
                command: Some(command),
                env: start.env,
                cols: size.0,
                rows: size.1,
            },
            owner,
        )
        .await
    }

    /// X12: stop Terminal `id` if it runs and forget it. `INVALID_PARAMS` for one with no owner.
    pub async fn close(&self, id: &str) -> Result<(), RpcError> {
        if self.close_remote(id).await? {
            return Ok(());
        }
        let number = parse_terminal_number(id)?;
        let running = {
            let table = self.shared.table();
            let entry = table
                .get(&number)
                .ok_or_else(|| RpcError::not_found(format!("terminal {id}")))?;
            if entry.info.owner.is_none() {
                return Err(invalid(format!("terminal {id} has no owner to close it")));
            }
            entry.handle.is_some()
        };
        if running {
            match self.kill(id).await {
                Ok(()) => {}
                // It ended on its own just before; closing it is still right.
                Err(err) if err.code == code::NOT_FOUND => {}
                Err(err) => return Err(err),
            }
        }
        if self.shared.table().remove(&number).is_none() {
            return Err(RpcError::not_found(format!("terminal {id}")));
        }
        self.shared
            .bus
            .emit(Actor::daemon(), EventData::TerminalChanged);
        Ok(())
    }

    /// Close every Terminal `owner` holds; one `terminal.changed` for all, none for none.
    pub async fn close_owned_by(&self, owner: &str) -> Result<(), RpcError> {
        let remote_closed = self.close_remote_owned(owner).await?;
        let ids: Vec<u64> = self
            .shared
            .table()
            .iter()
            .filter(|(_, entry)| entry.info.owner.as_deref() == Some(owner))
            .map(|(number, _)| *number)
            .collect();
        for number in &ids {
            let id = number.to_string();
            match self.kill(&id).await {
                Ok(()) => {}
                Err(err) if err.code == code::NOT_FOUND => {}
                Err(err) => return Err(err),
            }
            self.shared.table().remove(number);
        }
        if !ids.is_empty() || remote_closed {
            self.shared
                .bus
                .emit(Actor::daemon(), EventData::TerminalChanged);
        }
        Ok(())
    }

    /// Forget `owner`'s oldest exited Terminal when it holds [`OWNED_CAP`]; true when one went.
    fn make_room(&self, owner: &str) -> Result<bool, RpcError> {
        if self.owner_helper.is_some() {
            return self.make_remote_space(owner);
        }
        let mut table = self.shared.table();
        let parked: Vec<(u64, bool)> = table
            .iter()
            .filter(|(_, entry)| entry.info.owner.as_deref() == Some(owner))
            .map(|(number, entry)| (*number, entry.handle.is_none()))
            .collect();
        if parked.len() < OWNED_CAP {
            return Ok(false);
        }
        let oldest_exited = parked
            .iter()
            .find(|(_, exited)| *exited)
            .map(|(number, _)| *number);
        match oldest_exited {
            Some(number) => {
                table.remove(&number);
                Ok(true)
            }
            None => Err(RpcError::conflict(format!(
                "{owner} already runs {OWNED_CAP} terminals"
            ))),
        }
    }

    async fn start(&self, params: SpawnParams, owner: Option<String>) -> Result<Spawned, RpcError> {
        if let Some(helper) = &self.owner_helper {
            return self.start_owner(helper, params, owner).await;
        }
        check_program(&params)?;
        // portable-pty silently falls back to $HOME when the cwd is unusable; refuse instead.
        if !Path::new(&params.cwd).is_dir() {
            return Err(invalid(format!("cwd is not a directory: {}", params.cwd)));
        }
        // Generate independently of authentication and vendor content; failure starts no program.
        let mut nonce = [0u8; 32];
        getrandom::fill(&mut nonce).map_err(RpcError::internal)?;
        let incarnation = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        let pair = native_pty_system()
            .openpty(window(params.cols, params.rows)?)
            .map_err(RpcError::internal)?;
        let mut command = match &params.command {
            Some(argv) => CommandBuilder::from_argv(argv.iter().map(Into::into).collect()),
            None => CommandBuilder::new_default_prog(),
        };
        command.cwd(&params.cwd);
        for (name, value) in &params.env {
            command.env(name, value);
        }
        // Last, so none of them survive even if a caller passed one in `params.env`.
        for marker in &self.shared.clean_env {
            command.env_remove(marker);
        }
        // All three threads start before the program, so a thread-creation failure leaves no
        // program behind. The reaper observes completion independently of PTY EOF.
        let reader = pair.master.try_clone_reader().map_err(RpcError::internal)?;
        let writer = pair.master.take_writer().map_err(RpcError::internal)?;
        let writer = match &self.input_writer {
            Some(adapt) => adapt(writer),
            None => writer,
        };
        let number = self.next.fetch_add(1, Ordering::Relaxed);
        let snapshot_available = screen::snapshot_size_supported(params.cols, params.rows);
        let scrollback = if snapshot_available {
            SNAPSHOT_SCROLLBACK.min(SNAPSHOT_MAX_HISTORY_CELLS / usize::from(params.cols))
        } else {
            0
        };
        let screen = Arc::new(Mutex::new(ScreenState {
            parser: ScreenParser::Pending,
            after: 0,
            log: output::Log::default(),
            cursors: Default::default(),
            snapshot_available,
            scrollback_rows: scrollback,
            cols: params.cols,
            rows: params.rows,
            scheme_notices: false,
            status: Default::default(),
        }));
        let (program_arrival, program_arrives) = mpsc::channel::<Program>();
        let (reaped, completion) = mpsc::channel();
        let (ended, program_ended) = watch::channel(false);
        let program_shared = Arc::clone(&self.shared);
        std::thread::Builder::new()
            .name(format!("terminal-{number}-reap"))
            .spawn(move || {
                if let Ok(program) = program_arrives.recv() {
                    let code = program::exit_code(number, reap(&program));
                    ended.send_replace(true);
                    program_shared
                        .program_ends
                        .lock()
                        .expect("terminal program ends lock")
                        .remove(&number);
                    let _ = reaped.send(code);
                }
            })
            .map_err(RpcError::internal)?;
        let (arrival, child_arrives) = mpsc::channel::<Arc<Handle>>();
        let (output, output_receiver) = broadcast::channel(OUTPUT_BACKLOG);
        let pump_output = output.clone();
        let shared = Arc::clone(&self.shared);
        let reader_screen = Arc::clone(&screen);
        let exit_hold = self.exit_hold.clone();
        let recorder = Arc::new(OnceLock::new());
        std::thread::Builder::new()
            .name(format!("terminal-{number}"))
            .spawn(move || {
                // No child means the program never started: nothing to report.
                if let Ok(handle) = child_arrives.recv() {
                    pty::read(
                        &shared,
                        number,
                        reader,
                        &handle,
                        &reader_screen,
                        &pump_output,
                    );
                    let code = completion
                        .recv()
                        .expect("the reaper reports program completion");
                    if let Some(hold) = exit_hold {
                        hold();
                    }
                    drop(pump_output);
                    shared.finish(number, code);
                }
            })
            .map_err(RpcError::internal)?;
        let (input, queued) = mpsc::sync_channel(WRITE_BACKLOG);
        let input_clock = Arc::clone(&self.shared.clock);
        std::thread::Builder::new()
            .name(format!("terminal-{number}-input"))
            .spawn(move || pty::type_queued(number, queued, writer, input_clock))
            .map_err(RpcError::internal)?;
        let argv0 = params
            .command
            .as_deref()
            .and_then(<[String]>::first)
            .map(String::as_str);
        let program: Program = Arc::new(Mutex::new(
            pair.slave
                .spawn_command(command)
                .map_err(|err| spawn_error(argv0, &err))?,
        ));
        // Only the program may hold the slave end, or reading never sees it close.
        drop(pair.slave);
        let pid = program.lock().expect("program lock").process_id();
        let handle = Arc::new(Handle {
            input,
            program: Arc::clone(&program),
            master: Mutex::new(pair.master),
            recorder,
        });

        let (sender, events) = broadcast::channel(EVENT_BACKLOG);
        // Install the wait registration before list can expose this Terminal.
        self.shared
            .program_ends
            .lock()
            .expect("terminal program ends lock")
            .insert(number, program_ended);
        self.shared.table().insert(
            number,
            Entry {
                pid,
                info: TerminalInfo {
                    program_pid: pid,
                    id: number.to_string(),
                    incarnation,
                    cwd: params.cwd,
                    title: None,
                    program: program_name(params.command.as_deref()),
                    running: true,
                    exit_code: None,
                    owner,
                },
                events: sender,
                output: Some(output.clone()),
                handle: Some(Arc::clone(&handle)),
                screen,
            },
        );
        assert!(
            program_arrival.send(program).is_ok(),
            "the reaper thread waits for its program"
        );
        assert!(
            arrival.send(handle).is_ok(),
            "the reader thread waits for its child"
        );
        Ok(Spawned {
            id: number.to_string(),
            events,
            output: OutputStream {
                receiver: output_receiver,
                next: 0,
                after_gap: None,
            },
        })
    }

    /// Tell a running Terminal its window is now `cols` x `rows`. `NOT_FOUND` as for [`Terminals::write`].
    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), RpcError> {
        if let Some(remote) = self.remote(id)? {
            return remote.call(
                "terminal.resize",
                serde_json::json!({"id":id,"cols":cols,"rows":rows}),
            );
        }
        let size = window(cols, rows)?;
        let handle = self.running(id)?;
        let screen = self.screen(id)?;
        let mut state = screen.lock().expect("terminal screen lock");
        let master = handle.master.lock().expect("terminal master lock");
        master.resize(size).map_err(RpcError::internal)?;
        state.cols = cols;
        state.rows = rows;
        if state.snapshot_available
            && screen::snapshot_size_supported(cols, rows)
            && (matches!(&state.parser, ScreenParser::Pending)
                || state.scrollback_rows * usize::from(cols) <= SNAPSHOT_MAX_HISTORY_CELLS)
        {
            match &mut state.parser {
                ScreenParser::Pending => {
                    state.scrollback_rows =
                        SNAPSHOT_SCROLLBACK.min(SNAPSHOT_MAX_HISTORY_CELLS / usize::from(cols));
                }
                ScreenParser::Active(parser) => parser.screen_mut().set_size(rows, cols),
                ScreenParser::Failed => {}
            }
        } else {
            // A size beyond the capture budget loses screen history; a later shrink cannot restore it.
            state.snapshot_available = false;
        }
        Ok(())
    }

    /// Return the Terminal's last screen and the output offset represented by it, from one cut.
    pub fn snapshot(&self, id: &str) -> Result<Snapshot, RpcError> {
        if let Some(remote) = self.remote(id)? {
            return remote.call("terminal.snapshot", serde_json::json!({"id":id}));
        }
        let screen = self.screen(id)?;
        let mut state = screen.lock().expect("terminal screen lock");
        if !state.snapshot_available {
            return Err(RpcError::conflict(format!(
                "terminal {id} screen is too large to snapshot"
            )));
        }
        let after = state.after;
        let parser = state
            .ensure_parser()
            .ok_or_else(|| RpcError::internal("terminal screen parser stopped"))?;
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
        if let Some(remote) = self.remote(id)? {
            return remote.call("terminal.screen", serde_json::json!({"id":id,"max":max}));
        }
        let cap = output::cap(max)?;
        let screen = self.screen(id)?;
        let mut state = screen.lock().expect("terminal screen lock");
        if !state.snapshot_available {
            return Err(RpcError::conflict(format!(
                "terminal {id} screen is too large to read"
            )));
        }
        let offset = state.log.end();
        let parser = state
            .ensure_parser()
            .ok_or_else(|| RpcError::internal("terminal screen parser stopped"))?;
        let (rows, cols) = parser.screen().size();
        let shown = parser.screen().rows(0, cols).collect();
        Ok(output::screen(cols, rows, offset, shown, cap))
    }

    /// X13, X16: the output from `params.after` on, or from the reader's cursor, as plain text.
    /// Writes nothing and emits nothing; only a read by `reader` moves that reader's cursor.
    pub fn read(&self, params: &ReadParams) -> Result<contracts::terminal::Read, RpcError> {
        if let Some(remote) = self.remote(&params.id)? {
            return remote.call(
                "terminal.read",
                serde_json::to_value(params).map_err(RpcError::internal)?,
            );
        }
        let cap = output::cap(params.max)?;
        let (after, reader) = match (params.after, params.reader.as_deref()) {
            (Some(after), _) => (Some(after), None),
            (None, Some(reader)) => (None, Some(reader)),
            (None, None) => {
                return Err(invalid("terminal.read needs `after` or `reader`"));
            }
        };
        let screen = self.screen(&params.id)?;
        let mut state = screen.lock().expect("terminal screen lock");
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
        if let Some(remote) = self.remote(&params.id)? {
            return remote.call(
                "terminal.search",
                serde_json::to_value(params).map_err(RpcError::internal)?,
            );
        }
        let cap = output::cap(params.max)?;
        let window = self.window(&params.id, params.after.unwrap_or(0))?;
        output::search(&window, &params.pattern, cap)
    }

    fn window(&self, id: &str, after: u64) -> Result<output::Window, RpcError> {
        let screen = self.screen(id)?;
        let state = screen.lock().expect("terminal screen lock");
        state.log.from(after)
    }

    fn screen(&self, id: &str) -> Result<Arc<Mutex<ScreenState>>, RpcError> {
        let number = parse_terminal_number(id)?;
        self.shared
            .table()
            .get(&number)
            .map(|entry| Arc::clone(&entry.screen))
            .ok_or_else(|| RpcError::not_found(format!("terminal {id}")))
    }

    /// The pid of Terminal `id`'s program, only while it runs (H21).
    pub fn program_pid(&self, id: &str) -> Option<u32> {
        if let Some(remote) = self.remote(id).ok()? {
            return remote.info().ok().and_then(|info| info.program_pid);
        }
        let number = parse_terminal_number(id).ok()?;
        self.shared.table().get(&number).and_then(|entry| entry.pid)
    }

    fn running(&self, id: &str) -> Result<Arc<Handle>, RpcError> {
        let number = parse_terminal_number(id)?;
        self.shared
            .table()
            .get(&number)
            .and_then(|entry| entry.handle.clone())
            .ok_or_else(|| RpcError::not_found(format!("running terminal {id}")))
    }

    /// Every event this Terminal emits from now on, in order. `NOT_FOUND` if it is unknown or has
    /// exited, as for [`Terminals::write`]: an exited Terminal has no more events, so a receiver
    /// would never yield or close.
    /// A subscriber that falls too far behind gets `RecvError::Lagged` and then the newest events;
    /// it never slows the PTY reader. For output from the first byte and a guaranteed exit event,
    /// use [`Spawned::events`] instead.
    pub fn subscribe(&self, id: &str) -> Result<broadcast::Receiver<Arc<EventData>>, RpcError> {
        if let Some(remote) = self.remote(id)? {
            return remote.subscribe();
        }
        let number = parse_terminal_number(id)?;
        let table = self.shared.table();
        table
            .get(&number)
            .filter(|entry| entry.handle.is_some())
            .map(|entry| entry.events.subscribe())
            .ok_or_else(|| RpcError::not_found(format!("terminal {id}")))
    }

    /// X14: the output of a running Terminal from its current end, in order. `NOT_FOUND` as for
    /// [`Terminals::subscribe`]. Dropping the stream releases the subscription.
    pub fn subscribe_output(&self, id: &str) -> Result<OutputStream, RpcError> {
        if let Some(remote) = self.remote(id)? {
            return remote.subscribe_output();
        }
        let number = parse_terminal_number(id)?;
        let (start, receiver) = {
            let table = self.shared.table();
            let entry = table
                .get(&number)
                .filter(|entry| entry.handle.is_some())
                .ok_or_else(|| RpcError::not_found(format!("terminal {id}")))?;
            let sender = entry
                .output
                .as_ref()
                .ok_or_else(|| RpcError::not_found(format!("terminal {id}")))?;
            // The reader sends a chunk under this lock, so the end read here is where the receiver starts.
            let screen = Arc::clone(&entry.screen);
            let state = screen.lock().expect("terminal screen lock");
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
    pub fn answer_status_query(&self, on: bool) {
        self.shared.answer_status_query.store(on, Ordering::Relaxed);
    }

    /// X17: set the scheme every program is answered in. A change from the one before (or from none)
    /// sends one notice to each running program that turned on mode 2031.
    pub async fn set_scheme(&self, params: SchemeParams) -> Result<(), RpcError> {
        let palette = scheme::Palette::parse(&params)?;
        self.remote_scheme(&params)?;
        let before = self
            .shared
            .scheme
            .lock()
            .expect("terminal scheme lock")
            .replace(palette);
        if before.is_some_and(|before| before.scheme == palette.scheme) {
            return Ok(());
        }
        let running: Vec<(u64, Arc<Mutex<ScreenState>>)> = self
            .shared
            .table()
            .iter()
            .filter(|(_, entry)| entry.handle.is_some())
            .map(|(number, entry)| (*number, Arc::clone(&entry.screen)))
            .collect();
        for (number, screen) in running {
            if screen.lock().expect("terminal screen lock").scheme_notices {
                self.shared.type_into(number, palette.notice());
            }
        }
        Ok(())
    }

    /// Every Terminal, running or exited, oldest first.
    pub async fn list(&self) -> Vec<TerminalInfo> {
        let remotes: Vec<_> = self
            .remotes
            .lock()
            .expect("remote table")
            .values()
            .cloned()
            .collect();
        let mut asked = tokio::task::JoinSet::new();
        for remote in remotes {
            asked.spawn(async move { remote.info_within_deadline().await });
        }
        let mut infos = Vec::new();
        while let Some(answer) = asked.join_next().await {
            infos.extend(answer.ok().and_then(Result::ok));
        }
        infos.extend(self.shared.table().values().map(|entry| entry.info.clone()));
        infos.sort_by_key(|info| info.id.parse::<u64>().expect("Terminal id"));
        infos
    }
}

/// Wait for the program to end without holding the lock while it runs, so `kill` can take it.
fn reap(program: &Program) -> std::io::Result<portable_pty::ExitStatus> {
    loop {
        let status = program.lock().expect("terminal program lock").try_wait()?;
        match status {
            Some(status) => return Ok(status),
            None => std::thread::sleep(REAP_POLL),
        }
    }
}

/// What the OS would refuse at exec time, caught here so it is the caller's error with a short message.
fn check_program(params: &SpawnParams) -> Result<(), RpcError> {
    let argv = params.command.as_deref().unwrap_or_default();
    if params.command.is_some() && argv.first().is_none_or(String::is_empty) {
        return Err(invalid("command must start with a program name"));
    }
    let env = params.env.iter().flat_map(|(name, value)| [name, value]);
    if argv.iter().chain(env).any(|text| text.contains('\0')) {
        return Err(invalid("command and env must not contain NUL"));
    }
    if params
        .env
        .keys()
        .any(|name| name.is_empty() || name.contains('='))
    {
        return Err(invalid("env names must be non-empty and contain no '='"));
    }
    Ok(())
}

/// The number a Terminal id names. Only the form `spawn` hands out is an id: `+5`, `05` and `nope`
/// are malformed, never a second spelling of an existing Terminal.
fn parse_terminal_number(id: &str) -> Result<u64, RpcError> {
    id.parse::<u64>()
        .ok()
        .filter(|number| number.to_string() == id)
        .ok_or_else(|| invalid(format!("not a terminal id: {id:?}")))
}

/// portable-pty reports an argv[0] it cannot find or run as text that can quote the Daemon's `PATH`;
/// that is the caller's error and must not leak `PATH`. Any other failure to start is the Daemon's.
fn spawn_error(program: Option<&str>, err: &impl std::fmt::Display) -> RpcError {
    match program {
        Some(program) if err.to_string().starts_with("Unable to spawn ") => {
            invalid(format!("cannot run {program}"))
        }
        _ => RpcError::internal(err),
    }
}

/// Validate Terminal dimensions before allocating launch resources.
pub fn window(cols: u16, rows: u16) -> Result<PtySize, RpcError> {
    if cols == 0 || rows == 0 {
        return Err(invalid("cols and rows must be at least 1"));
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn invalid(message: impl Into<String>) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, message)
}

#[async_trait]
impl Module for Terminals {
    fn namespaces(&self) -> &'static [&'static str] {
        &["terminal"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        contracts::terminal_methods!(rpc::dispatch_methods, self, ctx, method, value)
    }
}

/// The basename of the program's argv0, else of `$SHELL`, else `terminal`.
fn program_name(command: Option<&[String]>) -> String {
    let shell = std::env::var("SHELL").ok();
    let path = command.and_then(<[String]>::first).or(shell.as_ref());

    path.and_then(|path| Path::new(path).file_name())
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("terminal")
        .to_string()
}
