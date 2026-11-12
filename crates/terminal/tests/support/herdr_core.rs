//! Test-support herdr-core: `herdr-core-test connect` speaks generation 1 of herdr-core's framed
//! protocol on stdin and stdout (`hello`, `terminal.run`, `terminal.get`, `terminal.attach`, and
//! DATA, RESIZE and CLOSE frames) and runs each requested program on a real PTY. Tests start it
//! the way the product starts the real core, as a child whose pipe is the connection. It is
//! dev-only: the `test-support` feature builds it and the daemon never starts it.
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
    channels: Vec<u32>,
    exit: Option<Exit>,
}

struct Terminal {
    id: String,
    pid: Option<u32>,
    cwd: String,
    argv: Vec<String>,
    live: Mutex<Live>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// Input waits in a queue a thread of its own drains, so a program that reads nothing parks
    /// that thread and never the core.
    input: Mutex<std::sync::mpsc::Sender<Vec<u8>>>,
}

struct Core {
    out: Mutex<io::Stdout>,
    terminals: Mutex<HashMap<String, Arc<Terminal>>>,
    attached: Mutex<HashMap<u32, Arc<Terminal>>>,
    next_terminal: AtomicU32,
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
                format!("cannot start {:?}: {}", argv.first(), why.lines().next().unwrap_or_default().split(" because").next().unwrap_or_default()),
            )
        };
        // portable-pty silently falls back to $HOME when the cwd is unusable; the core refuses.
        if !std::path::Path::new(cwd).is_dir() {
            return Err(spawn_failed(
                "No such file or directory (os error 2)".into(),
            ));
        }
        let id = format!("t{}", self.next_terminal.fetch_add(1, Ordering::Relaxed));
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
                if writer.write_all(&bytes).and_then(|()| writer.flush()).is_err() {
                    return;
                }
            }
        });
        let terminal = Arc::new(Terminal {
            id: id.clone(),
            pid: child.process_id(),
            cwd: cwd.to_owned(),
            argv,
            live: Mutex::default(),
            master: Mutex::new(pair.master),
            input: Mutex::new(input),
        });
        lock(&self.terminals).insert(id, terminal.clone());
        let core = self.clone();
        let t = terminal.clone();
        let drained = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let done = drained.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            // A PTY read fails with EIO once the program is gone: any error is the end.
            while let Ok(n @ 1..) = reader.read(&mut buf) {
                let chunk = buf.get(..n).unwrap_or_default();
                let mut live = lock(&t.live);
                live.output.extend_from_slice(chunk);
                for channel in &live.channels {
                    core.send(&frame(*channel, DATA, chunk));
                }
            }
            done.store(true, Ordering::SeqCst);
        });
        // The program's end closes its channels even while a descendant still holds the PTY open;
        // a short grace lets the output the program printed reach them first.
        let core = self.clone();
        let t = terminal.clone();
        std::thread::spawn(move || {
            let status = child.wait();
            for _ in 0..40 {
                if drained.load(Ordering::SeqCst) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
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
            for channel in live.channels.drain(..) {
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
            "terminal": t.id,
            "state": if exit.is_some() { "finished" } else { "live" },
            "pid": t.pid,
            "cwd": t.cwd,
            "argv": t.argv,
            "exit_code": exit.as_ref().and_then(|e| e.code),
            "reason": exit.as_ref().map(|e| e.reason),
            "signal": null,
        })
    }

    fn terminal(&self, params: &Value) -> Result<Arc<Terminal>, Value> {
        let id = params
            .get("terminal")
            .and_then(Value::as_str)
            .unwrap_or_default();
        lock(&self.terminals).get(id).cloned().ok_or_else(|| {
            failure(
                "not_found",
                "see `hc ls --all`",
                format!("no terminal {id}"),
            )
        })
    }

    /// Open a channel: a repaint of everything printed so far, then the live bytes, then the end.
    /// It answers `id` itself, so the reply precedes the first paint on the channel.
    fn attach(&self, id: &Value, params: &Value) -> Result<(), Value> {
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
            None => live.channels.push(channel),
        }
        Ok(())
    }

    fn call(self: &Arc<Self>, msg: &Value) {
        let id = msg.get("id").cloned().unwrap_or(Value::Null);
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        let result = match msg
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "terminal.run" => self.run(&params),
            "terminal.get" => self.terminal(&params).map(|t| self.describe(&t)),
            "terminal.kill" => self.terminal(&params).and_then(|t| {
                let pid = t.pid.and_then(|pid| i32::try_from(pid).ok()).ok_or_else(|| {
                    failure("not_found", "the terminal has no process", "no process".into())
                })?;
                nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), nix::sys::signal::SIGKILL)
                    .map_err(|e| failure("not_found", "already gone", e.to_string()))?;
                Ok(json!({}))
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
                lock(&t.live).channels.retain(|c| *c != channel);
                lock(&self.attached).remove(&channel);
            }
            _ => {}
        }
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
    if std::env::args().nth(1).as_deref() != Some("connect") {
        eprintln!("usage: herdr-core-test connect");
        std::process::exit(2);
    }
    let core = Arc::new(Core {
        out: Mutex::new(io::stdout()),
        terminals: Mutex::default(),
        attached: Mutex::default(),
        next_terminal: AtomicU32::new(1),
        next_channel: AtomicU32::new(1),
    });
    let mut input = io::BufReader::new(io::stdin().lock());
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
            "methods":["terminal.run","terminal.get","terminal.attach","terminal.kill"]}})
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
