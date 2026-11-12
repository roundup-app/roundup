//! herdr-core as a Terminal's host: the framed attach stream feeds the same
//! `Chunk` broadcast, `ScreenState` and status records the PTY reader does, through `stream::read`.
use super::spawn::{OTHER_TERMINALS, check_program};
use super::*;

/// How a Terminal on a remote Machine finds its channel again after the ssh to it is lost: waits
/// for the Machine, attaches with the history a gap needs, and answers `None` once the program
/// has ended. It blocks, so it runs on the Terminal's own thread.
pub(super) type Relink = Box<dyn FnMut() -> Option<herdr::Stream> + Send>;

/// How long a reattach's repaint may stay quiet while its seam is looked for.
const SEAM_QUIET: Duration = Duration::from_millis(300);

/// The bytes of one attached channel as a [`Read`]. Frames are cut anywhere, a UTF-8 character
/// included, so bytes pass through undecoded and the screen parser decodes once.
struct StreamReader {
    stream: herdr::Stream,
    frame: Vec<u8>,
    taken: usize,
    /// The core's reason object from the channel's CLOSE.
    closed: Arc<Mutex<Option<Value>>>,
    /// MC14: set for a remote Terminal, whose lost connection is followed by a reattach.
    relink: Option<Relink>,
    seam: reattach::Seam,
    runtime: tokio::runtime::Handle,
}

impl StreamReader {
    /// The next event; while a repaint is kept back, `None` for the stream going quiet.
    fn next(&mut self) -> Option<Option<herdr::Ev>> {
        if !self.seam.waiting() {
            return Some(self.stream.blocking_next());
        }
        let stream = &mut self.stream;
        self.runtime
            .block_on(async { tokio::time::timeout(SEAM_QUIET, stream.next()).await })
            .ok()
    }

    /// Reattach after a lost connection; false when the program is gone.
    fn relinked(&mut self) -> bool {
        let Some(relink) = self.relink.as_mut() else {
            return false;
        };
        let Some(stream) = relink() else {
            return false;
        };
        self.stream = stream;
        self.seam.reattached();
        true
    }

    fn deliver(&mut self, bytes: Vec<u8>) {
        if self.relink.is_some() {
            self.seam.delivered(&bytes);
        }
        self.frame = bytes;
        self.taken = 0;
    }
}

/// Whether a CLOSE names a lost connection rather than the program's end or a detach.
fn connection_lost(reason: &Value) -> bool {
    reason.get("reason").and_then(Value::as_str) == Some("connection_lost")
}

impl Read for StreamReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        while self.taken == self.frame.len() {
            match self.next() {
                None => {
                    let repaint = self.seam.give_up();
                    self.deliver(repaint);
                }
                Some(Some(herdr::Ev::Data(bytes))) if self.relink.is_some() => {
                    let out = self.seam.feed(bytes);
                    self.deliver(out);
                }
                Some(Some(herdr::Ev::Data(bytes))) => {
                    self.frame = bytes;
                    self.taken = 0;
                }
                Some(Some(herdr::Ev::Resize(..))) => {}
                Some(Some(herdr::Ev::Close(reason))) => {
                    if connection_lost(&reason) && self.relinked() {
                        continue;
                    }
                    if let Ok(mut closed) = self.closed.lock() {
                        *closed = Some(reason);
                    }
                    return Ok(0);
                }
                Some(None) => {
                    if self.relinked() {
                        continue;
                    }
                    return Ok(0);
                }
            }
        }
        let rest = within(&self.frame, self.taken..);
        let n = buf.len().min(rest.len());
        for (to, from) in buf.iter_mut().zip(rest) {
            *to = *from;
        }
        self.taken += n;
        Ok(n)
    }
}

/// The core's typing path as the [`Write`] the input thread feeds; after a reattach it types into
/// the new channel.
pub(super) struct StreamWriter(pub(super) Arc<Mutex<Link>>);

