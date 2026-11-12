//! MC57: a run with a `herdr-core` on `PATH` that would be the user's core. A test of its own core
//! never starts it, and ends its Terminal.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use herdr::Conn;
use serde_json::json;
use tokio::process::Command;

#[tokio::test]
async fn mc57_no_test_reaches_the_users_core_run() {
    let dir = tempfile::tempdir().unwrap();
    let mark = dir.path().join("reached");
    let stub = dir.path().join("herdr-core");
    std::fs::write(
        &stub,
        format!("#!/bin/sh\ntouch '{}'\nexit 1\n", mark.display()),
    )
    .unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut cmd = Command::new(env!("CARGO_BIN_EXE_herdr-core-test"));
    cmd.arg("connect")
        .env("PATH", format!("{}:/usr/bin:/bin", dir.path().display()))
        .env("HOME", dir.path());
    let conn = Conn::spawn(cmd, Duration::from_secs(10)).await.unwrap();
    let run = conn
        .call(
            "terminal.run",
            json!({"argv":["/bin/sh","-c","sleep 30"],"cwd":dir.path(),"env":{},"size":{"cols":80,"rows":24}}),
        )
        .await
        .unwrap();
    let address = run["address"].as_str().unwrap().to_owned();
    conn.call("terminal.kill", json!({"terminal": address}))
        .await
        .unwrap();
    drop(conn);

    assert!(!mark.exists(), "the user's core was started");
}
