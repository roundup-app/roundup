//! spike <q1|q2|...>: one live proof per question. Prints `PROOF` lines.
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use herdr_core_client_spike::{Conn, Ev, Result, Stream, find};
use serde_json::{Value, json};

macro_rules! proof {
    ($q:expr, $($arg:tt)*) => { println!("PROOF {} {}", $q, format!($($arg)*)) };
}

mod back;
mod basics;
mod measure;
mod streams;

#[tokio::main]
async fn main() -> Result<()> {
    let q = std::env::args().nth(1).unwrap_or_default();
    match q.as_str() {
        "q1" => basics::q1().await,
        "q2" => basics::q2().await,
        "q3" => streams::q3().await,
        "q4" => streams::q4().await,
        "q5" => streams::q5().await,
        "q6" => basics::q6().await,
        "q7" => streams::q7().await,
        "q8" => basics::q8().await,
        "q9" => measure::q9().await,
        "q10" => measure::q10().await,
        "q11" => back::q11().await,
        "q12" => back::q12().await,
        "q13" => back::q13().await,
        other => Err(format!("unknown question {other:?}").into()),
    }
}

/// Where the spike keeps its Mac-side files.
pub fn work() -> PathBuf {
    let d = PathBuf::from("/tmp/hs");
    std::fs::create_dir_all(&d).unwrap();
    d
}

pub fn exe(name: &str) -> PathBuf {
    std::env::current_exe().unwrap().with_file_name(name)
}

/// The gate holds the program until the viewer types one byte, so a viewer attached first
/// sees every byte the program prints.
const GATE: &str = "stty -echo -icanon min 1 time 0; dd bs=1 count=1 >/dev/null 2>&1; stty echo icanon; exec \"$0\" \"$@\"";

pub fn agent_argv(gate: bool, extra: &[&str]) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    if gate {
        v.extend(["sh".into(), "-c".into(), GATE.into()]);
    }
    v.push("fake-agent".into());
    v.extend(extra.iter().map(|s| s.to_string()));
    v
}

/// terminal.run a fake agent at 100x30 in /tmp; returns its id.
pub async fn run_agent(c: &Conn, name: &str, env: Value, gate: bool) -> Result<String> {
    let r = c
        .call(
            "terminal.run",
            json!({"argv":agent_argv(gate,&[]),"cwd":"/tmp","env":env,"name":name,"size":{"cols":100,"rows":30}}),
        )
        .await?;
    Ok(r["address"].as_str().ok_or("address")?.to_owned())
}

pub async fn kill_all(c: &Conn) {
    if let Ok(l) = c.call("terminal.list", json!({"all":true})).await {
        for t in l["terminals"].as_array().cloned().unwrap_or_default() {
            let a = t["address"].as_str().unwrap_or_default().to_owned();
            let _ = c.call("terminal.kill", json!({"terminal":a})).await;
            let _ = c.call("terminal.rm", json!({"terminal":a})).await;
        }
    }
}

/// Read stream data into `buf` until `needle` appears or `within` passes.
pub async fn until(s: &mut Stream, buf: &mut Vec<u8>, needle: &str, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    loop {
        if find(buf, needle.as_bytes()).is_some() {
            return true;
        }
        match tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), s.next()).await {
            Ok(Some(Ev::Data(b))) => buf.extend(b),
            Ok(Some(Ev::Close(_))) | Ok(None) | Err(_) => return false,
            Ok(Some(Ev::Resize(..))) => {}
        }
    }
}

/// Drain whatever arrives until `quiet` passes with nothing.
pub async fn settle(s: &mut Stream, buf: &mut Vec<u8>, quiet: Duration) {
    while let Ok(Some(ev)) = tokio::time::timeout(quiet, s.next()).await {
        if let Ev::Data(b) = ev {
            buf.extend(b)
        }
    }
}

pub fn text(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

pub fn pct(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() as f64 - 1.0) * p).round() as usize]
}

pub fn sh(cmd: &str) -> String {
    let o = Command::new("sh").args(["-c", cmd]).output().unwrap();
    String::from_utf8_lossy(&o.stdout).into_owned() + &String::from_utf8_lossy(&o.stderr)
}

/// Run a command on the machine over plain ssh.
pub fn remote(cmd: &str) -> String {
    let o = Command::new("ssh").args(["-T", "-o", "BatchMode=yes", herdr_core_client_spike::HOST, cmd]).output().unwrap();
    String::from_utf8_lossy(&o.stdout).into_owned() + &String::from_utf8_lossy(&o.stderr)
}

/// Collect stream data for a fixed time.
pub async fn collect_for(s: &mut Stream, buf: &mut Vec<u8>, total: Duration) {
    let end = Instant::now() + total;
    while let Ok(Some(ev)) = tokio::time::timeout(end.saturating_duration_since(Instant::now()), s.next()).await {
        if let Ev::Data(b) = ev {
            buf.extend(b)
        }
    }
}