impl Write for StreamWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if let Ok(link) = self.0.lock() {
            link.tx.send(bytes);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// The exit code a CLOSE carries; `None` when it names none (a detach, a lost connection).
fn exit_code(reason: &Value) -> Option<i32> {
    reason
        .get("exit_code")
        .and_then(Value::as_i64)
        .and_then(|code| i32::try_from(code).ok())
}

/// X8 for a core's Terminal: the exit code once the core has settled `terminal.get`, because
/// `terminal.wait` answers `exit_code: null` right after the exit.
pub(super) async fn finished_code(
    conn: &herdr::Conn,
    terminal: &str,
    settle: Duration,
) -> Option<i32> {
    tokio::time::sleep(settle).await;
    let got = conn
        .call("terminal.get", serde_json::json!({"terminal":terminal}))
        .await
        .ok()?;
    exit_code(&got)
}

/// Publish everything `stream` carries to Terminal `number`'s output, screen, log and status
/// records until the channel closes; returns the exit code the CLOSE named. Blocks: run it on
/// the Terminal's own thread, never on the runtime.
/// MC10: as above; and when `relink` is given (MC14), again on the channel it finds after each lost
/// connection, `runtime` driving the waits in between.
pub(super) fn feed(
    shared: &Shared,
    number: u64,
    stream: herdr::Stream,
    relink: Option<Relink>,
    runtime: tokio::runtime::Handle,
    screen: &Mutex<ScreenState>,
    output: &broadcast::Sender<Chunk>,
) -> Result<Option<i32>, Error> {
    let closed = Arc::new(Mutex::new(None));
    let reader = StreamReader {
        stream,
        frame: Vec::new(),
        taken: 0,
        closed: Arc::clone(&closed),
        relink,
        seam: reattach::Seam::default(),
        runtime,
    };
    stream::read(
        shared,
        number,
        Box::new(reader),
        &OnceLock::new(),
        screen,
        output,
    )?;
    let reason = closed.locked("stream close")?.take();
    Ok(reason.as_ref().and_then(exit_code))
}

/// MC16: the argv that starts a core on this Mac from a clean environment: `env -i` with only the
/// named variables, since an empty-string value would set a variable rather than remove it.
pub(super) fn core_command(core: &str, vars: &BTreeMap<String, String>) -> Vec<String> {
    let mut argv = vec!["env".to_owned(), "-i".to_owned()];
    argv.extend(vars.iter().map(|(name, value)| format!("{name}={value}")));
    argv.extend([core.to_owned(), "connect".to_owned()]);
    argv
}

/// The variables a core starts with: what a program needs to find itself, and nothing of the session
/// the Daemon runs in. A name the Daemon lacks is left out.
fn core_vars() -> BTreeMap<String, String> {
    [
        "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TMPDIR",
    ]
    .into_iter()
    .filter_map(|name| Some((name.to_owned(), std::env::var(name).ok()?)))
    .chain(test_vars())
    .collect()
}

/// Under `test-support` the test-support core also gets the variables the fake `claude` and the
/// Daemon's tests set, which a real core never sees.
#[cfg(feature = "test-support")]
fn test_vars() -> impl Iterator<Item = (String, String)> {
    std::env::vars().filter(|(name, _)| {
        name.starts_with("FAKE_CLAUDE_")
            || name.starts_with("ROUNDUP_")
            || name == "CLAUDE_CONFIG_DIR"
    })
}

#[cfg(not(feature = "test-support"))]
fn test_vars() -> impl Iterator<Item = (String, String)> {
    std::iter::empty()
}

/// Under `test-support` the core is the test-support one built beside the test binary, so a test
/// that opens `Terminals` runs on a core; otherwise `herdr-core` from `PATH`.
pub(super) fn default_core() -> std::path::PathBuf {
    #[cfg(feature = "test-support")]
    if let Ok(exe) = std::env::current_exe() {
        for dir in exe.ancestors().skip(1).take(2) {
            let core = dir.join("herdr-core-test");
            if core.is_file() {
                return core;
            }
        }
    }
    "herdr-core".into()
}

impl Terminals {
    /// MC15: whether the ssh to each remote Machine roundup has tried last answered, for a surface to
    /// show on the Machine's Agents; none is shown here.
    pub fn machine_reachability(&self) -> BTreeMap<String, bool> {
        self.remotes.reachability()
    }

