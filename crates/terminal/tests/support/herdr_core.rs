//! Test-support herdr-core: `herdr-core-test connect` speaks generation 1 of herdr-core's framed
//! protocol on stdin and stdout (`hello`, `terminal.run`, `terminal.get`, `terminal.attach`, and
//! DATA, RESIZE and CLOSE frames) and runs each requested program on a real PTY. Tests start it
//! the way the product starts the real core, as a child whose pipe is the connection. It is
//! dev-only: the `test-support` feature builds it and the daemon never starts it.
//!
//! A Daemon whose `$TMPDIR` holds a `herdr-core-persist` file gets a core that outlives it: the
//! first `connect` starts `herdr-core-test serve` on a socket there and proxies the pipe to it, so a
//! reopened Daemon finds its terminals live. It serves every connection at once over one set of
//! terminals, as the real core serves each `connect`. It writes its pid to `herdr-core.pid` there; a
//! `herdr-core-upgrade` file closes every connection and keeps the terminals, as an upgrade does,
//! and the server removes that file once done. The server ends once `herdr-core-persist` is gone.
use std::collections::HashMap;
use std::io::{self, BufRead, Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde_json::{Value, json};

const DATA: u8 = 0;
const CLOSE: u8 = 2;
const RESIZE: u8 = 3;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn frame(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut v = channel.to_le_bytes().to_vec();
    v.push(kind);
    v.extend((payload.len() as u32).to_le_bytes());
    v.extend(payload);
    v
}

/// herdr-core's error object.
fn failure(kind: &str, hint: &str, message: String) -> Value {
    json!({"code":-32000,"data":{"hint":hint,"kind":kind},"message":message})
}

/// What a terminal's program ended with.
#[derive(Clone)]
struct Exit {
    code: Option<u32>,
    reason: &'static str,
}

impl Exit {
    fn reason_object(&self) -> Value {
        json!({"exit_code":self.code,"reason":self.reason,"signal":null})
    }
}

/// A terminal's replayable output, attached channels and end, kept under one lock so a repaint
/// and the live bytes behind it stay in order.
#[derive(Default)]
struct Live {
    output: Vec<u8>,
    /// Each attached channel, with the connection it was opened on.
    channels: Vec<(Arc<Core>, u32)>,
    exit: Option<Exit>,
}

struct Terminal {
    id: String,
    pid: Option<u32>,
    cwd: String,
    argv: Vec<String>,
    /// MC52: the labels `terminal.run` was given; a terminal without any is the user's own.
    labels: Value,
    live: Mutex<Live>,
    /// The viewer's `display.cell` (width, height in pixels), as herdr-core 0.1.20 answers `14 t`
    /// and `16 t` from it; without one it answers Ghostty's 10 x 20.
    cell: (u64, u64),
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// Input waits in a queue a thread of its own drains, so a program that reads nothing parks
    /// that thread and never the core.
    input: Mutex<std::sync::mpsc::Sender<Vec<u8>>>,
}

/// The terminals every connection to one core shares.
#[derive(Default)]
struct Store {
    terminals: Mutex<HashMap<String, Arc<Terminal>>>,
    next_terminal: AtomicU32,
}

/// One connection to the core.
struct Core {
    out: Mutex<Box<dyn Write + Send>>,
    store: Arc<Store>,
    attached: Mutex<HashMap<u32, Arc<Terminal>>>,
    next_channel: AtomicU32,
}

impl Core {
    fn send(&self, bytes: &[u8]) {
        let mut out = lock(&self.out);
        let _ = out.write_all(bytes).and_then(|()| out.flush());
    }

    fn reply(&self, id: &Value, result: Result<Value, Value>) {
        let body = match result {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err(error) => json!({"jsonrpc":"2.0","id":id,"error":error}),
        };
        self.send(&frame(0, DATA, body.to_string().as_bytes()));
    }

    fn run(self: &Arc<Self>, params: &Value) -> Result<Value, Value> {
        let bad = |what: &str| failure("invalid_params", "see terminal.run", what.to_owned());
        let argv: Vec<String> = params
            .get("argv")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .filter(|a: &Vec<String>| !a.is_empty())
            .ok_or_else(|| bad("argv must be a non-empty array"))?;
        let cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .ok_or_else(|| bad("cwd must be a string"))?;
        let size = |key: &str, default: u16| {
            params
                .get("size")
                .and_then(|s| s.get(key))
                .and_then(Value::as_u64)
                .and_then(|n| u16::try_from(n).ok())
                .unwrap_or(default)
        };
        let spawn_failed = |why: String| {
            failure(
                "spawn_failed",
                "check the program name and cwd",
                // The OS's reason can carry the whole `PATH`; the core names only argv0.
                format!(
                    "cannot start {:?}: {}",
                    argv.first(),
                    why.lines()
                        .next()
                        .unwrap_or_default()
                        .split(" because")
                        .next()
                        .unwrap_or_default()
                ),
            )
        };
        // portable-pty silently falls back to $HOME when the cwd is unusable; the core refuses.
        if !std::path::Path::new(cwd).is_dir() {
            return Err(spawn_failed(
                "No such file or directory (os error 2)".into(),
            ));
        }
        let id = format!(
            "t{}",
            self.store.next_terminal.fetch_add(1, Ordering::Relaxed) + 1
        );
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: size("rows", 24),
                cols: size("cols", 80),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| spawn_failed(e.to_string()))?;
        let mut command = CommandBuilder::from_argv(argv.iter().map(Into::into).collect());
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        if let Some(env) = params.get("env").and_then(Value::as_object) {
            for (name, value) in env {
                if let Some(value) = value.as_str() {
                    command.env(name, value);
                }
            }
        }
        command.env("HC_TERMINAL_ID", &id);
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| spawn_failed(e.to_string()))?;
        drop(pair.slave);
        let (mut reader, writer) = match (pair.master.try_clone_reader(), pair.master.take_writer())
        {
            (Ok(r), Ok(w)) => (r, w),
            (Err(e), _) | (_, Err(e)) => return Err(spawn_failed(e.to_string())),
        };
        let (input, queued) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut writer = writer;
            while let Ok(bytes) = queued.recv() {
                if writer
                    .write_all(&bytes)
                    .and_then(|()| writer.flush())
                    .is_err()
                {
                    return;
                }
            }
        });
        let terminal = Arc::new(Terminal {
            id: id.clone(),
            pid: child.process_id(),
            cwd: cwd.to_owned(),
            argv,
            labels: params.get("labels").cloned().unwrap_or_else(|| json!({})),
            live: Mutex::default(),
            cell: cell_of(params),
            master: Mutex::new(pair.master),
            input: Mutex::new(input),
        });
        lock(&self.store.terminals).insert(id, terminal.clone());
        let t = terminal.clone();
        let (done, drained) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            // A PTY read fails with EIO once the program is gone: any error is the end.
            while let Ok(n @ 1..) = reader.read(&mut buf) {
                let chunk = buf.get(..n).unwrap_or_default();
                answer_pixel_queries(&t, chunk);
                let mut live = lock(&t.live);
                live.output.extend_from_slice(chunk);
                for (core, channel) in &live.channels {
                    core.send(&frame(*channel, DATA, chunk));
                }
            }
            let _ = done.send(());
        });
        // The program's end closes its channels even while a descendant still holds the PTY open;
        // a short grace lets the output the program printed reach them first.
        let t = terminal.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            let _ = drained.recv_timeout(std::time::Duration::from_millis(200));
            let exit = match status {
                Ok(status) if status.signal().is_none() => Exit {
                    code: Some(status.exit_code()),
                    reason: "exited",
                },
                _ => Exit {
                    code: None,
                    reason: "killed",
                },
            };
            let mut live = lock(&t.live);
            for (core, channel) in live.channels.drain(..) {
                core.send(&frame(
                    channel,
                    CLOSE,
                    exit.reason_object().to_string().as_bytes(),
                ));
            }
            live.exit = Some(exit);
        });
        Ok(self.describe(&terminal))
    }

    fn describe(&self, t: &Terminal) -> Value {
        let exit = lock(&t.live).exit.clone();
        json!({
            "address": t.id,
            "state": if exit.is_some() { "finished" } else { "live" },
            "pid": t.pid,
            "cwd": t.cwd,
            "argv": t.argv,
            "exit_code": exit.as_ref().and_then(|e| e.code),
            "reason": exit.as_ref().map(|e| e.reason),
            "signal": null,
            "labels": t.labels,
        })
    }

    /// `terminal.list`: every live terminal, and with `all` every finished one too, whose labels hold
    /// each pair of the optional `labels` filter.
    fn list(&self, params: &Value) -> Value {
        let want = params.get("labels").and_then(Value::as_object);
        let all = params.get("all").and_then(Value::as_bool).unwrap_or(false);
        let mut found: Vec<Arc<Terminal>> = lock(&self.store.terminals)
            .values()
            .filter(|t| all || lock(&t.live).exit.is_none())
            .filter(|t| {
                want.is_none_or(|want| want.iter().all(|(k, v)| t.labels.get(k) == Some(v)))
            })
            .cloned()
            .collect();
        found.sort_by_key(|t| t.id.clone());
        json!({"terminals": found.iter().map(|t| self.describe(t)).collect::<Vec<_>>()})
    }

    fn terminal(&self, params: &Value) -> Result<Arc<Terminal>, Value> {
        let id = params
            .get("terminal")
            .and_then(Value::as_str)
            .unwrap_or_default();
        lock(&self.store.terminals).get(id).cloned().ok_or_else(|| {
            failure(
                "not_found",
                "see `hc ls --all`",
                format!("no terminal {id}"),
            )
        })
    }

    /// Open a channel: a repaint of everything printed so far, then the live bytes, then the end.
    /// It answers `id` itself, so the reply precedes the first paint on the channel.
    fn attach(self: &Arc<Self>, id: &Value, params: &Value) -> Result<(), Value> {
        let t = self.terminal(params)?;
        if let (Some(cols), Some(rows)) = (
            params.get("cols").and_then(Value::as_u64),
            params.get("rows").and_then(Value::as_u64),
        ) {
            resize(&t, cols, rows);
        }
        let channel = self.next_channel.fetch_add(1, Ordering::Relaxed);
        lock(&self.attached).insert(channel, t.clone());
        let mut live = lock(&t.live);
        self.reply(id, Ok(json!({"channel":channel})));
        if !live.output.is_empty() {
            self.send(&frame(channel, DATA, &live.output));
        }
        match &live.exit {
            Some(exit) => {
                self.send(&frame(
                    channel,
                    CLOSE,
                    exit.reason_object().to_string().as_bytes(),
                ));
            }
            None => live.channels.push((self.clone(), channel)),
        }
        Ok(())
    }

    fn call(self: &Arc<Self>, msg: &Value) {
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        eprintln!("call {msg}");
        let result = match msg
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "terminal.run" => self.run(&params),
            "terminal.get" => self.terminal(&params).map(|t| self.describe(&t)),
            "terminal.kill" => self.terminal(&params).and_then(|t| {
                let pid = t
                    .pid
                    .and_then(|pid| i32::try_from(pid).ok())
                    .ok_or_else(|| {
                        failure(
                            "not_found",
                            "the terminal has no process",
                            "no process".into(),
                        )
                    })?;
                nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), nix::sys::signal::SIGKILL)
                    .map_err(|e| failure("not_found", "already gone", e.to_string()))?;
                // As the real core, answer once the program is seen to end.
                for _ in 0..250 {
                    if lock(&t.live).exit.is_some() {
                        break;
                    }
                    pause(20);
                }
                Ok(json!({}))
            }),
            "terminal.list" => Ok(self.list(&params)),
            "terminal.rm" => self.terminal(&params).and_then(|t| {
                if lock(&t.live).exit.is_none() {
                    return Err(failure(
                        "live",
                        "end its program first",
                        format!("terminal {} is live", t.id),
                    ));
                }
                lock(&self.store.terminals).remove(&t.id);
                Ok(json!({"removed": t.id}))
            }),
            "terminal.attach" => {
                if let Err(error) = self.attach(&id, &params) {
                    self.reply(&id, Err(error));
                }
                return;
            }
            other => Err(failure(
                "unknown_method",
                "the test-support core speaks hello, terminal.run, terminal.get, terminal.attach",
                format!("no method {other}"),
            )),
        };
        self.reply(&id, result);
    }

    /// A frame on a terminal's channel: input, a new size, or a detach.
    fn on_channel(&self, channel: u32, kind: u8, payload: &[u8]) {
        let Some(t) = lock(&self.attached).get(&channel).cloned() else {
            return;
        };
        match (kind, payload) {
            (DATA, bytes) => {
                let _ = lock(&t.input).send(bytes.to_vec());
            }
            (RESIZE, [c0, c1, r0, r1]) => resize(
                &t,
                u16::from_le_bytes([*c0, *c1]).into(),
                u16::from_le_bytes([*r0, *r1]).into(),
            ),
            (CLOSE, _) => {
                lock(&t.live)
                    .channels
                    .retain(|(core, c)| !(std::ptr::eq(Arc::as_ptr(core), self) && *c == channel));
                lock(&self.attached).remove(&channel);
            }
            _ => {}
        }
    }
}

