//! herdr-core as a Terminal's host, beside `remote.rs`: the framed attach stream feeds the same
//! `Chunk` broadcast, `ScreenState` and status records the PTY reader does, through `pty::read`.
use super::*;

/// The bytes of one attached channel as a [`Read`]. Frames are cut anywhere, a UTF-8 character
/// included, so bytes pass through undecoded and the screen parser decodes once.
struct StreamReader {
    stream: herdr::Stream,
    frame: Vec<u8>,
    taken: usize,
    /// The core's reason object from the channel's CLOSE.
    closed: Arc<Mutex<Option<Value>>>,
}

impl Read for StreamReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        while self.taken == self.frame.len() {
            match self.stream.blocking_next() {
                Some(herdr::Ev::Data(bytes)) => {
                    self.frame = bytes;
                    self.taken = 0;
                }
                Some(herdr::Ev::Resize(..)) => {}
                Some(herdr::Ev::Close(reason)) => {
                    if let Ok(mut closed) = self.closed.lock() {
                        *closed = Some(reason);
                    }
                    return Ok(0);
                }
                None => return Ok(0),
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
pub(super) fn feed(
    shared: &Shared,
    number: u64,
    stream: herdr::Stream,
    screen: &Mutex<ScreenState>,
    output: &broadcast::Sender<Chunk>,
) -> Result<Option<i32>, Error> {
    let closed = Arc::new(Mutex::new(None));
    let reader = StreamReader {
        stream,
        frame: Vec::new(),
        taken: 0,
        closed: Arc::clone(&closed),
    };
    pty::read(
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt, duplex};

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
            feed(&shared, 1, stream, &mirror, &output).unwrap()
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
        pty::read(
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
        tokio::task::spawn_blocking(move || feed(&shared, 7, stream, &screen, &output).unwrap())
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
}
