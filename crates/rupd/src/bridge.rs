//! MC23, MC26: the Mac's one ssh bridge per Machine. It dials `socat - UNIX-CONNECT:<relay socket>`
//! over the user's own ssh (never `ssh -R`), relays each Spool line the machine sends into this
//! Daemon, returns `{"ack": id}` only after the Daemon answered it (`{"nack": id}` when it refused),
//! and relays a live call and its reply. It holds no queue and no state beyond whether it is up:
//! the Spool is on the machine and its replay is the machine's. A Machine with no bridge up is
//! Away, a status the Machine's Agents' rows show, with no alert.

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::Instant;

/// The wait before the first reconnect; it doubles up to [`CAP`] and resets after a success.
pub const FIRST: Duration = Duration::from_millis(300);
/// The longest wait between two connects.
pub const CAP: Duration = Duration::from_secs(30);
/// A bridge is up once a connect has been quiet this long with nothing in flight: the machine's
/// Spool has drained into this Daemon. It counts this Mac's own clock, never the machine's.
const SETTLE: Duration = Duration::from_millis(500);

/// One connection to a machine's relay socket.
pub struct Link {
    pub read: Box<dyn AsyncRead + Send + Unpin>,
    pub write: Box<dyn AsyncWrite + Send + Unpin>,
    /// What ends the connection when dropped: the ssh child.
    pub hold: Box<dyn Send>,
}

type Dial = dyn Fn(String) -> Pin<Box<dyn Future<Output = io::Result<Link>> + Send>> + Send + Sync;

/// The bridges this Daemon holds, one per Machine.
#[derive(Clone)]
pub struct Bridges {
    dial: Arc<Dial>,
    kept: Arc<Mutex<BTreeMap<String, Kept>>>,
    /// The Daemon's own socket, once it serves one; no bridge starts before.
    socket: Arc<Mutex<Option<PathBuf>>>,
}