fn cell_of(params: &Value) -> (u64, u64) {
    let cell = params.get("display").and_then(|d| d.get("cell"));
    let at = |i: usize| cell.and_then(|c| c.get(i)).and_then(Value::as_u64);
    match (at(0), at(1)) {
        (Some(w), Some(h)) => (w, h),
        _ => (10, 20),
    }
}

/// herdr-core answers `CSI 14 t` and `CSI 16 t` itself, from the viewer's cell size.
fn answer_pixel_queries(t: &Terminal, chunk: &[u8]) {
    let (w, h) = t.cell;
    let (cols, rows) = lock(&t.master)
        .get_size()
        .map_or((0, 0), |s| (u64::from(s.cols), u64::from(s.rows)));
    let text = String::from_utf8_lossy(chunk);
    for query in text.matches("\x1b[14t").chain(text.matches("\x1b[16t")) {
        let reply = match query {
            "\x1b[14t" => format!("\x1b[4;{};{}t", rows * h, cols * w),
            _ => format!("\x1b[6;{h};{w}t"),
        };
        let _ = lock(&t.input).send(reply.into_bytes());
    }
}

fn resize(t: &Terminal, cols: u64, rows: u64) {
    let (Ok(cols), Ok(rows)) = (u16::try_from(cols), u16::try_from(rows)) else {
        return;
    };
    let _ = lock(&t.master).resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    });
}