    /// Use the herdr-core at `binary`, not the one on `PATH`.
    pub fn with_core(mut self, binary: impl Into<std::path::PathBuf>) -> Self {
        self.core_bin = binary.into();
        self
    }

    /// The one core connection, started on first use from a clean environment (MC16).
    pub(super) async fn core(&self) -> Result<Arc<herdr::Conn>, Error> {
        let conn = self
            .core
            .get_or_try_init(|| async {
                let argv = core_command(&self.core_bin.to_string_lossy(), &core_vars());
                let mut command = tokio::process::Command::new("env");
                command.args(argv.iter().skip(1));
                herdr::Conn::spawn(command, CORE_TIMEOUT)
                    .await
                    .map(Arc::new)
            })
            .await
            .map_err(|err| match err {
                herdr::Error::Missing => Error::internal("herdr-core is not installed"),
                other => Error::internal(other),
            })?;
        Ok(Arc::clone(conn))
    }
}

/// How long a call to the core may take before it is lost.
pub(super) const CORE_TIMEOUT: Duration = Duration::from_secs(15);

/// MC12: the `terminal.run` request for `params`: argv, cwd, env and size, with the environment the
/// PTY path gave a program. A core may have started in a session that carries other variables, so
/// every name the program must not see is dropped from `env`, and the core itself starts clean. It
/// names no terminal: a core's names are unique among its live terminals, and one core serves every
/// Daemon on the machine and outlives each, so the core's `address` is the only id.
pub(super) fn run_params(shared: &Shared, params: &SpawnParams, number: u64) -> Value {
    // The program inherits the Daemon's own environment, as it did on the PTY path (A3507a), with
    // the launch's variables on top.
    // A Machine's program is no child of the Daemon: it gets the launch's variables and none of this Mac's.
    let remote = params.machine.is_some();
    let mut env: BTreeMap<String, String> = match remote {
        true => BTreeMap::new(),
        false => std::env::vars().collect(),
    };
    env.extend(params.env.clone());
    let mut removed: Vec<&str> = shared.clean_env.iter().map(String::as_str).collect();
    removed.extend(params.unset.iter().map(String::as_str));
    removed.extend(OTHER_TERMINALS.iter().copied());
    removed.sort_unstable();
    removed.dedup();
    for name in &removed {
        env.remove(*name);
    }
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("CLAUDE_CODE_FORCE_SYNC_OUTPUT".into(), "1".into());
    env.insert("ROUNDUP_TERMINAL".into(), number.to_string());
    // The core starts clean (`core_command`), so the program's argv is its own and a bad program
    // fails the run as `spawn_failed`, which an `env` in front of it would hide.
    let mut argv = Vec::new();
    match &params.command {
        Some(command) => argv.extend(command.iter().cloned()),
        None if remote => argv.push("/bin/sh".into()),
        None => argv.push(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())),
    }
    serde_json::json!({
        "argv": argv,
        "cwd": params.cwd,
        "env": env,
        "size": {"cols": params.cols, "rows": params.rows},
    })
}

