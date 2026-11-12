//! FK5977d: `rup data fork` sends the one `data.fork` call its flags name and prints the result.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::process::Stdio;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixListener;
use tokio::sync::mpsc;

/// A stand-in Daemon on `socket`: it answers every call with `null` but `data.fork`, whose params
/// arrive on the channel and whose answer is `result` (or an error when `result` is `None`).
fn daemon(socket: &std::path::Path, result: Option<Value>) -> mpsc::UnboundedReceiver<Value> {
    let listener = UnixListener::bind(socket).unwrap();
    let (seen, log) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            let (seen, result) = (seen.clone(), result.clone());
            tokio::spawn(async move {
                let mut lines = BufReader::new(read).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let request: Value = serde_json::from_str(&line).unwrap();
                    let reply = if request["method"] == "data.fork" {
                        let _ = seen.send(request["params"].clone());
                        match &result {
                            Some(result) => {
                                json!({"jsonrpc":"2.0","id":request["id"],"result":result})
                            }
                            None => {
                                json!({"jsonrpc":"2.0","id":request["id"],"error":{"code":-32602,"message":"refused"}})
                            }
                        }
                    } else {
                        json!({"jsonrpc":"2.0","id":request["id"],"result":null})
                    };
                    write
                        .write_all(format!("{reply}\n").as_bytes())
                        .await
                        .unwrap();
                }
            });
        }
    });
    log
}

async fn rup(socket: &std::path::Path, args: &[&str]) -> std::process::Output {
    let child = tokio::process::Command::new(env!("CARGO_BIN_EXE_rup"))
        .args(args)
        .env("RUPD_SOCKET", socket)
        .env_remove("ROUNDUP_AGENT")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(30), child.wait_with_output())
        .await
        .expect("rup ended")
        .unwrap()
}

#[tokio::test]
async fn fk5977d_the_flags_send_the_picks_and_the_result_is_printed() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let result = json!({"path":"/f","projects":[{"key":"a-1","agents":["3"],"todos":2,"pads":1,"messages":4,"history":5}]});
    let mut log = daemon(&socket, Some(result));
    let output = rup(
        &socket,
        &[
            "data",
            "fork",
            "/f",
            "--name",
            "Try",
            "--colour",
            "teal",
            "--project",
            "a-1:agents=3:no-pads",
        ],
    )
    .await;
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    assert_eq!(
        log.recv().await.unwrap(),
        json!({"name":"Try","colour":"teal","path":"/f","projects":[{"key":"a-1","agents":["3"],"todos":true,"pads":false,"messages":true,"history":true}]})
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(
        text.contains("forked into /f") && text.contains("a-1: 1 agents, 2 todos"),
        "{text}"
    );

    // With no --project it copies everything: no picks are sent.
    rup(
        &socket,
        &["data", "fork", "/g", "--name", "All", "--colour", "red"],
    )
    .await;
    let params = log.recv().await.unwrap();
    assert!(params.get("projects").is_none(), "{params}");
}

#[tokio::test]
async fn fk5977d_a_refusal_fails_the_command_and_a_bad_colour_is_bad_usage() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("rupd.sock");
    let mut log = daemon(&socket, None);
    let refused = rup(
        &socket,
        &["data", "fork", "/f", "--name", "Try", "--colour", "red"],
    )
    .await;
    assert_eq!(refused.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&refused.stderr).contains("INVALID_PARAMS"));
    log.recv().await.unwrap();
    let bad = rup(
        &socket,
        &["data", "fork", "/f", "--name", "Try", "--colour", "mauve"],
    )
    .await;
    assert_eq!(bad.status.code(), Some(2));
    assert!(log.try_recv().is_err());
}