fn main() -> io::Result<()> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("connect") => {
            let tmp = std::env::var_os("TMPDIR").map(std::path::PathBuf::from);
            match tmp.filter(|t| t.join("herdr-core-persist").exists()) {
                Some(tmp) => proxy(&tmp),
                None => serve(
                    &new_core(Box::new(io::stdout()), Arc::default()),
                    &mut io::stdin().lock(),
                ),
            }
        }
        Some("serve") => {
            let tmp = std::path::PathBuf::from(args.next().unwrap_or_default());
            listen(&tmp)
        }
        _ => {
            eprintln!("usage: herdr-core-test connect");
            std::process::exit(2);
        }
    }
}

fn new_core(out: Box<dyn Write + Send>, store: Arc<Store>) -> Arc<Core> {
    Arc::new(Core {
        out: Mutex::new(out),
        store,
        attached: Mutex::default(),
        next_channel: AtomicU32::new(1),
    })
}

/// A writer that hands each write to a thread of its own, so a connection whose reader falls behind
/// never stalls a terminal's output to the other connections, or its end.
struct Queued(std::sync::mpsc::Sender<Vec<u8>>);

impl Queued {
    fn new(mut out: impl Write + Send + 'static) -> Self {
        let (tx, queued) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            while let Ok(bytes) = queued.recv() {
                if out.write_all(&bytes).and_then(|()| out.flush()).is_err() {
                    return;
                }
            }
        });
        Self(tx)
    }
}

