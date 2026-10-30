use super::*;
use contracts::terminal::TerminalInfo;
use portable_pty::{ChildKiller, ExitStatus};
use provenance::Touches;
use serde_json::json;
use std::io;
use std::sync::atomic::AtomicU64;

#[derive(Debug)]
struct Ended;
impl ChildKiller for Ended {
    fn kill(&mut self) -> io::Result<()> {
        Ok(())
    }
    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(Ended)
    }
}
impl Child for Ended {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        Ok(Some(ExitStatus::with_exit_code(0)))
    }
    fn wait(&mut self) -> io::Result<ExitStatus> {
        Ok(ExitStatus::with_exit_code(0))
    }
    fn process_id(&self) -> Option<u32> {
        None
    }
}

struct Writer(Arc<AtomicU64>, Arc<Mutex<Vec<u8>>>);
impl Write for Writer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.1.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.0.store(107, Ordering::SeqCst);
        Ok(())
    }
}

struct Reader {
    chunks: std::collections::VecDeque<(u64, Vec<u8>)>,
    clock: Arc<AtomicU64>,
    observed: Option<tokio::sync::oneshot::Sender<()>>,
    end: mpsc::Receiver<()>,
}
impl Read for Reader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if let Some((at, chunk)) = self.chunks.pop_front() {
            self.clock.store(at, Ordering::SeqCst);
            bytes[..chunk.len()].copy_from_slice(&chunk);
            return Ok(chunk.len());
        }
        if let Some(observed) = self.observed.take() {
            observed.send(()).unwrap();
        }
        self.end.recv().unwrap();
        Ok(0)
    }
}

/// Production handler → queue → physical writer → PTY pump → serialized measurement, with no child program or window.
#[tokio::test]
async fn r20_hop_report_accounts_for_the_echo_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let mut terminals = Terminals::open(dir.path(), bus.clone()).unwrap();
    let time = Arc::new(AtomicU64::new(100));
    let clock_time = time.clone();
    Arc::get_mut(&mut terminals.shared).unwrap().clock =
        Arc::new(move || clock_time.load(Ordering::SeqCst) as f64);
    let ctx = Ctx {
        actor: Actor::user(),
        bus,
        touches: Arc::new(Touches::open(&dir.path().join("touches.db")).unwrap()),
    };
    let (input, queued) = mpsc::sync_channel(16);
    // A PTY handle only: no process is spawned. The controlled writer/reader use the production loops.
    let pair = native_pty_system()
        .openpty(window(80, 24).unwrap())
        .unwrap();
    let program: Program = Arc::new(Mutex::new(Box::new(Ended)));
    let recorder = Arc::new(OnceLock::new());
    let screen = Arc::new(Mutex::new(ScreenState {
        parser: ScreenParser::Pending,
        after: 0,
        log: output::Log::default(),
        cursors: Default::default(),
        snapshot_available: true,
        scrollback_rows: 0,
        cols: 80,
        rows: 24,
        scheme_notices: false,
    }));
    let (output, _) = broadcast::channel(256);
    let (events, _) = broadcast::channel(16);
    terminals.shared.table().insert(
        1,
        Entry {
            info: TerminalInfo {
                program_pid: None,
                id: "1".into(),
                incarnation: "fixture".into(),
                cwd: dir.path().display().to_string(),
                title: None,
                program: "fixture".into(),
                running: true,
                exit_code: None,
                owner: None,
            },
            pid: None,
            events,
            output: Some(output.clone()),
            screen: screen.clone(),
            handle: Some(Arc::new(Handle {
                master: Mutex::new(pair.master),
                input,
                program: program.clone(),
                recorder: recorder.clone(),
            })),
        },
    );
    let query = json!({"id":"1", "run":"test"});
    terminals
        .call(&ctx, "terminal.measure", query.clone())
        .await
        .unwrap();
    time.store(102, Ordering::SeqCst);
    let bytes = b"\x1b]777;test-0\x07a";
    assert_eq!(
        terminals
            .call(
                &ctx,
                "terminal.write",
                json!({"id":"1", "data":STANDARD.encode(bytes)})
            )
            .await
            .unwrap(),
        Value::Null
    );
    let before = terminals
        .call(&ctx, "terminal.measure", query.clone())
        .await
        .unwrap();
    assert_eq!(
        before["samples"][0]["written"],
        Value::Null,
        "enqueue acknowledgement is not physical completion"
    );
    let input = queued.try_recv().unwrap();
    let (tx, rx) = mpsc::sync_channel(1);
    tx.send(input).unwrap();
    drop(tx);
    let written = Arc::new(Mutex::new(Vec::new()));
    pty::type_queued(
        1,
        rx,
        Box::new(Writer(time.clone(), written.clone())),
        terminals.shared.clock.clone(),
    );
    assert_eq!(*written.lock().unwrap(), bytes);
    let (observed, arrived) = tokio::sync::oneshot::channel();
    let (end, ending) = mpsc::channel();
    let reader = Reader {
        chunks: [
            (111, b"unrelated a".to_vec()),
            (112, bytes[..8].to_vec()),
            (113, bytes[8..bytes.len() - 1].to_vec()),
            (117, bytes[bytes.len() - 1..].to_vec()),
        ]
        .into(),
        clock: time,
        observed: Some(observed),
        end: ending,
    };
    let shared = terminals.shared.clone();
    let handle = terminals.running("1").unwrap();
    let pump = std::thread::spawn(move || {
        pty::pump(&shared, 1, Box::new(reader), &handle, &screen, output, None)
    });
    arrived.await.unwrap();
    let report = terminals
        .call(&ctx, "terminal.measure", query)
        .await
        .unwrap();
    end.send(()).unwrap();
    pump.join().unwrap();
    let serialized: Value = serde_json::from_str(&serde_json::to_string(&report).unwrap()).unwrap();
    assert_eq!(
        serialized["samples"],
        json!([{"token":"\u{1b}]777;test-0\u{7}a", "received":102.0,"written":107.0,"read":117.0,"ambiguous":false}])
    );
}

