//! MC13, MC14, MC15: a Terminal on a Machine runs in that Machine's herdr-core, reached through
//! `ssh <host> herdr-core connect`, one connection per Machine, and outlives that ssh.
use std::future::Future;
use std::pin::Pin;

use super::host::{CORE_TIMEOUT, Relink};
use super::*;

/// How many lines of scrollback a reattach asks for, so the repaint holds what the outage printed.
const REATTACH_HISTORY: u32 = 5000;
/// The longest wait between reconnect attempts.
const LONGEST_WAIT: Duration = Duration::from_secs(5);

type Connect = dyn Fn(String) -> Pin<Box<dyn Future<Output = herdr::Result<herdr::Conn>> + Send>>
    + Send
    + Sync;

/// What a lost channel's owner needs to find its program again: the connection and the channel's
/// sending half, which a reattach replaces.
pub(super) struct Link {
    pub(super) conn: Arc<herdr::Conn>,
    pub(super) tx: herdr::Sender,
}

/// The connections to remote Machines, and whether each answered last.
pub(super) struct Remotes {
    conns: tokio::sync::Mutex<BTreeMap<String, Arc<herdr::Conn>>>,
    reach: watch::Sender<BTreeMap<String, bool>>,
    connect: Box<Connect>,
}

impl Remotes {
    /// Connections through the user's ssh.
    pub(super) fn ssh() -> Self {
        Self::with(|host| {
            Box::pin(async move { herdr::Conn::connect_ssh(&host, CORE_TIMEOUT).await })
        })
    }

    pub(super) fn with(
        connect: impl Fn(String) -> Pin<Box<dyn Future<Output = herdr::Result<herdr::Conn>> + Send>>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        Self {
            conns: Default::default(),
            reach: watch::channel(BTreeMap::new()).0,
            connect: Box::new(connect),
        }
    }

    /// MC15: each Machine roundup has tried, and whether its ssh answered.
    pub(super) fn reachability(&self) -> BTreeMap<String, bool> {
        self.reach.borrow().clone()
    }

    fn mark(&self, machine: &str, reachable: bool) {
        self.reach
            .send_if_modified(|all| all.insert(machine.to_owned(), reachable) != Some(reachable));
    }

    /// The one connection to `machine`, opened when none is open. An ssh that does not answer (a
    /// Machine off, or hibernated and not yet woken) marks it unreachable; a hello marks it reachable.
    pub(super) async fn conn(&self, machine: &str) -> Result<Arc<herdr::Conn>, Error> {
        let mut conns = self.conns.lock().await;
        if let Some(conn) = conns.get(machine).filter(|conn| !conn.is_closed()) {
            return Ok(Arc::clone(conn));
        }
        match (self.connect)(machine.to_owned()).await {
            Ok(conn) => {
                let conn = Arc::new(conn);
                conns.insert(machine.to_owned(), Arc::clone(&conn));
                self.mark(machine, true);
                Ok(conn)
            }
            Err(err) => {
                conns.remove(machine);
                self.mark(machine, false);
                Err(Error::internal(format!("{machine}: {}: {err}", err.code())))
            }
        }
    }
}

/// An ssh name is one word that no option can pass for.
pub(super) fn check_machine(name: &str) -> Result<(), Error> {
    if name.is_empty()
        || name.starts_with('-')
        || name.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(invalid(format!("not an ssh name: {name:?}")));
    }
    Ok(())
}

/// The wait between two attempts to reach a Machine, on this thread's own clock.
fn pause(wait: Duration) {
    std::thread::sleep(wait);
}

enum Step {
    Retry,
    Gone(Arc<herdr::Conn>),
    Live(Arc<herdr::Conn>, herdr::Stream),
}

