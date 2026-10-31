//! rex-tap SOCKET SESSION BLOCK [none|vt]: run as a Terminal's program, it joins a Rex block and
//! plays the Rex stream's program bytes on its own (raw) PTY, so roundup's unchanged
//! `terminal` crate parses, logs and offsets exactly the bytes Rex streams. Input typed into
//! the Terminal goes to Rex's `write`; SIGWINCH becomes `own_block` + `resize`; Rex's
//! `child_exited` becomes this process's exit code. `TAP_DUMP=path` writes the bytes it played.
use std::io::Write;
use std::path::PathBuf;

use nix::sys::termios::{SetArg, cfmakeraw, tcgetattr, tcsetattr};
use rex_client_spike::{Control, Piece, Splitter, stream};
use serde_json::json;
use tokio::io::AsyncReadExt;
use tokio::signal::unix::{SignalKind, signal};

#[tokio::main]
async fn main() -> rex_client_spike::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (socket, session, block) = (PathBuf::from(&args[1]), args[2].clone(), args[3].clone());
    let catch_up = args.get(4).map(String::as_str).unwrap_or("none");
    let stdin = std::io::stdin();
    if let Ok(mut mode) = tcgetattr(&stdin) {
        cfmakeraw(&mut mode);
        tcsetattr(&stdin, SetArg::TCSANOW, &mode)?;
    }
    let mut dump = std::env::var_os("TAP_DUMP")
        .map(std::fs::File::create)
        .transpose()?;
    let control = Control::connect(&socket, "roundup-tap", None).await?;
    control
        .call("session.attach", json!({"session_id":session}))
        .await?;
    control
        .call(
            "session.own_block",
            json!({"session_id":session,"block_ids":[block],"mode":"take"}),
        )
        .await?;
    resize(&control, &session, &block).await?;
    let mut data = stream(&control, &socket, &session, &block).await?;
    let mut splitter = Splitter::new(data.nonce);
    let mut out = std::io::stdout().lock();
    if catch_up == "vt" {
        let screen = control
            .terminal(
                &session,
                &block,
                "format",
                json!({"format":"vt","extra_cursor":true,"extra_modes":true}),
            )
            .await?;
        out.write_all(screen["content"].as_str().unwrap_or_default().as_bytes())?;
        out.flush()?;
    }
    let mut input = tokio::io::stdin();
    let mut typed = vec![0u8; 4096];
    let mut pending: Vec<u8> = Vec::new();
    let mut winch = signal(SignalKind::window_change())?;
    let code = loop {
        tokio::select! {
            bytes = data.next() => {
                let Some(bytes) = bytes else { break 255 };
                let mut exited = None;
                for piece in splitter.push(&bytes) {
                    match piece {
                        Piece::Program(bytes) => {
                            out.write_all(&bytes)?;
                            if let Some(dump) = &mut dump { dump.write_all(&bytes)?; }
                        }
                        Piece::Rex(message) if message["type"] == "child_exited" => {
                            exited = Some(message["exit_code"].as_i64().unwrap_or(-1));
                        }
                        Piece::Rex(_) | Piece::Snapshot(_) => {}
                    }
                }
                out.flush()?;
                if let Some(code) = exited { break if code < 0 { 255 } else { code as i32 } }
            }
            read = input.read(&mut typed) => {
                let n = read?;
                if n == 0 { break 255 }
                pending.extend_from_slice(&typed[..n]);
                // `write` takes a JSON string: send the longest valid UTF-8 prefix, keep a split tail.
                let valid = match std::str::from_utf8(&pending) { Ok(text) => text.len(), Err(err) => err.valid_up_to() };
                if valid > 0 {
                    let text = String::from_utf8(pending.drain(..valid).collect())?;
                    control.terminal(&session, &block, "write", json!({"data":text})).await?;
                }
            }
            _ = winch.recv() => resize(&control, &session, &block).await?,
        }
    };
    data.end().await;
    control.close().await;
    std::process::exit(code);
}

async fn resize(control: &Control, session: &str, block: &str) -> rex_client_spike::Result<()> {
    if let Ok((cols, rows)) = terminal_size() {
        control
            .terminal(
                session,
                block,
                "resize",
                json!({"columns":cols,"rows":rows}),
            )
            .await?;
    }
    Ok(())
}

fn terminal_size() -> nix::Result<(u16, u16)> {
    let out = std::process::Command::new("stty")
        .arg("size")
        .stdin(std::process::Stdio::inherit())
        .output()
        .map_err(|_| nix::errno::Errno::EIO)?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text
        .split_whitespace()
        .filter_map(|n| n.parse::<u16>().ok());
    match (parts.next(), parts.next()) {
        (Some(rows), Some(cols)) if rows > 0 && cols > 0 => Ok((cols, rows)),
        _ => Err(nix::errno::Errno::EIO),
    }
}