struct Kept {
    away: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

impl Drop for Kept {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Default for Bridges {
    fn default() -> Self {
        Self::with_dial(ssh)
    }
}

/// The user's own `ssh`; the remote shell expands `$HOME`, as `rup` does for its default socket.
fn ssh(host: String) -> Pin<Box<dyn Future<Output = io::Result<Link>> + Send>> {
    Box::pin(async move {
        let mut child = tokio::process::Command::new("ssh")
            .args([
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ServerAliveInterval=15",
                "-o",
                "ServerAliveCountMax=3",
                "--",
                &host,
                "socat - UNIX-CONNECT:$HOME/rupq-relay.sock",
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let write = child.stdin.take().ok_or(io::ErrorKind::BrokenPipe)?;
        let read = child.stdout.take().ok_or(io::ErrorKind::BrokenPipe)?;
        Ok(Link {
            read: Box::new(read),
            write: Box::new(write),
            hold: Box::new(child),
        })
    })
}

/// An ssh name is one word that no option can pass for.
fn is_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.chars().any(|c| c.is_whitespace() || c.is_control())
}

impl Bridges {
    /// Bridges that connect through `dial` instead of ssh.
    pub fn with_dial(
        dial: impl Fn(String) -> Pin<Box<dyn Future<Output = io::Result<Link>> + Send>>
        + Send
        + Sync
        + 'static,
    ) -> Self {
        Self {
            dial: Arc::new(dial),
            kept: Arc::default(),
            socket: Arc::default(),
        }
    }

    /// The socket the bridges relay into, the one this Daemon serves.
    pub fn serving(&self, socket: &Path) {
        *self.socket.lock() = Some(socket.to_owned());
    }

    /// MC26: exactly one bridge for each of `machines`, to the Daemon at `socket`. A Machine
    /// already kept keeps its bridge, one no longer listed loses it, and its Spool stays on it.
    pub fn sync(&self, machines: &[String]) {
        let Some(socket) = self.socket.lock().clone() else {
            return;
        };
        let mut kept = self.kept.lock();
        kept.retain(|name, _| machines.contains(name));
        for name in machines.iter().filter(|name| is_name(name)) {
            if kept.contains_key(name) {
                continue;
            }
            let away = Arc::new(AtomicBool::new(true));
            let task = tokio::spawn(supervise(
                name.clone(),
                Arc::clone(&self.dial),
                socket.clone(),
                Arc::clone(&away),
            ));
            kept.insert(name.clone(), Kept { away, task });
        }
    }

    /// Whether the bridge to `machine` is down; `None` when this Daemon holds none for it.
    pub fn away(&self, machine: &str) -> Option<bool> {
        self.kept
            .lock()
            .get(machine)
            .map(|kept| kept.away.load(Ordering::Relaxed))
    }
}

/// MC26: connect, serve until the connection ends, wait, and again; the wait is [`FIRST`], doubling
/// to [`CAP`], and starts over after a connect that came up.
async fn supervise(host: String, dial: Arc<Dial>, socket: PathBuf, away: Arc<AtomicBool>) {
    let mut wait = FIRST;
    loop {
        let up = match dial(host.clone()).await {
            Ok(link) => session(link, &socket, &away).await,
            Err(_) => false,
        };
        away.store(true, Ordering::Relaxed);
        tokio::time::interval_at(tokio::time::Instant::now() + wait, wait)
            .tick()
            .await;
        wait = if up { FIRST } else { (wait * 2).min(CAP) };
    }
}

/// Serve one connection. Returns whether it succeeded: it came up (quiet, nothing in flight, for
/// [`SETTLE`]) or the machine sent it something, so a link that keeps dying mid-drain does not back off.
async fn session(link: Link, socket: &Path, away: &AtomicBool) -> bool {
    let Link { read, write, hold } = link;
    let _hold = hold;
    let mut write = write;
    let mut lines = BufReader::new(read).lines();
    let (out, mut frames) = mpsc::unbounded_channel::<Value>();
    // Reports in flight: the drain is over when none is and the machine has gone quiet.
    let mut reports = JoinSet::new();
    let mut live: HashMap<u64, mpsc::UnboundedSender<Value>> = HashMap::new();
    let mut lives = JoinSet::new();
    let mut last = Instant::now();
    let mut up = false;
    let mut heard = false;
    loop {
        tokio::select! {
            line = lines.next_line() => {
                let Ok(Some(line)) = line else { break };
                last = Instant::now();
                heard = true;
                let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
                if let Some(n) = frame.get("c").and_then(Value::as_u64) {
                    if frame.get("close").is_some() {
                        live.remove(&n);
                    } else if let Some(d) = frame.get("d") {
                        let to = live.entry(n).or_insert_with(|| {
                            let (to, inbox) = mpsc::unbounded_channel();
                            lives.spawn(live_call(n, socket.to_owned(), inbox, out.clone()));
                            to
                        });
                        let _ = to.send(d.clone());
                    }
                } else if frame.get("id").is_some() {
                    reports.spawn(report(frame, socket.to_owned(), out.clone()));
                }
            }
            Some(frame) = frames.recv() => {
                if write.write_all(format!("{frame}\n").as_bytes()).await.is_err() { break }
                if write.flush().await.is_err() { break }
            }
            Some(_) = reports.join_next(), if !reports.is_empty() => last = Instant::now(),
            () = tokio::time::sleep_until(last + SETTLE), if !up && reports.is_empty() => {
                up = true;
                away.store(false, Ordering::Relaxed);
            }
        }
    }
    up || heard
}

/// MC23: hand one Spool line to the Daemon as its Agent and answer the machine: `ack` once the
/// Daemon replied with a result, `nack` for an error or no answer, so the line stays in the Spool.
async fn report(line: Value, socket: PathBuf, out: mpsc::UnboundedSender<Value>) {
    let id = line
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let agent = id.rsplit_once(':').map_or("", |(agent, _)| agent);
    let answered = async {
        let mut stream = UnixStream::connect(&socket).await.ok()?;
        let identify = json!({"jsonrpc": "2.0", "id": 1, "method": "daemon.identify",
            "params": {"actor": {"kind": "agent", "id": agent}}});
        let call = json!({"jsonrpc": "2.0", "id": 2, "method": line.get("method").cloned().unwrap_or_default(),
            "params": line.get("params").cloned().unwrap_or_default()});
        stream
            .write_all(format!("{identify}\n{call}\n").as_bytes())
            .await
            .ok()?;
        let mut lines = BufReader::new(stream).lines();
        loop {
            let reply: Value = serde_json::from_str(&lines.next_line().await.ok()??).ok()?;
            if reply.get("id") == Some(&json!(2)) {
                break Some(reply.get("result").is_some());
            }
        }
    }
    .await;
    let key = if answered == Some(true) {
        "ack"
    } else {
        "nack"
    };
    let _ = out.send(json!({ key: id }));
}

/// A live call of the machine: its own connection to the Daemon, so its identity and events stay its
/// own; each line the Daemon sends back goes to the machine as `{"c": n, "d": line}`.
async fn live_call(
    n: u64,
    socket: PathBuf,
    mut inbox: mpsc::UnboundedReceiver<Value>,
    out: mpsc::UnboundedSender<Value>,
) {
    let Ok(stream) = UnixStream::connect(&socket).await else {
        // The Daemon is not there: answer each request with an error, so the caller does not hang.
        while let Some(d) = inbox.recv().await {
            let error = json!({"jsonrpc": "2.0", "id": d.get("id").cloned().unwrap_or_default(),
                "error": {"code": -32603, "message": "the Daemon did not answer"}});
            let _ = out.send(json!({ "c": n, "d": error }));
        }
        return;
    };
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    loop {
        tokio::select! {
            request = inbox.recv() => {
                let Some(request) = request else { return };
                if write.write_all(format!("{request}\n").as_bytes()).await.is_err() { return }
            }
            reply = lines.next_line() => {
                let Ok(Some(reply)) = reply else { return };
                let Ok(d) = serde_json::from_str::<Value>(&reply) else { continue };
                if out.send(json!({ "c": n, "d": d })).is_err() { return }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    //! MC23 and MC26 against a fake relay (the machine's side of the frames) and a fake Daemon.
    use super::*;
    use tokio::io::{DuplexStream, duplex};
    use tokio::net::UnixListener;

    /// A Daemon at a socket that records each request it gets and answers with `reply`.
    fn fake_rupd(
        dir: &Path,
        reply: impl Fn(&Value) -> Option<Value> + Send + Sync + 'static,
    ) -> (PathBuf, Arc<Mutex<Vec<Value>>>) {
        let socket = dir.join("rupd.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = Arc::clone(&seen);
        let reply = Arc::new(reply);
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let (log, reply) = (Arc::clone(&log), Arc::clone(&reply));
                tokio::spawn(async move {
                    let (read, mut write) = stream.into_split();
                    let mut lines = BufReader::new(read).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        let request: Value = serde_json::from_str(&line).unwrap();
                        log.lock().push(request.clone());
                        let answer = if request["method"] == "daemon.identify" {
                            Some(json!({"jsonrpc": "2.0", "id": request["id"], "result": null}))
                        } else {
                            reply(&request)
                        };
                        if let Some(answer) = answer {
                            let _ = write.write_all(format!("{answer}\n").as_bytes()).await;
                        }
                    }
                });
            }
        });
        (socket, seen)
    }

    /// The machine's end of one link: lines it sends, lines the bridge sent back.
    struct Machine {
        to_bridge: DuplexStream,
        from_bridge: tokio::io::Lines<BufReader<DuplexStream>>,
    }

    impl Machine {
        async fn send(&mut self, frame: Value) {
            self.to_bridge
                .write_all(format!("{frame}\n").as_bytes())
                .await
                .unwrap();
        }
        async fn next(&mut self) -> Value {
            let line = self.from_bridge.next_line().await.unwrap().unwrap();
            serde_json::from_str(&line).unwrap()
        }
    }

    fn pair() -> (Link, Machine) {
        let (bridge_read, to_bridge) = duplex(1 << 16);
        let (from_bridge, bridge_write) = duplex(1 << 16);
        let link = Link {
            read: Box::new(bridge_read),
            write: Box::new(bridge_write),
            hold: Box::new(()),
        };
        let machine = Machine {
            to_bridge,
            from_bridge: BufReader::new(from_bridge).lines(),
        };
        (link, machine)
    }

    fn line(id: &str) -> Value {
        json!({"id": id, "method": "agent.signal", "params": {"report": id}})
    }

    #[tokio::test]
    async fn mc23_ack_follows_rupd_ack() {
        let dir = tempfile::tempdir().unwrap();
        let (socket, seen) = fake_rupd(dir.path(), |request| {
            Some(json!({"jsonrpc": "2.0", "id": request["id"], "result": {"ack": "a1:1"}}))
        });
        let (link, mut machine) = pair();
        let away = AtomicBool::new(true);
        let task = tokio::spawn(async move { session(link, &socket, &away).await });
        machine.send(line("a1:1")).await;
        assert_eq!(machine.next().await, json!({"ack": "a1:1"}));
        let requests = seen.lock().clone();
        assert_eq!(requests[0]["method"], "daemon.identify");
        assert_eq!(requests[0]["params"]["actor"]["id"], "a1");
        assert_eq!(requests[1]["params"]["report"], "a1:1");
        drop(machine);
        // The link ended before it settled, but the machine had sent it a report: no backoff.
        assert!(task.await.unwrap());
    }

    #[tokio::test]
    async fn mc23_an_error_from_rupd_is_a_nack_and_no_ack() {
        let dir = tempfile::tempdir().unwrap();
        let (socket, _) = fake_rupd(dir.path(), |request| {
            Some(json!({"jsonrpc": "2.0", "id": request["id"],
                "error": {"code": -32603, "message": "no"}}))
        });
        let (link, mut machine) = pair();
        let away = AtomicBool::new(true);
        tokio::spawn(async move { session(link, &socket, &away).await });
        machine.send(line("a1:1")).await;
        assert_eq!(machine.next().await, json!({"nack": "a1:1"}));
    }

    #[tokio::test]
    async fn mc23_the_ack_waits_for_the_daemon() {
        let dir = tempfile::tempdir().unwrap();
        let release = Arc::new(Mutex::new(None::<Value>));
        let answer = Arc::clone(&release);
        let (socket, _) = fake_rupd(dir.path(), move |request| {
            answer
                .lock()
                .take()
                .map(|_| json!({"jsonrpc": "2.0", "id": request["id"], "result": {"ack": "a1:1"}}))
        });
        let (link, mut machine) = pair();
        let away = AtomicBool::new(true);
        tokio::spawn(async move { session(link, &socket, &away).await });
        machine.send(line("a1:1")).await;
        let none = tokio::time::timeout(Duration::from_millis(300), machine.next()).await;
        assert!(none.is_err(), "no ack while the Daemon has not answered");
        // The Daemon answers a retry: the machine replays the line on its next connect.
        *release.lock() = Some(Value::Null);
        machine.send(line("a1:1")).await;
        assert_eq!(machine.next().await, json!({"ack": "a1:1"}));
    }

    #[tokio::test]
    async fn mc23_a_live_call_and_its_reply_are_relayed() {
        let dir = tempfile::tempdir().unwrap();
        let (socket, _) = fake_rupd(dir.path(), |request| {
            Some(json!({"jsonrpc": "2.0", "id": request["id"], "result": "pong"}))
        });
        let (link, mut machine) = pair();
        let away = AtomicBool::new(true);
        tokio::spawn(async move { session(link, &socket, &away).await });
        machine
            .send(json!({"c": 3, "d": {"jsonrpc": "2.0", "id": 9, "method": "ping"}}))
            .await;
        assert_eq!(
            machine.next().await,
            json!({"c": 3, "d": {"jsonrpc": "2.0", "id": 9, "result": "pong"}})
        );
    }

    type Dials = Arc<Mutex<Vec<(String, Instant)>>>;

    /// A dial that counts its calls and gives each a link that ends at once, or a kept one.
    fn counting(quick: bool) -> (Bridges, Dials, Arc<Mutex<Vec<Machine>>>) {
        let dials = Arc::new(Mutex::new(Vec::new()));
        let machines = Arc::new(Mutex::new(Vec::new()));
        let (log, kept) = (Arc::clone(&dials), Arc::clone(&machines));
        let bridges = Bridges::with_dial(move |host| {
            log.lock().push((host, Instant::now()));
            let (link, machine) = pair();
            if quick {
                drop(machine);
            } else {
                kept.lock().push(machine);
            }
            Box::pin(async move { Ok(link) })
        });
        (bridges, dials, machines)
    }

    #[tokio::test(start_paused = true)]
    async fn mc26_one_bridge_per_machine() {
        let (bridges, dials, _keep) = counting(false);
        let names = vec!["box".to_owned(), "far".to_owned()];
        bridges.serving(Path::new("/none"));
        bridges.sync(&names);
        bridges.sync(&names);
        tokio::time::sleep(Duration::from_secs(5)).await;
        let hosts: Vec<String> = dials.lock().iter().map(|(h, _)| h.clone()).collect();
        assert_eq!(hosts, ["box", "far"]);
    }

    #[tokio::test(start_paused = true)]
    async fn mc26_reconnects_by_itself_with_backoff() {
        let (bridges, dials, _) = counting(true);
        bridges.serving(Path::new("/none"));
        bridges.sync(&["box".to_owned()]);
        tokio::time::sleep(Duration::from_secs(400)).await;
        let times: Vec<Instant> = dials.lock().iter().map(|(_, t)| *t).collect();
        let gaps: Vec<Duration> = times.windows(2).map(|w| w[1] - w[0]).collect();
        assert_eq!(gaps[0], FIRST);
        assert!(gaps.windows(2).all(|g| g[1] >= g[0]), "{gaps:?}");
        assert_eq!(*gaps.last().unwrap(), CAP);
        assert!(gaps.iter().all(|gap| *gap <= CAP));
    }

    #[tokio::test]
    async fn mc26_the_status_clears_after_the_drain() {
        let dir = tempfile::tempdir().unwrap();
        let (socket, _) = fake_rupd(dir.path(), |request| {
            Some(json!({"jsonrpc": "2.0", "id": request["id"], "result": null}))
        });
        let (bridges, _, machines) = counting(false);
        bridges.serving(&socket);
        bridges.sync(&["box".to_owned()]);
        assert_eq!(bridges.away("box"), Some(true));
        assert_eq!(bridges.away("other"), None);
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut first = machines.lock().remove(0);
        first.send(line("a1:1")).await;
        machines.lock().insert(0, first);
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert_eq!(bridges.away("box"), Some(true), "still draining");
        tokio::time::sleep(Duration::from_millis(600)).await;
        assert_eq!(bridges.away("box"), Some(false));
        // The link ends: away again.
        machines.lock().clear();
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(bridges.away("box"), Some(true));
    }

    #[tokio::test(start_paused = true)]
    async fn mc26_a_removed_machine_stops_its_bridge() {
        let (bridges, dials, _keep) = counting(false);
        bridges.serving(Path::new("/none"));
        bridges.sync(&["box".to_owned()]);
        tokio::time::sleep(Duration::from_secs(1)).await;
        bridges.sync(&[]);
        assert_eq!(bridges.away("box"), None);
        tokio::time::sleep(Duration::from_secs(60)).await;
        assert_eq!(dials.lock().len(), 1);
    }
}
