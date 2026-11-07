//! herdr-tap TERMINAL: run as a Terminal's program, it attaches to a herdr-core terminal over
//! ssh and plays the attach stream's bytes on its own (raw) PTY, so roundup's unchanged
//! `terminal` crate parses, logs and offsets exactly what herdr-core streams. Bytes typed
//! into the Terminal go to the attach channel as DATA; SIGWINCH becomes a RESIZE frame; the
//! stream's CLOSE `exit_code` becomes this process's exit code. `TAP_DUMP=path` writes the
//! bytes it played.
use std::io::Write;

use herdr_core_client_spike::{Conn, Ev, Result};
use nix::sys::termios::{SetArg, cfmakeraw, tcgetattr, tcsetattr};
use serde_json::json;
use tokio::io::AsyncReadExt;
use tokio::signal::unix::{SignalKind, signal};

#[tokio::main]
async fn main() -> Result<()> {
    let terminal = std::env::args().nth(1).expect("terminal id");
    let stdin = std::io::stdin();
    if let Ok(mut mode) = tcgetattr(&stdin) {
        cfmakeraw(&mut mode);
        tcsetattr(&stdin, SetArg::TCSANOW, &mode)?;
    }
    let mut dump = std::env::var_os("TAP_DUMP").map(std::fs::File::create).transpose()?;
    let (cols, rows) = size().unwrap_or((100, 30));
    let conn = Conn::connect().await?;
    let (_, mut stream) = conn.attach(&terminal, cols, rows, json!({})).await?;
    let mut out = std::io::stdout().lock();
    let mut input = tokio::io::stdin();
    let mut typed = vec![0u8; 4096];
    let mut winch = signal(SignalKind::window_change())?;
    let (mut frames, mut split_frames, mut biggest) = (0u64, 0u64, 0usize);
    let code = loop {
        tokio::select! {
            ev = stream.next() => match ev {
                Some(Ev::Data(bytes)) => {
                    frames += 1;
                    biggest = biggest.max(bytes.len());
                    if matches!(std::str::from_utf8(&bytes), Err(e) if e.error_len().is_none()) { split_frames += 1; }
                    out.write_all(&bytes)?;
                    out.flush()?;
                    if let Some(d) = &mut dump { d.write_all(&bytes)?; d.flush()?; }
                }
                Some(Ev::Close(reason)) => {
                    break reason["exit_code"].as_i64().map_or(255, |c| c as i32);
                }
                Some(Ev::Resize(..)) => {}
                None => break 255,
            },
            read = input.read(&mut typed) => {
                let n = read?;
                if n == 0 { break 255 }
                stream.send(&typed[..n]); // raw bytes: no UTF-8 split problem, unlike Rex's JSON `write`
            }
            _ = winch.recv() => {
                if let Some((c, r)) = size() { stream.resize(c, r); }
            }
        }
    };
    if let Some(path) = std::env::var_os("TAP_STATS") {
        std::fs::write(path, format!("frames={frames} frames_ending_mid_utf8={split_frames} biggest_frame={biggest}\n"))?;
    }
    stream.close();
    std::process::exit(code);
}

fn size() -> Option<(u16, u16)> {
    let out = std::process::Command::new("stty").arg("size").stdin(std::process::Stdio::inherit()).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.split_whitespace().filter_map(|n| n.parse::<u16>().ok());
    match (parts.next(), parts.next()) {
        (Some(rows), Some(cols)) if rows > 0 && cols > 0 => Some((cols, rows)),
        _ => None,
    }
}