impl Write for Queued {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0
            .send(bytes.to_vec())
            .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Waits `ms` on a channel nothing sends to.
fn pause(ms: u64) {
    let (_keep, never) = std::sync::mpsc::channel::<()>();
    let _ = never.recv_timeout(std::time::Duration::from_millis(ms));
}

/// The persistent server: every connection at once over a socket in `tmp`, its terminals kept
/// between connections, ending when the `herdr-core-persist` file goes.
fn listen(tmp: &std::path::Path) -> io::Result<()> {
    let marker = tmp.join("herdr-core-persist");
    let upgrade = tmp.join("herdr-core-upgrade");
    let listener = std::os::unix::net::UnixListener::bind(tmp.join("herdr-core.sock"))?;
    std::fs::write(tmp.join("herdr-core.pid"), std::process::id().to_string())?;
    let store = Arc::new(Store::default());
    let open: Arc<Mutex<HashMap<u64, std::os::unix::net::UnixStream>>> = Arc::default();
    let (watch, streams) = (store.clone(), open.clone());
    std::thread::spawn(move || {
        while marker.exists() {
            if upgrade.exists() {
                for stream in lock(&streams).values() {
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                }
                let _ = std::fs::remove_file(&upgrade);
            }
            pause(20);
        }
        for t in lock(&watch.terminals).values() {
            if let Some(pid) = t.pid {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .status();
            }
        }
        std::process::exit(0);
    });
    for (n, stream) in (0u64..).zip(listener.incoming()) {
        let Ok(stream) = stream else { continue };
        let (Ok(writer), Ok(kept)) = (stream.try_clone(), stream.try_clone()) else {
            continue;
        };
        lock(&open).insert(n, kept);
        let core = new_core(Box::new(Queued::new(writer)), store.clone());
        let open = open.clone();
        std::thread::spawn(move || {
            let _ = serve(&core, &mut io::BufReader::new(stream));
            lock(&open).remove(&n);
            // The connection's channels go with it.
            lock(&core.attached).clear();
            for t in lock(&core.store.terminals).values() {
                lock(&t.live)
                    .channels
                    .retain(|(c, _)| !Arc::ptr_eq(c, &core));
            }
        });
    }
    Ok(())
}

/// `connect` against the persistent server, started if it is not running: bytes both ways.
fn proxy(tmp: &std::path::Path) -> io::Result<()> {
    use std::os::unix::process::CommandExt;
    let socket = tmp.join("herdr-core.sock");
    // Of connects that find no server at once, the one that creates this file starts it.
    let starting = tmp.join("herdr-core-starting");
    let mut started = false;
    let stream = loop {
        if let Ok(stream) = std::os::unix::net::UnixStream::connect(&socket) {
            break stream;
        }
        if !started
            && std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&starting)
                .is_ok()
        {
            let _ = std::fs::remove_file(&socket);
            std::process::Command::new(std::env::current_exe()?)
                .arg("serve")
                .arg(tmp)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .process_group(0)
                .spawn()?;
            started = true;
        }
        pause(20);
    };
    if started {
        let _ = std::fs::remove_file(&starting);
    }
    let mut up = stream.try_clone()?;
    std::thread::spawn(move || {
        let _ = io::copy(&mut io::stdin().lock(), &mut up);
        let _ = up.shutdown(std::net::Shutdown::Both);
    });
    let mut down = stream;
    // Stdout is line-buffered: flush each read so a frame without a newline is not held back.
    let mut out = io::stdout().lock();
    let mut buf = [0u8; 8192];
    while let Ok(n) = down.read(&mut buf) {
        if n == 0 || buf.get(..n).is_none_or(|b| out.write_all(b).is_err()) || out.flush().is_err()
        {
            break;
        }
    }
    Ok(())
}

