//! MC13, MC14: a Terminal on a real core over a real `ssh`. They need an ssh name with `herdr-core`
//! on its non-interactive PATH (`ROUNDUP_MC_HOST`, for example `localhost`) and run with
//! `cargo nextest run -p terminal --run-ignored only mc13 mc14`.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::process::Stdio;
use std::time::{Duration, Instant};

use herdr::{Conn, Ev, Stream};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

const T: Duration = Duration::from_secs(15);

fn host() -> String {
    std::env::var("ROUNDUP_MC_HOST").expect("ROUNDUP_MC_HOST names the ssh host")
}

async fn run(conn: &Conn, script: &str) -> String {
    let reply = conn
        .call(
            "terminal.run",
            json!({"argv":["/bin/sh","-c",script],"cwd":"/tmp","env":{},"size":{"cols":100,"rows":30}}),
        )
        .await
        .unwrap();
    reply["terminal"].as_str().unwrap().to_owned()
}

async fn until(stream: &mut Stream, text: &str) -> String {
    let mut seen = String::new();
    while !seen.contains(text) {
        match tokio::time::timeout(T, stream.next())
            .await
            .unwrap()
            .unwrap()
        {
            Ev::Data(bytes) => seen.push_str(&String::from_utf8_lossy(&bytes)),
            Ev::Close(reason) => panic!("closed before {text:?}: {reason}"),
            Ev::Resize(..) => {}
        }
    }
    seen
}

fn median(mut v: Vec<Duration>) -> Duration {
    v.sort();
    v[v.len() / 2]
}

#[tokio::test]
#[ignore = "needs ROUNDUP_MC_HOST, a real ssh and herdr-core"]
async fn mc13_remote_keystroke_adds_under_1ms() {
    let host = host();
    let conn = Conn::connect_ssh(&host, T).await.unwrap();
    let id = run(&conn, "stty raw -echo; exec cat").await;
    let mut stream = conn.attach(&id, 100, 30, 0).await.unwrap();

    let mut base = Command::new("ssh")
        .args(["-T", "-o", "BatchMode=yes", "--", &host, "cat"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut base_in = base.stdin.take().unwrap();
    let mut base_out = BufReader::new(base.stdout.take().unwrap());

    let (mut through, mut plain) = (Vec::new(), Vec::new());
    for n in 0..200 {
        let key = format!("k{n:03}");
        let t = Instant::now();
        stream.send(key.as_bytes());
        until(&mut stream, &key).await;
        through.push(t.elapsed());

        let t = Instant::now();
        base_in
            .write_all(format!("{key}\n").as_bytes())
            .await
            .unwrap();
        base_out.read_line(&mut String::new()).await.unwrap();
        plain.push(t.elapsed());
    }
    let added = median(through).saturating_sub(median(plain));
    assert!(added < Duration::from_millis(1), "added {added:?} at p50");
}

#[tokio::test]
#[ignore = "needs ROUNDUP_MC_HOST, a real ssh and herdr-core"]
async fn mc14_reattach_keeps_program() {
    let host = host();
    let conn = Conn::connect_ssh(&host, T).await.unwrap();
    let id = run(
        &conn,
        "i=0; while :; do i=$((i+1)); echo tick $i; sleep 0.1; done",
    )
    .await;
    let pid = conn
        .call("terminal.get", json!({"terminal":id}))
        .await
        .unwrap()["pid"]
        .clone();
    let mut stream = conn.attach(&id, 100, 30, 0).await.unwrap();
    until(&mut stream, "tick 3").await;

    // The ssh is lost; a new connection finds the same program and the gap in `history`.
    drop(stream);
    drop(conn);
    tokio::time::sleep(Duration::from_secs(3)).await;
    let conn = Conn::connect_ssh(&host, T).await.unwrap();
    let got: Value = conn
        .call("terminal.get", json!({"terminal":id}))
        .await
        .unwrap();
    assert_eq!(got["pid"], pid);
    assert_eq!(got["state"], "live");
    let mut stream = conn.attach(&id, 100, 30, 5000).await.unwrap();
    stream.resize(100, 30);
    let repaint = until(&mut stream, "tick 30").await;
    let numbers: Vec<u32> = repaint
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter_map(|w| w.parse().ok())
        .collect();
    let mut seen = std::collections::BTreeSet::new();
    for n in numbers.iter().filter(|n| **n <= 30) {
        assert!(seen.insert(*n), "tick {n} repeats in {repaint:?}");
    }
}