/// Start `params` in the core. A bad cwd or program is the caller's error
/// (`spawn_failed`); anything else is the Daemon's.
pub(super) async fn run(
    conn: &herdr::Conn,
    shared: &Shared,
    params: &SpawnParams,
    number: u64,
) -> Result<Value, Error> {
    check_program(params)?;
    match conn
        .call("terminal.run", run_params(shared, params, number))
        .await
    {
        Ok(ran) => Ok(ran),
        Err(herdr::Error::Rpc(err)) if err.kind == "spawn_failed" => {
            Err(invalid(format!("cannot run the program: {}", err.message)))
        }
        Err(err) => Err(Error::internal(err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt, duplex};
    use tokio::runtime::Handle;

    fn frame(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
        let mut v = channel.to_le_bytes().to_vec();
        v.push(kind);
        v.extend((payload.len() as u32).to_le_bytes());
        v.extend(payload);
        v
    }

    /// A fake herdr-core: answers hello and one `terminal.attach` (channel 5), then plays `frames`
    /// as DATA and ends the channel with `close`. `terminal.get` answers `state` as `exit_code 3`.
    async fn fake_core(frames: Vec<Vec<u8>>, close: Value) -> herdr::Conn {
        let (mac_r, mut core_w) = duplex(1 << 20);
        let (core_r, mac_w) = duplex(1 << 20);
        tokio::spawn(async move {
            let mut r = tokio::io::BufReader::new(core_r);
            let mut line = String::new();
            tokio::io::AsyncBufReadExt::read_line(&mut r, &mut line)
                .await
                .unwrap();
            let hello =
                r#"{"id":0,"jsonrpc":"2.0","result":{"generation":1,"version":"0","methods":[]}}"#;
            core_w
                .write_all(format!("{hello}\n").as_bytes())
                .await
                .unwrap();
            loop {
                let mut h = [0u8; 9];
                if r.read_exact(&mut h).await.is_err() {
                    return;
                }
                let mut p = vec![0u8; u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize];
                r.read_exact(&mut p).await.unwrap();
                if h[4] != 0 {
                    continue;
                }
                let msg: Value = serde_json::from_slice(&p).unwrap();
                let result = match msg["method"].as_str() {
                    Some("terminal.get") => json!({"state":"finished","exit_code":3}),
                    _ => json!({"channel":5}),
                };
                let reply = json!({"jsonrpc":"2.0","id":msg["id"],"result":result});
                let out = frame(0, 0, reply.to_string().as_bytes());
                core_w.write_all(&out).await.unwrap();
                if msg["method"] == "terminal.attach" {
                    for f in &frames {
                        core_w.write_all(&frame(5, 0, f)).await.unwrap();
                    }
                    core_w
                        .write_all(&frame(5, 2, close.to_string().as_bytes()))
                        .await
                        .unwrap();
                }
            }
        });
        herdr::Conn::over(mac_r, mac_w, Duration::from_secs(5))
            .await
            .unwrap()
    }

    struct Fed {
        terminals: Terminals,
        screen: Arc<Mutex<ScreenState>>,
        out: broadcast::Receiver<Chunk>,
        code: Option<i32>,
        conn: herdr::Conn,
        _dir: tempfile::TempDir,
    }

    async fn fed(frames: Vec<Vec<u8>>, close: Value) -> Fed {
        let dir = tempfile::tempdir().unwrap();
        let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
        let conn = fake_core(frames, close).await;
        let stream = conn.attach("t", 100, 30, 0).await.unwrap();
        let screen = Arc::new(Mutex::new(ScreenState::new(100, 30)));
        let (output, out) = broadcast::channel(1 << 16);
        let (shared, mirror) = (terminals.shared.clone(), screen.clone());
        let code = tokio::task::spawn_blocking(move || {
            feed(
                &shared,
                1,
                stream,
                None,
                Handle::current(),
                &mirror,
                &output,
            )
            .unwrap()
        })
        .await
        .unwrap();
        Fed {
            terminals,
            screen,
            out,
            code,
            conn,
            _dir: dir,
        }
    }

    fn lines() -> Vec<u8> {
        (1..=5000)
            .flat_map(|n| format!("line {n:06} αβγ→🙂 xxxx\r\n").into_bytes())
            .collect()
    }

    #[tokio::test]
    async fn mc10_attach_stream_gives_same_read_search_screen() {
        let bytes = lines();
        // 16 KiB frames, so some end inside a character.
        let frames = bytes.chunks(16384).map(<[u8]>::to_vec).collect();
        let got = fed(frames, json!({"exit_code":0})).await;
        let state = got.screen.lock().unwrap();
        assert_eq!(state.after, bytes.len() as u64);
        assert_eq!(
            state.log.raw(state.log.start()).unwrap(),
            bytes[bytes.len() - state.log.raw(state.log.start()).unwrap().len()..]
        );
        // The same bytes straight through the reader the PTY path uses answer alike.
        let direct = Mutex::new(ScreenState::new(100, 30));
        let (output, _keep) = broadcast::channel(1 << 16);
        stream::read(
            &got.terminals.shared,
            2,
            Box::new(std::io::Cursor::new(bytes.clone())),
            &OnceLock::new(),
            &direct,
            &output,
        )
        .unwrap();
        let direct = direct.lock().unwrap();
        let window = |s: &ScreenState| s.log.from(s.log.start()).unwrap();
        let (a, b) = (window(&state), window(&direct));
        assert_eq!(output::read(&a, 16384).text, output::read(&b, 16384).text);
        assert_eq!(
            output::search(&a, "line 004321", 16384).unwrap().matches,
            output::search(&b, "line 004321", 16384).unwrap().matches
        );
        let last = |s: &ScreenState| match &s.parser {
            ScreenParser::Active(p) => p.screen().contents(),
            _ => String::new(),
        };
        assert!(last(&state).contains("line 005000 αβγ→🙂"));
        assert_eq!(last(&state), last(&direct));
        assert_eq!(got.code, Some(0));
    }

    #[tokio::test]
    async fn mc10_split_utf8_frame_decodes_once() {
        let text = "a🙂b".as_bytes();
        let frames = vec![text[..2].to_vec(), text[2..4].to_vec(), text[4..].to_vec()];
        let mut got = fed(frames, json!({})).await;
        let mut seen = Vec::new();
        while let Ok(chunk) = got.out.try_recv() {
            seen.extend_from_slice(&chunk.bytes);
        }
        assert_eq!(seen, text);
        let state = got.screen.lock().unwrap();
        let ScreenParser::Active(parser) = &state.parser else {
            panic!("no parser");
        };
        assert!(parser.screen().contents().starts_with("a🙂b"));
    }

    #[tokio::test]
    async fn mc10_osc_7501_report_reaches_status() {
        let dir = tempfile::tempdir().unwrap();
        let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
        let mut changes = terminals.subscribe_status();
        let conn = fake_core(vec![b"\x1b]7501;state=working\x07".to_vec()], json!({})).await;
        let stream = conn.attach("t", 100, 30, 0).await.unwrap();
        let screen = Mutex::new(ScreenState::new(100, 30));
        let (output, _keep) = broadcast::channel(16);
        let shared = terminals.shared.clone();
        tokio::task::spawn_blocking(move || {
            feed(
                &shared,
                7,
                stream,
                None,
                Handle::current(),
                &screen,
                &output,
            )
            .unwrap()
        })
        .await
        .unwrap();
        let change = changes.try_recv().unwrap();
        assert_eq!(change.terminal, "7");
        assert!(!change.records.is_empty());
    }

    #[tokio::test]
    async fn mc10_exit_code_reaches_terminals() {
        // A CLOSE that names no code: the code comes from `terminal.get` after a short delay.
        let got = fed(vec![b"bye\r\n".to_vec()], json!({"reason":"exited"})).await;
        assert_eq!(got.code, None);
        let code = finished_code(&got.conn, "t", Duration::from_millis(20)).await;
        assert_eq!(code, Some(3));
        let named = fed(vec![], json!({"exit_code":7})).await;
        assert_eq!(named.code, Some(7));
    }

    /// A fake core that records each `terminal.run` it gets and answers `reply` (an error object
    /// when it has `code`).
    async fn run_core(reply: Value) -> (herdr::Conn, tokio::sync::mpsc::UnboundedReceiver<Value>) {
        let (mac_r, mut core_w) = duplex(1 << 20);
        let (core_r, mac_w) = duplex(1 << 20);
        let (seen, got) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            let mut r = tokio::io::BufReader::new(core_r);
            let mut line = String::new();
            tokio::io::AsyncBufReadExt::read_line(&mut r, &mut line)
                .await
                .unwrap();
            let hello =
                r#"{"id":0,"jsonrpc":"2.0","result":{"generation":1,"version":"0","methods":[]}}"#;
            core_w
                .write_all(format!("{hello}\n").as_bytes())
                .await
                .unwrap();
            loop {
                let mut h = [0u8; 9];
                if r.read_exact(&mut h).await.is_err() {
                    return;
                }
                let mut p = vec![0u8; u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize];
                r.read_exact(&mut p).await.unwrap();
                let msg: Value = serde_json::from_slice(&p).unwrap();
                let key = if reply.get("code").is_some() {
                    "error"
                } else {
                    "result"
                };
                let body = json!({"jsonrpc":"2.0","id":msg["id"],key:reply});
                core_w
                    .write_all(&frame(0, 0, body.to_string().as_bytes()))
                    .await
                    .unwrap();
                let _ = seen.send(msg);
            }
        });
        let conn = herdr::Conn::over(mac_r, mac_w, Duration::from_secs(5))
            .await
            .unwrap();
        (conn, got)
    }

    fn launch() -> SpawnParams {
        SpawnParams {
            cwd: "/work".into(),
            command: Some(vec!["claude".into(), "--flag".into()]),
            env: [
                ("ROUNDUP_AGENT".to_owned(), "7".to_owned()),
                ("CLAUDECODE".to_owned(), "1".to_owned()),
            ]
            .into(),
            unset: vec!["CLAUDE_CODE_SESSION_ID".into()],
            cols: 100,
            rows: 30,
            machine: None,
        }
    }

    #[tokio::test]
    async fn mc12_local_terminal_starts_through_herdr_core() {
        let dir = tempfile::tempdir().unwrap();
        let terminals = Terminals::open_with(dir.path(), Bus::new(), &["CLAUDECODE"]).unwrap();
        let (conn, mut seen) = run_core(json!({"state":"live"})).await;
        run(&conn, &terminals.shared, &launch(), 4).await.unwrap();
        let call = seen.recv().await.unwrap();
        assert_eq!(call["method"], "terminal.run");
        let p = &call["params"];
        assert_eq!(p["cwd"], "/work");
        assert!(p.get("name").is_none(), "a name collides across Daemons");
        assert_eq!(p["size"], json!({"cols":100,"rows":30}));
        assert_eq!(p["env"]["ROUNDUP_AGENT"], "7");
        assert_eq!(p["env"]["ROUNDUP_TERMINAL"], "4");
        assert_eq!(p["env"]["TERM"], "xterm-256color");
        let argv: Vec<&str> = p["argv"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| a.as_str().unwrap())
            .collect();
        assert_eq!(&argv[argv.len() - 2..], ["claude", "--flag"]);
    }

    #[tokio::test]
    async fn mc16_agent_env_has_no_session_leak() {
        let dir = tempfile::tempdir().unwrap();
        let terminals = Terminals::open_with(dir.path(), Bus::new(), &["CLAUDECODE"]).unwrap();
        let p = run_params(&terminals.shared, &launch(), 4);
        // Names the launch or the Daemon removes are neither in env nor left to the core's own.
        assert!(p["env"].get("CLAUDECODE").is_none());
        for name in [
            "CLAUDECODE",
            "CLAUDE_CODE_SESSION_ID",
            "TMUX",
            "TERM_PROGRAM",
        ] {
            assert!(p["env"].get(name).is_none(), "{name}");
        }
        assert_eq!(p["env"]["ROUNDUP_AGENT"], "7");
    }

    #[test]
    fn mc16_core_starts_from_clean_environment() {
        let vars = [("PATH".to_owned(), "/usr/bin".to_owned())].into();
        assert_eq!(
            core_command("/bin/herdr-core", &vars),
            ["env", "-i", "PATH=/usr/bin", "/bin/herdr-core", "connect"]
        );
    }

    #[tokio::test]
    async fn mc16_spawn_failed_is_the_callers_error() {
        let dir = tempfile::tempdir().unwrap();
        let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
        let (conn, _seen) = run_core(
            json!({"code":-32000,"message":"no such directory","data":{"kind":"spawn_failed"}}),
        )
        .await;
        let err = run(&conn, &terminals.shared, &launch(), 1)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("cannot run"), "{err}");
    }
}