fn serve(core: &Arc<Core>, input: &mut impl BufRead) -> io::Result<()> {
    let mut line = String::new();
    input.read_line(&mut line)?;
    let hello: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
    let id = hello.get("id").cloned().unwrap_or(Value::Null);
    let wanted = hello
        .get("params")
        .and_then(|p| p.get("generation"))
        .and_then(Value::as_u64);
    let reply = if wanted == Some(1) {
        json!({"jsonrpc":"2.0","id":id,"result":{"generation":1,"version":"0.1.18-test","framed":true,
            "methods":["terminal.run","terminal.get","terminal.attach","terminal.kill","terminal.list","terminal.rm"]}})
    } else {
        let msg = format!(
            "protocol generation {} not supported",
            wanted.unwrap_or_default()
        );
        let error = failure(
            "unsupported_generation",
            "this core speaks generation 1",
            msg,
        );
        json!({"jsonrpc":"2.0","id":id,"error":error})
    };
    core.send(format!("{reply}\n").as_bytes());
    if wanted != Some(1) {
        return Ok(());
    }
    let mut header = [0u8; 9];
    while input.read_exact(&mut header).is_ok() {
        let [c0, c1, c2, c3, kind, l0, l1, l2, l3] = header;
        let mut payload = vec![0u8; u32::from_le_bytes([l0, l1, l2, l3]) as usize];
        input.read_exact(&mut payload)?;
        let channel = u32::from_le_bytes([c0, c1, c2, c3]);
        if channel != 0 {
            core.on_channel(channel, kind, &payload);
        } else if kind == DATA
            && let Ok(msg) = serde_json::from_slice::<Value>(&payload)
        {
            core.call(&msg);
        }
    }
    Ok(())
}
