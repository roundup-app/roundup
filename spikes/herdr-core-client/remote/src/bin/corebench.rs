//! corebench TERMINAL N: on the machine, speak framed JSON-RPC to herdr-core's own Unix socket
//! (no ssh), attach to TERMINAL (a fake-agent that echoes every byte) and time N one-byte
//! round trips: DATA frame in, echoed DATA frame out. Also times N round trips through a plain
//! `cat` on pipes, the floor with no PTY and no core.
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::process::{Command, Stdio};
use std::time::Instant;

fn frame(ch: u32, kind: u8, p: &[u8]) -> Vec<u8> {
    let mut v = ch.to_le_bytes().to_vec();
    v.push(kind);
    v.extend((p.len() as u32).to_le_bytes());
    v.extend(p);
    v
}
fn read_frame(r: &mut impl Read) -> (u32, u8, Vec<u8>) {
    let mut h = [0u8; 9];
    r.read_exact(&mut h).unwrap();
    let len = u32::from_le_bytes(h[5..9].try_into().unwrap()) as usize;
    let mut p = vec![0u8; len];
    r.read_exact(&mut p).unwrap();
    (u32::from_le_bytes(h[0..4].try_into().unwrap()), h[4], p)
}
fn stats(tag: &str, mut ms: Vec<f64>) {
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = ms.len();
    println!("{tag} n={n} p50={:.4}ms p95={:.4}ms max={:.4}ms", ms[n / 2], ms[n * 95 / 100], ms[n - 1]);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (terminal, n) = (&args[0], args[1].parse::<usize>().unwrap());
    let mut s = UnixStream::connect("/run/user/1000/herdr-core/default.sock").unwrap();
    let mut r = BufReader::new(s.try_clone().unwrap());
    s.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"hello\",\"params\":{\"generation\":1,\"framed\":true}}\n").unwrap();
    let mut line = String::new();
    r.read_line(&mut line).unwrap();
    let body = format!(r#"{{"jsonrpc":"2.0","id":1,"method":"terminal.attach","params":{{"terminal":"{terminal}","cols":100,"rows":30}}}}"#);
    s.write_all(&frame(0, 0, body.as_bytes())).unwrap();
    let channel = loop {
        let (ch, _, p) = read_frame(&mut r);
        if ch == 0 {
            let v: serde_json::Value = serde_json::from_slice(&p).unwrap();
            if v["id"] == 1 {
                break v["result"]["channel"].as_u64().unwrap() as u32;
            }
        }
    };
    // Let the first paint and the banner pass; the agent is already at its prompt.
    s.set_read_timeout(Some(std::time::Duration::from_millis(500))).unwrap();
    while std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ())).is_ok() {
        let mut h = [0u8; 9];
        if r.read_exact(&mut h).is_err() {
            break;
        }
        let len = u32::from_le_bytes(h[5..9].try_into().unwrap()) as usize;
        let mut p = vec![0u8; len];
        r.read_exact(&mut p).unwrap();
    }
    s.set_read_timeout(None).unwrap();
    let mut ms = Vec::new();
    for _ in 0..n {
        let t = Instant::now();
        s.write_all(&frame(channel, 0, b"x")).unwrap();
        loop {
            let (ch, kind, p) = read_frame(&mut r);
            if ch == channel && kind == 0 && p.contains(&b'x') {
                break;
            }
        }
        ms.push(t.elapsed().as_secs_f64() * 1e3);
    }
    stats("herdr-core attach echo (DATA frame -> PTY -> fake-agent -> DATA frame), local socket", ms);
    let mut cat = Command::new("cat").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    let mut cin = cat.stdin.take().unwrap();
    let mut cout = cat.stdout.take().unwrap();
    let mut ms = Vec::new();
    let mut b = [0u8; 1];
    for _ in 0..n {
        let t = Instant::now();
        cin.write_all(b"x").unwrap();
        cout.read_exact(&mut b).unwrap();
        ms.push(t.elapsed().as_secs_f64() * 1e3);
    }
    stats("plain cat on pipes, local", ms);
    let _ = cat.kill();
}
