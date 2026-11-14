//! MC24: no report is lost or doubled across an absence. The real `rup signal` spools, the real
//! `rup relay` replays, and the real bridge of `rupd` relays over a link this test kills, pauses and
//! loses every 7th ack on, together with its link (so each run also loses acks). The Daemon's side is a fake that keeps a Mark per Agent, as MC20
//! does, and logs each report it applied: that log is read.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use rupd::bridge::{Bridges, Link};
use serde_json::{Value, json};
use std::sync::Mutex;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex};
use tokio::net::{UnixListener, UnixStream};

const REPORTS: usize = 100;

/// What the test does to the link, and what the Daemon applied.
#[derive(Default)]
struct Net {
    down: AtomicBool,
    paused: AtomicBool,
    /// Bumped to end every open link at once.
    epoch: AtomicUsize,
    acks: AtomicUsize,
    applied: Mutex<Vec<String>>,
}

fn fake_rupd(socket: &Path, net: Arc<Net>, marks: bool) {
    let listener = UnixListener::bind(socket).unwrap();
    let held = Arc::new(Mutex::new(HashMap::<String, u64>::new()));
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let (net, held) = (Arc::clone(&net), Arc::clone(&held));
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    if let Some(report) = request["params"]["report"].as_str() {
                        let (agent, seq) = report.rsplit_once(':').unwrap();
                        let seq: u64 = seq.parse().unwrap();
                        let mut marks_by_agent = held.lock().unwrap();
                        let mark = marks_by_agent.entry(agent.to_owned()).or_default();
                        if !marks || seq > *mark {
                            *mark = (*mark).max(seq);
                            net.applied.lock().unwrap().push(report.to_owned());
                        }
                    }
                    let reply = json!({"jsonrpc": "2.0", "id": request["id"], "result": null});
                    let _ = write.write_all(format!("{reply}\n").as_bytes()).await;
                }
            });
        }
    });
}

