//! MC12: the test-support herdr-core (`tests/support/herdr_core.rs`) answers a `herdr::Conn` as
//! the real core does, so tests that spawn a real program can run against a core.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
use std::time::Duration;

use herdr::{Conn, Error, Ev};
use serde_json::{Value, json};
use tokio::process::Command;

const T: Duration = Duration::from_secs(10);

async fn core() -> Conn {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_herdr-core-test"));
    cmd.arg("connect");
    Conn::spawn(cmd, T).await.unwrap()
}

fn run_params(cwd: &str, script: &str) -> Value {
    json!({"argv":["/bin/sh","-c",script],"cwd":cwd,"env":{"MARK":"kept"},"size":{"cols":100,"rows":30}})
}

#[tokio::test]
async fn mc12_core_replays_five_thousand_lines_and_the_exit_code() {
    let conn = core().await;
    assert_eq!(conn.hello.generation, 1);
    let cwd = std::env::temp_dir();
    let run = conn
        .call(
            "terminal.run",
            run_params(
                cwd.to_str().unwrap(),
                "printf '%s\\n' $(seq 1 5000); exit 7",
            ),
        )
        .await
        .unwrap();
    let id = run["address"].as_str().unwrap();
    let mut stream = conn.attach(id, 100, 30, 0).await.unwrap();
    let mut printed = Vec::new();
    let close = loop {
        match tokio::time::timeout(T, stream.next())
            .await
            .unwrap()
            .unwrap()
        {
            Ev::Data(bytes) => printed.extend(bytes),
            Ev::Close(reason) => break reason,
            Ev::Resize(..) => {}
        }
    };
    let expected: String = (1..=5000).map(|n| format!("{n}\r\n")).collect();
    assert_eq!(String::from_utf8(printed).unwrap(), expected);
    assert_eq!(close["exit_code"], 7);
    let got = conn
        .call("terminal.get", json!({"terminal":id}))
        .await
        .unwrap();
    assert_eq!(
        (&got["state"], &got["exit_code"]),
        (&json!("finished"), &json!(7))
    );
}

#[tokio::test]
async fn mc12_core_carries_id_cwd_env_size_and_input() {
    let conn = core().await;
    let cwd = std::fs::canonicalize(std::env::temp_dir()).unwrap();
    let script = "echo \"$HC_TERMINAL_ID $MARK $(pwd) $(stty size)\"; read line; echo got:$line";
    let run = conn
        .call("terminal.run", run_params(cwd.to_str().unwrap(), script))
        .await
        .unwrap();
    let id = run["address"].as_str().unwrap();
    let mut stream = conn.attach(id, 100, 30, 0).await.unwrap();
    stream.send(b"typed\n");
    let mut printed = String::new();
    while !printed.contains("got:typed") {
        match tokio::time::timeout(T, stream.next())
            .await
            .unwrap()
            .unwrap()
        {
            Ev::Data(bytes) => printed.push_str(&String::from_utf8_lossy(&bytes)),
            Ev::Close(_) => break,
            Ev::Resize(..) => {}
        }
    }
    let want = format!("{id} kept {} 30 100", cwd.display());
    assert!(printed.contains(&want), "{printed:?} lacks {want:?}");
    assert!(printed.contains("got:typed"), "{printed:?}");
}

#[tokio::test]
async fn mc12_core_answers_spawn_failed_for_a_bad_cwd_or_program() {
    let conn = core().await;
    let bad_cwd = conn
        .call("terminal.run", run_params("/no/such/dir", "true"))
        .await;
    let bad_program = conn
        .call(
            "terminal.run",
            json!({"argv":["no-such-program"],"cwd":"/tmp","size":{"cols":80,"rows":24}}),
        )
        .await;
    for got in [bad_cwd, bad_program] {
        match got {
            Err(Error::Rpc(e)) => assert_eq!(e.kind, "spawn_failed"),
            other => panic!("{other:?}"),
        }
    }
}
