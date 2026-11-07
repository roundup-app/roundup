//! Mac side of the back channel (boxd's ssh gateway cannot do `ssh -R`, so the Mac dials in).
//!   bridge RUPD_SOCK   runs `ssh host socat - UNIX-CONNECT:~/rupq-relay.sock` and, per line from the machine:
//!     {"id":..}            a queued report: send to rupd, wait for its ack, only then write {"ack":id} back
//!     {"key":K,"rpc":{..}} a live call: forward to rupd, write {"key":K,"reply":..} back
//!   No rupd ack (closed, timeout): reconnect to rupd and resend the same line. At-least-once.
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::process::{Command, Stdio};
use std::time::Duration;

fn rupd(sock: &str) -> (UnixStream, BufReader<UnixStream>) {
    loop {
        if let Ok(s) = UnixStream::connect(sock) {
            s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let r = BufReader::new(s.try_clone().unwrap());
            return (s, r);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn main() {
    let sock = std::env::args().nth(1).unwrap();
    let up = std::env::var("BRIDGE_UP").ok();
    let (mut w, mut r) = rupd(&sock);
    loop {
        let mut ssh = Command::new("ssh")
            .args(["-T", "-o", "BatchMode=yes", herdr_core_client_spike::HOST, "socat - UNIX-CONNECT:/home/boxd/rupq-relay.sock"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        if let Some(p) = &up {
            std::fs::write(p, ssh.id().to_string()).unwrap();
        }
        let mut to_machine = ssh.stdin.take().unwrap();
        for line in BufReader::new(ssh.stdout.take().unwrap()).lines().map_while(Result::ok) {
            let v: serde_json::Value = serde_json::from_str(&line).unwrap_or_default();
            let payload = if v.get("rpc").is_some() { v["rpc"].to_string() } else { line.clone() };
            let reply = loop {
                let mut got = String::new();
                if writeln!(w, "{payload}").is_ok() && r.read_line(&mut got).is_ok_and(|n| n > 0) {
                    break got;
                }
                (w, r) = rupd(&sock);
            };
            let back = if v.get("rpc").is_some() {
                format!(r#"{{"key":{},"reply":{}}}"#, v["key"], reply.trim())
            } else {
                format!(r#"{{"ack":{}}}"#, v["id"])
            };
            if writeln!(to_machine, "{back}").is_err() {
                break;
            }
        }
        let _ = ssh.wait();
        std::thread::sleep(Duration::from_millis(300));
    }
}