#[test]
fn r20_duplicate_echo_is_ambiguous_and_missing_echo_stays_missing() {
    let mut recorder = Recording::new("test").unwrap();
    recorder.receive(b"\x1b]777;test-0\x07a\x1b]777;test-1\x07a", 1.0);
    recorder.read(b"noise a\x1b]777;test-0\x07a", 2.0);
    recorder.read(b"\x1b]777;test-0\x07a", 3.0);
    let samples = recorder.samples();
    assert!(samples[0].ambiguous);
    assert_eq!(samples[1].read, None);
}

#[tokio::test]
async fn r20_agents_and_extensions_cannot_enable_or_read_a_recording() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let terminals = Terminals::open(dir.path(), bus.clone()).unwrap();
    for kind in [contracts::ActorKind::Agent, contracts::ActorKind::Ext] {
        let ctx = Ctx {
            actor: Actor {
                kind,
                id: "other".into(),
                parent: None,
            },
            bus: bus.clone(),
            touches: Arc::new(Touches::open(&dir.path().join("touches.db")).unwrap()),
        };
        let error = terminals
            .call(&ctx, "terminal.measure", json!({"id":"1", "run":"test"}))
            .await
            .unwrap_err();
        assert_eq!(error.code, code::FORBIDDEN);
    }
}

#[tokio::test]
async fn r21_buffered_output_yields_to_other_terminals() {
    let (sender, receiver) = broadcast::channel(256);
    for offset in 0..64 {
        assert!(
            sender
                .send(Chunk {
                    offset,
                    bytes: Arc::from(&b"x"[..]),
                })
                .is_ok()
        );
    }
    let mut stream = OutputStream {
        receiver,
        next: 0,
        after_gap: None,
    };
    let progress = Arc::new(AtomicU64::new(0));
    let written = progress.clone();
    let input = tokio::spawn(async move {
        written.store(1, Ordering::SeqCst);
    });
    // A ready output backlog must leave a turn for another Terminal's runnable input.
    for _ in 0..32 {
        stream.next().await.unwrap();
    }
    assert_eq!(progress.load(Ordering::SeqCst), 1);
    input.await.unwrap();
}
