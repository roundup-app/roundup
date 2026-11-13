//! MC21, MC22, MC23: `rup` on a machine spools a report, serves the bridge and fails loud when away.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

fn rup(dir: &Path, args: &[&str], stdin: &str) -> (Output, Duration) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_rup"));
    command
        .args(args)
        .env("ROUNDUP_MACHINE", "1")
        .env("ROUNDUP_ATTEMPT", "1")
        .env("RUPD_SOCKET", dir.join("none.sock"))
        .env("RUPQ_DIR", dir.join("rupq"))
        .env("RUPQ_RELAY_SOCK", dir.join("relay.sock"))
        .env("RUPQ_LIVE_SOCK", dir.join("live.sock"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let start = Instant::now();
    let mut child = command.spawn().unwrap();
    let _ = child.stdin.take().unwrap().write_all(stdin.as_bytes());
    let out = child.wait_with_output().unwrap();
    (out, start.elapsed())
}

fn spool(dir: &Path) -> Vec<Value> {
    std::fs::read_to_string(dir.join("rupq/spool"))
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
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
    let (_tx, tick) = std::sync::mpsc::channel::<()>();
    while !dir.join("relay.sock").exists() || !dir.join("live.sock").exists() {
        assert!(Instant::now() < deadline, "the relay did not start");
        let _ = tick.recv_timeout(Duration::from_millis(10));
    }
    child
}

#[test]
fn mc21_signal_spools_and_exits_0_with_no_bridge() {
    let dir = tempfile::tempdir().unwrap();
    let (out, took) = rup(
        dir.path(),
        &["signal", "a1"],
        r#"{"hook_event_name":"Stop"}"#,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(out.stdout.is_empty() && out.stderr.is_empty());
    assert!(took < Duration::from_secs(1), "{took:?}");
    let lines = spool(dir.path());
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["id"], "a1:1");
    assert_eq!(lines[0]["method"], "agent.signal");
    assert_eq!(lines[0]["params"]["report"], "a1:1");
}

#[test]
fn mc21_signal_exits_0_the_same_with_the_bridge_up() {
    let dir = tempfile::tempdir().unwrap();
    let mut relay = start_relay(dir.path());
    let _bridge = std::os::unix::net::UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    let (out, took) = rup(dir.path(), &["signal", "a1"], "{}");
    relay.kill().unwrap();
    relay.wait().unwrap();
    assert!(out.status.success() && out.stdout.is_empty() && out.stderr.is_empty());
    assert!(took < Duration::from_secs(1), "{took:?}");
}

#[test]
fn mc21_signal_with_an_unwritable_spool_exits_1_with_the_cause() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("rupq"), "a file, not a directory").unwrap();
    let (out, _) = rup(dir.path(), &["signal", "a1"], "{}");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("cannot"));
}

#[test]
fn mc23_a_line_leaves_the_spool_only_on_the_ack_and_replays_on_connect() {
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixStream;
    let dir = tempfile::tempdir().unwrap();
    let mut relay = start_relay(dir.path());
    rup(dir.path(), &["signal", "a1"], "{}");
    rup(dir.path(), &["signal", "a1"], "{}");
    let read = |stream: &UnixStream| {
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line).unwrap();
        serde_json::from_str::<Value>(&line).unwrap()
    };
    // A bridge that hangs up before acking leaves the line, and the next connect replays it.
    let first = UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    assert_eq!(read(&first)["id"], "a1:1");
    drop(first);
    let mut second = UnixStream::connect(dir.path().join("relay.sock")).unwrap();
    assert_eq!(read(&second)["id"], "a1:1");
    assert_eq!(spool(dir.path()).len(), 2);
    second.write_all(b"{\"ack\":\"a1:1\"}\n").unwrap();
    let mut reader = BufReader::new(&second);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["id"], "a1:2");
    assert_eq!(spool(dir.path()).len(), 1);
    relay.kill().unwrap();
    relay.wait().unwrap();
}

#[test]
fn mc22_a_live_call_with_no_bridge_returns_away_at_once() {
    let dir = tempfile::tempdir().unwrap();
    for relay in [false, true] {
        let mut child = relay.then(|| start_relay(dir.path()));
        let (out, took) = rup(dir.path(), &["todo", "list", "--agent", "a1"], "");
        assert_eq!(out.status.code(), Some(1));
        assert!(String::from_utf8_lossy(&out.stderr).contains(r#"{"error":"away"}"#));
        assert!(took < Duration::from_secs(1), "{took:?}");
        if let Some(child) = child.as_mut() {
            child.kill().unwrap();
            child.wait().unwrap();
        }
    }
}