/// MC14: the way back to Terminal `core_id` on `machine` after its ssh is lost. The program kept
/// running in the core, so a new connection asks for its state, attaches with `history`, and takes
/// the size back with RESIZE, since the last active viewer sets it. A Machine that does not answer
/// is tried again, with waits on this thread's own clock and none read from the Machine (it steps
/// forward on wake).
pub(super) fn relink(
    remotes: Arc<Remotes>,
    machine: String,
    core_id: String,
    link: Arc<Mutex<Link>>,
    screen: Arc<Mutex<ScreenState>>,
    runtime: tokio::runtime::Handle,
) -> Relink {
    Box::new(move || {
        let mut wait = Duration::from_millis(250);
        loop {
            remotes.mark(&machine, false);
            let step = runtime.block_on(async {
                let Ok(conn) = remotes.conn(&machine).await else {
                    return Step::Retry;
                };
                match conn
                    .call("terminal.get", serde_json::json!({"terminal": core_id}))
                    .await
                {
                    Ok(got) if got.get("state").and_then(Value::as_str) == Some("live") => {}
                    Ok(_) => return Step::Gone(conn),
                    Err(herdr::Error::Rpc(err)) if err.kind == "not_found" => {
                        return Step::Gone(conn);
                    }
                    Err(_) => return Step::Retry,
                }
                let (cols, rows) = match screen.lock() {
                    Ok(state) => (state.cols, state.rows),
                    Err(_) => return Step::Gone(conn),
                };
                match conn.attach(&core_id, cols, rows, REATTACH_HISTORY).await {
                    Ok(stream) => {
                        stream.resize(cols, rows);
                        Step::Live(conn, stream)
                    }
                    Err(_) => Step::Retry,
                }
            });
            match step {
                Step::Retry => {
                    pause(wait);
                    wait = (wait * 2).min(LONGEST_WAIT);
                }
                Step::Gone(conn) => {
                    if let Ok(mut link) = link.lock() {
                        link.conn = conn;
                    }
                    return None;
                }
                Step::Live(conn, stream) => {
                    if let Ok(mut link) = link.lock() {
                        link.conn = conn;
                        link.tx = stream.sender();
                    }
                    return Some(stream);
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use serde_json::json;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, duplex};

    use super::*;

    /// What one connection's attach replays, and how the connection ends.
    struct Script {
        frames: Vec<Vec<u8>>,
        /// `None` drops the pipe, as a lost ssh does; else the CLOSE reason of the channel.
        close: Option<Value>,
    }

    fn frame(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
        let mut v = channel.to_le_bytes().to_vec();
        v.push(kind);
        v.extend((payload.len() as u32).to_le_bytes());
        v.extend(payload);
        v
    }

    /// A connector whose nth connection is a fake core playing `scripts[n]`; a connection past the
    /// scripts fails, as an ssh that does not answer.
    fn fake_ssh(
        scripts: Vec<Script>,
    ) -> impl Fn(String) -> Pin<Box<dyn Future<Output = herdr::Result<herdr::Conn>> + Send>> {
        let scripts = Arc::new(Mutex::new(
            scripts.into_iter().map(Some).collect::<Vec<_>>(),
        ));
        let n = Arc::new(AtomicUsize::new(0));
        move |_host| {
            let script = scripts
                .lock()
                .unwrap()
                .get_mut(n.fetch_add(1, Ordering::SeqCst))
                .and_then(Option::take);
            Box::pin(async move {
                let Some(script) = script else {
                    return Err(herdr::Error::Closed);
                };
                let (mac_r, mut core_w) = duplex(1 << 20);
                let (core_r, mac_w) = duplex(1 << 20);
                tokio::spawn(async move {
                    let mut r = tokio::io::BufReader::new(core_r);
                    let mut line = String::new();
                    r.read_line(&mut line).await.unwrap();
                    let hello = r#"{"id":0,"jsonrpc":"2.0","result":{"generation":1,"version":"0","methods":[]}}"#;
                    core_w
                        .write_all(format!("{hello}\n").as_bytes())
                        .await
                        .unwrap();
                    loop {
                        let mut h = [0u8; 9];
                        if r.read_exact(&mut h).await.is_err() {
                            return;
                        }
                        let mut p =
                            vec![0u8; u32::from_le_bytes([h[5], h[6], h[7], h[8]]) as usize];
                        r.read_exact(&mut p).await.unwrap();
                        if h[4] != 0 || h[0] != 0 {
                            continue;
                        }
                        let msg: Value = serde_json::from_slice(&p).unwrap();
                        let result = match msg["method"].as_str() {
                            Some("terminal.attach") => json!({"channel":5}),
                            _ => json!({"address":"c1","pid":42,"state":"live"}),
                        };
                        let reply = json!({"jsonrpc":"2.0","id":msg["id"],"result":result});
                        core_w
                            .write_all(&frame(0, 0, reply.to_string().as_bytes()))
                            .await
                            .unwrap();
                        if msg["method"] == "terminal.attach" {
                            for f in &script.frames {
                                core_w.write_all(&frame(5, 0, f)).await.unwrap();
                            }
                            match &script.close {
                                None => return,
                                Some(reason) => core_w
                                    .write_all(&frame(5, 2, reason.to_string().as_bytes()))
                                    .await
                                    .unwrap(),
                            }
                        }
                    }
                });
                herdr::Conn::over(mac_r, mac_w, Duration::from_secs(5)).await
            })
        }
    }

    fn ticks(range: std::ops::RangeInclusive<u32>) -> Vec<u8> {
        range
            .flat_map(|n| format!("tick {n}\r\n").into_bytes())
            .collect()
    }

    fn launch(machine: &str) -> SpawnParams {
        SpawnParams {
            cwd: "/srv/work".into(),
            command: Some(vec!["sh".into()]),
            env: BTreeMap::new(),
            unset: Vec::new(),
            cols: 100,
            rows: 30,
            machine: Some(machine.into()),
        }
    }

    async fn output(mut spawned: Spawned) -> String {
        let mut text = Vec::new();
        tokio::time::timeout(Duration::from_secs(10), async {
            while let Some(out) = spawned.output.next().await {
                if let Output::Bytes { bytes, .. } = out {
                    text.extend_from_slice(&bytes);
                }
            }
        })
        .await
        .expect("the output ends");
        String::from_utf8(text).unwrap()
    }

    #[tokio::test]
    async fn mc14_gap_filled_from_history_without_duplicate_lines() {
        let dir = tempfile::tempdir().unwrap();
        let mut terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
        // The ssh is lost after tick 10; the repaint of the second connection holds ticks 8 to 20,
        // the last ten of which came during the outage.
        terminals.remotes = Arc::new(Remotes::with(fake_ssh(vec![
            Script {
                frames: vec![ticks(1..=10)],
                close: None,
            },
            Script {
                frames: vec![ticks(8..=20)],
                close: Some(json!({"exit_code":0})),
            },
        ])));
        let spawned = terminals.spawn(launch("box")).await.unwrap();
        let text = output(spawned).await;
        assert_eq!(text.as_bytes(), ticks(1..=20));
        assert!(terminals.machine_reachability()["box"]);
    }

    #[tokio::test]
    async fn mc15_a_machine_that_does_not_answer_is_unreachable_until_it_does() {
        let remotes = Remotes::with(fake_ssh(vec![]));
        assert!(remotes.conn("box").await.is_err());
        assert!(!remotes.reachability()["box"]);
        let remotes = Remotes::with(fake_ssh(vec![Script {
            frames: vec![],
            close: None,
        }]));
        remotes.conn("box").await.unwrap();
        assert!(remotes.reachability()["box"]);
    }

    #[tokio::test]
    async fn mc13_a_machine_name_cannot_pass_for_an_ssh_option() {
        let dir = tempfile::tempdir().unwrap();
        let terminals = Terminals::open(dir.path(), Bus::new()).unwrap();
        for name in ["-oProxyCommand=x", "a b", ""] {
            assert!(terminals.spawn(launch(name)).await.is_err(), "{name:?}");
        }
    }
}
