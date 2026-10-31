//! A fake agent: no model. Raw mode, bracketed paste on, echoes every byte, and runs one
//! command per `\r`: `flood N`, `status STATE MSG`, `title T`, `env`, `size`, `exit CODE`.
use std::io::{Read, Write};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use nix::sys::termios::{SetArg, cfmakeraw, tcgetattr, tcsetattr};

fn main() {
    let stdin = std::io::stdin();
    if let Ok(mut mode) = tcgetattr(&stdin) {
        cfmakeraw(&mut mode);
        let _ = tcsetattr(&stdin, SetArg::TCSANOW, &mode);
    }
    let mut out = std::io::stdout();
    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|e| format!("ERR {e}"));
    write!(out, "fake-agent pid={} cwd={cwd}\r\n", std::process::id()).unwrap();
    let argv: Vec<String> = std::env::args().skip(1).collect();
    write!(out, "argv={argv:?}\r\n").unwrap();
    print_env(&mut out);
    print_size(&mut out);
    write!(out, "\x1b[?2004h\x1b]7501;state=idle\x1b\\ready> ").unwrap();
    out.flush().unwrap();
    let mut line: Vec<u8> = Vec::new();
    let mut byte = [0u8; 4096];
    let mut turn = 0;
    loop {
        let n = match std::io::stdin().read(&mut byte) {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        for &b in &byte[..n] {
            if b != b'\r' {
                line.push(b);
                out.write_all(&[b]).unwrap();
                continue;
            }
            turn += 1;
            let pasted = line.starts_with(b"\x1b[200~") && line.ends_with(b"\x1b[201~");
            let text = String::from_utf8_lossy(&line)
                .replace("\x1b[200~", "")
                .replace("\x1b[201~", "");
            write!(out, "\r\nturn {turn} paste={pasted} got={text:?}\r\n").unwrap();
            run(&mut out, text.trim());
            line.clear();
            write!(out, "ready> ").unwrap();
        }
        out.flush().unwrap();
    }
}

fn run(out: &mut impl Write, command: &str) {
    let mut words = command.split_whitespace();
    match words.next() {
        Some("flood") => {
            let n: usize = words.next().and_then(|n| n.parse().ok()).unwrap_or(10);
            for i in 1..=n {
                write!(out, "line {i:06} αβγ→🙂 {}\r\n", "x".repeat(i % 97)).unwrap();
            }
            write!(out, "flood done {n}\r\n").unwrap();
        }
        Some("status") => {
            let state = words.next().unwrap_or("working");
            let msg = words.collect::<Vec<_>>().join(" ");
            write!(
                out,
                "\x1b]7501;state={state}:msg={}\x1b\\",
                STANDARD.encode(msg)
            )
            .unwrap();
        }
        Some("tick") => {
            let n: u64 = words.next().and_then(|n| n.parse().ok()).unwrap_or(10);
            let every: u64 = words.next().and_then(|n| n.parse().ok()).unwrap_or(100);
            std::thread::spawn(move || {
                for i in 1..=n {
                    std::thread::sleep(std::time::Duration::from_millis(every));
                    let mut out = std::io::stdout();
                    let _ = write!(out, "tick {i:05}\r\n");
                    let _ = out.flush();
                }
            });
        }
        Some("title") => write!(out, "\x1b]0;{}\x07", words.collect::<Vec<_>>().join(" ")).unwrap(),
        Some("env") => print_env(out),
        Some("size") => print_size(out),
        Some("exit") => {
            out.flush().unwrap();
            std::process::exit(words.next().and_then(|c| c.parse().ok()).unwrap_or(0));
        }
        _ => {}
    }
}

fn print_env(out: &mut impl Write) {
    for name in [
        "ROUNDUP_AGENT",
        "ROUNDUP_AGENT_ID",
        "RUPD_SOCKET",
        "CLAUDECODE",
        "CLAUDE_CODE_SESSION_ID",
        "SPIKE_MARK",
        "REX_SERVER",
        "TERM",
    ] {
        write!(out, "env {name}={:?}\r\n", std::env::var(name).ok()).unwrap();
    }
    let path = std::env::var("PATH").unwrap_or_default();
    write!(out, "env PATH[0]={:?}\r\n", path.split(':').next()).unwrap();
}

fn print_size(out: &mut impl Write) {
    let stty = std::process::Command::new("stty")
        .arg("size")
        .stdin(std::process::Stdio::inherit())
        .output();
    let text = stty
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        .unwrap_or_default();
    write!(out, "size rows_cols={text}\r\n").unwrap();
}
