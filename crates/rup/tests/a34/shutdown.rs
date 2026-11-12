//! D9: coordinated Workstream removal keeps its shutdown waits finite.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![allow(clippy::panic, clippy::indexing_slicing)]

use super::daemon::{self, start};
use super::removal::{agent_in, workstream};
use serde_json::json;

#[tokio::test]
async fn d9_workstream_removal_keeps_finite_shutdown_waits_within_the_app_bound() {
    use std::os::unix::fs::PermissionsExt;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixListener;

    let fixture = tempfile::tempdir().unwrap();
    let socket = fixture.path().join("shutdown.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let program = fixture.path().join("claude");
    // A descendant keeps the PTY open after its Agent is reaped, exercising
    // agents::KILL_WAIT_BOUND. Entry and release travel outside the PTY.
    std::fs::write(
        &program,
        r#"#!/usr/bin/env python3
import os, signal, socket, sys
# Model the capability probe, as e2e/fake_claude.py does, before
# creating descendants that deliberately hold the Agent's PTY open.
if sys.argv[1:3] == ["plugin", "test"]:
    print("Q11 runtime hook closure: 1 pass")
    sys.exit(0)
# Ignore the exit keys too (^C is SIGINT on this PTY), so only the kill ends the Agent.
signal.signal(signal.SIGINT, signal.SIG_IGN)
read, write = os.pipe()
if os.fork() == 0:
    os.close(write)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    ready = socket.socket(socket.AF_UNIX)
    ready.connect(os.environ["D9_SHUTDOWN_SOCKET"])
    ready.sendall(b"R")
    ready.close()
    os.read(read, 1)
    entered = socket.socket(socket.AF_UNIX)
    entered.settimeout(45)
    entered.connect(os.environ["D9_SHUTDOWN_SOCKET"])
    entered.sendall(b"S")
    entered.recv(1)
    entered.sendall(b"X")
    os._exit(0)
os.close(read)
while True:
    signal.pause()
"#,
    )
    .unwrap();
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
    let project = start(&[
        ("ROUNDUP_CLAUDE_BIN", program.to_str().unwrap()),
        ("D9_SHUTDOWN_SOCKET", socket.to_str().unwrap()),
    ]);
    let client = project.client().await;
    let ws = workstream(&client, "bounded removal").await;
    let mut ids = Vec::new();
    for _ in 0..16 {
        let id = agent_in(&project, &client, &ws).await;
        let (mut ready, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(ready.read_u8().await.unwrap(), b'R');
        daemon::signal(
            &client,
            &id,
            json!({"hook_event_name": "SessionEnd", "reason": "done"}),
        )
        .await;
        ids.push(id);
    }
    let began = tokio::time::Instant::now();
    // crates/desktop/src/config.rs: CALL_BOUND is the unchanged App policy.
    let deadline = began + Duration::from_secs(30);
    let removal = client.request("rail.remove", json!({"id": ws}));
    tokio::pin!(removal);
    let entered = async {
        let mut held = Vec::new();
        for _ in 0..16 {
            let (mut stream, _) = listener.accept().await.unwrap();
            assert_eq!(stream.read_u8().await.unwrap(), b'S');
            held.push(stream);
        }
        held
    };
    tokio::pin!(entered);
    let mut held = tokio::select! {
        held = tokio::time::timeout_at(deadline, &mut entered) => held.expect("all sixteen stops entered within CALL_BOUND"),
        result = &mut removal => panic!("removal replied before every shutdown entered: {result:?}"),
    };
    let result = tokio::time::timeout_at(deadline, &mut removal)
        .await
        .expect("finite shutdown waits fit CALL_BOUND")
        .unwrap();
    // Linux keeps reading a slave held by descendants; macOS may hang up when
    // the session leader exits. The signal-driven Agents test proves overlap on both.
    #[cfg(target_os = "linux")]
    assert!(began.elapsed() >= agents::KILL_WAIT_BOUND);
    for id in ids {
        assert!(
            result["removed"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["id"] == id)
        );
    }
    assert!(daemon::rail_tree(&client).await.is_empty());
    for stream in &mut held {
        stream.write_all(b"release").await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(5), stream.read_u8())
                .await
                .unwrap()
                .unwrap(),
            b'X'
        );
    }
}