/// The ssh stand-in: a proxy to the machine's relay socket the test can cut, pause and make lose
/// every 7th ack on its way back to the machine.
fn dial(relay: std::path::PathBuf, net: Arc<Net>) -> Bridges {
    Bridges::with_dial(move |_| {
        let (relay, net) = (relay.clone(), Arc::clone(&net));
        Box::pin(async move {
            if net.down.load(Ordering::SeqCst) {
                return Err(std::io::ErrorKind::ConnectionRefused.into());
            }
            let (machine_read, machine_write) = UnixStream::connect(&relay).await?.into_split();
            let (bridge_read, mut to_bridge) = duplex(1 << 16);
            let (from_bridge, bridge_write) = duplex(1 << 16);
            let born = net.epoch.load(Ordering::SeqCst);
            let alive = {
                let net = Arc::clone(&net);
                move || net.epoch.load(Ordering::SeqCst) == born
            };
            let (up_alive, down_alive, up_net) = (alive.clone(), alive, Arc::clone(&net));
            spawn_until_cut(Arc::clone(&net), born, async move {
                let mut lines = BufReader::new(from_bridge).lines();
                let mut machine_write = machine_write;
                while let Ok(Some(line)) = lines.next_line().await {
                    while up_net.paused.load(Ordering::SeqCst) && up_alive() {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                    if !up_alive() {
                        return;
                    }
                    let ack = line.contains("\"ack\"");
                    if ack && up_net.acks.fetch_add(1, Ordering::SeqCst) % 7 == 6 {
                        // ssh is reliable: an ack is lost only with its link, which ends here.
                        up_net.epoch.fetch_add(1, Ordering::SeqCst);
                        return;
                    }
                    if machine_write
                        .write_all(format!("{line}\n").as_bytes())
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            });
            let down_net = Arc::clone(&net);
            spawn_until_cut(Arc::clone(&net), born, async move {
                let mut lines = BufReader::new(machine_read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    while down_net.paused.load(Ordering::SeqCst) && down_alive() {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                    if !down_alive()
                        || to_bridge
                            .write_all(format!("{line}\n").as_bytes())
                            .await
                            .is_err()
                    {
                        return;
                    }
                }
            });
            Ok(Link {
                read: Box::new(bridge_read),
                write: Box::new(bridge_write),
                hold: Box::new(()),
            })
        })
    })
}

/// Runs `task` until the link it belongs to is cut; ending it drops its halves, as ssh dying does.
fn spawn_until_cut(net: Arc<Net>, born: usize, task: impl Future<Output = ()> + Send + 'static) {
    tokio::spawn(async move {
        let cut = async {
            while net.epoch.load(Ordering::SeqCst) == born {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        };
        tokio::select! { () = task => {}, () = cut => {} }
    });
}

fn start_relay(dir: &Path) -> Child {
    let child = Command::new(env!("CARGO_BIN_EXE_rup"))
        .arg("relay")
        .env("ROUNDUP_MACHINE", "1")
        .env("RUPQ_DIR", dir.join("rupq"))
        .env("RUPQ_RELAY_SOCK", dir.join("relay.sock"))
        .env("RUPQ_LIVE_SOCK", dir.join("live.sock"))
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !dir.join("relay.sock").exists() || !dir.join("live.sock").exists() {
        assert!(Instant::now() < deadline, "the relay did not start");
        std::thread::sleep(Duration::from_millis(10));
    }
    child
}

fn report(dir: &Path) -> Child {
    let mut child = Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(["signal", "a1"])
        .env("ROUNDUP_MACHINE", "1")
        .env("ROUNDUP_ATTEMPT", "1")
        .env("RUPD_SOCKET", dir.join("none.sock"))
        .env("RUPQ_DIR", dir.join("rupq"))
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    std::io::Write::write_all(&mut child.stdin.take().unwrap(), b"{}").unwrap();
    child
}

/// `REPORTS` numbered reports 10 ms apart; `fault` runs once a third of them are in.
/// Returns what the Daemon applied.
async fn run(marks: bool, fault: impl AsyncFnOnce(&Net)) -> Vec<String> {
    let mut fault = Some(fault);
    let dir = tempfile::tempdir().unwrap();
    let net = Arc::new(Net::default());
    fake_rupd(&dir.path().join("rupd.sock"), Arc::clone(&net), marks);
    let mut relay = start_relay(dir.path());
    let bridges = dial(dir.path().join("relay.sock"), Arc::clone(&net));
    bridges.serving(&dir.path().join("rupd.sock"));
    bridges.sync(&["box".to_owned()]);
    let mut sent = Vec::new();
    for n in 0..REPORTS {
        sent.push(report(dir.path()));
        if n == REPORTS / 3 {
            if let Some(fault) = fault.take() {
                fault(&net).await;
            }
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    for mut child in sent {
        assert!(child.wait().unwrap().success());
    }
    let deadline = Instant::now() + Duration::from_secs(30);
    let drained =
        || std::fs::read_to_string(dir.path().join("rupq/spool")).is_ok_and(|text| text.is_empty());
    while !(net.applied.lock().unwrap().len() >= REPORTS && drained()) && Instant::now() < deadline
    {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // Long enough for a double to show.
    tokio::time::sleep(Duration::from_secs(1)).await;
    relay.kill().unwrap();
    relay.wait().unwrap();
    let applied = net.applied.lock().unwrap().clone();
    applied
}

fn expected() -> Vec<String> {
    (1..=REPORTS).map(|n| format!("a1:{n}")).collect()
}

async fn cut(net: &Net) {
    net.down.store(true, Ordering::SeqCst);
    net.epoch.fetch_add(1, Ordering::SeqCst);
    tokio::time::sleep(Duration::from_millis(400)).await;
    net.down.store(false, Ordering::SeqCst);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mc24_link_killed_loses_none_doubles_none() {
    assert_eq!(run(true, async |net| cut(net).await).await, expected());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mc24_link_paused_loses_none_doubles_none() {
    let applied = run(true, async |net| {
        net.paused.store(true, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(400)).await;
        net.paused.store(false, Ordering::SeqCst);
    })
    .await;
    assert_eq!(applied, expected());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn mc24_the_harness_sees_a_double_without_the_mark() {
    let applied = run(false, async |net| cut(net).await).await;
    assert!(applied.len() > REPORTS, "{} applied", applied.len());
    let mut seen = applied.clone();
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), REPORTS, "none lost");
}
